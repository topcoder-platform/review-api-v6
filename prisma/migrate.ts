import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import * as readline from 'readline';
import {
  ScorecardStatus,
  ScorecardType,
  ChallengeTrack,
  QuestionType,
} from '../src/dto/scorecard.dto';
import { ReviewItemCommentType } from '../src/dto/review.dto';
import { nanoid } from 'nanoid';
import { UploadType, UploadStatus } from '../src/dto/upload.dto';
import { SubmissionStatus, SubmissionType } from '../src/dto/submission.dto';

interface QuestionTypeMap {
  name: QuestionType;
  min?: number;
  max?: number;
}

interface ProjectTypeMap {
  name: string;
  type: ChallengeTrack;
}

// Get the schema name from environment variable or use 'public' as default
const schema = process.env.POSTGRES_SCHEMA || 'public';
console.log(`Using PostgreSQL schema: ${schema}`);

const prisma = new PrismaClient();
const DEFAULT_DATA_DIR = '/mnt/export/review_tables';
const DATA_DIR = process.env.DATA_DIR || DEFAULT_DATA_DIR;
const batchSize = 1000;
const logSize = 20000;
const DEFAULT_ES_DATA_FILE = path.join(
  '/home/ubuntu',
  'submissions-api.data.json',
);
const ES_DATA_FILE = process.env.ES_DATA_FILE || DEFAULT_ES_DATA_FILE;

const incrementalSinceInput =
  process.env.MIGRATE_SINCE || process.env.INCREMENTAL_SINCE;
let incrementalSince: Date | null = null;
if (incrementalSinceInput) {
  const parsed = new Date(incrementalSinceInput);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(
      `Invalid MIGRATE_SINCE/INCREMENTAL_SINCE value "${incrementalSinceInput}". Use an ISO-8601 date.`,
    );
  }
  incrementalSince = parsed;
  console.log(
    `Running incremental migration for records updated after ${incrementalSince.toISOString()}`,
  );
}
const isIncrementalRun = incrementalSince !== null;

const parseDateInput = (value: string | Date | null | undefined) => {
  if (!value) {
    return null;
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value;
  }
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const shouldProcessRecord = (
  created?: string | Date | null,
  updated?: string | Date | null,
) => {
  if (!incrementalSince) {
    return true;
  }
  const createdAt = parseDateInput(created);
  const updatedAt = parseDateInput(updated);
  if (!createdAt && !updatedAt) {
    // If there is no audit information we default to processing.
    return true;
  }
  return (
    (createdAt && createdAt >= incrementalSince) ||
    (updatedAt && updatedAt >= incrementalSince)
  );
};

const modelMappingKeys = [
  'project_result',
  'scorecard',
  'scorecard_group',
  'scorecard_section',
  'scorecard_question',
  'review',
  'review_item',
  'review_item_comment',
  'llm_provider',
  'llm_model',
  'ai_workflow',
];
const subModelMappingKeys = {
  review_item_comment: ['reviewItemComment', 'appeal', 'appealResponse'],
};
const lookupKeys: string[] = [
  'scorecard_status_lu',
  'scorecard_type_lu',
  'scorecard_question_type_lu',
  'comment_type_lu',
  'project_category_lu',
  'upload_type_lu',
  'upload_status_lu',
  'submission_type_lu',
  'submission_status_lu',
];

// Global lookup maps
let scorecardStatusMap: Record<string, ScorecardStatus> = {};
let scorecardTypeMap: Record<string, ScorecardType> = {};
let questionTypeMap: Record<string, QuestionTypeMap> = {};
let projectCategoryMap: Record<string, ProjectTypeMap> = {};
let reviewItemCommentTypeMap: Record<string, string> = {};
let uploadTypeMap: Record<string, UploadType> = {};
let uploadStatusMap: Record<string, UploadStatus> = {};
let submissionTypeMap: Record<string, SubmissionType> = {};
let submissionStatusMap: Record<string, SubmissionStatus> = {};
let resourceSubmissionSet = new Set<string>();

// Global submission map to store submission information.
const submissionMap: Record<string, Record<string, string>> = {};

// Data lookup maps
// Initialize maps from files if they exist, otherwise create new maps
function readIdMap(filename: string): Map<string, string> {
  if (fs.existsSync(`.tmp/${filename}.json`)) {
    const entries = Object.entries(
      JSON.parse(fs.readFileSync(`.tmp/${filename}.json`, 'utf-8')),
    ).map(([key, value]) => {
      if (typeof value !== 'string') {
        throw new Error(
          `Invalid mapping value for ${filename}: expected string, received "${describeLegacyId(
            value,
          )}"`,
        );
      }
      return [key, value] as [string, string];
    });
    return new Map<string, string>(entries);
  }
  return new Map<string, string>();
}

const describeLegacyId = (value: unknown): string => {
  if (value === null) {
    return 'null';
  }
  if (value === undefined) {
    return 'undefined';
  }
  if (typeof value === 'symbol') {
    return value.toString();
  }
  if (
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean' ||
    typeof value === 'bigint'
  ) {
    return String(value);
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'object' || typeof value === 'function') {
    try {
      const json = JSON.stringify(value);
      if (typeof json === 'string') {
        return json;
      }
    } catch {
      // ignore serialization errors
    }
    const fallbackDescription: string = Object.prototype.toString.call(value);
    return fallbackDescription;
  }
  const fallbackDescription: string = Object.prototype.toString.call(value);
  return fallbackDescription;
};

const normalizeLegacyKey = (value: unknown): string => {
  if (value === null || value === undefined) {
    throw new Error('Missing legacy identifier when normalizing key');
  }
  return describeLegacyId(value);
};

const tryNormalizeLegacyKey = (value: unknown): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }
  return describeLegacyId(value);
};

const omitId = <T extends { id: string }>(entity: T): Omit<T, 'id'> => {
  const { id: ignoredId, ...rest } = entity;
  void ignoredId;
  return rest;
};

const getMappedId = (
  map: Map<string, string>,
  legacyId: unknown,
): string | undefined => {
  const key = tryNormalizeLegacyKey(legacyId);
  return key ? map.get(key) : undefined;
};

const setMappedId = (
  map: Map<string, string>,
  legacyId: unknown,
  value: string,
) => {
  map.set(normalizeLegacyKey(legacyId), value);
};

const deleteMappedId = (map: Map<string, string>, legacyId: unknown) => {
  const key = tryNormalizeLegacyKey(legacyId);
  if (key) {
    map.delete(key);
  }
};

const requireMappedId = (
  map: Map<string, string>,
  legacyId: unknown,
  context: string,
): string => {
  const id = getMappedId(map, legacyId);
  if (!id) {
    throw new Error(
      `Missing required mapping for ${context} legacy id "${describeLegacyId(
        legacyId,
      )}"`,
    );
  }
  return id;
};

const hasMappedId = (map: Map<string, string>, legacyId: unknown): boolean => {
  const key = tryNormalizeLegacyKey(legacyId);
  return key ? map.has(key) : false;
};

const projectIdMap = readIdMap('projectIdMap');
const scorecardIdMap = readIdMap('scorecardIdMap');
const scorecardGroupIdMap = readIdMap('scorecardGroupIdMap');
const scorecardSectionIdMap = readIdMap('scorecardSectionIdMap');
const scorecardQuestionIdMap = readIdMap('scorecardQuestionIdMap');
const reviewIdMap = readIdMap('reviewIdMap');
const reviewItemIdMap = readIdMap('reviewItemIdMap');
const reviewItemCommentReviewItemCommentIdMap = readIdMap(
  'reviewItemCommentReviewItemCommentIdMap',
);
const reviewItemCommentAppealIdMap = readIdMap('reviewItemCommentAppealIdMap');
const reviewItemCommentAppealResponseIdMap = readIdMap(
  'reviewItemCommentAppealResponseIdMap',
);
const uploadIdMap = readIdMap('uploadIdMap');
const submissionIdMap = readIdMap('submissionIdMap');
const llmProviderIdMap = readIdMap('llmProviderIdMap');
const llmModelIdMap = readIdMap('llmModelIdMap');
const aiWorkflowIdMap = readIdMap('aiWorkflowIdMap');
const resourceSubmissionIdMap = readIdMap('resourceSubmissionIdMap');

// read resourceSubmissionSet
const rsSetFile = '.tmp/resourceSubmissionSet.json';
if (fs.existsSync(rsSetFile)) {
  resourceSubmissionSet = new Set<string>([
    ...(JSON.parse(fs.readFileSync(rsSetFile, 'utf-8')) as string[]),
  ]);
}

// Legacy enum mappings
enum LegacyScorecardStatus {
  'Active' = ScorecardStatus.ACTIVE,
  'Inactive' = ScorecardStatus.INACTIVE,
  'Deleted' = ScorecardStatus.DELETED,
}

