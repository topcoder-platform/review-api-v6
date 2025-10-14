import { SetMetadata } from '@nestjs/common';
import { Scope } from '../enums/scopes.enum';

export const SCOPES_KEY = 'scopes';

/**
 * Decorator to define required scopes for an endpoint
 * @param scopes List of required scopes
 */
export const Scopes = (...scopes: Scope[]) => SetMetadata(SCOPES_KEY, scopes);
