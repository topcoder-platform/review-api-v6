import { createReadStream, promises as fs } from 'fs';
import * as path from 'path';
import readline from 'readline';
import { Prisma, PrismaClient } from '@prisma/client';

type LegacyReviewSummation = {
  id: string;
  submissionId: string;
  aggregateScore: number | string;
  isPassing: boolean | string | number;
  scoreCardId?: number | string | null;
  reviewedDate?: string | null;
  created?: string | null;
  createdBy?: string | null;
  updated?: string | null;
  updatedBy?: string | null;
  metadata?: unknown;
  isFinal?: boolean | string | null;
  isProvisional?: boolean | string | null;
  isExample?: boolean | string | null;
};

type ImportOptions = {
  submissionsDataPath: string;
  summationsDir: string;
  summationsFiles: string[];
  dryRun: boolean;
};

type ImportStats = {
  processed: number;
  created: number;
  updated: number;
  skippedMissingLegacyMapping: number;
  skippedMissingSubmission: number;
  skippedInvalid: number;
};

const prisma = new PrismaClient();

const DEFAULT_SUBMISSIONS_DATA =
  process.env.SUBMISSIONS_DATA_PATH ||
  '/home/ubuntu/submissions-api.data.json';
const DEFAULT_SUMMATIONS_DIR =
  process.env.REVIEW_SUMMATIONS_DIR || '/home/jmgasper/Downloads';

function parseArgs(): ImportOptions {
  let submissionsDataPath = DEFAULT_SUBMISSIONS_DATA;
  let summationsDir = DEFAULT_SUMMATIONS_DIR;
  const summationsFiles: string[] = [];
  let dryRun = false;

  for (const arg of process.argv.slice(2)) {
    if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg.startsWith('--submissions-data=')) {
      submissionsDataPath = arg.split('=')[1];
    } else if (arg.startsWith('--summations-dir=')) {
      summationsDir = arg.split('=')[1];
    } else if (arg.startsWith('--summations-files=')) {
      const value = arg.split('=')[1];
      if (value) {
        for (const file of value.split(',')) {
          if (file.trim()) {
            summationsFiles.push(file.trim());
          }
        }
      }
    }
  }

  return {
    submissionsDataPath: path.resolve(submissionsDataPath),
    summationsDir: path.resolve(summationsDir),
    summationsFiles: summationsFiles.map((file) => path.resolve(file)),
    dryRun,
  };
}

function makeSummationKey(
  submissionId: string,
  scorecardLegacyId?: string | null,
): string {
  return `${submissionId}::${scorecardLegacyId ?? ''}`;
}

function parseDate(value?: string | null): Date | undefined {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return undefined;
  }
  return parsed;
}

function normalizeMetadata(
  metadata?: unknown,
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (metadata === undefined) {
    return undefined;
  }
  if (metadata === null) {
    return Prisma.JsonNull;
  }
  return metadata as Prisma.InputJsonValue;
}

function normalizeBoolean(
  value: boolean | string | number | null | undefined,
): boolean | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  const lowered = value.trim().toLowerCase();
  return lowered === 'true' || lowered === '1';
}

async function loadLegacySubmissionLookup(filePath: string) {
  await fs.access(filePath);

  const submissionToLegacy = new Map<string, string>();
  const stream = createReadStream(filePath, { encoding: 'utf-8' });
  const rl = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });

  for await (const rawLine of rl) {
    const line = rawLine.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line);
      const source = parsed?._source;
      if (source?.resource !== 'submission') continue;
      const legacyId = source.legacySubmissionId;
      const submissionId = source.id || parsed._id;
      if (!legacyId || !submissionId) continue;
      submissionToLegacy.set(String(submissionId), String(legacyId));
    } catch (error) {
      console.warn(`Skipping malformed line in ${filePath}: ${error}`);
    }
  }

  rl.close();
  stream.close();
  console.log(
    `Loaded ${submissionToLegacy.size} legacy submission ids from ${filePath}`,
  );
  return submissionToLegacy;
}

