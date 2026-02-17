/**
 * Enum defining all the possible scopes for M2M tokens
 */
export enum Scope {
  // Appeal scopes
  CreateAppeal = 'create:appeal',
  ReadAppeal = 'read:appeal',
  UpdateAppeal = 'update:appeal',
  DeleteAppeal = 'delete:appeal',
  CreateAppealResponse = 'create:appeal-response',
  UpdateAppealResponse = 'update:appeal-response',
  AllAppeal = 'all:appeal',

  // Contact request scopes
  CreateContactRequest = 'create:contact-request',
  AllContactRequest = 'all:contact-request',

  // Project result scopes
  ReadProjectResult = 'read:project-result',
  AllProjectResult = 'all:project-result',

  // Review scopes
  CreateReview = 'create:review',
  ReadReview = 'read:review',
  UpdateReview = 'update:review',
  DeleteReview = 'delete:review',
  CreateReviewItem = 'create:review-item',
  UpdateReviewItem = 'update:review-item',
  DeleteReviewItem = 'delete:review-item',
  AllReview = 'all:review',

  // Scorecard scopes
  CreateScorecard = 'create:scorecard',
  ReadScorecard = 'read:scorecard',
  UpdateScorecard = 'update:scorecard',
  DeleteScorecard = 'delete:scorecard',
  AllScorecard = 'all:scorecard',

  // Review type scopes
  CreateReviewType = 'create:review_type',
  ReadReviewType = 'read:review_type',
  UpdateReviewType = 'update:review_type',
  DeleteReviewType = 'delete:review_type',
  AllReviewType = 'all:review_type',

  // Review oportunity scopes
  CreateReviewOpportunity = 'create:review_opportunity',
  ReadReviewOpportunity = 'read:review_opportunity',
  UpdateReviewOpportunity = 'update:review_opportunity',
  DeleteReviewOpportunity = 'delete:review_opportunity',
  AllReviewOpportunity = 'all:review_opportunity',

  // Review summation scopes
  CreateReviewSummation = 'create:review_summation',
  ReadReviewSummation = 'read:review_summation',
  UpdateReviewSummation = 'update:review_summation',
  DeleteReviewSummation = 'delete:review_summation',
  AllReviewSummation = 'all:review_summation',

  // Submission scopes
  CreateSubmission = 'create:submission',
  ReadSubmission = 'read:submission',
  UpdateSubmission = 'update:submission',
  DeleteSubmission = 'delete:submission',
  AllSubmission = 'all:submission',

  // Submission artifact scopes
  CreateSubmissionArtifacts = 'create:submission-artifacts',
  ReadSubmissionArtifacts = 'read:submission-artifacts',
  DeleteSubmissionArtifacts = 'delete:submission-artifacts',
  AllSubmissionArtifacts = 'all:submission-artifacts',

  // AI workflow scopes
  CreateWorkflow = 'create:workflow',
  ReadWorkflow = 'read:workflow',
  UpdateWorkflow = 'update:workflow',
  CreateWorkflowRun = 'create:workflow-run',
  ReadWorkflowRun = 'read:workflow-run',
  UpdateWorkflowRun = 'update:workflow-run',

  // AI review template scopes
  CreateAiReviewTemplate = 'create:ai-review-template',
  ReadAiReviewTemplate = 'read:ai-review-template',
  UpdateAiReviewTemplate = 'update:ai-review-template',
  DeleteAiReviewTemplate = 'delete:ai-review-template',
}

/**
 * Maps AllScope types to the corresponding individual scopes
 */
export const ALL_SCOPE_MAPPINGS: Record<string, string[]> = {
  [Scope.AllAppeal]: [
    Scope.CreateAppeal,
    Scope.ReadAppeal,
    Scope.UpdateAppeal,
    Scope.DeleteAppeal,
    Scope.CreateAppealResponse,
    Scope.UpdateAppealResponse,
  ],
  [Scope.AllContactRequest]: [Scope.CreateContactRequest],
  [Scope.AllProjectResult]: [Scope.ReadProjectResult],
  [Scope.AllReview]: [
    Scope.CreateReview,
    Scope.ReadReview,
    Scope.UpdateReview,
    Scope.DeleteReview,
    Scope.CreateReviewItem,
    Scope.UpdateReviewItem,
    Scope.DeleteReviewItem,
  ],
  [Scope.AllScorecard]: [
    Scope.CreateScorecard,
    Scope.ReadScorecard,
    Scope.UpdateScorecard,
    Scope.DeleteScorecard,
  ],
  [Scope.AllReviewType]: [
    Scope.CreateReviewType,
    Scope.ReadReviewType,
    Scope.UpdateReviewType,
    Scope.DeleteReviewType,
  ],
  [Scope.AllReviewSummation]: [
    Scope.CreateReviewSummation,
    Scope.ReadReviewSummation,
    Scope.UpdateReviewSummation,
    Scope.DeleteReviewSummation,
  ],
  [Scope.AllSubmission]: [
    Scope.CreateSubmission,
    Scope.ReadSubmission,
    Scope.UpdateSubmission,
    Scope.DeleteSubmission,
  ],
  [Scope.AllSubmissionArtifacts]: [
    Scope.CreateSubmissionArtifacts,
    Scope.ReadSubmissionArtifacts,
    Scope.DeleteSubmissionArtifacts,
  ],
};
