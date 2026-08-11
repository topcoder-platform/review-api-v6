import {
  isExplicitUnlimitedSubmissionLimit,
  isSubmissionRankEligible,
  parseSubmissionLimitCount,
  resolveReviewSubmissionRankLimit,
} from './submission-limit.util';

describe('submission-limit utilities', () => {
  const countAliases = ['count', 'max', 'maximum', 'limitCount', 'value'];
  const trueFlagValues = [true, 'true', 'yes', '1', 1];
  const falseFlagValues = [false, 'false', 'no', '0', 0];
  const resolveDesignLimit = (submissionLimit: unknown): number | null =>
    resolveReviewSubmissionRankLimit({
      track: 'Design',
      legacy: {},
      metadata: { submissionLimit },
    });

  describe('parseSubmissionLimitCount', () => {
    it.each(countAliases)(
      'parses the legacy finite count alias %s',
      (countField) => {
        const value = JSON.stringify({ [countField]: '3' });

        expect(parseSubmissionLimitCount(value)).toBe(3);
        expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(false);
        expect(resolveDesignLimit(value)).toBe(3);
      },
    );

    it.each(trueFlagValues)('parses the limited flag form %p', (limitFlag) => {
      const value = JSON.stringify({ count: '2', limit: limitFlag });

      expect(parseSubmissionLimitCount(value)).toBe(2);
      expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(false);
      expect(resolveDesignLimit(value)).toBe(2);
    });

    it.each(falseFlagValues)(
      'parses the disabled unlimited flag form %p with a finite count',
      (unlimitedFlag) => {
        const value = JSON.stringify({
          count: '2',
          unlimited: unlimitedFlag,
        });

        expect(parseSubmissionLimitCount(value)).toBe(2);
        expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(false);
        expect(resolveDesignLimit(value)).toBe(2);
      },
    );

    it.each([1, '2', JSON.stringify(3)])(
      'parses the positive scalar value %p',
      (value) => {
        expect(parseSubmissionLimitCount(value)).toBe(Number(value));
      },
    );

    it('parses canonical finite metadata', () => {
      const value = JSON.stringify({
        count: '3',
        limit: 'true',
        unlimited: 'false',
      });

      expect(parseSubmissionLimitCount(value)).toBe(3);
      expect(resolveDesignLimit(value)).toBe(3);
    });

    it.each([
      undefined,
      null,
      '',
      '{invalid',
      JSON.stringify({ count: '', limit: 'false', unlimited: 'true' }),
      JSON.stringify({ count: '0', limit: 'true', unlimited: 'false' }),
    ])('treats %p as uncapped', (value) => {
      expect(parseSubmissionLimitCount(value)).toBeNull();
    });
  });

  describe('isExplicitUnlimitedSubmissionLimit', () => {
    it.each(['unlimited', 'false', '0', 'no', 'none', false, 0])(
      'recognizes the legacy explicit-unlimited scalar %p',
      (value) => {
        expect(parseSubmissionLimitCount(value)).toBeNull();
        expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(true);
        expect(resolveDesignLimit(value)).toBeNull();
      },
    );

    it.each(trueFlagValues)(
      'recognizes the unlimited flag form %p',
      (unlimitedFlag) => {
        const value = JSON.stringify({
          count: '2',
          unlimited: unlimitedFlag,
        });

        expect(parseSubmissionLimitCount(value)).toBeNull();
        expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(true);
        expect(resolveDesignLimit(value)).toBeNull();
      },
    );

    it.each(falseFlagValues)(
      'recognizes the disabled limit flag form %p',
      (limitFlag) => {
        const value = JSON.stringify({ count: '2', limit: limitFlag });

        expect(parseSubmissionLimitCount(value)).toBeNull();
        expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(true);
        expect(resolveDesignLimit(value)).toBeNull();
      },
    );

    it('gives explicit unlimited flags precedence over a stale count', () => {
      const value = JSON.stringify({
        maximum: '4',
        limit: 'false',
        unlimited: 'true',
      });

      expect(parseSubmissionLimitCount(value)).toBeNull();
      expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(true);
      expect(resolveDesignLimit(value)).toBeNull();
    });

    it.each([
      ['both true', { count: 2, limit: 'yes', unlimited: 1 }],
      ['both false', { count: 2, limit: 'no', unlimited: 0 }],
    ])('treats contradictory %s flags as malformed', (_description, value) => {
      const serializedValue = JSON.stringify(value);

      expect(parseSubmissionLimitCount(serializedValue)).toBeNull();
      expect(isExplicitUnlimitedSubmissionLimit(serializedValue)).toBe(false);
      expect(resolveDesignLimit(serializedValue)).toBe(1);
    });

    it.each([
      true,
      '{invalid',
      JSON.stringify({ limit: 'yes' }),
      JSON.stringify({ unlimited: 'false' }),
    ])('treats malformed value %p as latest-only for review', (value) => {
      expect(parseSubmissionLimitCount(value)).toBeNull();
      expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(false);
      expect(resolveDesignLimit(value)).toBe(1);
    });
  });

  describe('resolveReviewSubmissionRankLimit', () => {
    it('defaults missing Design metadata to uncapped', () => {
      expect(
        resolveReviewSubmissionRankLimit({
          track: 'Design',
          legacy: {},
        }),
      ).toBeNull();
    });

    it('keeps non-Design challenges latest-only regardless of metadata', () => {
      expect(
        resolveReviewSubmissionRankLimit({
          track: 'Development',
          legacy: {},
          metadata: {
            submissionLimit: JSON.stringify({
              maximum: '3',
              limit: 'yes',
              unlimited: 'no',
            }),
          },
        }),
      ).toBe(1);
    });

    it('keeps malformed and contradictory Design metadata latest-only', () => {
      for (const value of [
        '{invalid',
        JSON.stringify({ count: '2', limit: true, unlimited: true }),
      ]) {
        expect(isExplicitUnlimitedSubmissionLimit(value)).toBe(false);
        expect(resolveDesignLimit(value)).toBe(1);
      }
    });
  });

  it('checks finite ranks while allowing all uncapped ranks', () => {
    expect(isSubmissionRankEligible(2, 2)).toBe(true);
    expect(isSubmissionRankEligible(3, 2)).toBe(false);
    expect(isSubmissionRankEligible(null, null)).toBe(true);
  });
});
