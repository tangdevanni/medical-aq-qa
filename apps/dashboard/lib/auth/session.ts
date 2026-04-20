import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { loadDashboardEnv, type DashboardQaUser } from "../env";

const SESSION_COOKIE_NAME = "medical_ai_qa_session";

export type DashboardSession = {
  sessionId: string;
  email: string;
  name: string;
  allowedAgencyIds: string[];
  selectedAgencyId: string | null;
  issuedAt: string;
  expiresAt: string;
};

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeBase64Url(value: string): string {
  return Buffer.from(value, "base64url").toString("utf8");
}

function signPayload(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

function serializeSession(session: DashboardSession, secret: string): string {
  const payload = encodeBase64Url(JSON.stringify(session));
  const signature = signPayload(payload, secret);
  return `${payload}.${signature}`;
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function isValidIsoTimestamp(value: string): boolean {
  return !Number.isNaN(Date.parse(value));
}

function isExpired(expiresAt: string, now = Date.now()): boolean {
  const expiresAtMs = Date.parse(expiresAt);
  return Number.isNaN(expiresAtMs) || expiresAtMs <= now;
}

function parseDashboardSession(value: unknown): DashboardSession | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  const email = typeof record.email === "string" ? record.email.trim().toLowerCase() : "";
  const name = typeof record.name === "string" ? record.name.trim() : "";
  const selectedAgencyId =
    typeof record.selectedAgencyId === "string" && record.selectedAgencyId.trim().length > 0
      ? record.selectedAgencyId.trim()
      : record.selectedAgencyId === null
        ? null
        : "";
  const issuedAt = typeof record.issuedAt === "string" ? record.issuedAt : "";
  const expiresAt = typeof record.expiresAt === "string" ? record.expiresAt : "";
  const allowedAgencyIds = Array.isArray(record.allowedAgencyIds)
    ? record.allowedAgencyIds.filter((agencyId): agencyId is string =>
        typeof agencyId === "string" && agencyId.trim().length > 0,
      )
    : [];

  if (
    !isValidEmail(email) ||
    sessionId.length === 0 ||
    name.length === 0 ||
    selectedAgencyId === "" ||
    allowedAgencyIds.length === 0 ||
    !isValidIsoTimestamp(issuedAt) ||
    !isValidIsoTimestamp(expiresAt)
  ) {
    return null;
  }

  return {
    sessionId,
    email,
    name,
    allowedAgencyIds,
    selectedAgencyId,
    issuedAt,
    expiresAt,
  };
}

function parseSessionCookie(cookieValue: string | undefined, secret: string): DashboardSession | null {
  if (!cookieValue) {
    return null;
  }

  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = signPayload(payload, secret);
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    const session = parseDashboardSession(JSON.parse(decodeBase64Url(payload)));
    return session && !isExpired(session.expiresAt) ? session : null;
  } catch {
    return null;
  }
}

function getCookieOptions(env: ReturnType<typeof loadDashboardEnv>, expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: env.isProduction,
    path: "/",
    priority: "high" as const,
    maxAge: env.sessionTtlSeconds,
    expires: expiresAt,
  };
}

function buildDashboardSession(input: {
  user: DashboardQaUser;
  selectedAgencyId?: string | null;
  now?: Date;
  sessionTtlSeconds: number;
}): DashboardSession {
  const issuedAt = input.now ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + input.sessionTtlSeconds * 1000);

  return {
    sessionId: randomUUID(),
    email: input.user.email,
    name: input.user.name,
    allowedAgencyIds: input.user.allowedAgencyIds,
    selectedAgencyId:
      input.selectedAgencyId && input.user.allowedAgencyIds.includes(input.selectedAgencyId)
        ? input.selectedAgencyId
        : null,
    issuedAt: issuedAt.toISOString(),
    expiresAt: expiresAt.toISOString(),
  };
}

function reconcileSessionWithUsers(
  session: DashboardSession,
  users: DashboardQaUser[],
): DashboardSession | null {
  const user = users.find((candidate) => candidate.email.toLowerCase() === session.email.toLowerCase());
  if (!user) {
    return null;
  }

  return {
    ...session,
    name: user.name,
    allowedAgencyIds: user.allowedAgencyIds,
    selectedAgencyId:
      session.selectedAgencyId && user.allowedAgencyIds.includes(session.selectedAgencyId)
        ? session.selectedAgencyId
        : null,
  };
}

export async function getDashboardSession(): Promise<DashboardSession | null> {
  const cookieStore = await cookies();
  const env = loadDashboardEnv();
  const rawValue = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  const parsed = parseSessionCookie(rawValue, env.DASHBOARD_SESSION_SECRET);

  if (!rawValue) {
    return null;
  }

  if (!parsed) {
    await clearDashboardSession();
    return null;
  }

  const reconciled = reconcileSessionWithUsers(parsed, env.qaUsers);
  if (!reconciled) {
    await clearDashboardSession();
    return null;
  }

  return reconciled;
}

export async function requireDashboardSession(): Promise<DashboardSession> {
  const session = await getDashboardSession();
  if (!session) {
    redirect("/login");
  }
  return session;
}

export async function requireSelectedAgencySession(): Promise<DashboardSession> {
  const session = await requireDashboardSession();
  if (!session.selectedAgencyId) {
    redirect("/select-agency");
  }
  return session;
}

export async function setDashboardSession(input: {
  user: DashboardQaUser;
  selectedAgencyId?: string | null;
}): Promise<DashboardSession> {
  const env = loadDashboardEnv();
  const cookieStore = await cookies();
  const session = buildDashboardSession({
    user: input.user,
    selectedAgencyId: input.selectedAgencyId ?? null,
    sessionTtlSeconds: env.sessionTtlSeconds,
  });

  cookieStore.set(
    SESSION_COOKIE_NAME,
    serializeSession(session, env.DASHBOARD_SESSION_SECRET),
    getCookieOptions(env, new Date(session.expiresAt)),
  );

  return session;
}

export async function updateSelectedAgencyInSession(agencyId: string): Promise<DashboardSession> {
  const env = loadDashboardEnv();
  const cookieStore = await cookies();
  const current = await requireDashboardSession();
  if (!current.allowedAgencyIds.includes(agencyId)) {
    throw new Error(`Agency not allowed for user session: ${agencyId}`);
  }

  const user = env.qaUsers.find(
    (candidate: DashboardQaUser) => candidate.email.toLowerCase() === current.email.toLowerCase(),
  );
  if (!user) {
    throw new Error(`QA user is no longer configured: ${current.email}`);
  }

  const nextSession = buildDashboardSession({
    user,
    selectedAgencyId: agencyId,
    sessionTtlSeconds: env.sessionTtlSeconds,
  });

  cookieStore.set(
    SESSION_COOKIE_NAME,
    serializeSession(nextSession, env.DASHBOARD_SESSION_SECRET),
    getCookieOptions(env, new Date(nextSession.expiresAt)),
  );

  return nextSession;
}

export async function clearDashboardSession(): Promise<void> {
  const env = loadDashboardEnv();
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, "", {
    ...getCookieOptions(env, new Date(0)),
    maxAge: 0,
    expires: new Date(0),
  });
}
