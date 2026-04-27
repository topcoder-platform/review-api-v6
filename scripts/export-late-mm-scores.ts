import axios, { AxiosResponse } from 'axios';
import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from '@aws-sdk/client-s3';
import { execFile } from 'child_process';
import { createWriteStream } from 'fs';
import { mkdir, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join, posix as pathPosix } from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const DEFAULT_OUTPUT_DIR = '/home/jmgasper/Downloads/LateMMScores';
const DEFAULT_API_BASE_URL = 'https://api.topcoder.com/v6';
const DEFAULT_CHALLENGES_URL = `${DEFAULT_API_BASE_URL}/challenges`;
const DEFAULT_SUBMISSIONS_URL = `${DEFAULT_API_BASE_URL}/submissions`;
const DEFAULT_START_MATCH = 110;
const DEFAULT_END_MATCH = 163;
const DEFAULT_PAGE_SIZE = 100;
const DEFAULT_SUBMISSION_CONCURRENCY = 3;
const REVIEW_JSON_MAX_BUFFER_BYTES = 100 * 1024 * 1024;

interface Challenge {
  id: string;
  name: string;
}

interface Submission {
  id: string;
  esId?: string | null;
  memberId?: string | number | null;
  legacySubmissionId?: string | number | null;
}

interface SubmissionPage {
  data?: Submission[];
  meta?: {
    totalPages?: number;
  };
}

interface ScriptConfig {
  authHeader: string;
  artifactBucket: string;
  challengesUrl: string;
  submissionsUrl: string;
  outputDir: string;
  startMatch: number;
  endMatch: number;
  pageSize: number;
  submissionConcurrency: number;
}

interface ArtifactCandidate {
  key: string;
  lookupPrefix: string;
  fileName: string;
  kind: 'system' | 'provisional';
  lastModified?: Date;
}

interface ExportSummary {
  challenges: number;
  submissions: number;
  artifactsFound: number;
  reviewsExtracted: number;
  skippedNoArtifact: number;
  failures: number;
}

/**
 * Reads a positive integer from an environment variable.
 *
 * @param value - Environment variable value to parse.
 * @param fallback - Default value used when the variable is empty or invalid.
 * @returns A positive integer suitable for pagination, ranges, or concurrency.
 */
function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
): number {
  const parsed = Number(value ?? '');
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

/**
 * Resolves the first populated environment variable from a list of names.
 *
 * @param names - Environment variable names to check in priority order.
 * @returns The trimmed environment variable value, or undefined when none exist.
 */
function getFirstEnv(names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim();
    if (value) {
      return value;
    }
  }
  return undefined;
}

/**
 * Normalizes a Topcoder API base URL or collection URL into a collection URL.
 *
 * @param value - User-provided base URL or full collection URL.
 * @param collectionName - API collection segment, such as challenges.
 * @param fallback - Default full collection URL used when no value is provided.
 * @returns A URL that points at the requested API collection.
 */
function normalizeCollectionUrl(
  value: string | undefined,
  collectionName: string,
  fallback: string,
): string {
  if (!value?.trim()) {
    return fallback;
  }

  const trimmed = value.trim().replace(/\/+$/, '');
  const lower = trimmed.toLowerCase();
  const collectionSuffix = `/${collectionName.toLowerCase()}`;

  if (lower.endsWith(collectionSuffix)) {
    return trimmed;
  }

  if (/\/v\d+$/.test(lower)) {
    return `${trimmed}/${collectionName}`;
  }

  return `${trimmed}/v6/${collectionName}`;
}

/**
 * Loads and validates all configuration needed by the export script.
 *
 * @returns Parsed script configuration from environment variables.
 * @throws Error when required token or S3 bucket configuration is missing.
 */
