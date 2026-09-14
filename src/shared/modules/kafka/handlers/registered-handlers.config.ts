import { SubmissionScanCompleteHandler } from './submission-scan-complete.handler';
import { SubmissionNotificationCreateHandler } from './submission-notification-create.handler';
import { ChallengeResourceCreateHandler } from './challenge-resource-create.handler';
import { ChallengeResourceDeleteHandler } from './challenge-resource-delete.handler';

export default [
  SubmissionScanCompleteHandler,
  SubmissionNotificationCreateHandler,
  ChallengeResourceCreateHandler,
  ChallengeResourceDeleteHandler,
];