async function loadSummationFiles(options: ImportOptions) {
  if (options.summationsFiles.length) {
    return options.summationsFiles;
  }

  const entries = await fs.readdir(options.summationsDir);
  const files = entries
    .filter((entry) => /^ReviewSummation_part.*\.json$/i.test(entry))
    .sort()
    .map((entry) => path.join(options.summationsDir, entry));

  if (!files.length) {
    throw new Error(
      `No ReviewSummation_part*.json files found in ${options.summationsDir}`,
    );
  }

  return files;
}

async function readSummationFile(filePath: string) {
  const raw = await fs.readFile(filePath, 'utf-8');
  const parsed = JSON.parse(raw.trim());
  if (!Array.isArray(parsed)) {
    throw new Error(`Summation file ${filePath} is not a JSON array`);
  }
  return parsed as LegacyReviewSummation[];
}

async function loadSubmissionMap() {
  const records = await prisma.submission.findMany({
    select: { id: true, legacySubmissionId: true },
    where: { legacySubmissionId: { not: null } },
  });

  const map = new Map<string, string>();
  for (const record of records) {
    if (record.legacySubmissionId) {
      map.set(String(record.legacySubmissionId), record.id);
    }
  }
  console.log(`Cached ${map.size} submissions by legacySubmissionId`);
  return map;
}

async function loadScorecardMap() {
  const records = await prisma.scorecard.findMany({
    select: { id: true, legacyId: true },
    where: { legacyId: { not: null } },
  });

  const map = new Map<string, string>();
  for (const record of records) {
    if (record.legacyId) {
      map.set(record.legacyId, record.id);
    }
  }
  console.log(`Cached ${map.size} scorecards by legacyId`);
  return map;
}

async function loadExistingSummations() {
  const records = await prisma.reviewSummation.findMany({
    select: { id: true, submissionId: true, scorecardLegacyId: true },
  });

  const map = new Map<string, string>();
  for (const record of records) {
    map.set(makeSummationKey(record.submissionId, record.scorecardLegacyId), record.id);
  }

  console.log(
    `Cached ${records.length} existing review summations for update checks`,
  );
  return map;
}

