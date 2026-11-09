-- Human-readable LLM label for the UI. "name" holds the provider model id, which for
-- AWS Bedrock application inference profiles is an ARN that must not be shown.
ALTER TABLE "llmModel" ADD COLUMN "displayName" VARCHAR;
