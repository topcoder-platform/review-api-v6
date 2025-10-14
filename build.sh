#!/bin/bash
set -eo pipefail
docker buildx build --no-cache=true --build-arg RESET_DB_ARG=<<pipeline.parameters.reset-db>> --build-arg SEED_DATA_ARG=${DEPLOYMENT_ENVIRONMENT} -t ${APPNAME}}:latest .