function loadConfig(): ScriptConfig {
  const apiBaseUrl = process.env.LATE_MM_API_BASE_URL?.trim();
  const token = getFirstEnv([
    'M2M_TOKEN',
    'TC_M2M_TOKEN',
    'TOPCODER_M2M_TOKEN',
    'AUTH_TOKEN',
  ]);
  if (!token) {
    throw new Error(
      'Missing M2M token. Set M2M_TOKEN, TC_M2M_TOKEN, TOPCODER_M2M_TOKEN, or AUTH_TOKEN.',
    );
  }

  const artifactBucket = process.env.ARTIFACTS_S3_BUCKET?.trim();
  if (!artifactBucket) {
    throw new Error('Missing ARTIFACTS_S3_BUCKET.');
  }

  const startMatch = parsePositiveInteger(
    process.env.LATE_MM_START,
    DEFAULT_START_MATCH,
  );
  const endMatch = parsePositiveInteger(
    process.env.LATE_MM_END,
    DEFAULT_END_MATCH,
  );
  if (endMatch < startMatch) {
    throw new Error(
      `Invalid match range: LATE_MM_END (${endMatch}) is before LATE_MM_START (${startMatch}).`,
    );
  }

  return {
    authHeader: token.toLowerCase().startsWith('bearer ')
      ? token
      : `Bearer ${token}`,
    artifactBucket,
    challengesUrl: normalizeCollectionUrl(
      getFirstEnv(['LATE_MM_CHALLENGES_URL']) ?? apiBaseUrl,
      'challenges',
      DEFAULT_CHALLENGES_URL,
    ),
    submissionsUrl: normalizeCollectionUrl(
      getFirstEnv(['LATE_MM_SUBMISSIONS_URL']) ?? apiBaseUrl,
      'submissions',
      DEFAULT_SUBMISSIONS_URL,
    ),
    outputDir: process.env.LATE_MM_OUTPUT_DIR?.trim() || DEFAULT_OUTPUT_DIR,
    startMatch,
    endMatch,
    pageSize: parsePositiveInteger(
      process.env.LATE_MM_PAGE_SIZE,
      DEFAULT_PAGE_SIZE,
    ),
    submissionConcurrency: parsePositiveInteger(
      process.env.LATE_MM_SUBMISSION_CONCURRENCY,
      DEFAULT_SUBMISSION_CONCURRENCY,
    ),
  };
}

/**
 * Extracts the numeric Marathon Match suffix from a challenge name.
 *
 * @param name - Challenge name returned by challenge-api-v6.
 * @returns The numeric suffix when the name is exactly Marathon Match NNN.
 */
function getMarathonMatchNumber(name: string): number | undefined {
  const match = name.trim().match(/^Marathon Match\s+(\d+)$/i);
  if (!match) {
    return undefined;
  }
  return Number(match[1]);
}

/**
 * Converts a possibly paginated API response into an array.
 *
 * @param data - Raw response body from Topcoder APIs.
 * @returns The response collection regardless of whether it is wrapped in data.
 */
function extractResponseItems<T>(data: unknown): T[] {
  if (Array.isArray(data)) {
    return data as T[];
  }

  const wrapped = data as { data?: unknown; result?: unknown };
  if (Array.isArray(wrapped.data)) {
    return wrapped.data as T[];
  }
  if (Array.isArray(wrapped.result)) {
    return wrapped.result as T[];
  }

  return [];
}

/**
 * Reads total pages from a Topcoder paginated response.
 *
 * @param response - Axios response whose headers or body may contain total pages.
 * @returns The total page count when present.
 */
