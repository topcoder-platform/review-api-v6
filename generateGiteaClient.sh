#!/bin/bash
npx swagger-typescript-api generate -p https://git.topcoder-dev.com/swagger.v1.json -o ./src/shared/clients/gitea -n gitea.client.ts --axios