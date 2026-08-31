# Topcoder Review API

## Opportunities experience additions

- [Design submission previews](docs/SUBMISSION_PREVIEWS.md) documents the
  Screening-triggered extraction pipeline, release gates, S3 configuration,
  retry behavior, and public redirect endpoint.
- [Review opportunity API](docs/REVIEW_OPPORTUNITIES.md) documents the
  metadata-first search and current-member application endpoints used by
  platform-ui.
- [`@topcoder/review-api-v6-prisma-client`](packages/review-prisma-client/README.md)
  is the supported external Prisma client boundary for opportunities-api-v6.

Review API built on modern frameworks for managing all review-related Topcoder needs.

Use Node.js 26.5.1 (see `.nvmrc`) and pnpm 11.15.1 for local development and builds.

## Project setup

```bash
$ pnpm install
```

## Compile and run the project

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Database

```
# run postgres in docker, or other approach
docker run -p 5432:5432  -e POSTGRES_PASSWORD=mysecretpassword postgres:14

# Configure the database connection URL (without schema parameter)
export DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/postgres"

# Configure the PostgreSQL schema (defaults to 'public' if not specified)
export POSTGRES_SCHEMA="public"

# run migration
npx prisma migrate dev

# seed data
npx prisma db seed
or
npx prisma migrate reset

# if you modify prisma schema, run migration again
# and it'll ask
# Enter a name for the new migration:
# just provide a good migration name, such as
#- `add_user_table`
#- `update_user_fields`
#- `create_posts_table`
#- `add_email_to_users`
#- `update_foreign_keys`
```

## Schema Configuration

The application supports configurable PostgreSQL schemas through the `POSTGRES_SCHEMA` environment variable:

```bash
# Set the schema for development
export POSTGRES_SCHEMA="dev_schema"

# Set the schema for production
export POSTGRES_SCHEMA="prod_schema"

# If not specified, the application defaults to the 'public' schema
```

This allows you to:

- Use different schemas for different environments (development, testing, production)
- Isolate data for different instances of the application
- Improve security by separating schemas based on environment

## Data import

- create a .env file `mv .env.sample .env`
- update the postgres database url in .env file —
  `DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/postgres"`
- set the PostgreSQL schema in .env file —
  `POSTGRES_SCHEMA="public"` (or your preferred schema name)
- place all the legacy json files in the `prisma/Scorecards` directory or specify it in .env file — `DATA_DIR=/path/to/Scorecards/folder/`
- install dependencies `pnpm install`
- run the prisma migration `npx prisma migrate dev`
- run the prisma seed `npx prisma db seed`
- run the project `pnpm run start`

## Run tests

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```

## Review summation metadata

`GET /v6/reviewSummations?metadata=true` returns full metadata for admins, copilots, and machine clients. Member/submitter requests are limited to their own Marathon Match submissions and receive only progress metadata: `testProcess`, `testProgress`, `testStatus`, and safe count/timestamp fields in `testProgressDetails`. Per-seed scores and runner messages are not returned to competitors.

Submission responses include that same safe progress subset in nested review summations. The allowlisted process values are `example`, `provisional`, and `system`; raw test scores, seeds, and runner messages remain excluded.

## Duplicate submission detection

`GET /v6/submissions/{challengeId}/duplicates?submissionId=s1&submissionId=s2&crossChallenge=false` returns submissions that share the exact `sha256Hash` of each requested submission.

- `submissionId` is required and repeatable (a comma-separated list also works). Up to 100 ids per request, and every id must belong to `{challengeId}`.
- `crossChallenge` defaults to `false`, which limits matches to `{challengeId}`. Set it to `true` to match across every challenge.
- Access is limited to admins, machine clients with `read:submission`/`all:submission`, users holding the `Project Manager` role, and challenge Reviewer/Screener/Copilot/Manager resources.
- The response is keyed by the requested submission id: `{ "s1": { "duplicates": [{ "submissionId", "challenge", "challengeTitle", "user", "submittedAt" }] } }`, newest first. Submissions without a stored digest and `DELETED` submissions never match, so their lists come back empty.