function getTotalPages(response: AxiosResponse<unknown>): number | undefined {
  const headerValue = response.headers['x-total-pages'];
  const bodyValue = (response.data as SubmissionPage)?.meta?.totalPages;
  const parsed = Number(headerValue ?? bodyValue ?? '');
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

/**
 * Fetches target Marathon Match challenges from challenge-api-v6.
 *
 * @param config - Script configuration containing API URLs and auth header.
 * @returns Challenges whose names are exactly Marathon Match 110 through 163 by default.
 */
async function fetchTargetChallenges(
  config: ScriptConfig,
): Promise<Challenge[]> {
  const byId = new Map<string, Challenge>();
  let page = 1;

  while (true) {
    const response = await axios.get<unknown>(config.challengesUrl, {
      headers: { Authorization: config.authHeader },
      params: {
        name: 'Marathon Match',
        page,
        perPage: config.pageSize,
      },
    });

    const challenges = extractResponseItems<Challenge>(response.data);
    for (const challenge of challenges) {
      const matchNumber = getMarathonMatchNumber(challenge.name ?? '');
      if (
        matchNumber !== undefined &&
        matchNumber >= config.startMatch &&
        matchNumber <= config.endMatch
      ) {
        byId.set(challenge.id, challenge);
      }
    }

    const totalPages = getTotalPages(response);
    if (totalPages ? page >= totalPages : challenges.length < config.pageSize) {
      break;
    }
    page += 1;
  }

  return Array.from(byId.values()).sort((a, b) => {
    const aNumber = getMarathonMatchNumber(a.name) ?? 0;
    const bNumber = getMarathonMatchNumber(b.name) ?? 0;
    return aNumber - bNumber || a.name.localeCompare(b.name);
  });
}

/**
 * Fetches all submissions for a challenge from review-api-v6.
 *
 * @param challengeId - Challenge UUID to query submissions for.
 * @param config - Script configuration containing API URL and auth header.
 * @returns All submissions associated with the challenge.
 */
async function fetchSubmissionsForChallenge(
  challengeId: string,
  config: ScriptConfig,
): Promise<Submission[]> {
  const submissions: Submission[] = [];
  let page = 1;

  while (true) {
    const response = await axios.get<unknown>(config.submissionsUrl, {
      headers: { Authorization: config.authHeader },
      params: {
        challengeId,
        page,
        perPage: config.pageSize,
      },
    });

    const pageSubmissions = extractResponseItems<Submission>(response.data);
    submissions.push(...pageSubmissions);

    const totalPages = getTotalPages(response);
    if (
      totalPages ? page >= totalPages : pageSubmissions.length < config.pageSize
    ) {
      break;
    }
    page += 1;
  }

  return submissions;
}

/**
 * Determines whether an S3 object key is a target internal review artifact.
 *
 * @param key - S3 object key under a submission artifact prefix.
 * @returns Artifact kind for system/provisional internal zips, otherwise undefined.
 */
function classifyArtifactKey(
  key: string,
): ArtifactCandidate['kind'] | undefined {
  const fileName = pathPosix.basename(key).toLowerCase();
  const dot = fileName.lastIndexOf('.');
  const artifactId = dot > 0 ? fileName.substring(0, dot) : fileName;

  if (
    fileName.endsWith('system-internal.zip') ||
    artifactId.endsWith('system-internal.zip')
  ) {
    return 'system';
  }

  if (
    fileName.endsWith('provisional-internal.zip') ||
    artifactId.endsWith('provisional-internal.zip')
  ) {
    return 'provisional';
  }

  return undefined;
}

/**
 * Lists matching internal artifact zips from S3 for a submission.
 *
 * @param s3 - AWS S3 client configured through the default provider chain.
 * @param config - Script configuration containing the artifact bucket.
 * @param lookupPrefix - S3 key prefix whose artifacts should be scanned.
 * @returns Matching system/provisional internal artifact candidates.
 */
async function listInternalArtifactCandidates(
  s3: S3Client,
  config: ScriptConfig,
  lookupPrefix: string,
): Promise<ArtifactCandidate[]> {
  const candidates: ArtifactCandidate[] = [];
  let continuationToken: string | undefined;
  const s3Prefix = `${lookupPrefix}/`;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: config.artifactBucket,
        Prefix: s3Prefix,
        ContinuationToken: continuationToken,
      }),
    );

    for (const object of response.Contents ?? []) {
      if (!object.Key) {
        continue;
      }
      const kind = classifyArtifactKey(object.Key);
      if (!kind) {
        continue;
      }
      candidates.push({
        key: object.Key,
        lookupPrefix,
        fileName: pathPosix.basename(object.Key),
        kind,
        lastModified: object.LastModified,
      });
    }

    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return candidates;
}

/**
 * Builds the S3 artifact prefixes to scan for a submission.
 *
 * review-api-v6 stores current artifacts under submission.id, while migrated
 * submissions may still need inspection by esId when debugging legacy data.
 *
 * @param submission - Submission API response.
 * @returns Unique S3 key prefixes to inspect for internal artifact zips.
 */
