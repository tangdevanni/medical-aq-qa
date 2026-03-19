export interface HealthPayload {
  status: "ok";
  service: "api";
  timestamp: string;
}

export function getHealthPayload(): HealthPayload {
  return {
    status: "ok",
    service: "api",
    timestamp: new Date().toISOString(),
  };
}
