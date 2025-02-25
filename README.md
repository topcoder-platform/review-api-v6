# TC Review API

Review API built on modern frameworks for managing all review-related Topcoder needs.

## Project setup

```bash
$ npm install
```

## Compile and run the project

```bash
# development
$ npm run start

# watch mode
$ npm run start:dev

# production mode
$ npm run start:prod
```

## Database

```
# run postgres in docker, or other approach
docker run -p 5432:5432  -e POSTGRES_PASSWORD=mysecretpassword postgres:14

export DATABASE_URL="postgresql://postgres:mysecretpassword@localhost:5432/postgres?schema=public"

# run migration
npx prisma migrate dev

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

## Run tests

```bash
# unit tests
$ npm run test

# e2e tests
$ npm run test:e2e

# test coverage
$ npm run test:cov
```
