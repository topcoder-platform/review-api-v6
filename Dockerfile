# syntax=docker/dockerfile:1

FROM node:22.13.1-alpine

RUN apk add --no-cache bash
RUN apk update 

ARG RESET_DB_ARG=false
ENV RESET_DB=$RESET_DB_ARG
ARG SEED_DATA_ARG=""
ENV SEED_DATA=$SEED_DATA_ARG

WORKDIR /app
COPY . .
RUN npm install
RUN npm run build
RUN chmod +x appStartUp.sh
CMD ./appStartUp.sh
