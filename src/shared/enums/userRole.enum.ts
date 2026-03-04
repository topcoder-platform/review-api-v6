/**
 * Enum defining user roles for role-based access control
 */
export enum UserRole {
  Customer = 'Self-Service Customer',
  User = 'Topcoder User',
  TopcoderTalent = 'Topcoder Talent',
  Admin = 'administrator',
  ProjectManager = 'Project Manager',
  Copilot = 'copilot',
  TopcoderStaff = 'Topcoder Staff',
  TalentManager = 'Talent Manager',
}

export enum ResourceRole {
  Submitter = 'Submitter',
  Reviewer = 'Reviewer',
  Observer = 'Observer',
  Approver = 'Approver',
  CheckpointReviewer = 'Checkpoint Reviewer',
  CheckpointScreener = 'Checkpoint Screener',
  IterativeReviewer = 'Iterative Reviewer',
  Screener = 'Screener',
}
