import { PrismaClient } from '@prisma/client';
import * as path from 'path';
import * as fs from 'fs';
import {
  ScorecardStatus,
  ScorecardType,
  ChallengeTrack,
  QuestionType,
} from '../src/dto/scorecard.dto';
import { ReviewItemCommentType } from '../src/dto/review.dto';
import { nanoid } from 'nanoid';

interface QuestionTypeMap {
  name: QuestionType;
  min?: number;
  max?: number;
}

interface ProjectTypeMap {
  name: string;
  type: ChallengeTrack;
}

const prisma = new PrismaClient();
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'Scorecards');
const batchSize = 1000;
const modelMappingKeys = [
  'project_result',
  'scorecard',
  'scorecard_group',
  'scorecard_section',
  'scorecard_question',
  'review',
  'review_item',
  'review_item_comment',
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
];

// Global lookup maps
let scorecardStatusMap: Record<string, ScorecardStatus> = {};
let scorecardTypeMap: Record<string, ScorecardType> = {};
let questionTypeMap: Record<string, QuestionTypeMap> = {};
let projectCategoryMap: Record<string, ProjectTypeMap> = {};
let reviewItemCommentTypeMap: Record<string, string> = {};

// Global submission map to store submission information.
let submissionMap: Record<string, Record<string, string>> = {};

// Data lookup maps
// Initialize maps from files if they exist, otherwise create new maps
const projectIdMap = fs.existsSync('.tmp/projectIdMap.json')
  ? new Map(
      Object.entries(
        JSON.parse(fs.readFileSync('.tmp/projectIdMap.json', 'utf-8')),
      ),
    )
  : new Map<string, string>();

const scorecardIdMap = fs.existsSync('.tmp/scorecardIdMap.json')
  ? new Map(
      Object.entries(
        JSON.parse(fs.readFileSync('.tmp/scorecardIdMap.json', 'utf-8')),
      ),
    )
  : new Map<string, string>();

const scorecardGroupIdMap = fs.existsSync('.tmp/scorecardGroupIdMap.json')
  ? new Map(
      Object.entries(
        JSON.parse(fs.readFileSync('.tmp/scorecardGroupIdMap.json', 'utf-8')),
      ),
    )
  : new Map<string, string>();

const scorecardSectionIdMap = fs.existsSync('.tmp/scorecardSectionIdMap.json')
  ? new Map(
      Object.entries(
        JSON.parse(fs.readFileSync('.tmp/scorecardSectionIdMap.json', 'utf-8')),
      ),
    )
  : new Map<string, string>();

const scorecardQuestionIdMap = fs.existsSync('.tmp/scorecardQuestionIdMap.json')
  ? new Map(
      Object.entries(
        JSON.parse(
          fs.readFileSync('.tmp/scorecardQuestionIdMap.json', 'utf-8'),
        ),
      ),
    )
  : new Map<string, string>();

const reviewIdMap = fs.existsSync('.tmp/reviewIdMap.json')
  ? new Map(
      Object.entries(
        JSON.parse(fs.readFileSync('.tmp/reviewIdMap.json', 'utf-8')),
      ),
    )
  : new Map<string, string>();

const reviewItemIdMap = fs.existsSync('.tmp/reviewItemIdMap.json')
  ? new Map(
      Object.entries(
        JSON.parse(fs.readFileSync('.tmp/reviewItemIdMap.json', 'utf-8')),
      ),
    )
  : new Map<string, string>();

const reviewItemCommentReviewItemCommentIdMap = fs.existsSync(
  '.tmp/reviewItemCommentReviewItemCommentIdMap.json',
)
  ? new Map(
      Object.entries(
        JSON.parse(
          fs.readFileSync(
            '.tmp/reviewItemCommentReviewItemCommentIdMap.json',
            'utf-8',
          ),
        ),
      ),
    )
  : new Map<string, string>();

const reviewItemCommentAppealIdMap = fs.existsSync(
  '.tmp/reviewItemCommentAppealIdMap.json',
)
  ? new Map(
      Object.entries(
        JSON.parse(
          fs.readFileSync('.tmp/reviewItemCommentAppealIdMap.json', 'utf-8'),
        ),
      ),
    )
  : new Map<string, string>();

