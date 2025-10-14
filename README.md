# Topcoder Review API

Review API built on modern frameworks for managing all review-related Topcoder needs.

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
