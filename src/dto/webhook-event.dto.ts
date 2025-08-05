import { IsString, IsNotEmpty, IsOptional } from 'class-validator';

export class WebhookEventDto {
  @IsString()
  @IsNotEmpty()
  eventId: string; // From X-GitHub-Delivery

  @IsString()
  @IsNotEmpty()
  event: string; // From X-GitHub-Event

  @IsNotEmpty()
  eventPayload: any; // Complete webhook payload
}

export class WebhookResponseDto {
  @IsNotEmpty()
  success: boolean;

  @IsString()
  @IsOptional()
  message?: string;
}
