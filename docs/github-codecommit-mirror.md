# GitHub backup mirror to AWS CodeCommit

The [mirror workflow](../.github/workflows/codecommit-mirror.yml) maintains an exact secondary Git copy of `topcoder-platform/review-api-v6` in the dedicated `review-api-v6` AWS CodeCommit repository.

## Provisioned configuration

Provisioning and the initial verified seed were completed on 24 August 2026:

- AWS account: `811668436784`
- AWS Region: `us-east-1`
- CodeCommit repository: `review-api-v6`
- CodeCommit default branch: `develop`
- IAM role: `GitHubActions-review-api-v6-CodeCommitMirror`
- Trusted GitHub branches: `develop` and `master`
- Authentication: GitHub OpenID Connect (OIDC), with no long-lived AWS access key
- GitHub repository variables: configured and enabled

## Synchronization behavior

A push to `develop` or `master` starts a full reconciliation. A reconciliation also runs every six hours and can be started manually from either trusted branch.

Every run:

1. Fetches all GitHub branches and tags with their reachable Git history.
2. Obtains short-lived AWS credentials by presenting a GitHub-signed OIDC token.
3. Force-updates CodeCommit branches and tags to the same Git object IDs.
4. Deletes CodeCommit branches and tags that no longer exist in GitHub.
5. Sets CodeCommit's default branch to GitHub's default branch.
6. Fails if any final branch or tag object ID differs.

Each run mirrors all current refs. A push to another branch or tag therefore appears in CodeCommit at the next `develop`/`master` push or scheduled reconciliation; workflows on those other refs cannot obtain the AWS role.

Runs are serialized so an older run cannot finish after a newer one and move the mirror backwards.

## Trust and permissions

The account-wide IAM OIDC provider is:

`arn:aws:iam::811668436784:oidc-provider/token.actions.githubusercontent.com`

The `GitHubActions-review-api-v6-CodeCommitMirror` trust policy accepts only OIDC subjects for this repository's `develop` and `master` branches. It accepts both GitHub's legacy name-based subject and the repository's immutable owner/repository-ID subject. Public forks and workflows on any other upstream ref have different subjects and are denied.

The role's inline `CodeCommitMirrorAccess` policy permits only:

- `codecommit:GitPull`
- `codecommit:GitPush`
- `codecommit:UpdateDefaultBranch`

Those permissions apply only to `arn:aws:codecommit:us-east-1:811668436784:review-api-v6`. The role cannot access other CodeCommit repositories, delete repositories, manage IAM, or use other AWS services.

GitHub stores only resource identifiers in these repository variables:

- `CODECOMMIT_MIRROR_AWS_REGION`
- `CODECOMMIT_MIRROR_REPOSITORY`
- `CODECOMMIT_MIRROR_ROLE_ARN`
- `CODECOMMIT_MIRROR_ENABLED`

The role ARN and repository variables are not credentials. AWS validates GitHub's signed token and issues credentials for at most one hour. GitHub Actions logs and AWS CloudTrail provide an audit trail.

## Operations

- Treat a failed mirror run as a backup warning; it does not block or roll back the GitHub push.
- Use **Actions → Mirror GitHub to AWS CodeCommit → Run workflow** from `develop` or `master` for an immediate repair.
- The next trusted-branch push or six-hour run performs a complete repair, so retries are safe.
- Keep both referenced third-party Actions pinned to reviewed full commit SHAs.
- Protect `develop` and `master` and require review for changes under `.github/workflows/`.
- If a trusted branch or repository identity changes, update both the workflow filters and IAM `sub` conditions before the next run.
- Do not develop in the CodeCommit repository; GitHub is authoritative and synchronization overwrites destination-only refs.

## Recovery limitations

This is an exact warm Git replica, not immutable point-in-time retention:

- Force-pushes, moved tags, and deleted branches or tags are reproduced.
- A commit on another ref that becomes unreachable before reconciliation can be missed.
- Pull requests, issues, releases, Actions artifacts, repository settings, secrets, and other GitHub metadata are not copied.
- Git LFS pointer files are copied, but external LFS objects are not.
- Provider-specific refs such as GitHub pull-request refs are not copied.

For immutable retention, add a separate scheduled `git bundle` archive in versioned, object-locked storage. For disaster recovery, an AWS administrator with CodeCommit read access can clone the mirror and push its branches and tags into a replacement GitHub repository.