function getSubmissionArtifactLookupPrefixes(submission: Submission): string[] {
  return [submission.id, submission.esId]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

/**
 * Formats an S3 artifact prefix as a URI for operator-facing logs.
 *
 * @param bucket - S3 bucket name.
 * @param lookupPrefix - S3 key prefix without trailing slash.
 * @returns Full S3 URI prefix.
 */
function formatArtifactLookupPath(
  bucket: string,
  lookupPrefix: string,
): string {
  return `s3://${bucket}/${lookupPrefix}/`;
}

/**
 * Selects the best artifact when a submission has multiple internal zips.
 *
 * @param candidates - Matching S3 artifacts for a submission.
 * @returns The preferred artifact, favoring system-internal over provisional-internal.
 */
function selectArtifact(
  candidates: ArtifactCandidate[],
): ArtifactCandidate | undefined {
  const priority: Record<ArtifactCandidate['kind'], number> = {
    system: 0,
    provisional: 1,
  };

  return [...candidates].sort((a, b) => {
    const priorityDiff = priority[a.kind] - priority[b.kind];
    if (priorityDiff !== 0) {
      return priorityDiff;
    }

    const aTime = a.lastModified?.getTime() ?? 0;
    const bTime = b.lastModified?.getTime() ?? 0;
    return bTime - aTime;
  })[0];
}

/**
 * Converts an S3 response body into a Node.js readable stream.
 *
 * @param body - Body returned by GetObjectCommand.
 * @returns A readable stream that can be piped to disk.
 * @throws Error when the S3 body type cannot be streamed in Node.
 */
async function toReadableStream(body: unknown): Promise<Readable> {
  if (body && typeof (body as Readable).pipe === 'function') {
    return body as Readable;
  }

  if (
    body &&
    typeof (body as { transformToByteArray?: () => Promise<Uint8Array> })
      .transformToByteArray === 'function'
  ) {
    const bytes = await (
      body as { transformToByteArray: () => Promise<Uint8Array> }
    ).transformToByteArray();
    return Readable.from([Buffer.from(bytes)]);
  }

  throw new Error('Unsupported S3 Body stream type.');
}

/**
 * Downloads an S3 object to a local zip path.
 *
 * @param s3 - AWS S3 client.
 * @param config - Script configuration containing the artifact bucket.
 * @param artifact - Artifact candidate to download.
 * @param zipPath - Local path where the zip should be written.
 */
async function downloadArtifactZip(
  s3: S3Client,
  config: ScriptConfig,
  artifact: ArtifactCandidate,
  zipPath: string,
): Promise<void> {
  const response = await s3.send(
    new GetObjectCommand({
      Bucket: config.artifactBucket,
      Key: artifact.key,
    }),
  );

  await pipeline(
    await toReadableStream(response.Body),
    createWriteStream(zipPath),
  );
}

/**
 * Finds the reviews.json entry inside a zip file.
 *
 * @param zipPath - Local zip file path.
 * @returns The zip entry path to reviews.json, or undefined when not present.
 */
async function findReviewsJsonEntry(
  zipPath: string,
): Promise<string | undefined> {
  const { stdout } = await execFileAsync('unzip', ['-Z', '-1', zipPath], {
    maxBuffer: REVIEW_JSON_MAX_BUFFER_BYTES,
  });
  const entries = String(stdout)
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);

  return entries
    .filter(
      (entry) => pathPosix.basename(entry).toLowerCase() === 'reviews.json',
    )
    .sort((a, b) => {
      if (a === 'reviews.json') {
        return -1;
      }
      if (b === 'reviews.json') {
        return 1;
      }
      return a.length - b.length || a.localeCompare(b);
    })[0];
}

/**
 * Extracts reviews.json content from a zip file.
 *
 * @param zipPath - Local zip file path.
 * @returns The reviews.json file contents, or undefined when the entry is missing.
 */
