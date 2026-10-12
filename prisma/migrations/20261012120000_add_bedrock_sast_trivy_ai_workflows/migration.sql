-- Add AWS Bedrock (Claude Haiku 4.5) variants of the SAST (OpenGrep) and Trivy scanner AI workflows.
-- Each new workflow copies the scorecard, description, review method and timeout of the existing
-- (Ollama based) scanner workflow and dispatches the dedicated Bedrock Gitea workflow of the scanner repo.
-- A row is skipped when its template workflow or the Bedrock model is missing, or when it already exists.
INSERT INTO "aiWorkflow" (
  "id",
  "name",
  "llmId",
  "description",
  "defUrl",
  "gitWorkflowId",
  "gitOwnerRepo",
  "scorecardId",
  "timeoutSeconds",
  "reviewMethod",
  "disabled",
  "createdAt",
  "createdBy",
  "updatedAt",
  "updatedBy"
)
SELECT
  n."id",
  n."name",
  m."id",
  replace(t."description", t."name", n."name"),
  replace(t."defUrl", t."gitWorkflowId", n."gitWorkflowId"),
  n."gitWorkflowId",
  t."gitOwnerRepo",
  t."scorecardId",
  t."timeoutSeconds",
  t."reviewMethod",
  false,
  CURRENT_TIMESTAMP,
  'System',
  CURRENT_TIMESTAMP,
  'System'
FROM (
  VALUES
    (
      'awsH45_SAST_01',
      '[AWS:Claude-Haiku-4.5] - SAST semgrep/opengrep Analysis',
      'TC-AI-Workflows/TC-AI-SAST-Scanner',
      'opengrep-submission-scanner_prompt-agent.yaml',
      'opengrep-submission-scanner_bedrock.yaml'
    ),
    (
      'awsH45_TRIVY01',
      '[AWS:Claude-Haiku-4.5] - AI Vulnerabilities (CVE) & Misconfigurations (IaC) & Secrets Scanner',
      'TC-AI-Workflows/TC-AI-Trivy-Scanner',
      'trivy-submission-screener_prompt-agent.yaml',
      'trivy-submission-screener_bedrock.yaml'
    )
) AS n ("id", "name", "gitOwnerRepo", "templateGitWorkflowId", "gitWorkflowId")
-- Template: the enabled, most recently updated workflow running the scanner's existing Gitea workflow
CROSS JOIN LATERAL (
  SELECT w.*
  FROM "aiWorkflow" w
  WHERE w."gitOwnerRepo" = n."gitOwnerRepo"
    AND w."gitWorkflowId" = n."templateGitWorkflowId"
  ORDER BY w."disabled" ASC, w."updatedAt" DESC
  LIMIT 1
) AS t
JOIN "llmModel" m ON m."name" = 'us.anthropic.claude-haiku-4-5-20251001-v1:0'
JOIN "llmProvider" p ON p."id" = m."providerId" AND p."name" = 'AWSBedrock'
ON CONFLICT DO NOTHING;
