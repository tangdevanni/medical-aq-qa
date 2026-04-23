import { createHash, timingSafeEqual } from "node:crypto";

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left, "utf8");
  const rightBuffer = Buffer.from(right, "utf8");
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

export function hashQaUserPassword(password: string): string {
  return `sha256:${createHash("sha256").update(password, "utf8").digest("hex")}`;
}

const DEFAULT_DASHBOARD_SESSION_SECRET = "local-dashboard-session-secret-change-me-now";
const DEFAULT_STAR_AGENCY_IDS = ["star-home-health", "default", "star-home-health-care-inc"];
const DEFAULT_DASHBOARD_QA_USERS_JSON = JSON.stringify([
  {
    email: "qa@starhhc.local",
    passwordHash: hashQaUserPassword("star1234"),
    name: "Star QA",
    allowedAgencyIds: [
      ...DEFAULT_STAR_AGENCY_IDS,
      "aplus-home-health",
      "active-home-health",
      "avery-home-health",
      "meadows-home-health",
    ],
  },
]);

export type DashboardQaUser = {
  email: string;
  password?: string;
  passwordHash?: string;
  name: string;
  allowedAgencyIds: string[];
};

export type DashboardEnv = {
  NODE_ENV: string;
  NEXT_PUBLIC_API_BASE_URL: string;
  DASHBOARD_SESSION_SECRET: string;
  DASHBOARD_QA_USERS_JSON: string;
  DASHBOARD_SESSION_TTL_HOURS: number;
  DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS: string;
  DASHBOARD_AUTH_AUDIT_LOG_GROUP: string;
  DASHBOARD_AUTH_AUDIT_AWS_REGION: string;
  DASHBOARD_AUTH_AUDIT_STREAM_PREFIX: string;
  qaUsers: DashboardQaUser[];
  isProduction: boolean;
  allowPlaintextPasswords: boolean;
  sessionTtlSeconds: number;
  authAuditEnabled: boolean;
  authAuditRegion: string | null;
  authAuditLogGroup: string | null;
  authAuditStreamPrefix: string;
};

function parseBooleanEnv(value: string | undefined, defaultValue: boolean): boolean {
  if (!value) {
    return defaultValue;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  throw new Error(`Invalid boolean environment value: ${value}`);
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Invalid positive integer environment value: ${value}`);
  }
  return parsed;
}

function assertNonEmptyString(value: unknown, fieldName: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${fieldName} must be a non-empty string.`);
  }
  return value.trim();
}

function assertUrl(value: string, fieldName: string): string {
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new Error(`${fieldName} must be a valid URL.`);
  }
}

function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function parseQaUser(candidate: unknown, index: number): DashboardQaUser {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    throw new Error(`QA user at index ${index} must be an object.`);
  }

  const record = candidate as Record<string, unknown>;
  const email = assertNonEmptyString(record.email, `qaUsers[${index}].email`).toLowerCase();
  if (!isValidEmail(email)) {
    throw new Error(`qaUsers[${index}].email must be a valid email address.`);
  }

  const name = assertNonEmptyString(record.name, `qaUsers[${index}].name`);
  const password = typeof record.password === "string" && record.password.trim().length > 0
    ? record.password
    : undefined;
  const passwordHash = typeof record.passwordHash === "string" && record.passwordHash.trim().length > 0
    ? record.passwordHash.trim()
    : undefined;

  if (!password && !passwordHash) {
    throw new Error(`qaUsers[${index}] must define either password or passwordHash.`);
  }

  const allowedAgencyIdsRaw = Array.isArray(record.allowedAgencyIds)
    ? record.allowedAgencyIds
    : DEFAULT_STAR_AGENCY_IDS;
  const allowedAgencyIds = allowedAgencyIdsRaw.map((agencyId, agencyIndex) =>
    assertNonEmptyString(agencyId, `qaUsers[${index}].allowedAgencyIds[${agencyIndex}]`),
  );

  return {
    email,
    password,
    passwordHash,
    name,
    allowedAgencyIds,
  };
}

function normalizeStoredPasswordHash(value: string): string | null {
  const normalized = value.trim().toLowerCase();
  if (/^[a-f0-9]{64}$/.test(normalized)) {
    return normalized;
  }
  if (normalized.startsWith("sha256:")) {
    const digest = normalized.slice("sha256:".length);
    return /^[a-f0-9]{64}$/.test(digest) ? digest : null;
  }
  return null;
}

export function verifyQaUserPassword(
  user: DashboardQaUser,
  password: string,
  allowPlaintextPasswords = false,
): boolean {
  if (user.passwordHash) {
    const expectedDigest = normalizeStoredPasswordHash(user.passwordHash);
    if (!expectedDigest) {
      return false;
    }
    return safeEqualString(hashQaUserPassword(password), `sha256:${expectedDigest}`);
  }

  if (!allowPlaintextPasswords || !user.password) {
    return false;
  }

  return safeEqualString(user.password, password);
}