enum LegacyScorecardType {
  'Screening' = ScorecardType.SCREENING,
  'Review' = ScorecardType.REVIEW,
  'Approval' = ScorecardType.APPROVAL,
  'Post-Mortem' = ScorecardType.POST_MORTEM,
  'Specification Review' = ScorecardType.SPECIFICATION_REVIEW,
  'Checkpoint Screening' = ScorecardType.CHECKPOINT_SCREENING,
  'Checkpoint Review' = ScorecardType.CHECKPOINT_REVIEW,
  'Iterative Review' = ScorecardType.ITERATIVE_REVIEW,
}

enum LegacyQuestionType {
  'Scale' = QuestionType.SCALE,
  'Yes/No' = QuestionType.YES_NO,
  'Test Case' = QuestionType.TEST_CASE,
}

enum LegacyCommentType {
  'Comment' = ReviewItemCommentType.COMMENT,
  'Recommended' = ReviewItemCommentType.RECOMMENDED,
  'Required' = ReviewItemCommentType.REQUIRED,
  'Aggregation Comment' = ReviewItemCommentType.AGGREGATION_COMMENT,
  'Aggregation Review Comment' = ReviewItemCommentType.AGGREGATION_REVIEW_COMMENT,
  'Submitter Comment' = ReviewItemCommentType.SUBMITTER_COMMENT,
  'Final Fix Comment' = ReviewItemCommentType.FINAL_REVIEW_COMMENT,
  'Final Review Comment' = ReviewItemCommentType.FINAL_REVIEW_COMMENT,
  'Manager Comment' = ReviewItemCommentType.MANAGER_COMMENT,
  'Approval Review Comment' = ReviewItemCommentType.APPROVAL_REVIEW_COMMENT,
  'Approval Review Comment - Other Fixes' = ReviewItemCommentType.APPROVAL_REVIEW_COMMENT_OTHER_FIXES,
  'Specification Review Comment' = ReviewItemCommentType.SPECIFICATION_REVIEW_COMMENT,
}

enum LegacyUploadType {
  'Submission' = UploadType.SUBMISSION,
  'Test Case' = UploadType.TEST_CASE,
  'Final Fix' = UploadType.FINAL_FIX,
  'Review Document' = UploadType.REVIEW_DOCUMENT,
}

enum LegacyUploadStatus {
  'Active' = UploadStatus.ACTIVE,
  'Deleted' = UploadStatus.DELETED,
}

enum LegacySubmissionType {
  // compatible for ES
  'ContestSubmission' = SubmissionType.CONTEST_SUBMISSION,
  'challengesubmission' = SubmissionType.CONTEST_SUBMISSION,
  // enum values
  'Contest Submission' = SubmissionType.CONTEST_SUBMISSION,
  'Specification Submission' = SubmissionType.SPECIFICATION_SUBMISSION,
  'Checkpoint Submission' = SubmissionType.CHECKPOINT_SUBMISSION,
  'Studio Final Fix Submission' = SubmissionType.STUDIO_FINAL_FIX_SUBMISSION,
}

enum LegacySubmissionStatus {
  'Active' = SubmissionStatus.ACTIVE,
  'Failed Screening' = SubmissionStatus.FAILED_SCREENING,
  'Failed Review' = SubmissionStatus.FAILED_REVIEW,
  'Completed Without Win' = SubmissionStatus.COMPLETED_WITHOUT_WIN,
  'Deleted' = SubmissionStatus.DELETED,
  'Failed Checkpoint Screening' = SubmissionStatus.FAILED_CHECKPOINT_SCREENING,
  'Failed Checkpoint Review' = SubmissionStatus.FAILED_CHECKPOINT_REVIEW,
}

const LegacyChallengeTrack: Record<string, ChallengeTrack> = {
  '1': ChallengeTrack.DEVELOPMENT,
  '2': ChallengeTrack.DATA_SCIENCE,
  '3': ChallengeTrack.DESIGN,
  '4': ChallengeTrack.QUALITY_ASSURANCE,
};

const readJson = (filePath: string): any =>
  JSON.parse(fs.readFileSync(filePath, 'utf-8'));

// Process lookup files.
function processLookupFiles() {
  const lookupFiles = fs
    .readdirSync(DATA_DIR)
    .filter((file) => /_lu_\d+\.json$/.test(file));
  for (const file of lookupFiles) {
    const filePath = path.join(DATA_DIR, file);
    const jsonData = readJson(filePath);
    const key = Object.keys(jsonData)[0];
    if (!key || !lookupKeys.includes(key)) {
      console.warn(`Skipping ${file}: Invalid lookup key "${key}"`);
      continue;
    }
    switch (key) {
      case 'scorecard_status_lu':
        scorecardStatusMap = Object.fromEntries(
          (jsonData.scorecard_status_lu as any[]).map(
            ({ scorecard_status_id, name }) => [
              scorecard_status_id,
              LegacyScorecardStatus[name] as ScorecardStatus,
            ],
          ),
        );
        break;
      case 'scorecard_type_lu':
        scorecardTypeMap = Object.fromEntries(
          (jsonData.scorecard_type_lu as any[]).map(
            ({ scorecard_type_id, name }) => [
              scorecard_type_id,
              LegacyScorecardType[name],
            ],
          ),
        );
        break;
      case 'scorecard_question_type_lu':
        questionTypeMap = Object.fromEntries(
          (jsonData.scorecard_question_type_lu as any[]).map(
            ({ scorecard_question_type_id, name }) => {
              const scaleMatch = name.match(/^Scale \((\d+)-(\d+)\)$/);
              return [
                scorecard_question_type_id,
                scaleMatch
                  ? {
                      name: QuestionType.SCALE,
                      min: Number(scaleMatch[1]),
                      max: Number(scaleMatch[2]),
                    }
                  : { name: LegacyQuestionType[name] },
              ];
            },
          ),
        );
        break;
      case 'comment_type_lu':
        reviewItemCommentTypeMap = Object.fromEntries(
          (jsonData.comment_type_lu as any[]).map(
            ({ comment_type_id, name }) => [comment_type_id, name],
          ),
        );
        break;
      case 'project_category_lu':
        projectCategoryMap = Object.fromEntries(
          (jsonData.project_category_lu as any[]).map(
            ({ project_category_id, project_type_id, name }) => [
              project_category_id,
              { name, type: LegacyChallengeTrack[project_type_id] },
            ],
          ),
        );
        break;
      case 'upload_type_lu':
        uploadTypeMap = Object.fromEntries(
          (jsonData.upload_type_lu as any[]).map(({ upload_type_id, name }) => [
            upload_type_id,
            LegacyUploadType[name],
          ]),
        );
        break;
      case 'upload_status_lu':
        uploadStatusMap = Object.fromEntries(
          (jsonData.upload_status_lu as any[]).map(
            ({ upload_status_id, name }) => [
              upload_status_id,
              LegacyUploadStatus[name],
            ],
          ),
        );
        break;
      case 'submission_type_lu':
        submissionTypeMap = Object.fromEntries(
          (jsonData.submission_type_lu as any[]).map(
            ({ submission_type_id, name }) => [
              submission_type_id,
              LegacySubmissionType[name],
            ],
          ),
        );
        break;
      case 'submission_status_lu':
        submissionStatusMap = Object.fromEntries(
          (jsonData.submission_status_lu as any[]).map(
            ({ submission_status_id, name }) => [
              submission_status_id,
              LegacySubmissionStatus[name],
            ],
          ),
        );
        break;
    }
  }
}

const filenameComp = (a, b) => {
  const numA = parseInt(a.match(/_(\d+)\.json$/)?.[1] || '0', 10);
  const numB = parseInt(b.match(/_(\d+)\.json$/)?.[1] || '0', 10);
  return numA - numB;
};

function convertSubmissionES(esData): any {
  let challengeId = null;
  let legacyChallengeId = null;
  if (esData.legacyChallengeId) {
    legacyChallengeId = esData.legacyChallengeId;
  }
  if (esData.challengeId) {
    if (typeof esData.challengeId === 'number') {
      legacyChallengeId = esData.challengeId;
    } else {
      challengeId = esData.challengeId;
    }
  }
  const submission: any = {
    legacySubmissionId: String(esData.legacySubmissionId),
    url: esData.url,
    memberId: String(esData.memberId),
    challengeId,
    legacyChallengeId,
    submissionPhaseId: String(esData.submissionPhaseId),
    fileType: esData.fileType,
    esId: esData.id,
    submittedDate: esData.submittedDate ? new Date(esData.submittedDate) : null,
    updatedBy: esData.updatedBy ?? null,
    updatedAt: esData.updated ? new Date(esData.updated) : null,
  };
  if (esData.reviewSummation && esData.reviewSummation.length > 0) {
    const summation = esData.reviewSummation[0];
    submission.reviewSummation = {
      create: {
        id: summation.id,
        legacySubmissionId: String(esData.legacySubmissionId),
        aggregateScore: summation.aggregateScore,
        scorecardId: getMappedId(scorecardIdMap, summation.scoreCardId),
        scorecardLegacyId: String(summation.scoreCardId),
        isPassing: summation.isPassing,
        reviewedDate: summation.reviewedDate
          ? new Date(summation.reviewedDate)
          : null,
        createdBy: summation.createdBy,
        createdAt: new Date(summation.created),
        updatedBy: summation.updatedBy,
        updatedAt: summation.updated ? new Date(summation.updated) : null,
      },
    };
  }
  return submission;
}

