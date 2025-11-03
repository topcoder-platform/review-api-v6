import * as fs from 'node:fs';
import * as path from 'node:path';

import { PrismaClient as ReviewPrismaClient } from '@prisma/client';
import { PrismaClient as ChallengePrismaClient } from '@prisma/client-challenge';

const SCRIPT_ACTOR = 'scripts/backfill-submission-challenge-ids';
const DEFAULT_EXPORT_ROOT = '/mnt/export';
const UPLOAD_FILE_REGEX = /^upload_\d+\.json$/i;
const MAX_UPLOAD_SCAN_DEPTH = 2;

interface UploadRecord {
  upload_id?: string;
  uploadId?: string;
  project_id?: string;
  projectId?: string;
}

interface UpdateCandidate {
  submissionId: string;
  legacyUploadId: string;
  legacyProjectId: number;
}

interface PlannedUpdate extends UpdateCandidate {
  challengeId: string;
}

const reviewPrisma = new ReviewPrismaClient({
  datasources: {
    db: {
      url: process.env.DATABASE_URL,
    },
  },
});

const challengePrisma = new ChallengePrismaClient({
  datasources: {
    db: {
      url: process.env.CHALLENGE_DB_URL,
    },
  },
});

function isTestMode() {
  return process.argv.includes('--test');
}

function collectUploadFiles(root: string, maxDepth = MAX_UPLOAD_SCAN_DEPTH) {
  if (!fs.existsSync(root)) {
    throw new Error(`Upload export directory "${root}" does not exist.`);
  }

  const files: string[] = [];
  const queue: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];

  while (queue.length) {
    const { dir, depth } = queue.shift()!;
    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const entryPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (depth < maxDepth) {
          queue.push({ dir: entryPath, depth: depth + 1 });
        }
        continue;
      }

      if (entry.isFile() && UPLOAD_FILE_REGEX.test(entry.name)) {
        files.push(entryPath);
      }
    }
  }

  return files;
}

function parseUploadFile(filePath: string) {
  const content = fs.readFileSync(filePath, 'utf-8').trim();
  if (!content) {
    return [] as UploadRecord[];
  }

  const hydrateRecords = (value: unknown): UploadRecord[] => {
    if (Array.isArray(value)) {
      return value as UploadRecord[];
    }
    if (value && typeof value === 'object') {
      const possibleKeys = ['upload', 'uploads', 'data'];
      for (const key of possibleKeys) {
        const candidate = (value as Record<string, unknown>)[key];
        if (Array.isArray(candidate)) {
          return candidate as UploadRecord[];
        }
      }
      const record = value as UploadRecord;
      if (
        record.upload_id ||
        record.uploadId ||
        record.project_id ||
        record.projectId
      ) {
        return [record];
      }
    }
    return [];
  };

  try {
    const parsed = JSON.parse(content);
    const records = hydrateRecords(parsed);
    if (records.length) {
      return records;
    }
    console.warn(
      `No upload records detected in ${filePath} after JSON parse; falling back to line parsing.`,
    );
  } catch {
    // Intentionally swallow; we will try per-line parsing next.
  }

  const records: UploadRecord[] = [];
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    try {
      const parsedLine = JSON.parse(trimmed);
      records.push(...hydrateRecords(parsedLine));
    } catch (error) {
      console.warn(
        `Skipping malformed JSON line in ${filePath}: ${(error as Error).message}`,
      );
    }
  }
  return records;
}

function buildUploadLookup(files: string[]) {
  const map = new Map<string, UploadRecord>();

  for (const file of files) {
    const records = parseUploadFile(file);
    if (records.length === 0) {
      console.warn(`No upload records parsed from ${file}`);
      continue;
    }
    for (const record of records) {
      const uploadId = record.upload_id ?? record.uploadId;
      if (!uploadId) {
        continue;
      }

      const normalizedUploadId = uploadId.trim();
      if (!normalizedUploadId) {
        continue;
      }

      if (!map.has(normalizedUploadId)) {
        map.set(normalizedUploadId, record);
      }
    }
  }

  return map;
}

async function gatherUpdateCandidates(uploadLookup: Map<string, UploadRecord>) {
  const submissions = await reviewPrisma.submission.findMany({
    where: {
      challengeId: null,
      legacyUploadId: {
        not: null,
      },
    },
    select: {
      id: true,
      legacyUploadId: true,
    },
  });

  const candidates: UpdateCandidate[] = [];
  const missingUploadRecords: Array<{ submissionId: string; legacyUploadId: string }> = [];
  const missingProjectIds: Array<{ submissionId: string; legacyUploadId: string }> = [];

  for (const submission of submissions) {
    const legacyUploadId = submission.legacyUploadId?.trim();
    if (!legacyUploadId) {
      continue;
    }

    const uploadRecord = uploadLookup.get(legacyUploadId);
    if (!uploadRecord) {
      missingUploadRecords.push({
        submissionId: submission.id,
        legacyUploadId,
      });
      continue;
    }

    const rawProjectId =
      uploadRecord.project_id ?? uploadRecord.projectId;

    if (!rawProjectId) {
      missingProjectIds.push({
        submissionId: submission.id,
        legacyUploadId,
      });
      continue;
    }

    const projectIdNumber = Number(rawProjectId);
    if (!Number.isFinite(projectIdNumber)) {
      missingProjectIds.push({
        submissionId: submission.id,
        legacyUploadId,
      });
      continue;
    }

    candidates.push({
      submissionId: submission.id,
      legacyUploadId,
      legacyProjectId: projectIdNumber,
    });
  }

  return {
    candidates,
    missingUploadRecords,
    missingProjectIds,
  };
}

