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
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'Scorecards');
const batchSize = 1000;
const logSize = 20000;
const esFileName = 'dev-submissions-api.data.json';

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
  'ai_workflow'
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
function readIdMap(filename) {
  return fs.existsSync(`.tmp/${filename}.json`)
    ? new Map(
        Object.entries(
          JSON.parse(fs.readFileSync(`.tmp/${filename}.json`, 'utf-8')),
        ),
      )
    : new Map<string, string>();
}

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
        scorecardId: scorecardIdMap.get(summation.scoreCardId),
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
  const filepath = path.join(DATA_DIR, esFileName);
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
      if (submissionIdMap.has(submission.legacySubmissionId)) {
        newSubmission = false;
        await prisma.submission.update({
          data: submission,
          where: {
            id: submissionIdMap.get(submission.legacySubmissionId) as string,
          },
        });
      } else {
        newSubmission = true;
        const newId = nanoid(14);
        projectIdMap.set(submission.legacySubmissionId, newId);
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
      }
    } catch {
      if (newSubmission) {
        projectIdMap.delete(submission.legacySubmissionId);
      }
      console.error(`Failed to import submission from ES: ${submission.esId}`);
    }
  }
}

function convertUpload(jsonData) {
  return {
    id: nanoid(14),
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
        uploadIdMap.delete(u.legacyId);
      }
    }
  }
}

