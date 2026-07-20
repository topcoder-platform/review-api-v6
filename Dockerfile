# syntax=docker/dockerfile:1.7

ARG NODE_VERSION=26.5.0
ARG PNPM_VERSION=11.15.1

FROM node:${NODE_VERSION}-alpine AS build

RUN apk upgrade --no-cache \
    && apk add --no-cache bash

WORKDIR /app
COPY . .
RUN npm install --global pnpm@${PNPM_VERSION}
RUN pnpm install --frozen-lockfile
RUN pnpm run lint
RUN pnpm run build
RUN pnpm prune --prod
RUN node node_modules/prisma/build/index.js generate \
    && node node_modules/prisma/build/index.js generate --schema=prisma/challenge-schema.prisma \
    && node node_modules/prisma/build/index.js generate --schema=prisma/resource-schema.prisma \
    && node node_modules/prisma/build/index.js generate --schema=prisma/member-schema.prisma

FROM node:${NODE_VERSION}-alpine AS runtime

RUN apk upgrade --no-cache \
    && apk add --no-cache bash \
    && rm -rf /usr/local/lib/node_modules/npm \
    && rm -f /usr/local/bin/npm /usr/local/bin/npx

ARG RESET_DB_ARG=false
ENV RESET_DB=$RESET_DB_ARG
ARG SEED_DATA_ARG=""
ENV SEED_DATA=$SEED_DATA_ARG
ENV PRISMA_CLI_BINARY_TARGETS=linux-musl-openssl-3.0.x

WORKDIR /app
COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
COPY --from=build /app/appStartUp.sh ./appStartUp.sh
RUN chmod +x appStartUp.sh
CMD ["./appStartUp.sh"]
