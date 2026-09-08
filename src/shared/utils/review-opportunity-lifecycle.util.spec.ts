import {
  hasReviewOpportunityWindowEnded,
  isReviewOpportunityWindowOpen,
} from './review-opportunity-lifecycle.util';

describe('review opportunity lifecycle utilities', () => {
  const opportunity = {
    startDate: new Date('2026-08-20T00:00:00Z'),
    duration: 60,
  };
  const endTimestamp = new Date('2026-08-20T00:01:00Z').getTime();

  it('keeps a valid opportunity open until its exact end timestamp', () => {
    expect(hasReviewOpportunityWindowEnded(opportunity, endTimestamp - 1)).toBe(
      false,
    );
    expect(isReviewOpportunityWindowOpen(opportunity, endTimestamp - 1)).toBe(
      true,
    );
  });

  it('closes a valid opportunity at its exact end timestamp', () => {
    expect(hasReviewOpportunityWindowEnded(opportunity, endTimestamp)).toBe(
      true,
    );
    expect(isReviewOpportunityWindowOpen(opportunity, endTimestamp)).toBe(
      false,
    );
  });

  it.each([
    { duration: -1, startDate: opportunity.startDate },
    { duration: 60, startDate: 'not-a-date' },
  ])('fails closed for an invalid application window', (invalidWindow) => {
    expect(hasReviewOpportunityWindowEnded(invalidWindow, endTimestamp)).toBe(
      false,
    );
    expect(isReviewOpportunityWindowOpen(invalidWindow, endTimestamp)).toBe(
      false,
    );
  });
});
