/**
 * Fields needed to determine whether a review opportunity's application
 * window is still open.
 */
export interface ReviewOpportunityWindow {
  startDate: Date | string;
  duration: number;
}

/**
 * Determines whether a review opportunity's configured window has elapsed.
 * Invalid legacy values are treated as non-expired so lifecycle reads do not
 * hide records whose end timestamp cannot be derived safely.
 *
 * @param opportunity - Opportunity start time and duration in seconds.
 * @param now - Epoch milliseconds used for deterministic checks and tests.
 * @returns true when the derived end timestamp is at or before `now`.
 */
export function hasReviewOpportunityWindowEnded(
  opportunity: ReviewOpportunityWindow,
  now: number = Date.now(),
): boolean {
  const startTimestamp = new Date(opportunity.startDate).getTime();
  const durationSeconds = Number(opportunity.duration);
  if (
    !Number.isFinite(startTimestamp) ||
    !Number.isFinite(durationSeconds) ||
    durationSeconds < 0
  ) {
    return false;
  }
  return startTimestamp + durationSeconds * 1000 <= now;
}

/**
 * Determines whether a review opportunity has a valid window that still
 * accepts applications. Unlike read-side expiry derivation, malformed legacy
 * values fail closed so they cannot permit an unbounded late application.
 *
 * @param opportunity - Opportunity start time and duration in seconds.
 * @param now - Epoch milliseconds used for deterministic checks and tests.
 * @returns true only for a valid window whose end timestamp is after `now`.
 */
export function isReviewOpportunityWindowOpen(
  opportunity: ReviewOpportunityWindow,
  now: number = Date.now(),
): boolean {
  const startTimestamp = new Date(opportunity.startDate).getTime();
  const durationSeconds = Number(opportunity.duration);
  return (
    Number.isFinite(startTimestamp) &&
    Number.isFinite(durationSeconds) &&
    durationSeconds >= 0 &&
    startTimestamp + durationSeconds * 1000 > now
  );
}
