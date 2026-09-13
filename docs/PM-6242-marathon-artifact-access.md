# PM-6242: Marathon Match artifact access

The artifact endpoints previously allowed only owners, challenge copilots,
administrators, and machines. Owners could never retrieve internal artifacts,
even after challenge completion. Submission history also hid earlier attempts
from other contestants, preventing discovery of those artifacts.

`SubmissionService.resolveArtifactAccess` now supplies one policy for
`listArtifacts` and `getArtifactStream`. Each request first checks submission and
challenge whitelist access, then reads current challenge status. A registered
Submitter of a Marathon Match gains access only when status is `COMPLETED`.
Artifact IDs containing `internal` (case insensitive) retain their existing
classification. No score, actual phase end, submission status, or cancelled
challenge status is treated as completion.

| Caller | Active/cancelled MM | Completed MM |
| --- | --- | --- |
| Submission owner | Own regular artifacts | Own regular and internal artifacts |
| Registered Submitter requesting another submission | Denied | Regular and internal artifacts |
| Unregistered unrelated member | Denied | Denied |
| Existing authorized copilot/admin/machine | Existing access | Existing access |

Failed status/resource lookups fail closed. Direct downloads perform the same
check as listing, including after status changes. Non-Marathon challenge access
is unchanged. Registered contestants may request other members' full submission
history after MM completion; explicit latest-only queries still return latest
attempts. This lets both UIs discover every released attempt's artifacts.

## Validation

Regression coverage exercises listing, direct downloads, mixed-case internal
IDs, current-status rechecks, cancelled/missing status, non-MM challenges,
unregistered callers, and the completed-only history exception. Existing owner,
copilot, machine, and admin tests remain in the artifact suite.

The full submission test file has four pre-existing failures, reproduced on
unchanged `origin/develop` (`41d6853`): the tests about omitting review data and
submission ID for another active submitter, omitting review data for an unrelated
viewer, stripping unauthorized `getSubmission` reviews, and retaining Marathon
review data expect older response shapes. They are unrelated to artifact access.

Deployment requires the companion platform-ui PM-6242 PR. QA should use two
registered contestants with regular/internal artifacts and multiple attempts:
check own regular-only access and denied cross-member/direct-internal requests
while active, then all regular/internal attempts after `COMPLETED`, and confirm
`CANCELLED` and `CANCELLED_FAILED_REVIEW` never unlock contestant access.
