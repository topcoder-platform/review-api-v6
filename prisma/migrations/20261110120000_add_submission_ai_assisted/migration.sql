-- PM-6737: record whether the submitter reports that AI tools wrote most of the submission's code.
ALTER TABLE "submission"
ADD COLUMN "aiAssisted" BOOLEAN;
