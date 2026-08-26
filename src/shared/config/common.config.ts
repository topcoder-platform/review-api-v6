import { ReviewApplicationRole } from '@prisma/client';
import { ReviewOpportunityType } from 'src/dto/reviewOpportunity.dto';

/**
 * Parses a comma separated environment value into a unique, trimmed list.
 *
 * @param value Raw environment value.
 * @returns The entries, in configuration order, without blanks or duplicates.
 * @throws This function never throws.
 */
function parseCsvEnv(value: string | undefined): string[] {
  return Array.from(
    new Set(
      (value ?? '')
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => !!entry),
    ),
  );
}

// Build payment config for each review opportunity config.
const paymentConfig: Record<string, Record<string, number>> = {};

paymentConfig[ReviewOpportunityType.REGULAR_REVIEW] = {};
paymentConfig[ReviewOpportunityType.REGULAR_REVIEW][
  ReviewApplicationRole.REVIEWER
] = 1;

paymentConfig[ReviewOpportunityType.ITERATIVE_REVIEW] = {};
paymentConfig[ReviewOpportunityType.ITERATIVE_REVIEW][
  ReviewApplicationRole.ITERATIVE_REVIEWER
] = 1;

paymentConfig[ReviewOpportunityType.SPEC_REVIEW] = {};
paymentConfig[ReviewOpportunityType.SPEC_REVIEW][
  ReviewApplicationRole.SPECIFICATION_REVIEWER
] = 1;

paymentConfig[ReviewOpportunityType.SCENARIOS_REVIEW] = {};
paymentConfig[ReviewOpportunityType.SCENARIOS_REVIEW][
  ReviewApplicationRole.REVIEWER
] = 1;

paymentConfig[ReviewOpportunityType.COMPONENT_DEV_REVIEW] = {};
paymentConfig[ReviewOpportunityType.COMPONENT_DEV_REVIEW][
  ReviewApplicationRole.PRIMARY_FAILURE_REVIEWER
] = 1;
paymentConfig[ReviewOpportunityType.COMPONENT_DEV_REVIEW][
  ReviewApplicationRole.FAILURE_REVIEWER
] = 0.8;
paymentConfig[ReviewOpportunityType.COMPONENT_DEV_REVIEW][
  ReviewApplicationRole.ACCURACY_REVIEWER
] = 0.8;
paymentConfig[ReviewOpportunityType.COMPONENT_DEV_REVIEW][
  ReviewApplicationRole.STRESS_REVIEWER
] = 0.8;

export const CommonConfig = {
  // API URLs
  apis: {
    busApiUrl: process.env.BUS_API_URL ?? 'http://localhost:4000/eventBus',
    challengeApiUrl:
      process.env.CHALLENGE_API_URL ?? 'http://localhost:4000/challenges/',
    resourceApiUrl:
      process.env.RESOURCE_API_URL ?? 'https://api.topcoder-dev.com/v6/',
    // Base URL for Topcoder v6 APIs (challenge types, tracks, etc.)
    v6ApiUrl: process.env.V6_API_URL ?? 'https://api.topcoder-dev.com/v6',
    memberApiUrl: process.env.MEMBER_API_URL ?? 'http://localhost:4000/members',
    groupsApiUrl:
      process.env.GROUPS_API_URL ?? 'https://api.topcoder-dev.com/v6/groups',
    onlineReviewUrlBase: 'https://review.topcoder.com/active-challenges/',
  },
  // Resource role configuration
  roles: {
    submitterRoleId:
      process.env.SUBMITTER_ROLE_ID ?? '732339e7-8e30-49d7-9198-cccf9451e221',
  },
  // Gitea configuration
  gitea: {
    // Identifier of the "Topcoder" authentication source configured in Gitea.
    // New Gitea accounts are provisioned against this source so that members
    // sign in with their existing Topcoder (auth0) credentials.
    authSourceId: Number(process.env.GITEA_AUTH_SOURCE_ID ?? '1'),
    // Visibility applied to Gitea accounts provisioned by this service.
    userVisibility: process.env.GITEA_USER_VISIBILITY ?? 'public',
    // Challenge metadata key holding the Gitea configuration for a challenge.
    challengeMetadataKey: 'gitea',
    // Gitea organizations searched when the challenge editor looks up teams.
    // Team names are only unique within an organization, so every organization
    // teams may be picked from has to be listed here (comma separated).
    organizations: parseCsvEnv(process.env.GITEA_ORGANIZATIONS ?? 'topcoder'),
  },
  // configs of payment for each review type
  reviewPaymentConfig: paymentConfig,
  // sendgrid templates configs
  sendgridConfig: {
    acceptEmailTemplate:
      process.env.SENDGRID_ACCEPT_REVIEW_APPLICATION ??
      'd-2de72880bd69499e9c16369398d34bb9',
    rejectEmailTemplate:
      process.env.SENDGRID_REJECT_REVIEW_APPLICATION ??
      'd-82ed74e778e84d8c9bc02eeda0f44b5e',
    contactManagersEmailTemplate:
      process.env.SENDGRID_CONTACT_MANAGERS_TEMPLATE ??
      'd-00000000000000000000000000000000',
    aiReviewEscalationsEmailTemplate:
      process.env.SENDGRID_AI_REVIEW_ESCALATION_CREATED_TEMPLATE ??
      'd-ecd4ec1d0b924bfe8ebc7c963d214aae',
    aiWorkflowRunCompletedEmailTemplate:
      process.env.SENDGRID_AI_WORKFLOW_RUN_COMPLETED_TEMPLATE ??
      'd-7d14d986ba0a4317b449164b73939910',
  },
  ui: {
    reviewUIUrl: process.env.REVIEW_UI_URL ?? 'https://review.topcoder-dev.com',
  },
};
