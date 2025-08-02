# GitHub Webhook Integration Setup and Testing Guide

## Overview

The Topcoder Review API includes a secure GitHub webhook integration that receives webhook events from GitHub repositories, validates them using HMAC-SHA256 signature verification, and stores them in the database for audit and future processing.

## Table of Contents

1. [Quick Start](#quick-start)
2. [Environment Setup](#environment-setup)
3. [GitHub Repository Configuration](#github-repository-configuration)
4. [Local Development Setup](#local-development-setup)
5. [Testing the Integration](#testing-the-integration)
6. [API Endpoint Reference](#api-endpoint-reference)
7. [Database Schema](#database-schema)
8. [Security Considerations](#security-considerations)
9. [Troubleshooting](#troubleshooting)
10. [Monitoring and Maintenance](#monitoring-and-maintenance)

## Quick Start

For immediate setup, follow these steps:

1. Generate a secure webhook secret
2. Configure environment variables
3. Set up GitHub webhook in repository settings
4. Test with a sample event

## Environment Setup

### Required Environment Variables

Add the following environment variable to your application configuration:

```bash
# .env file
GITHUB_WEBHOOK_SECRET=your_generated_secret_here
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

⚠️ **Important:** Store this secret securely and use the same value in both your application environment and GitHub webhook configuration.

### Database Setup

The webhook integration requires the `gitWebhookLog` table. If not already created, run the database migration:

```bash
npx prisma migrate dev
```

## GitHub Repository Configuration

### Step 1: Access Repository Settings

1. Navigate to your GitHub repository
2. Click on the **Settings** tab (requires admin permissions)
3. In the left sidebar, click **Webhooks**
4. Click **Add webhook**

### Step 2: Configure Webhook Settings

#### Payload URL

**Production/Staging Environment:**
```
https://your-api-domain.com/v6/review/webhooks/git
```

**Development Environment:**
```
https://your-dev-domain.com/webhooks/git
```

Note: The `/v6/review` prefix is only added in production when `NODE_ENV=production`.

#### Content Type
- Select `application/json`

#### Secret
- Enter the webhook secret you generated earlier
- This must exactly match your `GITHUB_WEBHOOK_SECRET` environment variable

#### SSL Verification
- Keep **Enable SSL verification** checked (recommended for production)
- For development with proper HTTPS setup, this should remain enabled

### Step 3: Select Events

Choose one of the following options:

**Option A: Send Everything (Recommended for Testing)**
- Select "Send me everything" to receive all GitHub event types

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
3. GitHub will automatically send a `ping` event to test the webhook

## Local Development Setup

Since GitHub webhooks require a publicly accessible URL, local development requires exposing your local server to the internet.

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

# 4. Use this URL in GitHub webhook settings
# https://abc123.ngrok.io/webhooks/git
```
## Testing the Integration

### Manual Testing

#### 1. Verify Initial Setup

After creating the webhook, GitHub automatically sends a `ping` event:

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
1. Go to your repository on GitHub
2. Click **Issues** tab
3. Click **New issue**
4. Create a test issue

**Create a Pull Request:**
1. Create a new branch: `git checkout -b test-webhook`
2. Make changes and commit
3. Push branch: `git push origin test-webhook`
4. Open pull request on GitHub

### Testing with curl

You can test the webhook endpoint directly using curl with proper signature generation:

```bash
#!/bin/bash

# Configuration
WEBHOOK_URL="http://localhost:3000/webhooks/git"  # Adjust for your environment
WEBHOOK_SECRET="your_webhook_secret_here"
PAYLOAD='{"test": "data", "repository": {"name": "test-repo"}}'
DELIVERY_ID="test-delivery-$(date +%s)"
EVENT_TYPE="push"

# Generate signature
SIGNATURE="sha256=$(echo -n "$PAYLOAD" | openssl dgst -sha256 -hmac "$WEBHOOK_SECRET" | sed 's/^.* //')"

# Send test webhook
curl -X POST "$WEBHOOK_URL" \
  -H "Content-Type: application/json" \
  -H "X-GitHub-Event: $EVENT_TYPE" \
  -H "X-GitHub-Delivery: $DELIVERY_ID" \
  -H "X-Hub-Signature-256: $SIGNATURE" \
  -d "$PAYLOAD"
```

## API Endpoint Reference

### Webhook Endpoint

**URL:** `POST /webhooks/git` (development) or `POST /v6/review/webhooks/git` (production)

**Required Headers:**
- `Content-Type: application/json`
- `X-GitHub-Event: {event_type}` - GitHub event type (push, pull_request, etc.)
- `X-GitHub-Delivery: {delivery_id}` - Unique delivery identifier from GitHub
- `X-Hub-Signature-256: sha256={signature}` - HMAC-SHA256 signature for verification

**Request Body:**
- GitHub webhook payload (varies by event type)

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
  "path": "/webhooks/git"
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

The webhook implementation uses GitHub's recommended security practices:

1. **HMAC-SHA256 Signature:** All incoming webhooks are verified using HMAC-SHA256
2. **Timing-Safe Comparison:** Uses `crypto.timingSafeEqual()` to prevent timing attacks
3. **Secret Protection:** Webhook secrets are stored as environment variables
4. **Header Validation:** Validates all required GitHub headers

### Best Practices

1. **Use HTTPS:** Always use HTTPS URLs for production webhooks
2. **Rotate Secrets:** Periodically rotate webhook secrets
3. **Monitor Access:** Regularly review webhook delivery logs
4. **Limit Events:** Only subscribe to events you actually need
5. **Access Control:** Restrict webhook configuration to repository administrators

### Environment Security

- Store `GITHUB_WEBHOOK_SECRET` securely using your deployment platform's secret management
- Never commit secrets to version control
- Use different secrets for different environments
- Implement proper secret rotation procedures

### Log Analysis

Key log messages to monitor:

```
# Successful webhook processing
[WebhookController] Successfully processed GitHub webhook

# Signature validation failures
[GitHubSignatureGuard] Invalid webhook signature for delivery

# Configuration errors
[GitHubSignatureGuard] GITHUB_WEBHOOK_SECRET environment variable is not configured
```

Example

```
[2025-08-02T01:06:48.312Z] [LOG] [Bootstrap] Server started on port 3000
[2025-08-02T01:07:15.700Z] [LOG] [HttpRequest] {"type":"request","method":"POST","url":"/webhooks/git","ip":"::1","userAgent":"GitHub-Hookshot/4f8bd7a"}
[2025-08-02T01:07:15.739Z] [LOG] [GitHubSignatureGuard] Valid webhook signature verified for delivery 0722d0bc-6f3d-11f0-8a2d-6cc18966c098, event push
[2025-08-02T01:07:15.740Z] [LOG] [WebhookController] {"message":"Received GitHub webhook","delivery":"0722d0bc-6f3d-11f0-8a2d-6cc18966c098","event":"push","timestamp":"2025-08-02T01:07:15.740Z"}
[2025-08-02T01:07:15.740Z] [LOG] [WebhookService] {"message":"Processing GitHub webhook event","eventId":"0722d0bc-6f3d-11f0-8a2d-6cc18966c098","event":"push","timestamp":"2025-08-02T01:07:15.740Z"}
[2025-08-02T01:07:15.804Z] [LOG] [WebhookService] {"message":"Successfully stored webhook event","eventId":"0722d0bc-6f3d-11f0-8a2d-6cc18966c098","event":"push","storedId":"9aHvEgDYPCYYnU","createdAt":"2025-08-02T01:07:15.747Z"}
[2025-08-02T01:07:15.804Z] [LOG] [WebhookService] {"message":"Event-specific processing placeholder","event":"push","payloadSize":7979}
[2025-08-02T01:07:15.804Z] [LOG] [WebhookController] {"message":"Successfully processed GitHub webhook","delivery":"0722d0bc-6f3d-11f0-8a2d-6cc18966c098","event":"push","success":true}
[2025-08-02T01:07:15.804Z] [LOG] [HttpRequest] {"type":"response","statusCode":200,"method":"POST","url":"/webhooks/git","responseTime":"104ms"}
```
