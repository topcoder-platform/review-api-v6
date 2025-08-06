/**
 * Resource role model
 */
export interface ResourceRole {
  id: string;
  name: string;
  legacyId?: number;
  fullReadAccess: boolean;
  fullWriteAccess: boolean;
  isActive: boolean;
  selfObtainable: boolean;
}
