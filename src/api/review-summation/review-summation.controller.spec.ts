jest.mock('nanoid', () => ({
  __esModule: true,
  nanoid: () => 'mock-nanoid',
}));

import { ForbiddenException } from '@nestjs/common';

import { ReviewSummationController } from './review-summation.controller';

describe('ReviewSummationController', () => {
  describe('listReviewSummations', () => {
    const summationRow = {
      id: 'summation-1',
      submissionId: 'submission-1',
      submitterId: 222,
      submitterHandle: 'coder',
      aggregateScore: 88.5,
      isFinal: false,
      isProvisional: true,
      isExample: false,
      reviewedDate: null,
      createdAt: new Date('2026-05-01T00:00:00.000Z'),
      updatedAt: null,
    };

    const createResponse = () => ({
      setHeader: jest.fn(),
    });

    const createRequest = (
      accept: string | undefined,
      user?: Record<string, unknown>,
      query: Record<string, unknown> = {},
    ) => ({
      headers: accept ? { accept } : {},
      query,
      ...(user ? { user } : {}),
    });

    it('refuses the tab-delimited export for anonymous visitors', async () => {
      const searchSummation = jest.fn();
      const controller = new ReviewSummationController({
        searchSummation,
      } as any);

      await expect(
        controller.listReviewSummations(
          createRequest('text/tab-separated-values') as any,
          createResponse() as any,
          { challengeId: 'challenge-1' } as any,
        ),
      ).rejects.toMatchObject({
        response: { code: 'TSV_AUTHENTICATION_REQUIRED' },
      });
      await expect(
        controller.listReviewSummations(
          createRequest('text/tab-separated-values') as any,
          createResponse() as any,
          { challengeId: 'challenge-1' } as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      // The unbounded export never runs for an unauthenticated caller.
      expect(searchSummation).not.toHaveBeenCalled();
    });

    it('refuses the tab-delimited export requested through format=tsv', async () => {
      const searchSummation = jest.fn();
      const controller = new ReviewSummationController({
        searchSummation,
      } as any);

      await expect(
        controller.listReviewSummations(
          createRequest(undefined, undefined, { format: 'tsv' }) as any,
          createResponse() as any,
          { challengeId: 'challenge-1' } as any,
        ),
      ).rejects.toMatchObject({
        response: { code: 'TSV_AUTHENTICATION_REQUIRED' },
      });
      expect(searchSummation).not.toHaveBeenCalled();
    });

    it('still serves the public leaderboard as JSON to anonymous visitors', async () => {
      const results = {
        data: [summationRow],
        meta: { page: 1, perPage: 10, totalCount: 1, totalPages: 1 },
      };
      const searchSummation = jest.fn().mockResolvedValue(results);
      const controller = new ReviewSummationController({
        searchSummation,
      } as any);

      const response = await controller.listReviewSummations(
        createRequest('application/json') as any,
        createResponse() as any,
        { challengeId: 'challenge-1' } as any,
      );

      expect(response).toBe(results);
      expect(searchSummation).toHaveBeenCalledWith(
        undefined,
        { challengeId: 'challenge-1' },
        undefined,
        undefined,
      );
    });

    it('leaves the seed columns blank when the caller cannot read metadata', async () => {
      // searchSummation has already stripped metadata for this caller, so the
      // export has no per-seed rows to emit.
      const searchSummation = jest.fn().mockResolvedValue({
        data: [summationRow],
        meta: { page: 1, perPage: 10, totalCount: 1, totalPages: 1 },
      });
      const controller = new ReviewSummationController({
        searchSummation,
      } as any);

      const payload = await controller.listReviewSummations(
        createRequest('text/tab-separated-values', {
          userId: '999',
          isMachine: false,
          roles: ['Topcoder User'],
        }) as any,
        createResponse() as any,
        { challengeId: 'challenge-1' } as any,
      );

      const [header, row] = String(payload).split('\n');
      expect(header.split('\t')).toEqual(
        expect.arrayContaining(['score', 'testcase']),
      );
      expect(row.split('\t')
        .slice(-2)).toEqual(['', '']);
      expect(String(payload)).not.toContain('987654321');
    });

    it('emits per-seed rows for a machine token that received metadata', async () => {
      const searchSummation = jest.fn().mockResolvedValue({
        data: [
          {
            ...summationRow,
            metadata: {
              testScores: [{ score: 100, testcase: 'seed-987654321' }],
            },
          },
        ],
        meta: { page: 1, perPage: 10, totalCount: 1, totalPages: 1 },
      });
      const controller = new ReviewSummationController({
        searchSummation,
      } as any);

      const payload = await controller.listReviewSummations(
        createRequest('text/tab-separated-values', {
          isMachine: true,
          scopes: ['read:review_summation'],
        }) as any,
        createResponse() as any,
        { challengeId: 'challenge-1', metadata: 'true' } as any,
      );

      const [, row] = String(payload).split('\n');
      expect(row.split('\t')
        .slice(-2)).toEqual(['100', 'seed-987654321']);
    });
  });
});