async function migrateElasticSearch() {
  // migrate elastic search data
  const filepath = ES_DATA_FILE;
  if (!fs.existsSync(filepath)) {
    throw new Error(
      `ElasticSearch export file not found at ${filepath}. Set ES_DATA_FILE to override the default.`,
    );
  }
  const fileStream = fs.createReadStream(filepath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });
  // read file line by line and handle it
  let lineCount = 0;
  for await (const line of rl) {
    lineCount += 1;
    try {
      const data = JSON.parse(line);
      const source = data['_source'];
      // only process 'submission' data for now
      if (source['resource'] === 'submission') {
        await handleElasticSearchSubmission(source);
      }
    } catch {
      console.log(`Failed to process ES line ${lineCount}`);
    }
    if (lineCount % logSize === 0) {
      console.log(`ES data processed ${lineCount} lines`);
    }
  }
  // migrate remaining submissions
  await importSubmissionES();
  console.log(`ES data imported with total line: ${lineCount}`);
}

let currentSubmissions: any[] = [];
async function handleElasticSearchSubmission(item) {
  // ignore records without legacySubmissionId field.
  if (item['legacySubmissionId'] == null) {
    return;
  }
  const createdAudit = item.created ?? item.submittedDate ?? null;
  const updatedAudit = item.updated ?? null;
  if (!shouldProcessRecord(createdAudit, updatedAudit)) {
    return;
  }
  currentSubmissions.push(item);
  // if we can batch insert data, +
  if (currentSubmissions.length >= batchSize) {
    await importSubmissionES();
    currentSubmissions = [];
  }
}

async function importSubmissionES() {
  if (currentSubmissions.length === 0) {
    return;
  }
  for (const item of currentSubmissions) {
    const submission = convertSubmissionES(item);

    let newSubmission = false;
    try {
      const existingSubmissionId = getMappedId(
        submissionIdMap,
        submission.legacySubmissionId,
      );
      if (existingSubmissionId) {
        newSubmission = false;
        await prisma.submission.update({
          data: submission,
          where: {
            id: existingSubmissionId,
          },
        });
      } else {
        newSubmission = true;
        const newId = nanoid(14);
        setMappedId(projectIdMap, submission.legacySubmissionId, newId);
        let type = LegacySubmissionType[item.type];
        if (!LegacySubmissionType[item.type]) {
          type = LegacySubmissionType.ContestSubmission;
        }
        await prisma.submission.create({
          data: {
            ...submission,
            id: newId,
            status: SubmissionStatus.ACTIVE,
            type,
            createdBy: item.createdBy || 'migration',
            createdAt: item.created ? new Date(item.created) : new Date(),
          },
        });
        setMappedId(submissionIdMap, submission.legacySubmissionId, newId);
      }
    } catch {
      if (newSubmission) {
        deleteMappedId(projectIdMap, submission.legacySubmissionId);
      }
      console.error(`Failed to import submission from ES: ${submission.esId}`);
    }
  }
}

function convertUpload(jsonData, existingId?: string) {
  return {
    id: existingId ?? nanoid(14),
    legacyId: jsonData['upload_id'],
    projectId: jsonData['project_id'],
    resourceId: jsonData['resource_id'],
    type: uploadTypeMap[jsonData['upload_type_id']],
    status: uploadStatusMap[jsonData['upload_status_id']],
    parameter: jsonData['parameter'],
    url: jsonData['url'],
    desc: jsonData['upload_desc'],
    projectPhaseId: jsonData['project_phase_id'],
    createdBy: jsonData['create_user'],
    createdAt: new Date(jsonData['create_date']),
    updatedBy: jsonData['modify_user'],
    updatedAt: new Date(jsonData['modify_date']),
  };
}

let uploadDataList: any[] = [];
async function importUploadData(uploadData) {
  uploadDataList.push(uploadData);
  if (uploadDataList.length >= batchSize) {
    await doImportUploadData();
    uploadDataList = [];
  }
}

async function doImportUploadData() {
  if (uploadDataList.length === 0) {
    return;
  }
  try {
    await prisma.upload.createMany({
      data: uploadDataList,
    });
  } catch {
    // import data one by one
    for (const u of uploadDataList) {
      try {
        await prisma.upload.create({ data: u });
      } catch {
        console.error(`Cannot import upload data id: ${u.legacyId}`);
        deleteMappedId(uploadIdMap, u.legacyId);
      }
    }
  }
}

async function upsertUploadData(uploadData) {
  const { id, ...updateData } = uploadData;
  try {
    await prisma.upload.upsert({
      where: { id },
      create: uploadData,
      update: updateData,
    });
  } catch (err) {
    console.error(`Failed to upsert upload data id: ${uploadData.legacyId}`);
    console.error(err);
    throw err;
  }
}

function convertSubmission(jsonData, existingId?: string) {
  return {
    id: existingId ?? nanoid(14),
    legacySubmissionId: jsonData['submission_id'],
    legacyUploadId: jsonData['upload_id'],
    uploadId: getMappedId(uploadIdMap, jsonData['upload_id']),
    status: submissionStatusMap[jsonData['submission_status_id']],
    type: submissionTypeMap[jsonData['submission_type_id']],
    screeningScore: jsonData['screening_score'],
    initialScore: jsonData['initial_score'],
    finalScore: jsonData['final_score'],
    placement: jsonData['placement'] ? Number(jsonData['placement']) : null,
    userRank: jsonData['user_rank'] ? Number(jsonData['user_rank']) : null,
    markForPurchase: jsonData['mark_for_purchase'],
    prizeId: jsonData['prize_id'],
    fileSize: jsonData['file_size'] ? Number(jsonData['file_size']) : null,
    viewCount: jsonData['view_count'] ? Number(jsonData['view_count']) : null,
    systemFileName: jsonData['system_file_name'],
    thurgoodJobId: jsonData['thurgood_job_id'],
    createdBy: jsonData['create_user'],
    createdAt: new Date(jsonData['create_date']),
    updatedBy: jsonData['modify_user'],
    updatedAt: new Date(jsonData['modify_date']),
  };
}

let submissionDataList: any[] = [];
async function importSubmissionData(submissionData) {
  submissionDataList.push(submissionData);
  if (submissionDataList.length >= batchSize) {
    await doImportSubmissionData();
    submissionDataList = [];
  }
}

async function doImportSubmissionData() {
  if (submissionDataList.length === 0) {
    return;
  }
  try {
    await prisma.submission.createMany({
      data: submissionDataList,
    });
  } catch {
    for (const s of submissionDataList) {
      try {
        await prisma.submission.create({ data: s });
      } catch {
        console.error(`Failed to import submission ${s.legacySubmissionId}`);
        deleteMappedId(submissionIdMap, s.legacySubmissionId);
      }
    }
  }
}

async function upsertSubmissionData(submissionData) {
  const { id, ...updateData } = submissionData;
  try {
    await prisma.submission.upsert({
      where: { id },
      create: submissionData,
      update: updateData,
    });
  } catch (err) {
    console.error(
      `Failed to upsert submission ${submissionData.legacySubmissionId}`,
    );
    console.error(err);
    throw err;
  }
}

/**
 * Read submission data from resource_xxx.json, upload_xxx.json and submission_xxx.json.
 */
