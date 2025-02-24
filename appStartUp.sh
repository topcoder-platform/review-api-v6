#!/bin/bash
set -eo pipefail

# Environments are created on the fly in dev and so the DB url must be constructed.
# The CI/CD tool passes the database name to the CloudFormation template which includes it as a env var
# Here we replace the "DATABASE_NAME" placeholder in the dev connection string with that
export DATABASE_URL=$(echo -e ${DATABASE_URL/DATABASE_NAME/$DATABASE_NAME})

# Query for the database name for this deployment
dbnameselect=$(psql -P t -P format=unaligned "${DATABASE_ADMIN_URL}" -c "SELECT datname FROM pg_database where datname = '${DATABASE_NAME}';")

# If the database exists run migrations or reset
if [[ "$dbnameselect" == "$DATABASE_NAME" ]]; then
    echo "Database ${DATABASE_NAME} exists - running migrations."
    if $RESET_DB; then
        echo "Resetting DB"
        npx prisma migrate reset --force
        echo "Seeding database"
        npm run seed -- $SEED_DATA
    else
        echo "Running migrations"
        npx prisma migrate deploy
    fi
else
    # Else create the DB and reset
    echo "Database ${DATABASE_NAME} does not exist - creating."
    psql -P t -P format=unaligned "${DATABASE_ADMIN_URL}" -c "CREATE DATABASE \"${DATABASE_NAME}\" OWNER ${DATABASE_ADMIN_USER};"

    echo "Running migrations."
    npx prisma migrate reset --force

    echo "Seeding database"
    npm run seed -- $SEED_DATA
fi

# Start the app
npm start