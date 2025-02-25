#!/bin/bash
set -eo pipefail

export DATABASE_URL=$(echo -e ${DATABASE_URL})

echo "Database - running migrations."
if $RESET_DB; then
    echo "Resetting DB"
    npx prisma migrate reset --force
else
    echo "Running migrations"
    npx prisma migrate deploy
fi

# Start the app
pnpm start