import { ReviewApplicationRole } from '@prisma/client';
import { ReviewOpportunityType } from 'src/dto/reviewOpportunity.dto';

// Build payment config for each review opportunity config.
const paymentConfig: Record<string, Record<string, number>> = {};

paymentConfig[ReviewOpportunityType.REGULAR_REVIEW] = {};
paymentConfig[ReviewOpportunityType.REGULAR_REVIEW][
  ReviewApplicationRole.PRIMARY_REVIEWER
] = 1;
paymentConfig[ReviewOpportunityType.REGULAR_REVIEW][
  ReviewApplicationRole.SECONDARY_REVIEWER
] = 0.8;

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
    memberApiUrl: process.env.MEMBER_API_URL ?? 'http://localhost:4000/members',
    onlineReviewUrlBase:
      'https://software.topcoder.com/review/actions/ViewProjectDetails?pid=',
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
  },
};