function convertSubmission(jsonData) {
  return {
    id: nanoid(14),
    legacySubmissionId: jsonData['submission_id'],
    legacyUploadId: jsonData['upload_id'],
    uploadId: uploadIdMap.get(jsonData['upload_id']),
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
        submissionIdMap.delete(s.legacySubmissionId);
      }
    }
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
      const uploadData = convertUpload(d);
      // import upload data if any
      if (!uploadIdMap.has(uploadData.legacyId)) {
        uploadIdMap.set(uploadData.legacyId, uploadData.id);
        await importUploadData(uploadData);
      }
      // collect data to resourceUploadMap
      if (
        uploadData.type === UploadType.SUBMISSION &&
        uploadData.status === UploadStatus.ACTIVE &&
        uploadData.resourceId != null
      ) {
        resourceUploadMap[uploadData.resourceId] = uploadData.legacyId;
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
      const dbData = convertSubmission(d);
      if (!submissionIdMap.has(dbData.legacySubmissionId)) {
        submissionIdMap.set(dbData.legacySubmissionId, dbData.id);
        await importSubmissionData(dbData);
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
        if (uploadSubmissionMap[dbData.legacyUploadId]) {
          const existing = uploadSubmissionMap[dbData.legacyUploadId];
          if (
            !existing.score ||
            item.created.getTime() > existing.created.getTime()
          ) {
            uploadSubmissionMap[dbData.legacyUploadId] = item;
          }
        } else {
          uploadSubmissionMap[dbData.legacyUploadId] = item;
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
          const processedData = jsonData[key]
            .filter((pr) => !projectIdMap.has(pr.project_id + pr.user_id))
            .map((pr) => {
              projectIdMap.set(
                pr.project_id + pr.user_id,
                pr.project_id + pr.user_id,
              );
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
                rated: pr.rating_ind === 1,
                passedReview: pr.passed_review_ind === 1,
                validSubmission: pr.valid_submission_ind === 1,
                pointAdjustment: parseFloat(pr.point_adjustment),
                ratingOrder: parseInt(pr.rating_order),
                createdAt: new Date(pr.create_date),
                createdBy: pr.create_user || '',
                updatedAt: new Date(pr.modify_date),
                updatedBy: pr.modify_user || '',
              };
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
                      projectIdMap.delete(item.project_id + item.user_id);
                      console.error(
                        `[${type}][${file}] Error code: ${err.code}, ChallengeId: ${item.challengeId}, UserId: ${item.userId}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'scorecard': {
          console.log(`[${type}][${file}] Processing file`);
          const processedData = jsonData[key]
            .map((sc) => {
              const id = nanoid(14);
              scorecardIdMap.set(sc.scorecard_id, id);
              return {
                id: id,
                legacyId: sc.scorecard_id,
                status: scorecardStatusMap[sc.scorecard_status_id],
                type: scorecardTypeMap[sc.scorecard_type_id],
                challengeTrack: projectCategoryMap[sc.project_category_id].type,
                challengeType: projectCategoryMap[sc.project_category_id].name,
                name: sc.name,
                version: sc.version,
                minScore: parseFloat(sc.min_score),
                maxScore: parseFloat(sc.max_score),
                createdAt: new Date(sc.create_date),
                createdBy: sc.create_user,
                updatedAt: new Date(sc.modify_date),
                updatedBy: sc.modify_user,
              };
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
                      scorecardIdMap.delete(item.legacyId);
                      console.error(
                        `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'scorecard_group': {
          console.log(`[${type}][${file}] Processing file`);
          const processedData = jsonData[key]
            .filter(
              (group) => !scorecardGroupIdMap.has(group.scorecard_group_id),
            )
            .map((group) => {
              const id = nanoid(14);
              scorecardGroupIdMap.set(group.scorecard_group_id, id);
              return {
                id: id,
                legacyId: group.scorecard_group_id,
                scorecardId: scorecardIdMap.get(group.scorecard_id),
                name: group.name,
                weight: parseFloat(group.weight),
                sortOrder: parseInt(group.sort),
                createdAt: new Date(group.create_date),
                createdBy: group.create_user,
                updatedAt: new Date(group.modify_date),
                updatedBy: group.modify_user,
              };
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
                      scorecardGroupIdMap.delete(item.legacyId);
                      console.error(
                        `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'scorecard_section': {
          console.log(`[${type}][${file}] Processing file`);
          const processedData = jsonData[key]
            .filter(
              (section) =>
                !scorecardSectionIdMap.has(section.scorecard_section_id),
            )
            .map((section) => {
              const id = nanoid(14);
              scorecardSectionIdMap.set(section.scorecard_section_id, id);
              return {
                id: id,
                legacyId: section.scorecard_section_id,
                scorecardGroupId: scorecardGroupIdMap.get(
                  section.scorecard_group_id,
                ),
                name: section.name,
                weight: parseFloat(section.weight),
                sortOrder: parseInt(section.sort),
                createdAt: new Date(section.create_date),
                createdBy: section.create_user,
                updatedAt: new Date(section.modify_date),
                updatedBy: section.modify_user,
              };
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
                      scorecardSectionIdMap.delete(item.legacyId);
                      console.error(
                        `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'scorecard_question': {
          console.log(`[${type}][${file}] Processing file`);
          const processedData = jsonData[key]
            .filter(
              (question) =>
                !scorecardQuestionIdMap.has(question.scorecard_question_id),
            )
            .map((question) => {
              const id = nanoid(14);
              scorecardQuestionIdMap.set(question.scorecard_question_id, id);
              return {
                id: id,
                legacyId: question.scorecard_question_id,
                scorecardSectionId: scorecardSectionIdMap.get(
                  question.scorecard_section_id,
                ),
                type: questionTypeMap[question.scorecard_question_type_id].name,
                description: question.description,
                guidelines: question.guideline,
                weight: parseFloat(question.weight),
                requiresUpload: question.upload_document === '1',
                sortOrder: parseInt(question.sort),
                createdAt: new Date(question.create_date),
                createdBy: question.create_user,
                updatedAt: new Date(question.modify_date),
                updatedBy: question.modify_user,
                scaleMin:
                  questionTypeMap[question.scorecard_question_type_id].min,
                scaleMax:
                  questionTypeMap[question.scorecard_question_type_id].max,
              };
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
                      scorecardQuestionIdMap.delete(item.legacyId);
                      console.error(
                        `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'review': {
          console.log(`[${type}][${file}] Processing file`);
          const processedData = jsonData[key]
            .filter((review) => !reviewIdMap.has(review.review_id))
            .map((review) => {
              const id = nanoid(14);
              reviewIdMap.set(review.review_id, id);
              return {
                id,
                legacyId: review.review_id,
                resourceId: review.resource_id,
                phaseId: review.project_phase_id,
                submissionId: submissionIdMap.get(review.submission_id) || null,
                legacySubmissionId: review.submission_id,
                scorecardId: scorecardIdMap.get(review.scorecard_id),
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
            });
          const totalBatches = Math.ceil(processedData.length / batchSize);
          for (let i = 0; i < processedData.length; i += batchSize) {
            const batchIndex = i / batchSize + 1;
            console.log(
              `[${type}][${file}] Processing batch ${batchIndex}/${totalBatches}`,
            );
            const batch = processedData.slice(i, i + batchSize);
            await prisma.review.createMany({ data: batch }).catch(async () => {
              console.error(
                `[${type}][${file}] An error occurred, retrying individually`,
              );
              for (const item of batch) {
                await prisma.review
                  .create({
                    data: item,
                  })
                  .catch((err) => {
                    reviewIdMap.delete(item.legacyId);
                    console.error(
                      `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                    );
                  });
              }
            });
          }
          break;
        }
        case 'review_item': {
          console.log(`[${type}][${file}] Processing file`);
          const processedData = jsonData[key]
            .filter((item) => !reviewItemIdMap.has(item.review_item_id))
            .map((item) => {
              const id = nanoid(14);
              reviewItemIdMap.set(item.review_item_id, id);
              return {
                id: id,
                legacyId: item.review_item_id,
                reviewId: reviewIdMap.get(item.review_id),
                scorecardQuestionId: scorecardQuestionIdMap.get(
                  item.scorecard_question_id,
                ),
                uploadId: item.upload_id || null,
                initialAnswer: item.answer,
                finalAnswer: item.answer,
                managerComment: item.answer,
                createdAt: new Date(item.create_date),
                createdBy: item.create_user,
                updatedAt: new Date(item.modify_date),
                updatedBy: item.modify_user,
              };
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
                      reviewItemIdMap.delete(item.legacyId);
                      console.error(
                        `[${type}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'review_item_comment': {
          switch (subtype) {
            case 'reviewItemComment': {
              console.log(`[${type}][${subtype}][${file}] Processing file`);
              const processedData = jsonData[key]
                .filter(
                  (c) =>
                    reviewItemCommentTypeMap[c.comment_type_id] in
                    LegacyCommentType,
                )
                .filter(
                  (c) =>
                    !reviewItemCommentReviewItemCommentIdMap.has(
                      c.review_item_comment_id,
                    ),
                )
                .map((c) => {
                  const id = nanoid(14);
                  reviewItemCommentReviewItemCommentIdMap.set(
                    c.review_item_comment_id,
                    id,
                  );
                  return {
                    id: id,
                    legacyId: c.review_item_comment_id,
                    resourceId: c.resource_id,
                    reviewItemId: reviewItemIdMap.get(c.review_item_id),
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
                });
              const totalBatches = Math.ceil(processedData.length / batchSize);
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
                          reviewItemCommentReviewItemCommentIdMap.delete(
                            item.legacyId,
                          );
                          console.error(
                            `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                          );
                        });
                    }
                  });
              }
              break;
            }
            case 'appeal': {
              console.log(`[${type}][${subtype}][${file}] Processing file`);
              const processedData = jsonData[key]
                .filter(
                  (c) =>
                    reviewItemCommentTypeMap[c.comment_type_id] === 'Appeal',
                )
                .filter(
                  (c) => !reviewItemCommentAppealIdMap.has(c.review_item_id),
                )
                .map((c) => {
                  const id = nanoid(14);
                  reviewItemCommentAppealIdMap.set(c.review_item_id, id);
                  return {
                    id: id,
                    legacyId: c.review_item_comment_id,
                    resourceId: c.resource_id,
                    reviewItemCommentId:
                      reviewItemCommentReviewItemCommentIdMap.get(
                        c.review_item_id,
                      ),
                    content: c.content,
                    createdAt: new Date(c.create_date),
                    createdBy: c.create_user,
                    updatedAt: new Date(c.modify_date),
                    updatedBy: c.modify_user,
                  };
                });

              const totalBatches = Math.ceil(processedData.length / batchSize);
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
                          reviewItemCommentAppealIdMap.delete(item.legacyId);
                          console.error(
                            `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                          );
                        });
                    }
                  });
              }
              break;
            }
            case 'appealResponse': {
              console.log(`[${type}][${subtype}][${file}] Processing file`);
              const processedData = jsonData[key]
                .filter(
                  (c) =>
                    reviewItemCommentTypeMap[c.comment_type_id] ===
                    'Appeal Response',
                )
                .filter(
                  (c) =>
                    !reviewItemCommentAppealResponseIdMap.has(
                      c.review_item_comment_id,
                    ),
                )
                .map((c) => {
                  const id = nanoid(14);
                  reviewItemCommentAppealResponseIdMap.set(
                    c.review_item_comment_id,
                    id,
                  );
                  return {
                    id: id,
                    legacyId: c.review_item_comment_id,
                    appealId: reviewItemCommentAppealIdMap.get(
                      c.review_item_id,
                    ),
                    resourceId: c.resource_id,
                    content: c.content,
                    success: c.extra_info === 'Succeeded',
                    createdAt: new Date(c.create_date),
                    createdBy: c.create_user,
                    updatedAt: new Date(c.modify_date),
                    updatedBy: c.modify_user,
                  };
                });
              const totalBatches = Math.ceil(processedData.length / batchSize);
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
                          reviewItemCommentAppealResponseIdMap.delete(
                            item.legacyId,
                          );
                          console.error(
                            `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${item.legacyId}`,
                          );
                        });
                    }
                  });
              }
              break;
            }
          }
          break;
        }
        case 'llm_provider': {
          console.log(`[${type}][${subtype}][${file}] Processing file`);
          const idToLegacyIdMap = {};
          const processedData = jsonData[key]
          .map((c) => {
            const id = nanoid(14);
            llmProviderIdMap.set(
              c.llm_provider_id,
              id,
            );
            idToLegacyIdMap[id] = c.llm_provider_id;
            return {
              id: id,
              name: c.name,
              createdAt: new Date(c.create_date),
              createdBy: c.create_user,
            };
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
                      llmProviderIdMap.delete(
                        idToLegacyIdMap[item.id],
                      );
                      console.error(
                        `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${idToLegacyIdMap[item.id]}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'llm_model': {
          console.log(`[${type}][${subtype}][${file}] Processing file`);
          const idToLegacyIdMap = {};
          const processedData = jsonData[key]
          .map((c) => {
            const id = nanoid(14);
            llmModelIdMap.set(
              c.llm_model_id,
              id,
            );
            idToLegacyIdMap[id] = c.llm_model_id;
            console.log(llmProviderIdMap.get(c.provider_id), 'c.provider_id')
            return {
              id: id,
              providerId: llmProviderIdMap.get(c.provider_id),
              name: c.name,
              description: c.description,
              icon: c.icon,
              url: c.url,
              createdAt: new Date(c.create_date),
              createdBy: c.create_user,
            };
          });

          console.log(llmProviderIdMap, processedData, 'processedData')

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
                      llmModelIdMap.delete(
                        idToLegacyIdMap[item.id],
                      );
                      console.error(
                        `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${idToLegacyIdMap[item.id]}`,
                      );
                    });
                }
              });
          }
          break;
        }
        case 'ai_workflow': {
          console.log(`[${type}][${subtype}][${file}] Processing file`);
          const idToLegacyIdMap = {};
          const processedData = jsonData[key]
          .map((c) => {
            const id = nanoid(14);
            aiWorkflowIdMap.set(
              c.ai_workflow_id,
              id,
            );
            idToLegacyIdMap[id] = c.ai_workflow_id;
            return {
              id: id,
              llmId: llmModelIdMap.get(c.llm_id),
              name: c.name,
              description: c.description,
              defUrl: c.def_url,
              gitId: c.git_id,
              gitOwner: c.git_owner,
              scorecardId: scorecardIdMap.get(c.scorecard_id),
              createdAt: new Date(c.create_date),
              createdBy: c.create_user,
              updatedAt: new Date(c.modify_date),
              updatedBy: c.modify_user,
            };
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
                  console.log(item, 'alskdjlaksd  sldfk');
                  await prisma.aiWorkflow
                    .create({
                      data: item,
                    })
                    .catch((err) => {
                      aiWorkflowIdMap.delete(
                        idToLegacyIdMap[item.id],
                      );
                      console.error(
                        `[${type}][${subtype}][${file}] Error code: ${err.code}, LegacyId: ${idToLegacyIdMap[item.id]}`,
                      );
                    });
                }
              });
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

function convertResourceSubmission(jsonData) {
  return {
    id: nanoid(14),
    resourceId: jsonData['resource_id'],
    legacySubmissionId: jsonData['submission_id'],
    submissionId: submissionIdMap[jsonData['submission_id']] || null,
    createdAt: new Date(jsonData['create_date']),
    createdBy: jsonData['create_user'],
    updatedAt: new Date(jsonData['modify_date']),
    updatedBy: jsonData['modify_user'],
  };
}

let resourceSubmissions: any[] = [];
async function handleResourceSubmission(data) {
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
      const data = convertResourceSubmission(d);
      const key = `${data.resourceId}:${data.legacySubmissionId}`;
      if (!resourceSubmissionSet.has(key)) {
        resourceSubmissionSet.add(key);
        await handleResourceSubmission(data);
      }
      if (dataCount % logSize === 0) {
        console.log(`Imported resource_submission count: ${dataCount}`);
      }
    }
    totalCount += dataCount;
  }
  console.log(`resource_submission total count: ${totalCount}`);
}

async function migrate() {
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
      { key: 'aiWorkflowIdMap', value: aiWorkflowIdMap }
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