async function resolveChallengeIds(candidates: UpdateCandidate[]) {
  const uniqueLegacyProjectIds = Array.from(
    new Set(candidates.map((candidate) => candidate.legacyProjectId)),
  );

  if (!uniqueLegacyProjectIds.length) {
    return {
      plannedUpdates: [] as PlannedUpdate[],
      unresolvedProjects: [] as number[],
    };
  }

  const challenges = await challengePrisma.challenge.findMany({
    where: {
      legacyId: {
        in: uniqueLegacyProjectIds,
      },
    },
    select: {
      id: true,
      legacyId: true,
    },
  });

  const challengeMap = new Map<number, string>();
  for (const challenge of challenges) {
    if (typeof challenge.legacyId === 'number') {
      challengeMap.set(challenge.legacyId, challenge.id);
    }
  }

  const plannedUpdates: PlannedUpdate[] = [];
  const unresolvedProjects: number[] = [];

  for (const candidate of candidates) {
    const challengeId = challengeMap.get(candidate.legacyProjectId);
    if (!challengeId) {
      unresolvedProjects.push(candidate.legacyProjectId);
      continue;
    }

    plannedUpdates.push({
      ...candidate,
      challengeId,
    });
  }

  return {
    plannedUpdates,
    unresolvedProjects,
  };
}

async function applyUpdates(plannedUpdates: PlannedUpdate[], testMode: boolean) {
  if (!plannedUpdates.length) {
    console.log('No submission challenge IDs require backfilling.');
    return;
  }

  console.log(
    `${plannedUpdates.length} submissions ${testMode ? 'would be updated' : 'will be updated'
    } with challenge IDs.`,
  );

  if (testMode) {
    for (const update of plannedUpdates) {
      console.log(
        JSON.stringify(
          {
            submissionId: update.submissionId,
            legacyUploadId: update.legacyUploadId,
            legacyProjectId: update.legacyProjectId,
            challengeId: update.challengeId,
          },
        ),
      );
    }
    return;
  }

  const BATCH_SIZE = 25;
  for (let i = 0; i < plannedUpdates.length; i += BATCH_SIZE) {
    const batch = plannedUpdates.slice(i, i + BATCH_SIZE);
    await reviewPrisma.$transaction(
      batch.map((update) =>
        reviewPrisma.submission.update({
          where: { id: update.submissionId },
          data: {
            challengeId: update.challengeId,
            updatedBy: SCRIPT_ACTOR,
          },
        }),
      ),
    );
  }

  console.log(`Updated ${plannedUpdates.length} submissions with new challenge IDs.`);
}

async function main() {
  const testMode = isTestMode();
  const exportRoot = process.env.UPLOAD_EXPORT_DIR ?? DEFAULT_EXPORT_ROOT;

  console.log(`Loading upload data from ${exportRoot}...`);
  const uploadFiles = collectUploadFiles(exportRoot);
  if (!uploadFiles.length) {
    throw new Error(
      `No files matching "upload_*.json" found under ${exportRoot}. Adjust UPLOAD_EXPORT_DIR if needed.`,
    );
  }

  console.log(`Found ${uploadFiles.length} upload reference files.`);
  const uploadLookup = buildUploadLookup(uploadFiles);
  console.log(`Loaded ${uploadLookup.size} upload records into memory.`);

  const {
    candidates,
    missingUploadRecords,
    missingProjectIds,
  } = await gatherUpdateCandidates(uploadLookup);

  if (missingUploadRecords.length) {
    console.warn(
      `Skipped ${missingUploadRecords.length} submissions because no upload record was found.`,
    );
  }

  if (missingProjectIds.length) {
    console.warn(
      `Skipped ${missingProjectIds.length} submissions because the upload lacked a project ID.`,
    );
  }

  const { plannedUpdates, unresolvedProjects } = await resolveChallengeIds(candidates);

  if (unresolvedProjects.length) {
    const uniqueUnresolved = Array.from(new Set(unresolvedProjects));
    console.warn(
      `Could not resolve ${uniqueUnresolved.length} legacy project IDs to challenges.`,
    );
    console.warn(JSON.stringify(uniqueUnresolved.slice(0, 50)));
  }

  await applyUpdates(plannedUpdates, testMode);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await reviewPrisma.$disconnect();
    await challengePrisma.$disconnect();
  });