async function initSubmissionMap() {
  // read submission_x.json, read {uploadId -> submissionId} map.
  const submissionRegex = new RegExp(`^submission_\\d+\\.json`);
  const uploadRegex = new RegExp(`^upload_\\d+\\.json`);
  const resourceRegex = new RegExp(`^resource_\\d+\\.json`);
  const submissionFiles: string[] = [];
  const uploadFiles: string[] = [];
  const resourceFiles: string[] = [];
  fs.readdirSync(DATA_DIR).filter((f) => {
    if (submissionRegex.test(f)) {
      submissionFiles.push(f);
    }
    if (uploadRegex.test(f)) {
      uploadFiles.push(f);
    }
    if (resourceRegex.test(f)) {
      resourceFiles.push(f);
    }
  });
  // sort files by filename
  uploadFiles.sort(filenameComp);
  submissionFiles.sort(filenameComp);
  // import upload data, get { resource_id -> upload_id } map.
  const resourceUploadMap: Record<string, string> = {};
  let uploadTotalCount = 0;
  for (const f of uploadFiles) {
    const filePath = path.join(DATA_DIR, f);
    console.log(`Reading upload data from ${f}`);
    const jsonData = readJson(filePath)['upload'];
    let dataCount = 0;
    for (const d of jsonData) {
      dataCount += 1;
      const shouldPersist = shouldProcessRecord(
        d['create_date'],
        d['modify_date'],
      );
      const legacyId = String(d['upload_id']);
      const existingId = getMappedId(uploadIdMap, legacyId);
      const uploadData = convertUpload(d, existingId);
      const skipPersistence = !existingId && isIncrementalRun && !shouldPersist;
      if (!skipPersistence) {
        // import upload data if any
        if (!existingId) {
          setMappedId(uploadIdMap, uploadData.legacyId, uploadData.id);
          if (isIncrementalRun) {
            await upsertUploadData(uploadData);
          } else {
            await importUploadData(uploadData);
          }
        } else if (isIncrementalRun && shouldPersist) {
          await upsertUploadData(uploadData);
        }
      }
      // collect data to resourceUploadMap
      if (
        uploadData.type === UploadType.SUBMISSION &&
        uploadData.status === UploadStatus.ACTIVE &&
        uploadData.resourceId != null
      ) {
        const resourceIdKey = tryNormalizeLegacyKey(uploadData.resourceId);
        if (resourceIdKey) {
          resourceUploadMap[resourceIdKey] = String(uploadData.legacyId);
        }
      }
      if (dataCount % logSize === 0) {
        console.log(`Imported upload count: ${dataCount}`);
      }
    }
    uploadTotalCount += dataCount;
  }
  // import remaining upload data
  await doImportUploadData();
  console.log(`Upload data import complete. Total count: ${uploadTotalCount}`);

  // import submission data, get {upload_id -> submission} map
  const uploadSubmissionMap: Record<string, any> = {};
  let submissionTotalCount = 0;
  for (const f of submissionFiles) {
    const filePath = path.join(DATA_DIR, f);
    console.log(`Reading submission data from ${f}`);
    const jsonData = readJson(filePath)['submission'];
    let dataCount = 0;
    for (const d of jsonData) {
      dataCount += 1;
      const shouldPersist = shouldProcessRecord(
        d['create_date'],
        d['modify_date'],
      );
      const legacyId = String(d['submission_id']);
      const existingId = getMappedId(submissionIdMap, legacyId);
      const dbData = convertSubmission(d, existingId);
      const skipPersistence = !existingId && isIncrementalRun && !shouldPersist;
      if (!skipPersistence) {
        if (!existingId) {
          setMappedId(submissionIdMap, dbData.legacySubmissionId, dbData.id);
          if (isIncrementalRun) {
            await upsertSubmissionData(dbData);
          } else {
            await importSubmissionData(dbData);
          }
        } else if (isIncrementalRun && shouldPersist) {
          await upsertSubmissionData(dbData);
        }
      }
      // collect data to uploadSubmissionMap
      if (
        dbData.status === SubmissionStatus.ACTIVE &&
        dbData.legacyUploadId != null
      ) {
        const item = {
          score:
            dbData.screeningScore || dbData.initialScore || dbData.finalScore,
          created: dbData.createdAt,
          submissionId: dbData.legacySubmissionId,
        };
        // pick the latest valid submission for each upload
        const uploadIdKey = tryNormalizeLegacyKey(dbData.legacyUploadId);
        if (!uploadIdKey) {
          continue;
        }
        if (uploadSubmissionMap[uploadIdKey]) {
          const existing = uploadSubmissionMap[uploadIdKey];
          if (
            !existing.score ||
            item.created.getTime() > existing.created.getTime()
          ) {
            uploadSubmissionMap[uploadIdKey] = item;
          }
        } else {
          uploadSubmissionMap[uploadIdKey] = item;
        }
      }
      if (dataCount % logSize === 0) {
        console.log(`Imported submission count: ${dataCount}`);
      }
    }
    submissionTotalCount += dataCount;
  }
  // import remaining submission data
  await doImportSubmissionData();
  console.log(`Submission total count: ${submissionTotalCount}`);

  // build {resource_id -> submission} map
  const resourceSubmissionMap = Object.entries(resourceUploadMap).reduce(
    (acc, [resourceId, uploadId]) => {
      const submission = uploadSubmissionMap[uploadId];
      if (submission) {
        acc[resourceId] = submission;
      }
      return acc;
    },
    {} as Record<string, any>,
  );

  // read resource files
  const challengeSubmissionMap: Record<string, Record<string, any>> = {};
  let resourceCount = 0;
  let validResourceCount = 0;
  for (const f of resourceFiles) {
    const filePath = path.join(DATA_DIR, f);
    console.log(`Reading resource data from ${f}`);
    const jsonData = readJson(filePath)['resource'];
    for (const d of jsonData) {
      const projectId = d['project_id'];
      const userId = d['user_id'];
      const resourceId = d['resource_id'];
      const submissionInfo = resourceSubmissionMap[resourceId];
      resourceCount += 1;
      if (projectId && userId && submissionInfo) {
        validResourceCount += 1;
        if (!challengeSubmissionMap[projectId]) {
          challengeSubmissionMap[projectId] = {};
          submissionMap[projectId] = {};
        }
        if (challengeSubmissionMap[projectId][userId]) {
          const existing = challengeSubmissionMap[projectId][userId];
          if (!existing.score || submissionInfo.created > existing.created) {
            // replace it
            challengeSubmissionMap[projectId][userId] = submissionInfo;
            submissionMap[projectId][userId] = submissionInfo.submissionId;
          }
        } else {
          challengeSubmissionMap[projectId][userId] = submissionInfo;
          submissionMap[projectId][userId] = submissionInfo.submissionId;
        }
      }
    }
  }
  console.log(
    `Read resource count: ${resourceCount}, submission resource count: ${validResourceCount}`,
  );
  // print summary
  let totalSubmissions = 0;
  Object.keys(submissionMap).forEach((c) => {
    totalSubmissions += Object.keys(submissionMap[c]).length;
  });
  console.log(`Found total project result submissions: ${totalSubmissions}`);
}

