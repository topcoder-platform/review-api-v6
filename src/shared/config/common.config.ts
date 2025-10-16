import { ReviewApplicationRole } from '@prisma/client';
import { ReviewOpportunityType } from 'src/dto/reviewOpportunity.dto';

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
    onlineReviewUrlBase:
      'https://review.topcoder.com/review/active-challenges/',
  },
  // Resource role configuration
  roles: {
    submitterRoleId:
      process.env.SUBMITTER_ROLE_ID ?? '732339e7-8e30-49d7-9198-cccf9451e221',
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
  },
};