export function loadDashboardEnv(
  source: Record<string, string | undefined> = process.env,
): DashboardEnv {
  const NODE_ENV = source.NODE_ENV?.trim() || "development";
  const NEXT_PUBLIC_API_BASE_URL = assertUrl(
    source.NEXT_PUBLIC_API_BASE_URL?.trim() || "http://127.0.0.1:3000",
    "NEXT_PUBLIC_API_BASE_URL",
  );
  const DASHBOARD_SESSION_SECRET =
    source.DASHBOARD_SESSION_SECRET?.trim() || DEFAULT_DASHBOARD_SESSION_SECRET;
  const DASHBOARD_QA_USERS_JSON = source.DASHBOARD_QA_USERS_JSON || DEFAULT_DASHBOARD_QA_USERS_JSON;
  const DASHBOARD_SESSION_TTL_HOURS = parsePositiveInteger(source.DASHBOARD_SESSION_TTL_HOURS, 12);
  const DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS = source.DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS || "false";
  const DASHBOARD_AUTH_AUDIT_LOG_GROUP = source.DASHBOARD_AUTH_AUDIT_LOG_GROUP?.trim() || "";
  const DASHBOARD_AUTH_AUDIT_AWS_REGION =
    source.DASHBOARD_AUTH_AUDIT_AWS_REGION?.trim() ||
    source.AWS_REGION?.trim() ||
    source.AWS_DEFAULT_REGION?.trim() ||
    "";
  const DASHBOARD_AUTH_AUDIT_STREAM_PREFIX =
    source.DASHBOARD_AUTH_AUDIT_STREAM_PREFIX?.trim() || "dashboard-auth";
  const allowPlaintextPasswords = parseBooleanEnv(DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS, false);
  const isProduction = NODE_ENV === "production";
  const usingFallbackSessionSecret = source.DASHBOARD_SESSION_SECRET === undefined;
  const usingFallbackQaUsers = source.DASHBOARD_QA_USERS_JSON === undefined;
  const authAuditEnabled = DASHBOARD_AUTH_AUDIT_LOG_GROUP.length > 0;

  let parsedUsersRaw: unknown;
  try {
    parsedUsersRaw = JSON.parse(DASHBOARD_QA_USERS_JSON);
  } catch {
    throw new Error("DASHBOARD_QA_USERS_JSON must contain valid JSON.");
  }

  if (!Array.isArray(parsedUsersRaw)) {
    throw new Error("DASHBOARD_QA_USERS_JSON must be a JSON array.");
  }

  const qaUsers = parsedUsersRaw.map((candidate, index) => parseQaUser(candidate, index));

  if (isProduction) {
    if (usingFallbackSessionSecret || DASHBOARD_SESSION_SECRET.length < 32) {
      throw new Error("DASHBOARD_SESSION_SECRET must be explicitly set to a strong secret in production.");
    }
    if (usingFallbackQaUsers) {
      throw new Error("DASHBOARD_QA_USERS_JSON must be explicitly configured in production.");
    }
    if (allowPlaintextPasswords) {
      throw new Error("DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS cannot be enabled in production.");
    }
    if (qaUsers.some((user) => Boolean(user.password))) {
      throw new Error("Production QA users must use passwordHash instead of plaintext password.");
    }
  }

  if (authAuditEnabled && DASHBOARD_AUTH_AUDIT_AWS_REGION.length === 0) {
    throw new Error("DASHBOARD_AUTH_AUDIT_AWS_REGION or AWS_REGION must be set when auth audit logging is enabled.");
  }

  return {
    NODE_ENV,
    NEXT_PUBLIC_API_BASE_URL,
    DASHBOARD_SESSION_SECRET,
    DASHBOARD_QA_USERS_JSON,
    DASHBOARD_SESSION_TTL_HOURS,
    DASHBOARD_ALLOW_PLAINTEXT_PASSWORDS,
    DASHBOARD_AUTH_AUDIT_LOG_GROUP,
    DASHBOARD_AUTH_AUDIT_AWS_REGION,
    DASHBOARD_AUTH_AUDIT_STREAM_PREFIX,
    qaUsers,
    isProduction,
    allowPlaintextPasswords,
    sessionTtlSeconds: DASHBOARD_SESSION_TTL_HOURS * 60 * 60,
    authAuditEnabled,
    authAuditRegion: authAuditEnabled ? DASHBOARD_AUTH_AUDIT_AWS_REGION : null,
    authAuditLogGroup: authAuditEnabled ? DASHBOARD_AUTH_AUDIT_LOG_GROUP : null,
    authAuditStreamPrefix: DASHBOARD_AUTH_AUDIT_STREAM_PREFIX,
  };
}
