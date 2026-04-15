import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { z } from "zod";
import { loadDashboardEnv, type DashboardQaUser } from "../env";

const SESSION_COOKIE_NAME = "medical_ai_qa_session";

const dashboardSessionSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1),
  allowedAgencyIds: z.array(z.string().min(1)),
  selectedAgencyId: z.string().min(1).nullable(),
  issuedAt: z.string().min(1),
});

export type DashboardSession = z.infer<typeof dashboardSessionSchema>;

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

function parseSessionCookie(cookieValue: string | undefined, secret: string): DashboardSession | null {
  if (!cookieValue) {
    return null;
  }

  const [payload, signature] = cookieValue.split(".");
  if (!payload || !signature) {
    return null;
  }

  const expected = signPayload(payload, secret);
  const signatureBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (
    signatureBuffer.length !== expectedBuffer.length ||
    !timingSafeEqual(signatureBuffer, expectedBuffer)
  ) {
    return null;
  }

  try {
    return dashboardSessionSchema.parse(JSON.parse(decodeBase64Url(payload)));
  } catch {
    return null;
  }
}

export async function getDashboardSession(): Promise<DashboardSession | null> {
  const cookieStore = await cookies();
  const env = loadDashboardEnv();
  return parseSessionCookie(cookieStore.get(SESSION_COOKIE_NAME)?.value, env.DASHBOARD_SESSION_SECRET);
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
}): Promise<void> {
  const env = loadDashboardEnv();
  const cookieStore = await cookies();
  const session: DashboardSession = {
    email: input.user.email,
    name: input.user.name,
    allowedAgencyIds: input.user.allowedAgencyIds,
    selectedAgencyId: input.selectedAgencyId ?? null,
    issuedAt: new Date().toISOString(),
  };

  cookieStore.set(SESSION_COOKIE_NAME, serializeSession(session, env.DASHBOARD_SESSION_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
  });
}

export async function updateSelectedAgencyInSession(agencyId: string): Promise<DashboardSession> {
  const env = loadDashboardEnv();
  const cookieStore = await cookies();
  const current = await requireDashboardSession();
  if (!current.allowedAgencyIds.includes(agencyId)) {
    throw new Error(`Agency not allowed for user session: ${agencyId}`);
  }

  const nextSession: DashboardSession = {
    ...current,
    selectedAgencyId: agencyId,
  };

  cookieStore.set(SESSION_COOKIE_NAME, serializeSession(nextSession, env.DASHBOARD_SESSION_SECRET), {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
  });

  return nextSession;
}

export async function clearDashboardSession(): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}
