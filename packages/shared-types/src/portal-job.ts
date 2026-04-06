import type { PortalSafetyConfig } from "./portal-safety";

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
  safety?: PortalSafetyConfig;
  payload?: Record<string, unknown>;
}
