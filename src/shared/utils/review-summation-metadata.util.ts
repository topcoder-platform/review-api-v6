import { Prisma } from '@prisma/client';

type MetadataRecord = Record<string, unknown>;
type SafeTestProcess = 'provisional' | 'system';
type SafeTestStatus = 'FAILED' | 'IN PROGRESS' | 'SUCCESS';
const ISO_TIMESTAMP_PATTERN =
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

/**
 * Checks whether a value can be inspected as metadata key/value pairs.
 * @param value Raw metadata value.
 * @returns `true` when the value is a non-array object.
 * Used before reading persisted review summation metadata.
 */
function isMetadataRecord(value: unknown): value is MetadataRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Normalizes test process metadata to the member-visible process values.
 * @param value Raw metadata value.
 * @returns Safe process value, or `undefined` when the value is unsupported.
 * Used by `buildSafeReviewSummationMetadata` to avoid leaking free-form text.
 */
function normalizeTestProcess(value: unknown): SafeTestProcess | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === 'provisional' || normalized === 'system'
    ? normalized
    : undefined;
}

/**
 * Normalizes test status metadata to the supported status flags.
 * @param value Raw metadata value.
 * @returns Safe status value, or `undefined` when the value is unsupported.
 * Used by `buildSafeReviewSummationMetadata` to avoid leaking free-form text.
 */
function normalizeTestStatus(value: unknown): SafeTestStatus | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return normalized === 'FAILED' ||
    normalized === 'IN PROGRESS' ||
    normalized === 'SUCCESS'
    ? normalized
    : undefined;
}

/**
 * Normalizes numeric progress/count metadata.
 * @param value Raw metadata value.
 * @returns Safe numeric value, or `undefined` when the value is unsupported.
 * Used by `buildSafeReviewSummationMetadata` to avoid leaking object or array values.
 */
function normalizeNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

/**
 * Normalizes ISO timestamp metadata.
 * @param value Raw metadata value.
 * @returns Safe timestamp value, or `undefined` when the value is unsupported.
 * Used by `buildSafeReviewSummationMetadata` to avoid leaking free-form text.
 */
function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }
  return ISO_TIMESTAMP_PATTERN.test(value) &&
    Number.isFinite(new Date(value).getTime())
    ? value
    : undefined;
}

/**
 * Copies a normalized JSON value into a metadata object when present.
 * @param destination Metadata object to write to.
 * @param key Metadata key to set.
 * @param value Normalized JSON value, or `undefined` when unsupported.
 * Used by `buildSafeReviewSummationMetadata` to omit unsafe or absent fields.
 */
function setDefined(
  destination: Prisma.JsonObject,
  key: string,
  value: Prisma.JsonValue | undefined,
): void {
  if (value !== undefined) {
    destination[key] = value;
  }
}

/**
 * Builds a member-safe review summation metadata object containing only progress state.
 * @param metadata Raw persisted review summation metadata.
 * @returns Sanitized metadata, or `null` when no progress metadata is present.
 * Used by member-facing review summation and submission responses to avoid exposing per-seed scores.
 */
export function buildSafeReviewSummationMetadata(
  metadata: unknown,
): Prisma.JsonObject | null {
  if (!isMetadataRecord(metadata)) {
    return null;
  }

  const safeMetadata: Prisma.JsonObject = {};
  setDefined(
    safeMetadata,
    'testProcess',
    normalizeTestProcess(metadata.testProcess),
  );
  setDefined(
    safeMetadata,
    'testProgress',
    normalizeNumber(metadata.testProgress),
  );
  setDefined(
    safeMetadata,
    'testStatus',
    normalizeTestStatus(metadata.testStatus),
  );
  setDefined(safeMetadata, 'testType', normalizeTestProcess(metadata.testType));

  if (isMetadataRecord(metadata.testProgressDetails)) {
    const details = metadata.testProgressDetails;
    const safeDetails: Prisma.JsonObject = {};
    setDefined(
      safeDetails,
      'completedTests',
      normalizeNumber(details.completedTests),
    );
    setDefined(
      safeDetails,
      'failedTests',
      normalizeNumber(details.failedTests),
    );
    setDefined(safeDetails, 'progress', normalizeNumber(details.progress));
    setDefined(safeDetails, 'status', normalizeTestStatus(details.status));
    setDefined(
      safeDetails,
      'testProcess',
      normalizeTestProcess(details.testProcess),
    );
    setDefined(safeDetails, 'totalTests', normalizeNumber(details.totalTests));
    setDefined(safeDetails, 'updatedAt', normalizeTimestamp(details.updatedAt));
    if (Object.keys(safeDetails).length > 0) {
      safeMetadata.testProgressDetails = safeDetails;
    }
  }

  return Object.keys(safeMetadata).length > 0 ? safeMetadata : null;
}
