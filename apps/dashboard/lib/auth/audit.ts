import { randomUUID } from "node:crypto";
import {
  CloudWatchLogsClient,
  CreateLogGroupCommand,
  CreateLogStreamCommand,
  PutLogEventsCommand,
} from "@aws-sdk/client-cloudwatch-logs";
import { loadDashboardEnv } from "../env";
import type { DashboardSession } from "./session";

type DashboardAuthAuditEventType =
  | "login_succeeded"
  | "login_failed"
  | "logout_succeeded"
  | "agency_selected";

type DashboardAuthAuditEvent = {
  eventId: string;
  eventType: DashboardAuthAuditEventType;
  occurredAt: string;
  application: "dashboard";
  email: string | null;
  sessionId: string | null;
  selectedAgencyId: string | null;
  requestPath: string;
  requestMethod: string;
  ipAddress: string | null;
  forwardedFor: string | null;
  userAgent: string | null;
  requestId: string | null;
  outcome: "success" | "failure";
  reason: string | null;
};

const cloudWatchClientByRegion = new Map<string, CloudWatchLogsClient>();
const ensuredLogGroups = new Set<string>();

function getCloudWatchLogsClient(region: string): CloudWatchLogsClient {
  const existing = cloudWatchClientByRegion.get(region);
  if (existing) {
    return existing;
  }

  const client = new CloudWatchLogsClient({ region });
  cloudWatchClientByRegion.set(region, client);
  return client;
}

function extractForwardedFor(request: Request): string | null {
  const header = request.headers.get("x-forwarded-for");
  return header?.trim() || null;
}

function extractIpAddress(request: Request): string | null {
  const forwardedFor = extractForwardedFor(request);
  if (forwardedFor) {
    return forwardedFor.split(",")[0]?.trim() || null;
  }
  return request.headers.get("x-real-ip")?.trim() || null;
}

function buildAuthAuditStreamName(prefix: string, event: DashboardAuthAuditEvent): string {
  const day = event.occurredAt.slice(0, 10);
  return `${prefix}/${day}/${event.eventType}/${event.eventId}`;
}

async function ensureLogGroup(client: CloudWatchLogsClient, logGroupName: string): Promise<void> {
  if (ensuredLogGroups.has(logGroupName)) {
    return;
  }

  try {
    await client.send(new CreateLogGroupCommand({ logGroupName }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ResourceAlreadyExistsException")) {
      throw error;
    }
  }

  ensuredLogGroups.add(logGroupName);
}

async function writeAuthAuditEvent(event: DashboardAuthAuditEvent): Promise<void> {
  const env = loadDashboardEnv();
  if (!env.authAuditEnabled || !env.authAuditLogGroup || !env.authAuditRegion) {
    return;
  }

  const client = getCloudWatchLogsClient(env.authAuditRegion);
  await ensureLogGroup(client, env.authAuditLogGroup);

  const logStreamName = buildAuthAuditStreamName(env.authAuditStreamPrefix, event);
  try {
    await client.send(new CreateLogStreamCommand({
      logGroupName: env.authAuditLogGroup,
      logStreamName,
    }));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes("ResourceAlreadyExistsException")) {
      throw error;
    }
  }

  await client.send(new PutLogEventsCommand({
    logGroupName: env.authAuditLogGroup,
    logStreamName,
    logEvents: [
      {
        message: JSON.stringify(event),
        timestamp: Date.parse(event.occurredAt),
      },
    ],
  }));
}

function buildAuthAuditEvent(input: {
  eventType: DashboardAuthAuditEventType;
  request: Request;
  session?: Pick<DashboardSession, "email" | "sessionId" | "selectedAgencyId"> | null;
  email?: string | null;
  selectedAgencyId?: string | null;
  outcome: "success" | "failure";
  reason?: string | null;
}): DashboardAuthAuditEvent {
  const occurredAt = new Date().toISOString();
  const forwardedFor = extractForwardedFor(input.request);
  const session = input.session ?? null;

  return {
    eventId: randomUUID(),
    eventType: input.eventType,
    occurredAt,
    application: "dashboard",
    email: session?.email ?? input.email ?? null,
    sessionId: session?.sessionId ?? null,
    selectedAgencyId: input.selectedAgencyId ?? session?.selectedAgencyId ?? null,
    requestPath: new URL(input.request.url).pathname,
    requestMethod: input.request.method,
    ipAddress: extractIpAddress(input.request),
    forwardedFor,
    userAgent: input.request.headers.get("user-agent"),
    requestId: input.request.headers.get("x-request-id"),
    outcome: input.outcome,
    reason: input.reason ?? null,
  };
}

async function recordAuthAuditEvent(input: {
  eventType: DashboardAuthAuditEventType;
  request: Request;
  session?: Pick<DashboardSession, "email" | "sessionId" | "selectedAgencyId"> | null;
  email?: string | null;
  selectedAgencyId?: string | null;
  outcome: "success" | "failure";
  reason?: string | null;
}): Promise<void> {
  try {
    await writeAuthAuditEvent(buildAuthAuditEvent(input));
  } catch (error) {
    console.error(
      "dashboard auth audit logging failed",
      error instanceof Error ? error.message : String(error),
    );
  }
}

export async function recordLoginSuccess(request: Request, session: DashboardSession): Promise<void> {
  await recordAuthAuditEvent({
    eventType: "login_succeeded",
    request,
    session,
    outcome: "success",
  });
}

export async function recordLoginFailure(request: Request, email: string | null, reason: string): Promise<void> {
  await recordAuthAuditEvent({
    eventType: "login_failed",
    request,
    email,
    outcome: "failure",
    reason,
  });
}

export async function recordLogoutSuccess(request: Request, session: DashboardSession | null): Promise<void> {
  await recordAuthAuditEvent({
    eventType: "logout_succeeded",
    request,
    session,
    outcome: "success",
  });
}

export async function recordAgencySelection(
  request: Request,
  session: DashboardSession,
  agencyId: string,
): Promise<void> {
  await recordAuthAuditEvent({
    eventType: "agency_selected",
    request,
    session,
    selectedAgencyId: agencyId,
    outcome: "success",
  });
}

