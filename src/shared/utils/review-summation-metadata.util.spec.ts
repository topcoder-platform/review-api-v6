import { buildSafeReviewSummationMetadata } from './review-summation-metadata.util';

describe('buildSafeReviewSummationMetadata', () => {
  it('keeps cancelled Marathon Match scoring visible to members', () => {
    expect(
      buildSafeReviewSummationMetadata({
        challengeId: 'challenge-1',
        testProcess: 'provisional',
        testProgress: 1,
        testStatus: 'CANCELLED',
        testType: 'provisional',
        testProgressDetails: {
          progress: 1,
          status: 'CANCELLED',
          testProcess: 'provisional',
          updatedAt: '2026-08-17T03:49:29.953Z',
        },
      }),
    ).toEqual({
      testProcess: 'provisional',
      testProgress: 1,
      testStatus: 'CANCELLED',
      testType: 'provisional',
      testProgressDetails: {
        progress: 1,
        status: 'CANCELLED',
        testProcess: 'provisional',
        updatedAt: '2026-08-17T03:49:29.953Z',
      },
    });
  });

  it('drops unsupported test statuses', () => {
    expect(
      buildSafeReviewSummationMetadata({
        testProcess: 'provisional',
        testStatus: 'SUPERSEDED',
      }),
    ).toEqual({ testProcess: 'provisional' });
  });
});
