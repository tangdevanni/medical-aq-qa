export interface PortalCredentials {
  username: string;
  password: string;
}

export interface PortalJob {
  jobId: string;
  portal: string;
  portalUrl: string;
  requestedBy: string;
  credentials: PortalCredentials;
  payload?: Record<string, unknown>;
}