const reviewItemCommentAppealResponseIdMap = fs.existsSync(
  '.tmp/reviewItemCommentAppealResponseIdMap.json',
)
  ? new Map(
      Object.entries(
        JSON.parse(
          fs.readFileSync(
            '.tmp/reviewItemCommentAppealResponseIdMap.json',
            'utf-8',
          ),
        ),
      ),
    )
  : new Map<string, string>();

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
  fs.readdirSync(DATA_DIR).filter(f => {
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
  // read submission files. Get {upload_id -> submission} map.
  const uploadSubmissionMap: Record<string, any> = {};
  let submissionCount = 0;
  for (const f of submissionFiles) {
    const filePath = path.join(DATA_DIR, f);
    console.log(`Reading submission data from ${f}`);
    const jsonData = readJson(filePath)['submission'];
    for (let d of jsonData) {
      if (d['submission_status_id'] === '1' && d['upload_id']) {
        submissionCount += 1;
        // find submission has score and most recent
        const item = {
          score: d['screening_score'] || d['initial_score'] || d['final_score'],
          created: d['create_date'],
          submissionId: d['submission_id']
        };
        if (uploadSubmissionMap[d['upload_id']]) {
          // existing submission info
          const existing = uploadSubmissionMap[d['upload_id']];
          if (!existing.score || item.created > existing.created) {
            uploadSubmissionMap[d['upload_id']] = item;
          }
        } else {
          uploadSubmissionMap[d['upload_id']] = item;
        }
      }
    }
  }
  console.log(`Submission total count: ${submissionCount}`);
  // read upload files. Get {resource_id -> submission_id} map.
  let uploadCount = 0;
  const resourceSubmissionMap: Record<string, any> = {};
  for (const f of uploadFiles) {
    const filePath = path.join(DATA_DIR, f);
    console.log(`Reading upload data from ${f}`);
    const jsonData = readJson(filePath)['upload'];
    for (let d of jsonData) {
      if (d['upload_status_id'] === '1' && d['upload_type_id'] === '1' && d['resource_id']) {
        // get submission info
        uploadCount += 1
        if (uploadSubmissionMap[d['upload_id']]) {
          resourceSubmissionMap[d['resource_id']] = uploadSubmissionMap[d['upload_id']];
        }
      }
    }
  }
  console.log(`Upload total count: ${uploadCount}`);
  // read resource files
  const challengeSubmissionMap: Record<string, Record<string, any>> = {};
  let resourceCount = 0;
  let validResourceCount = 0;
  for (const f of resourceFiles) {
    const filePath = path.join(DATA_DIR, f);
    console.log(`Reading resource data from ${f}`);
    const jsonData = readJson(filePath)['resource'];
    for (let d of jsonData) {
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
  console.log(`Read resource count: ${resourceCount}, submission resource count: ${validResourceCount}`);
  // print summary
  let totalSubmissions = 0;
  Object.keys(submissionMap).forEach(c => {
    totalSubmissions += Object.keys(submissionMap[c]).length;
  });
  console.log(`Found total submissions: ${totalSubmissions}`);
}


// Process a single type: find matching files, transform them one by one, and then insert in batches.
async function processType(type: string, subtype?: string) {
  const regex = new RegExp(`^${type}_\\d+\\.json$`);
  const files = fs
    .readdirSync(DATA_DIR)
    .filter((file) => regex.test(file))
    .sort((a, b) => {
      const numA = parseInt(a.match(/_(\d+)\.json$/)?.[1] || '0', 10);
      const numB = parseInt(b.match(/_(\d+)\.json$/)?.[1] || '0', 10);
      return numA - numB;
    });
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
            .filter((sc) => !scorecardIdMap.has(sc.scorecard_id))
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
                id: id,
                legacyId: review.review_id,
                resourceId: review.resource_id,
                phaseId: review.project_phase_id,
                submissionId: review.submission_id || '',
                scorecardId: scorecardIdMap.get(review.scorecard_id),
                committed: review.committed === '1',
                finalScore: parseFloat(review.score || '0.0'),
                initialScore: parseFloat(review.initial_score || '0.0'),
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

async function migrate() {
  console.log('Starting lookup import...');
  processLookupFiles();
  console.log('Lookup import completed.');

  // init resource-submission data
  console.log('Starting resource/submission import...');
  await initSubmissionMap();
  console.log('Resource/Submission import completed.');

  console.log('Starting data import...');
  await processAllTypes();
  console.log('Data import completed.');
}

migrate()
  .then(async () => {
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
    ].forEach((f) => {
      if (!fs.existsSync('.tmp')) {
        fs.mkdirSync('.tmp');
      }
      fs.writeFileSync(
        `.tmp/${f.key}.json`,
        JSON.stringify(Object.fromEntries(f.value)),
      );
    });
  });
