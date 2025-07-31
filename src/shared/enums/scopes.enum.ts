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
};
