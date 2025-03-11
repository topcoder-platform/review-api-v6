# TC Review API

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

export DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/postgres?schema=public"

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

## Data import

- create a .env file `mv .env.sample .env`
- update the postgres database url in .env file —
  `DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/postgres?schema=public"`
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
