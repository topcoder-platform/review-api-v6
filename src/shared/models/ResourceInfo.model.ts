/**
 * Resource info model
 */
export interface ResourceInfo {
  id: string;
  challengeId: string;
  memberId: string;
  memberHandle: string;
  roleId: string;
  phaseId?: string | null;
  roleName?: string; // this field is calculated
  createdBy: string;
  created: string | Date;
  rating?: number;
}
