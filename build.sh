#!/bin/bash
set -eo pipefail
RESET_DB_VALUE=$1
docker buildx build --no-cache=true --build-arg RESET_DB_ARG=${RESET_DB_VALUE} --build-arg SEED_DATA_ARG=${DEPLOYMENT_ENVIRONMENT} -t ${APPNAME}}:latest .