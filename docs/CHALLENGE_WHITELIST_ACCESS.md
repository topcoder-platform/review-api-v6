# Challenge Whitelist Access

`review-api-v6` treats `ChallengeUserWhitelist` rows in the challenge database as an additive access gate for interactive review-facing traffic.

- Challenges with no whitelist rows keep existing behavior.
- Challenges with whitelist rows are visible only to listed users for interactive requests, including admin users.
- M2M/background flows may continue to bypass this user-facing gate.
- Removing an active participant from the whitelist cuts off access immediately, but the first pass does not reassign or delete existing submissions, reviews, or assignments. Operators may need to manually reassign active review work or clean up affected records.
