import { SubmissionResponseDto } from 'src/dto/submission.dto';
import { ChallengeData } from 'src/shared/modules/global/challenge.service';

/**
 * Mocked data for testing purposes.
 * This class provides static methods to return mock data for submissions and challenges.
 * It is used to simulate API responses in unit tests or development environments.
 *
 * Should be removed when challenge is concluded or when real data is available.
 */
export class MockedData {
  static readonly submissionScanComplete = {
    submissionId: '12345',
    isInfected: false,
    challengeId: 'Triggers',
  };

  static readonly challengeDetail = [
    {
      id: 'Triggers',
      name: 'Sample Challenge',
      track: 'F2F',
      legacyId: 54321,
      workflows: [
        {
          worflowId: 'test_ai_workflow.yaml',
          ref: 'refs/heads/master',
          params: { key: 'value' },
        },
        {
          worflowId: 'test_ai_workflows.yaml',
          ref: 'refs/heads/master',
          params: { key: 'value' },
        },
      ],
    },
    {
      id: 'challenge-id-123',
      name: 'Sample Challenge',
      track: 'F2F',
      legacyId: 123,
      workflows: [
        {
          worflowId: 'test_ai_workflow.yaml',
          ref: 'refs/heads/master',
          params: { key: 'value' },
        },
        {
          worflowId: 'test_ai_workflows.yaml',
          ref: 'refs/heads/master',
          params: { key: 'value' },
        },
      ],
    },
  ] as ChallengeData[];

  static readonly submissionResponseDto = [
    {
      id: '12345',
      challengeId: 'Triggers',
      type: 'code',
      url: 'https://example.com/submission/12345',
    },
    {
      id: '67890',
      challengeId: 'challenge-id-123',
      type: 'code',
      url: 'https://example.com/submission/12345',
    },
  ] as SubmissionResponseDto[];

  static getSubmissionById(submissionId: string) {
    for (const submission of this.submissionResponseDto) {
      if (submission.id === submissionId) {
        return Promise.resolve(submission);
      }
    }
    throw new Error('Submission not found');
  }

  static getChallengeDetail(challengeId: string) {
    for (const challenge of this.challengeDetail) {
      if (challenge.id === challengeId) {
        return Promise.resolve(challenge);
      }
    }
    throw new Error('Challenge not found');
  }
}