async function extractReviewsJson(
  zipPath: string,
): Promise<string | undefined> {
  const entry = await findReviewsJsonEntry(zipPath);
  if (!entry) {
    return undefined;
  }

  const { stdout } = await execFileAsync('unzip', ['-p', zipPath, entry], {
    maxBuffer: REVIEW_JSON_MAX_BUFFER_BYTES,
  });
  return String(stdout);
}

/**
 * Sanitizes one filesystem path segment while preserving readable names.
 *
 * @param value - Raw value to use as a path segment.
 * @param fallback - Segment value used when the raw value is empty.
 * @returns A safe filename or directory segment.
 */
function sanitizePathSegment(value: string, fallback: string): string {
  const unsafeCharacters = new Set([
    '<',
    '>',
    ':',
    '"',
    '/',
    '\\',
    '|',
    '?',
    '*',
  ]);
  const sanitized = Array.from(value.trim().replace(/\s+/g, ' '))
    .map((character) =>
      character.charCodeAt(0) < 32 || unsafeCharacters.has(character)
        ? '_'
        : character,
    )
    .join('');

  return sanitized && sanitized !== '.' && sanitized !== '..'
    ? sanitized
    : fallback;
}

/**
 * Converts an optional submission field to a non-empty string.
 *
 * @param value - Submission field value.
 * @param fallback - Fallback value used when the field is absent.
 * @returns A string safe for follow-up path sanitization.
 */
function stringifyField(
  value: string | number | null | undefined,
  fallback: string,
): string {
  const stringValue = String(value ?? '').trim();
  return stringValue || fallback;
}

/**
 * Writes extracted reviews JSON into the LateMMScores directory structure.
 *
 * @param config - Script configuration containing output directory.
 * @param challenge - Challenge that owns the submission.
 * @param submission - Submission whose artifact was extracted.
 * @param reviewsJson - Extracted reviews.json contents.
 * @returns The final JSON file path.
 */
async function writeReviewsJson(
  config: ScriptConfig,
  challenge: Challenge,
  submission: Submission,
  reviewsJson: string,
): Promise<string> {
  const challengeSegment = sanitizePathSegment(challenge.name, challenge.id);
  const memberId = stringifyField(submission.memberId, 'unknown');
  const memberSegment = sanitizePathSegment(
    `coder_${memberId}`,
    'coder_unknown',
  );
  const legacySubmissionId = stringifyField(
    submission.legacySubmissionId,
    submission.id,
  );
  const fileSegment = `${sanitizePathSegment(
    legacySubmissionId,
    submission.id,
  )}.json`;
  const targetDir = join(config.outputDir, challengeSegment, memberSegment);
  const targetPath = join(targetDir, fileSegment);

  await mkdir(targetDir, { recursive: true });
  await writeFile(targetPath, reviewsJson);

  return targetPath;
}

/**
 * Processes one submission by finding, downloading, extracting, and writing reviews.
 *
 * @param s3 - AWS S3 client.
 * @param config - Script configuration.
 * @param challenge - Challenge that owns the submission.
 * @param submission - Submission to process.
 * @param tempDir - Directory used for temporary zip downloads.
 * @param summary - Mutable export summary updated as the submission is processed.
 */
