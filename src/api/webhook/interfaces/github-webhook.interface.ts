export interface GitHubWebhookHeaders {
  'x-github-delivery': string;
  'x-github-event': string;
  'x-hub-signature-256': string;
  'content-type': string;
}

export interface WebhookRequest {
  headers: GitHubWebhookHeaders;
  body: any; // GitHub webhook payload (varies by event type)
}

export interface WebhookResponse {
  success: boolean;
  message?: string;
}

export interface ErrorResponse {
  statusCode: number;
  message: string;
  error: string;
  timestamp: string;
  path: string;
}
