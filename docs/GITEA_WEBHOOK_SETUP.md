# Gitea Webhook Integration Setup and Testing Guide

## Overview

The Topcoder Review API includes a secure Gitea webhook integration that receives webhook events from Gitea repositories, validates them using Authorization header validation, and stores them in the database for audit and future processing.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Environment Setup](#environment-setup)
3. [Gitea Repository Configuration](#Gitea-repository-configuration)
4. [Local Development Setup](#local-development-setup)
5. [Testing the Integration](#testing-the-integration)
6. [API Endpoint Reference](#api-endpoint-reference)
7. [Database Schema](#database-schema)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)
10. [Monitoring and Maintenance](#monitoring-and-maintenance)

## Quick Start

For immediate setup, follow these steps:

1. Generate a secure webhook auth secret
2. Configure environment variables
3. Set up Gitea webhook in repository settings
4. Test with a sample event

## Environment Setup

### Required Environment Variables

Add the following environment variable to your application configuration:

```bash
# .env file
GITEA_WEBHOOK_AUTH=your_generated_secret_here
```

### Generate Webhook Secret

**Using OpenSSL:**

```bash
openssl rand -hex 32
```

**Example Output:**

```
a1b2c3d4e5f6789012345678901234567890abcdef1234567890abcdef123456
```

⚠️ **Important:** Store this auth secret securely and use the same value in both your application environment and Gitea webhook configuration.

### Database Setup

The webhook integration requires the `gitWebhookLog` table. If not already created, run the database migration:

```bash
npx prisma migrate dev
```

## Gitea Repository Configuration

### Step 1: Access Repository Settings

1. Navigate to your Gitea repository
2. Click on the **Settings** tab (requires admin permissions)
3. In the left sidebar, click **Webhooks**
4. Click **Add webhook**

### Step 2: Configure Webhook Settings

#### Payload URL

**Production/Staging Environment:**

```
https://your-api-domain.com/v6/review/webhooks/gitea
```

**Development Environment:**

```
https://your-dev-domain.com/webhooks/gitea
```

Note: The `/v6/review` prefix is only added in production when `NODE_ENV=production`.

#### Content Type

- Select `application/json`

#### Authorization

- Enter the webhook auth secret you generated earlier
- This must exactly match your `GITEA_WEBHOOK_AUTH` environment variable

#### SSL Verification

- Keep **Enable SSL verification** checked (recommended for production)
- For development with proper HTTPS setup, this should remain enabled

### Step 3: Select Events

Choose one of the following options:

**Option A: Send Everything (Recommended for Testing)**

- Select "Send me everything" to receive all Gitea event types

**Option B: Select Individual Events**
Common events for development workflows:

- **Pushes** - Code pushes to repository
- **Pull requests** - PR creation, updates, merges
- **Issues** - Issue creation, updates, comments
- **Issue comments** - Comments on issues and PRs
- **Releases** - Release creation and updates
- **Create** - Branch or tag creation
- **Delete** - Branch or tag deletion

### Step 4: Activate and Create

1. Ensure **Active** checkbox is checked
2. Click **Add webhook**
3. Gitea will automatically send a `ping` event to test the webhook

## Local Development Setup

Since Gitea webhooks require a publicly accessible URL, local development requires exposing your local server to the internet.

**Install ngrok:**

```bash
npm install -g ngrok
```

**Setup process:**

```bash
# 1. Start your local API server
pnpm run start:dev

# 2. In another terminal, expose your local server
ngrok http 3000

# 3. Copy the HTTPS URL from ngrok output
# Example: https://abc123.ngrok.io

# 4. Use this URL in Gitea webhook settings
# https://abc123.ngrok.io/webhooks/gitea
```

## Testing the Integration

### Manual Testing

#### 1. Verify Initial Setup

After creating the webhook, Gitea automatically sends a `ping` event:

1. Go to your repository's webhook settings
2. Click on your webhook
3. Check **Recent Deliveries** section
4. Look for the `ping` event with status 200 OK

#### 2. Trigger Test Events

**Create a Push Event:**

```bash
# Make a small change
echo "webhook test" >> test-webhook.txt
git add test-webhook.txt
git commit -m "Test webhook integration"
git push origin main
```

**Create an Issue:**

1. Go to your repository on Gitea
2. Click **Issues** tab
3. Click **New issue**
4. Create a test issue

**Create a Pull Request:**

1. Create a new branch: `git checkout -b test-webhook`
2. Make changes and commit
3. Push branch: `git push origin test-webhook`
4. Open pull request on Gitea

### API Endpoint Reference

### Webhook Endpoint

**URL:** `POST /webhooks/gitea` (development) or `POST /v6/review/webhooks/gitea` (production)

**Required Headers:**

- `Content-Type: application/json`
- `X-Gitea-Event: {event_type}` - Gitea event type (push, pull_request, etc.)
- `X-Gitea-Delivery: {delivery_id}` - Unique delivery identifier from Gitea
- `Authorization: Bearer {GITEA_WEBHOOK_AUTH}` - Token used to verify authorization

**Request Body:**

- Gitea webhook payload (varies by event type)

**Response Codes:**

- `200 OK` - Webhook processed successfully
- `400 Bad Request` - Missing required headers or invalid payload
- `403 Forbidden` - Invalid signature verification
- `500 Internal Server Error` - Processing error or configuration issue

**Success Response:**

```json
{
  "success": true,
  "message": "Webhook processed successfully"
}
```

**Error Response:**

```json
{
  "statusCode": 403,
  "message": "Invalid signature",
  "error": "Forbidden",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "path": "/webhooks/gitea"
}
```

## Database Schema

Webhook events are stored in the `gitWebhookLog` table:

```sql
CREATE TABLE "gitWebhookLog" (
  "id" VARCHAR(14) NOT NULL DEFAULT nanoid(),
  "eventId" TEXT NOT NULL,
  "event" TEXT NOT NULL,
  "eventPayload" JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "gitWebhookLog_pkey" PRIMARY KEY ("id")
);

-- Indexes for efficient querying
CREATE INDEX "gitWebhookLog_eventId_idx" ON "gitWebhookLog"("eventId");
CREATE INDEX "gitWebhookLog_event_idx" ON "gitWebhookLog"("event");
CREATE INDEX "gitWebhookLog_createdAt_idx" ON "gitWebhookLog"("createdAt");
```

### Query Examples

**View recent webhook events:**

```sql
SELECT
  id,
  "eventId",
  event,
  "createdAt"
FROM "gitWebhookLog"
ORDER BY "createdAt" DESC
LIMIT 10;
```

**Filter by event type:**

```sql
SELECT * FROM "gitWebhookLog"
WHERE event = 'push'
ORDER BY "createdAt" DESC;
```

**View specific webhook payload:**

```sql
SELECT
  event,
  "eventPayload"
FROM "gitWebhookLog"
WHERE "eventId" = 'your-delivery-id';
```

## Security Considerations

### Signature Verification

The webhook implementation uses Gitea's recommended security practices:

1. **Secret Protection:** Webhook auth secrets are stored as environment variables
2. **Header Validation:** Validates all required Gitea headers

### Best Practices

1. **Use HTTPS:** Always use HTTPS URLs for production webhooks
2. **Rotate Secrets:** Periodically rotate webhook secrets
3. **Monitor Access:** Regularly review webhook delivery logs
4. **Limit Events:** Only subscribe to events you actually need
5. **Access Control:** Restrict webhook configuration to repository administrators

### Environment Security

- Store `GITEA_WEBHOOK_AUTH` securely using your deployment platform's secret management
- Never commit secrets to version control
- Use different secrets for different environments
- Implement proper secret rotation procedures