async function processSubmission(
  s3: S3Client,
  config: ScriptConfig,
  challenge: Challenge,
  submission: Submission,
  tempDir: string,
  summary: ExportSummary,
): Promise<void> {
  let zipPath: string | undefined;
  const lookupPrefixes = getSubmissionArtifactLookupPrefixes(submission);
  const lookupPaths = lookupPrefixes.map((lookupPrefix) =>
    formatArtifactLookupPath(config.artifactBucket, lookupPrefix),
  );

  try {
    const candidateLists = await Promise.all(
      lookupPrefixes.map((lookupPrefix) =>
        listInternalArtifactCandidates(s3, config, lookupPrefix),
      ),
    );
    const candidates = candidateLists.flat();
    const artifact = selectArtifact(candidates);
    if (!artifact) {
      summary.skippedNoArtifact += 1;
      console.log(
        `  - ${submission.id}: no internal review zip artifact; checked ${lookupPaths.join(', ')}`,
      );
      return;
    }

    summary.artifactsFound += 1;
    zipPath = join(
      tempDir,
      `${sanitizePathSegment(submission.id, 'submission')}-${artifact.kind}.zip`,
    );

    await downloadArtifactZip(s3, config, artifact, zipPath);
    console.log(
      `  - ${submission.id}: found ${artifact.fileName} at ${formatArtifactLookupPath(
        config.artifactBucket,
        artifact.lookupPrefix,
      )}`,
    );
    const reviewsJson = await extractReviewsJson(zipPath);
    if (!reviewsJson) {
      summary.failures += 1;
      console.warn(
        `  - ${submission.id}: ${artifact.fileName} did not contain reviews.json`,
      );
      return;
    }

    const targetPath = await writeReviewsJson(
      config,
      challenge,
      submission,
      reviewsJson,
    );
    summary.reviewsExtracted += 1;
    console.log(`  - ${submission.id}: wrote ${targetPath}`);
  } catch (error) {
    summary.failures += 1;
    console.error(
      `  - ${submission.id}: failed to process artifact after checking ${lookupPaths.join(', ')}: ${
        (error as Error).message
      }`,
    );
  } finally {
    if (zipPath) {
      await rm(zipPath, { force: true });
    }
  }
}

/**
 * Runs asynchronous work over items with bounded concurrency.
 *
 * @param items - Items to process.
 * @param concurrency - Maximum number of in-flight tasks.
 * @param worker - Async worker invoked once per item.
 */
async function runWithConcurrency<T>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  const inFlight = new Set<Promise<void>>();

  for (const item of items) {
    const promise = worker(item).finally(() => {
      inFlight.delete(promise);
    });
    inFlight.add(promise);

    if (inFlight.size >= concurrency) {
      await Promise.race(inFlight);
    }
  }

  await Promise.all(inFlight);
}

/**
 * Coordinates the Marathon Match score export workflow.
 *
 * @throws Error when required configuration is missing or API discovery fails.
 */
async function main(): Promise<void> {
  const config = loadConfig();
  const s3 = new S3Client({});
  const tempDir = join(tmpdir(), `late-mm-scores-${process.pid}`);
  const summary: ExportSummary = {
    challenges: 0,
    submissions: 0,
    artifactsFound: 0,
    reviewsExtracted: 0,
    skippedNoArtifact: 0,
    failures: 0,
  };

  await mkdir(config.outputDir, { recursive: true });
  await mkdir(tempDir, { recursive: true });

  console.log(
    `Exporting Marathon Match ${config.startMatch}-${config.endMatch} review scores to ${config.outputDir}`,
  );
  console.log(`Challenge API: ${config.challengesUrl}`);
  console.log(`Submission API: ${config.submissionsUrl}`);
  console.log(`Artifact bucket: ${config.artifactBucket}`);

  try {
    const challenges = await fetchTargetChallenges(config);
    summary.challenges = challenges.length;
    console.log(`Found ${challenges.length} matching challenges.`);

    for (const challenge of challenges) {
      const submissions = await fetchSubmissionsForChallenge(
        challenge.id,
        config,
      );
      summary.submissions += submissions.length;
      console.log(
        `${challenge.name} (${challenge.id}): ${submissions.length} submissions`,
      );

      await runWithConcurrency(
        submissions,
        config.submissionConcurrency,
        async (submission) =>
          processSubmission(
            s3,
            config,
            challenge,
            submission,
            tempDir,
            summary,
          ),
      );
    }
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }

  console.log('--- Summary ------------------------------------------------');
  console.log(`Challenges scanned: ${summary.challenges}`);
  console.log(`Submissions scanned: ${summary.submissions}`);
  console.log(`Internal artifacts found: ${summary.artifactsFound}`);
  console.log(`reviews.json files written: ${summary.reviewsExtracted}`);
  console.log(
    `Submissions without matching artifact: ${summary.skippedNoArtifact}`,
  );
  console.log(`Failures: ${summary.failures}`);

  if (summary.failures > 0) {
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error('Late Marathon Match score export failed.');
  console.error(error);
  process.exit(1);
});