// Process a single type: find matching files, transform them one by one, and then insert in batches.
async function processType(type: string, subtype?: string) {
  const regex = new RegExp(`^${type}_\\d+\\.json$`);
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((file) => regex.test(file))
    .sort(filenameComp);
  if (files.length === 0) {
    console.log(`[${type}] No files found.`);
    return;
  }
  for (const file of files) {
    const filePath = path.join(DATA_DIR, file);
    const jsonData = readJson(filePath);
    const key = Object.keys(jsonData)[0];
    if (key !== type) {
      console.warn(
        `Skipping ${file}: key mismatch, expected ${type} got ${key}`,
      );
    } else {
      switch (type) {
        case 'project_result': {
          console.log(`[${type}][${file}] Processing file`);
          const convertProjectResult = (pr) => {
            let submissionId = '';
            if (submissionMap[pr.project_id]) {
              submissionId = submissionMap[pr.project_id][pr.user_id] || '';
            }
            return {
              challengeId: pr.project_id,
              userId: pr.user_id,
              paymentId: pr.payment_id,
              submissionId,
              oldRating: parseInt(pr.old_rating),
              newRating: parseInt(pr.new_rating),
              initialScore: parseFloat(pr.raw_score || '0.0'),
              finalScore: parseFloat(pr.final_score || '0.0'),
              placement: parseInt(pr.placed || '0'),
              rated: pr.rating_ind === '1',
              passedReview: pr.passed_review_ind === '1',
              validSubmission: pr.valid_submission_ind === '1',
              pointAdjustment: parseFloat(pr.point_adjustment),
              ratingOrder: parseInt(pr.rating_order),
              createdAt: new Date(pr.create_date),
              createdBy: pr.create_user || '',
              updatedAt: new Date(pr.modify_date),
              updatedBy: pr.modify_user || '',
            };
          };
          if (!isIncrementalRun) {
            const processedData = jsonData[key]
              .filter((pr) => {
                const mapKey = `${pr.project_id}${pr.user_id}`;
                return !hasMappedId(projectIdMap, mapKey);
              })
              .map((pr) => {
                const mapKey = `${pr.project_id}${pr.user_id}`;
                setMappedId(projectIdMap, mapKey, mapKey);
                return convertProjectResult(pr);
              });
            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.challengeResult
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.challengeResult
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(
                          projectIdMap,
                          `${item.challengeId}${item.userId}`,
                        );
                        console.error(
                          `[${type}][${file}] Error code: ${err.code}, ChallengeId: ${item.challengeId}, UserId: ${item.userId}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const pr of jsonData[key]) {
              if (!shouldProcessRecord(pr.create_date, pr.modify_date)) {
                continue;
              }
              const mapKey = `${pr.project_id}${pr.user_id}`;
              const data = convertProjectResult(pr);
              try {
                await prisma.challengeResult.upsert({
                  where: {
                    challengeId_userId: {
                      challengeId: data.challengeId,
                      userId: data.userId,
                    },
                  },
                  create: data,
                  update: data,
                });
                setMappedId(projectIdMap, mapKey, mapKey);
              } catch (err) {
                console.error(
                  `[${type}][${file}] Failed to upsert challengeResult for ChallengeId: ${data.challengeId}, UserId: ${data.userId}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'scorecard': {
          console.log(`[${type}][${file}] Processing file`);
          const convertScorecard = (sc, recordId: string) => {
            const minScore = parseFloat(sc.min_score);
            const passingScoreSource =
              sc.minimum_passing_score ?? sc.passing_score ?? sc.min_score;
            const parsedPassingScore = parseFloat(passingScoreSource);
            const category = projectCategoryMap[sc.project_category_id];
            return {
              id: recordId,
              legacyId: sc.scorecard_id,
              status: scorecardStatusMap[sc.scorecard_status_id],
              type: scorecardTypeMap[sc.scorecard_type_id],
              challengeTrack: category.type,
              challengeType: category.name,
              name: sc.name,
              version: sc.version,
              minScore: minScore,
              minimumPassingScore: Number.isFinite(parsedPassingScore)
                ? parsedPassingScore
                : minScore,
              maxScore: parseFloat(sc.max_score),
              createdAt: new Date(sc.create_date),
              createdBy: sc.create_user,
              updatedAt: new Date(sc.modify_date),
              updatedBy: sc.modify_user,
            };
          };
          if (!isIncrementalRun) {
            const processedData = jsonData[key].map((sc) => {
              const id = nanoid(14);
              setMappedId(scorecardIdMap, sc.scorecard_id, id);
              return convertScorecard(sc, id);
            });
            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.scorecard
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.scorecard
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(scorecardIdMap, item.legacyId);
                        console.error(
                          `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const sc of jsonData[key]) {
              if (!shouldProcessRecord(sc.create_date, sc.modify_date)) {
                continue;
              }
              const existingId = getMappedId(scorecardIdMap, sc.scorecard_id);
              const id = existingId ?? nanoid(14);
              const data = convertScorecard(sc, id);
              try {
                const updateData = omitId(data);
                await prisma.scorecard.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(scorecardIdMap, sc.scorecard_id, id);
                }
              } catch (err) {
                console.error(
                  `[${type}][${file}] Failed to upsert scorecard legacyId ${sc.scorecard_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'scorecard_group': {
          console.log(`[${type}][${file}] Processing file`);
          const convertGroup = (group, recordId: string) => {
            const legacyId = normalizeLegacyKey(group.scorecard_group_id);
            const scorecardId = requireMappedId(
              scorecardIdMap,
              group.scorecard_id,
              'scorecard',
            );
            return {
              id: recordId,
              legacyId,
              scorecardId,
              name: group.name,
              weight: parseFloat(group.weight),
              sortOrder: parseInt(group.sort),
              createdAt: new Date(group.create_date),
              createdBy: group.create_user,
              updatedAt: new Date(group.modify_date),
              updatedBy: group.modify_user,
            };
          };
          if (!isIncrementalRun) {
            const processedData = jsonData[key]
              .filter(
                (group) =>
                  !hasMappedId(scorecardGroupIdMap, group.scorecard_group_id),
              )
              .map((group) => {
                const id = nanoid(14);
                setMappedId(scorecardGroupIdMap, group.scorecard_group_id, id);
                return convertGroup(group, id);
              });
            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.scorecardGroup
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.scorecardGroup
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(scorecardGroupIdMap, item.legacyId);
                        console.error(
                          `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const group of jsonData[key]) {
              if (!shouldProcessRecord(group.create_date, group.modify_date)) {
                continue;
              }
              const existingId = getMappedId(
                scorecardGroupIdMap,
                group.scorecard_group_id,
              );
              const id = existingId ?? nanoid(14);
              const data = convertGroup(group, id);
              try {
                const updateData = omitId(data);
                await prisma.scorecardGroup.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(
                    scorecardGroupIdMap,
                    group.scorecard_group_id,
                    id,
                  );
                }
              } catch (err) {
                console.error(
                  `[${type}][${file}] Failed to upsert scorecardGroup legacyId ${group.scorecard_group_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'scorecard_section': {
          console.log(`[${type}][${file}] Processing file`);
          const convertSection = (section, recordId: string) => {
            const legacyId = normalizeLegacyKey(section.scorecard_section_id);
            const scorecardGroupId = requireMappedId(
              scorecardGroupIdMap,
              section.scorecard_group_id,
              'scorecard group',
            );
            return {
              id: recordId,
              legacyId,
              scorecardGroupId,
              name: section.name,
              weight: parseFloat(section.weight),
              sortOrder: parseInt(section.sort),
              createdAt: new Date(section.create_date),
              createdBy: section.create_user,
              updatedAt: new Date(section.modify_date),
              updatedBy: section.modify_user,
            };
          };
          if (!isIncrementalRun) {
            const processedData = jsonData[key]
              .filter(
                (section) =>
                  !hasMappedId(
                    scorecardSectionIdMap,
                    section.scorecard_section_id,
                  ),
              )
              .map((section) => {
                const id = nanoid(14);
                setMappedId(
                  scorecardSectionIdMap,
                  section.scorecard_section_id,
                  id,
                );
                return convertSection(section, id);
              });
            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.scorecardSection
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.scorecardSection
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(scorecardSectionIdMap, item.legacyId);
                        console.error(
                          `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const section of jsonData[key]) {
              if (
                !shouldProcessRecord(section.create_date, section.modify_date)
              ) {
                continue;
              }
              const existingId = getMappedId(
                scorecardSectionIdMap,
                section.scorecard_section_id,
              );
              const id = existingId ?? nanoid(14);
              const data = convertSection(section, id);
              try {
                const updateData = omitId(data);
                await prisma.scorecardSection.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(
                    scorecardSectionIdMap,
                    section.scorecard_section_id,
                    id,
                  );
                }
              } catch (err) {
                console.error(
                  `[${type}][${file}] Failed to upsert scorecardSection legacyId ${section.scorecard_section_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'scorecard_question': {
          console.log(`[${type}][${file}] Processing file`);
          const convertQuestion = (question, recordId: string) => {
            const questionType =
              questionTypeMap[question.scorecard_question_type_id];
            const legacyId = normalizeLegacyKey(question.scorecard_question_id);
            const scorecardSectionId = requireMappedId(
              scorecardSectionIdMap,
              question.scorecard_section_id,
              'scorecard section',
            );
            return {
              id: recordId,
              legacyId,
              scorecardSectionId,
              type: questionType.name,
              description: question.description,
              guidelines: question.guideline,
              weight: parseFloat(question.weight),
              requiresUpload: question.upload_document === '1',
              sortOrder: parseInt(question.sort),
              createdAt: new Date(question.create_date),
              createdBy: question.create_user,
              updatedAt: new Date(question.modify_date),
              updatedBy: question.modify_user,
              scaleMin: questionType.min,
              scaleMax: questionType.max,
            };
          };
          if (!isIncrementalRun) {
            const processedData = jsonData[key]
              .filter(
                (question) =>
                  !hasMappedId(
                    scorecardQuestionIdMap,
                    question.scorecard_question_id,
                  ),
              )
              .map((question) => {
                const id = nanoid(14);
                setMappedId(
                  scorecardQuestionIdMap,
                  question.scorecard_question_id,
                  id,
                );
                return convertQuestion(question, id);
              });
            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.scorecardQuestion
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.scorecardQuestion
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(scorecardQuestionIdMap, item.legacyId);
                        console.error(
                          `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const question of jsonData[key]) {
              if (
                !shouldProcessRecord(question.create_date, question.modify_date)
              ) {
                continue;
              }
              const existingId = getMappedId(
                scorecardQuestionIdMap,
                question.scorecard_question_id,
              );
              const id = existingId ?? nanoid(14);
              const data = convertQuestion(question, id);
              try {
                const updateData = omitId(data);
                await prisma.scorecardQuestion.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(
                    scorecardQuestionIdMap,
                    question.scorecard_question_id,
                    id,
                  );
                }
              } catch (err) {
                console.error(
                  `[${type}][${file}] Failed to upsert scorecardQuestion legacyId ${question.scorecard_question_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'review': {
          console.log(`[${type}][${file}] Processing file`);
          const convertReview = (review, recordId: string) => {
            const legacyId = normalizeLegacyKey(review.review_id);
            const submissionId =
              getMappedId(submissionIdMap, review.submission_id) ?? null;
            const scorecardId = requireMappedId(
              scorecardIdMap,
              review.scorecard_id,
              'scorecard',
            );
            return {
              id: recordId,
              legacyId,
              resourceId: review.resource_id,
              phaseId: review.project_phase_id,
              submissionId,
              legacySubmissionId: review.submission_id,
              scorecardId,
              committed: review.committed === '1',
              finalScore: review.score ? parseFloat(review.score) : null,
              initialScore: review.initial_score
                ? parseFloat(review.initial_score)
                : null,
              createdAt: new Date(review.create_date),
              createdBy: review.create_user,
              updatedAt: new Date(review.modify_date),
              updatedBy: review.modify_user,
            };
          };
          if (!isIncrementalRun) {
            const processedData = jsonData[key]
              .filter((review) => !hasMappedId(reviewIdMap, review.review_id))
              .map((review) => {
                const id = nanoid(14);
                setMappedId(reviewIdMap, review.review_id, id);
                return convertReview(review, id);
              });
            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.review
                .createMany({ data: batch })
                .catch(async () => {
                  console.error(
                    `[${type}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.review
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(reviewIdMap, item.legacyId);
                        console.error(
                          `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const review of jsonData[key]) {
              if (
                !shouldProcessRecord(review.create_date, review.modify_date)
              ) {
                continue;
              }
              const existingId = getMappedId(reviewIdMap, review.review_id);
              const id = existingId ?? nanoid(14);
              const data = convertReview(review, id);
              try {
                const updateData = omitId(data);
                await prisma.review.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(reviewIdMap, review.review_id, id);
                }
              } catch (err) {
                console.error(
                  `[${type}][${file}] Failed to upsert review legacyId ${review.review_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'review_item': {
          console.log(`[${type}][${file}] Processing file`);
          const convertReviewItem = (item, recordId: string) => {
            const legacyId = normalizeLegacyKey(item.review_item_id);
            const reviewId = requireMappedId(
              reviewIdMap,
              item.review_id,
              'review',
            );
            const scorecardQuestionId = requireMappedId(
              scorecardQuestionIdMap,
              item.scorecard_question_id,
              'scorecard question',
            );
            return {
              id: recordId,
              legacyId,
              reviewId,
              scorecardQuestionId,
              uploadId: item.upload_id || null,
              initialAnswer: item.answer,
              finalAnswer: item.answer,
              managerComment: item.answer,
              createdAt: new Date(item.create_date),
              createdBy: item.create_user,
              updatedAt: new Date(item.modify_date),
              updatedBy: item.modify_user,
            };
          };
          if (!isIncrementalRun) {
            const processedData = jsonData[key]
              .filter(
                (item) => !hasMappedId(reviewItemIdMap, item.review_item_id),
              )
              .map((item) => {
                const id = nanoid(14);
                setMappedId(reviewItemIdMap, item.review_item_id, id);
                return convertReviewItem(item, id);
              });
            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.reviewItem
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.reviewItem
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(reviewItemIdMap, item.legacyId);
                        console.error(
                          `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const item of jsonData[key]) {
              if (!shouldProcessRecord(item.create_date, item.modify_date)) {
                continue;
              }
              const existingId = getMappedId(
                reviewItemIdMap,
                item.review_item_id,
              );
              const id = existingId ?? nanoid(14);
              const data = convertReviewItem(item, id);
              try {
                const updateData = omitId(data);
                await prisma.reviewItem.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(reviewItemIdMap, item.review_item_id, id);
                }
              } catch (err) {
                console.error(
                  `[${type}][${file}] Failed to upsert reviewItem legacyId ${item.review_item_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'review_item_comment': {
          switch (subtype) {
            case 'reviewItemComment': {
              console.log(`[${type}][${subtype}][${file}] Processing file`);
              const isSupportedType = (c) =>
                reviewItemCommentTypeMap[c.comment_type_id] in
                LegacyCommentType;
              const convertComment = (c, recordId: string) => {
                const legacyId = normalizeLegacyKey(c.review_item_comment_id);
                const reviewItemId = requireMappedId(
                  reviewItemIdMap,
                  c.review_item_id,
                  'review item',
                );
                return {
                  id: recordId,
                  legacyId,
                  resourceId: c.resource_id,
                  reviewItemId,
                  content: c.content,
                  type: LegacyCommentType[
                    reviewItemCommentTypeMap[c.comment_type_id]
                  ],
                  sortOrder: parseInt(c.sort),
                  createdAt: new Date(c.create_date),
                  createdBy: c.create_user,
                  updatedAt: new Date(c.modify_date),
                  updatedBy: c.modify_user,
                };
              };
              if (!isIncrementalRun) {
                const processedData = jsonData[key]
                  .filter(isSupportedType)
                  .filter(
                    (c) =>
                      !hasMappedId(
                        reviewItemCommentReviewItemCommentIdMap,
                        c.review_item_comment_id,
                      ),
                  )
                  .map((c) => {
                    const id = nanoid(14);
                    setMappedId(
                      reviewItemCommentReviewItemCommentIdMap,
                      c.review_item_comment_id,
                      id,
                    );
                    return convertComment(c, id);
                  });
                const totalBatches = Math.ceil(
                  processedData.length / batchSize,
                );
                for (let i = 0; i < processedData.length; i += batchSize) {
                  const batchIndex = i / batchSize + 1;
                  console.log(
                    `[${type}][${subtype}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
                  );
                  const batch = processedData.slice(i, i + batchSize);
                  await prisma.reviewItemComment
                    .createMany({
                      data: batch,
                    })
                    .catch(async () => {
                      console.error(
                        `[${type}][${subtype}][${file}] An error occurred, retrying individually`,
                      );
                      for (const item of batch) {
                        await prisma.reviewItemComment
                          .create({
                            data: item,
                          })
                          .catch((err) => {
                            deleteMappedId(
                              reviewItemCommentReviewItemCommentIdMap,
                              item.legacyId,
                            );
                            console.error(
                              `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                            );
                          });
                      }
                    });
                }
              } else {
                for (const c of jsonData[key]) {
                  if (!isSupportedType(c)) {
                    continue;
                  }
                  if (!shouldProcessRecord(c.create_date, c.modify_date)) {
                    continue;
                  }
                  const existingId = getMappedId(
                    reviewItemCommentReviewItemCommentIdMap,
                    c.review_item_comment_id,
                  );
                  const id = existingId ?? nanoid(14);
                  const data = convertComment(c, id);
                  try {
                    const updateData = omitId(data);
                    await prisma.reviewItemComment.upsert({
                      where: { id },
                      create: data,
                      update: updateData,
                    });
                    if (!existingId) {
                      setMappedId(
                        reviewItemCommentReviewItemCommentIdMap,
                        c.review_item_comment_id,
                        id,
                      );
                    }
                  } catch (err) {
                    console.error(
                      `[${type}][${subtype}][${file}] Failed to upsert reviewItemComment legacyId ${c.review_item_comment_id}`,
                    );
                    console.error(err);
                  }
                }
              }
              break;
            }
            case 'appeal': {
              console.log(`[${type}][${subtype}][${file}] Processing file`);
              const isAppeal = (c) =>
                reviewItemCommentTypeMap[c.comment_type_id] === 'Appeal';
              const convertAppeal = (c, recordId: string) => {
                const legacyId = normalizeLegacyKey(c.review_item_comment_id);
                const reviewItemCommentId = requireMappedId(
                  reviewItemCommentReviewItemCommentIdMap,
                  c.review_item_id,
                  'review item comment',
                );
                return {
                  id: recordId,
                  legacyId,
                  resourceId: c.resource_id,
                  reviewItemCommentId,
                  content: c.content,
                  createdAt: new Date(c.create_date),
                  createdBy: c.create_user,
                  updatedAt: new Date(c.modify_date),
                  updatedBy: c.modify_user,
                };
              };
              if (!isIncrementalRun) {
                const processedData = jsonData[key]
                  .filter(isAppeal)
                  .filter(
                    (c) =>
                      !hasMappedId(
                        reviewItemCommentAppealIdMap,
                        c.review_item_id,
                      ),
                  )
                  .map((c) => {
                    const id = nanoid(14);
                    setMappedId(
                      reviewItemCommentAppealIdMap,
                      c.review_item_id,
                      id,
                    );
                    return convertAppeal(c, id);
                  });

                const totalBatches = Math.ceil(
                  processedData.length / batchSize,
                );
                for (let i = 0; i < processedData.length; i += batchSize) {
                  const batchIndex = i / batchSize + 1;
                  console.log(
                    `[${type}][${subtype}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
                  );
                  const batch = processedData.slice(i, i + batchSize);
                  await prisma.appeal
                    .createMany({
                      data: batch,
                    })
                    .catch(async () => {
                      console.error(
                        `[${type}][${subtype}][${file}] An error occurred, retrying individually`,
                      );
                      for (const item of batch) {
                        await prisma.appeal
                          .create({
                            data: item,
                          })
                          .catch((err) => {
                            deleteMappedId(
                              reviewItemCommentAppealIdMap,
                              item.legacyId,
                            );
                            console.error(
                              `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                            );
                          });
                      }
                    });
                }
              } else {
                for (const c of jsonData[key]) {
                  if (!isAppeal(c)) {
                    continue;
                  }
                  if (!shouldProcessRecord(c.create_date, c.modify_date)) {
                    continue;
                  }
                  const existingId = getMappedId(
                    reviewItemCommentAppealIdMap,
                    c.review_item_id,
                  );
                  const id = existingId ?? nanoid(14);
                  const data = convertAppeal(c, id);
                  try {
                    const updateData = omitId(data);
                    await prisma.appeal.upsert({
                      where: { id },
                      create: data,
                      update: updateData,
                    });
                    if (!existingId) {
                      setMappedId(
                        reviewItemCommentAppealIdMap,
                        c.review_item_id,
                        id,
                      );
                    }
                  } catch (err) {
                    console.error(
                      `[${type}][${subtype}][${file}] Failed to upsert appeal legacyId ${c.review_item_comment_id}`,
                    );
                    console.error(err);
                  }
                }
              }
              break;
            }
            case 'appealResponse': {
              console.log(`[${type}][${subtype}][${file}] Processing file`);
              const isAppealResponse = (c) =>
                reviewItemCommentTypeMap[c.comment_type_id] ===
                'Appeal Response';
              const convertAppealResponse = (c, recordId: string) => {
                const legacyId = normalizeLegacyKey(c.review_item_comment_id);
                const appealId = requireMappedId(
                  reviewItemCommentAppealIdMap,
                  c.review_item_id,
                  'appeal',
                );
                return {
                  id: recordId,
                  legacyId,
                  appealId,
                  resourceId: c.resource_id,
                  content: c.content,
                  success: c.extra_info === 'Succeeded',
                  createdAt: new Date(c.create_date),
                  createdBy: c.create_user,
                  updatedAt: new Date(c.modify_date),
                  updatedBy: c.modify_user,
                };
              };
              if (!isIncrementalRun) {
                const processedData = jsonData[key]
                  .filter(isAppealResponse)
                  .filter(
                    (c) =>
                      !hasMappedId(
                        reviewItemCommentAppealResponseIdMap,
                        c.review_item_comment_id,
                      ),
                  )
                  .map((c) => {
                    const id = nanoid(14);
                    setMappedId(
                      reviewItemCommentAppealResponseIdMap,
                      c.review_item_comment_id,
                      id,
                    );
                    return convertAppealResponse(c, id);
                  });
                const totalBatches = Math.ceil(
                  processedData.length / batchSize,
                );
                for (let i = 0; i < processedData.length; i += batchSize) {
                  const batchIndex = i / batchSize + 1;
                  console.log(
                    `[${type}][${subtype}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
                  );
                  const batch = processedData.slice(i, i + batchSize);
                  await prisma.appealResponse
                    .createMany({
                      data: batch,
                    })
                    .catch(async () => {
                      console.error(
                        `[${type}][${subtype}][${file}] An error occurred, retrying individually`,
                      );
                      for (const item of batch) {
                        await prisma.appealResponse
                          .create({
                            data: item,
                          })
                          .catch((err) => {
                            deleteMappedId(
                              reviewItemCommentAppealResponseIdMap,
                              item.legacyId,
                            );
                            console.error(
                              `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                            );
                          });
                      }
                    });
                }
              } else {
                for (const c of jsonData[key]) {
                  if (!isAppealResponse(c)) {
                    continue;
                  }
                  if (!shouldProcessRecord(c.create_date, c.modify_date)) {
                    continue;
                  }
                  const existingId = getMappedId(
                    reviewItemCommentAppealResponseIdMap,
                    c.review_item_comment_id,
                  );
                  const id = existingId ?? nanoid(14);
                  const data = convertAppealResponse(c, id);
                  try {
                    const updateData = omitId(data);
                    await prisma.appealResponse.upsert({
                      where: { id },
                      create: data,
                      update: updateData,
                    });
                    if (!existingId) {
                      setMappedId(
                        reviewItemCommentAppealResponseIdMap,
                        c.review_item_comment_id,
                        id,
                      );
                    }
                  } catch (err) {
                    console.error(
                      `[${type}][${subtype}][${file}] Failed to upsert appealResponse legacyId ${c.review_item_comment_id}`,
                    );
                    console.error(err);
                  }
                }
              }
              break;
            }
          }
          break;
        }
        case 'llm_provider': {
          console.log(`[${type}][${subtype}][${file}] Processing file`);
          const convertProvider = (c, recordId: string) => ({
            id: recordId,
            name: c.name,
            createdAt: new Date(c.create_date),
            createdBy: c.create_user,
          });
          if (!isIncrementalRun) {
            const idToLegacyIdMap = {};
            const processedData = jsonData[key].map((c) => {
              const id = nanoid(14);
              setMappedId(llmProviderIdMap, c.llm_provider_id, id);
              idToLegacyIdMap[id] = c.llm_provider_id;
              return convertProvider(c, id);
            });

            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${subtype}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.llmProvider
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${subtype}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.llmProvider
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(
                          llmProviderIdMap,
                          idToLegacyIdMap[item.id],
                        );
                        console.error(
                          `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${idToLegacyIdMap[item.id]}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const c of jsonData[key]) {
              if (!shouldProcessRecord(c.create_date, c.modify_date)) {
                continue;
              }
              const existingId = getMappedId(
                llmProviderIdMap,
                c.llm_provider_id,
              );
              const id = existingId ?? nanoid(14);
              const data = convertProvider(c, id);
              try {
                const updateData = omitId(data);
                await prisma.llmProvider.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(llmProviderIdMap, c.llm_provider_id, id);
                }
              } catch (err) {
                console.error(
                  `[${type}][${subtype}][${file}] Failed to upsert llmProvider legacyId ${c.llm_provider_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'llm_model': {
          console.log(`[${type}][${subtype}][${file}] Processing file`);
          const convertModel = (c, recordId: string) => {
            const providerId = requireMappedId(
              llmProviderIdMap,
              c.provider_id,
              'llm provider',
            );
            return {
              id: recordId,
              providerId,
              name: c.name,
              description: c.description,
              icon: c.icon,
              url: c.url,
              createdAt: new Date(c.create_date),
              createdBy: c.create_user,
            };
          };
          if (!isIncrementalRun) {
            const idToLegacyIdMap = {};
            const processedData = jsonData[key].map((c) => {
              const id = nanoid(14);
              setMappedId(llmModelIdMap, c.llm_model_id, id);
              idToLegacyIdMap[id] = c.llm_model_id;
              return convertModel(c, id);
            });

            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${subtype}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.llmModel
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${subtype}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.llmModel
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(llmModelIdMap, idToLegacyIdMap[item.id]);
                        console.error(
                          `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${idToLegacyIdMap[item.id]}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const c of jsonData[key]) {
              if (!shouldProcessRecord(c.create_date, c.modify_date)) {
                continue;
              }
              const existingId = getMappedId(llmModelIdMap, c.llm_model_id);
              const id = existingId ?? nanoid(14);
              const data = convertModel(c, id);
              try {
                const updateData = omitId(data);
                await prisma.llmModel.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(llmModelIdMap, c.llm_model_id, id);
                }
              } catch (err) {
                console.error(
                  `[${type}][${subtype}][${file}] Failed to upsert llmModel legacyId ${c.llm_model_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        case 'ai_workflow': {
          console.log(`[${type}][${subtype}][${file}] Processing file`);
          const convertWorkflow = (c, recordId: string) => {
            const llmId = requireMappedId(llmModelIdMap, c.llm_id, 'llm model');
            const scorecardId = requireMappedId(
              scorecardIdMap,
              c.scorecard_id,
              'scorecard',
            );
            return {
              id: recordId,
              llmId,
              name: c.name,
              description: c.description,
              defUrl: c.def_url,
              gitWorkflowId: c.git_id,
              gitOwnerRepo: c.git_owner,
              scorecardId,
              createdAt: new Date(c.create_date),
              createdBy: c.create_user,
              updatedAt: new Date(c.modify_date),
              updatedBy: c.modify_user,
            };
          };
          if (!isIncrementalRun) {
            const idToLegacyIdMap = {};
            const processedData = jsonData[key].map((c) => {
              const id = nanoid(14);
              setMappedId(aiWorkflowIdMap, c.ai_workflow_id, id);
              idToLegacyIdMap[id] = c.ai_workflow_id;
              return convertWorkflow(c, id);
            });

            const totalBatches = Math.ceil(processedData.length / batchSize);
            for (let i = 0; i < processedData.length; i += batchSize) {
              const batchIndex = i / batchSize + 1;
              console.log(
                `[${type}][${subtype}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
              );
              const batch = processedData.slice(i, i + batchSize);
              await prisma.aiWorkflow
                .createMany({
                  data: batch,
                })
                .catch(async () => {
                  console.error(
                    `[${type}][${subtype}][${file}] An error occurred, retrying individually`,
                  );
                  for (const item of batch) {
                    await prisma.aiWorkflow
                      .create({
                        data: item,
                      })
                      .catch((err) => {
                        deleteMappedId(
                          aiWorkflowIdMap,
                          idToLegacyIdMap[item.id],
                        );
                        console.error(
                          `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${idToLegacyIdMap[item.id]}`,
                        );
                      });
                  }
                });
            }
          } else {
            for (const c of jsonData[key]) {
              if (!shouldProcessRecord(c.create_date, c.modify_date)) {
                continue;
              }
              const existingId = getMappedId(aiWorkflowIdMap, c.ai_workflow_id);
              const id = existingId ?? nanoid(14);
              const data = convertWorkflow(c, id);
              try {
                const updateData = omitId(data);
                await prisma.aiWorkflow.upsert({
                  where: { id },
                  create: data,
                  update: updateData,
                });
                if (!existingId) {
                  setMappedId(aiWorkflowIdMap, c.ai_workflow_id, id);
                }
              } catch (err) {
                console.error(
                  `[${type}][${subtype}][${file}] Failed to upsert aiWorkflow legacyId ${c.ai_workflow_id}`,
                );
                console.error(err);
              }
            }
          }
          break;
        }
        default:
          console.warn(`No processor defined for type: ${type}`);
          return;
      }
    }
  }
}

async function processAllTypes() {
  for (const type of modelMappingKeys) {
    console.log(`[${type}] Processing start`);
    if (subModelMappingKeys[type]) {
      for (const subtype of subModelMappingKeys[type]) {
        await processType(type, subtype);
      }
    } else {
      await processType(type);
    }
    console.log(`[${type}] Processing completed`);
  }
}

function convertResourceSubmission(jsonData, existingId?: string) {
  const legacySubmissionId = normalizeLegacyKey(jsonData['submission_id']);
  return {
    id: existingId ?? nanoid(14),
    resourceId: jsonData['resource_id'],
    legacySubmissionId,
    submissionId:
      getMappedId(submissionIdMap, jsonData['submission_id']) ?? null,
    createdAt: new Date(jsonData['create_date']),
    createdBy: jsonData['create_user'],
    updatedAt: new Date(jsonData['modify_date']),
    updatedBy: jsonData['modify_user'],
  };
}

let resourceSubmissions: any[] = [];
async function handleResourceSubmission(data) {
  if (isIncrementalRun) {
    await upsertResourceSubmission(data);
    return;
  }
  resourceSubmissions.push(data);
  if (resourceSubmissions.length > batchSize) {
    await doImportResourceSubmission();
    resourceSubmissions = [];
  }
}

async function doImportResourceSubmission() {
  try {
    await prisma.resourceSubmission.createMany({
      data: resourceSubmissions,
    });
  } catch {
    for (const rs of resourceSubmissions) {
      try {
        await prisma.resourceSubmission.create({
          data: rs,
        });
      } catch {
        console.error(
          `Failed to import resource_submission ${rs.resourceId}_${rs.legacySubmissionId}`,
        );
      }
    }
  }
}

async function upsertResourceSubmission(data) {
  const { id, ...updateData } = data;
  try {
    await prisma.resourceSubmission.upsert({
      where: { id },
      create: data,
      update: updateData,
    });
  } catch (err) {
    console.error(
      `Failed to upsert resource_submission ${data.resourceId}_${data.legacySubmissionId}`,
    );
    console.error(err);
    throw err;
  }
}

async function migrateResourceSubmissions() {
  const filenameRegex = new RegExp(`^resource_submission_\\d+\\.json`);
  const filenames = fs
    .readdirSync(DATA_DIR)
    .filter((f) => filenameRegex.test(f));
  filenames.sort(filenameComp);
  // start importing data
  let totalCount = 0;
  for (const f of filenames) {
    const filePath = path.join(DATA_DIR, f);
    console.log(`Reading resource_submission data from ${f}`);
    const jsonData = readJson(filePath)['resource_submission'];
    let dataCount = 0;
    for (const d of jsonData) {
      dataCount += 1;
      const shouldPersist = shouldProcessRecord(
        d['create_date'],
        d['modify_date'],
      );
      const key = `${d['resource_id']}:${d['submission_id']}`;
      const existingId = getMappedId(resourceSubmissionIdMap, key);
      const data = convertResourceSubmission(d, existingId);
      if (isIncrementalRun) {
        if (!existingId && !shouldPersist) {
          continue;
        }
        if (!resourceSubmissionSet.has(key)) {
          resourceSubmissionSet.add(key);
        }
        if (!existingId) {
          setMappedId(resourceSubmissionIdMap, key, data.id);
        }
        if (shouldPersist || !existingId) {
          await handleResourceSubmission(data);
        }
      } else if (!resourceSubmissionSet.has(key)) {
        resourceSubmissionSet.add(key);
        setMappedId(resourceSubmissionIdMap, key, data.id);
        await handleResourceSubmission(data);
      }
      if (dataCount % logSize === 0) {
        console.log(`Imported resource_submission count: ${dataCount}`);
      }
    }
    totalCount += dataCount;
  }
  console.log(`resource_submission total count: ${totalCount}`);
  if (!isIncrementalRun) {
    await doImportResourceSubmission();
  }
}

async function migrate() {
  if (!fs.existsSync(DATA_DIR)) {
    throw new Error(
      `DATA_DIR "${DATA_DIR}" does not exist. Set DATA_DIR to a valid export path.`,
    );
  }
  console.log(`Using data directory: ${DATA_DIR}`);
  console.log(`Using ElasticSearch export file: ${ES_DATA_FILE}`);
  console.log('Starting lookup import...');
  processLookupFiles();
  console.log('Lookup import completed.');

  // import upload and submision data, init {challengeId -> submission} map
  console.log('Starting submission import...');
  await initSubmissionMap();
  console.log('Submission import completed.');

  console.log('Starting review import...');
  await processAllTypes();
  console.log('Review data import completed.');

  // import Elastic Search data
  console.log('Starting Elastic Search data migration...');
  await migrateElasticSearch();
  console.log('Elastic Search data imported.');

  // import resource_submission data
  console.log('Starting importing resource-submissions...');
  await migrateResourceSubmissions();
  console.log('Resource-submissions import completed.');
}

migrate()
  .then(async () => {
    console.log('---------------- ALL DONE ----------------');
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error('Migration failed', e);
    await prisma.$disconnect();
    process.exit(1);
  })
  .finally(() => {
    [
      { key: 'projectIdMap', value: projectIdMap },
      { key: 'scorecardIdMap', value: scorecardIdMap },
      {
        key: 'scorecardGroupIdMap',
        value: scorecardGroupIdMap,
      },
      {
        key: 'scorecardSectionIdMap',
        value: scorecardSectionIdMap,
      },
      {
        key: 'scorecardQuestionIdMap',
        value: scorecardQuestionIdMap,
      },
      {
        key: 'reviewIdMap',
        value: reviewIdMap,
      },
      {
        key: 'reviewItemIdMap',
        value: reviewItemIdMap,
      },
      {
        key: 'reviewItemCommentReviewItemCommentIdMap',
        value: reviewItemCommentReviewItemCommentIdMap,
      },
      {
        key: 'reviewItemCommentAppealIdMap',
        value: reviewItemCommentAppealIdMap,
      },
      {
        key: 'reviewItemCommentAppealResponseIdMap',
        value: reviewItemCommentAppealResponseIdMap,
      },
      { key: 'uploadIdMap', value: uploadIdMap },
      { key: 'submissionIdMap', value: submissionIdMap },
      { key: 'llmProviderIdMap', value: llmProviderIdMap },
      { key: 'llmModelIdMap', value: llmModelIdMap },
      { key: 'aiWorkflowIdMap', value: aiWorkflowIdMap },
      { key: 'resourceSubmissionIdMap', value: resourceSubmissionIdMap },
    ].forEach((f) => {
      if (!fs.existsSync('.tmp')) {
        fs.mkdirSync('.tmp');
      }
      fs.writeFileSync(
        `.tmp/${f.key}.json`,
        JSON.stringify(Object.fromEntries(f.value)),
      );
    });
    // write resourceSubmissionSet to file
    fs.writeFileSync(rsSetFile, JSON.stringify([...resourceSubmissionSet]));
  });