async function processSummations(
  files: string[],
  submissionIdByLegacy: Map<string, string>,
  legacySubmissionLookup: Map<string, string>,
  scorecardIdByLegacy: Map<string, string>,
  existingSummations: Map<string, string>,
  dryRun: boolean,
) {
  const stats: ImportStats = {
    processed: 0,
    created: 0,
    updated: 0,
    skippedMissingLegacyMapping: 0,
    skippedMissingSubmission: 0,
    skippedInvalid: 0,
  };

  for (const file of files) {
    console.log(`Processing ${file}`);
    const records = await readSummationFile(file);

    for (const record of records) {
      stats.processed += 1;

      const legacySubmissionId = legacySubmissionLookup.get(
        record.submissionId,
      );
      if (!legacySubmissionId) {
        stats.skippedMissingLegacyMapping += 1;
        console.warn(
          `Skipping reviewSummation ${record.id}: missing legacySubmissionId for submission ${record.submissionId}`,
        );
        continue;
      }

      const submissionId = submissionIdByLegacy.get(legacySubmissionId);
      if (!submissionId) {
        stats.skippedMissingSubmission += 1;
        console.warn(
          `Skipping reviewSummation ${record.id}: submission with legacySubmissionId=${legacySubmissionId} not found in target DB`,
        );
        continue;
      }

      const aggregateScore = Number(record.aggregateScore);
      if (!Number.isFinite(aggregateScore)) {
        stats.skippedInvalid += 1;
        console.warn(
          `Skipping reviewSummation ${record.id}: aggregateScore "${record.aggregateScore}" is not a finite number`,
        );
        continue;
      }

      const scorecardLegacyId =
        record.scoreCardId === undefined || record.scoreCardId === null
          ? undefined
          : String(record.scoreCardId);
      const scorecardId = scorecardLegacyId
        ? scorecardIdByLegacy.get(scorecardLegacyId)
        : undefined;

      const metadata = normalizeMetadata(record.metadata);
      const reviewedDate = parseDate(record.reviewedDate ?? undefined);
      const createdAt = parseDate(record.created ?? undefined);
      const updatedAt = parseDate(record.updated ?? undefined);
      const isFinal = normalizeBoolean(record.isFinal);
      const isProvisional = normalizeBoolean(record.isProvisional);
      const isExample = normalizeBoolean(record.isExample);
      const isPassing = normalizeBoolean(record.isPassing);

      if (isPassing === undefined || isPassing === null) {
        stats.skippedInvalid += 1;
        console.warn(
          `Skipping reviewSummation ${record.id}: isPassing is missing or invalid`,
        );
        continue;
      }

      const data: Prisma.reviewSummationUncheckedCreateInput = {
        submissionId,
        legacySubmissionId,
        aggregateScore,
        isPassing,
      };

      if (scorecardLegacyId !== undefined) {
        data.scorecardLegacyId = scorecardLegacyId;
      }
      if (scorecardId) {
        data.scorecardId = scorecardId;
      }
      if (reviewedDate) {
        data.reviewedDate = reviewedDate;
      }
      if (createdAt) {
        data.createdAt = createdAt;
      }
      if (updatedAt) {
        data.updatedAt = updatedAt;
      }
      if (record.createdBy) {
        data.createdBy = record.createdBy;
      }
      if (record.updatedBy) {
        data.updatedBy = record.updatedBy;
      }
      if (metadata !== undefined) {
        data.metadata = metadata;
      }
      if (isFinal !== undefined) {
        data.isFinal = isFinal;
      }
      if (isProvisional !== undefined) {
        data.isProvisional = isProvisional;
      }
      if (isExample !== undefined) {
        data.isExample = isExample;
      }

      const key = makeSummationKey(submissionId, scorecardLegacyId);
      const existingId = existingSummations.get(key);

      if (existingId) {
        if (!dryRun) {
          await prisma.reviewSummation.update({
            where: { id: existingId },
            data,
          });
        }
        stats.updated += 1;
        continue;
      }

      if (!dryRun) {
        await prisma.reviewSummation.create({ data });
      }
      stats.created += 1;
    }
  }

  return stats;
}

async function main() {
  const options = parseArgs();
  console.log(`Using submissions data: ${options.submissionsDataPath}`);
  console.log(`Using summations dir: ${options.summationsDir}`);
  if (options.summationsFiles.length) {
    console.log(
      `Summations file override (${options.summationsFiles.length} files): ${options.summationsFiles.join(
        ', ',
      )}`,
    );
  }
  if (options.dryRun) {
    console.log('Running in dry-run mode (no DB writes).');
  }

  try {
    const legacyLookup = await loadLegacySubmissionLookup(
      options.submissionsDataPath,
    );
    const summationFiles = await loadSummationFiles(options);
    const submissionIdByLegacy = await loadSubmissionMap();
    const scorecardIdByLegacy = await loadScorecardMap();
    const existingSummations = await loadExistingSummations();

    const stats = await processSummations(
      summationFiles,
      submissionIdByLegacy,
      legacyLookup,
      scorecardIdByLegacy,
      existingSummations,
      options.dryRun,
    );

    console.log('----------');
    console.log('Import complete');
    console.log(`Processed: ${stats.processed}`);
    console.log(`Created: ${stats.created}`);
    console.log(`Updated: ${stats.updated}`);
    console.log(
      `Skipped (no legacy submission match): ${stats.skippedMissingLegacyMapping}`,
    );
    console.log(
      `Skipped (submission missing in target DB): ${stats.skippedMissingSubmission}`,
    );
    console.log(`Skipped (invalid data): ${stats.skippedInvalid}`);
  } catch (error) {
    console.error('Import failed:', error);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

void main();
