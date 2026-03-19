export interface PortalWorkerEnv {
  portalBaseUrl: string;
  portalUsername: string;
  portalPassword: string;
  playwrightHeadless: boolean;
  playwrightSlowMoMs: number;
}

export interface PortalWorkerStartupDiagnostics {
  loadedEnvPaths: string[];
  hasPortalUsername: boolean;
  hasPortalPassword: boolean;
  playwrightHeadless: boolean;
  portalBaseUrl: string;
}

function getTrimmedEnvValue(source: NodeJS.ProcessEnv, key: string): string {
  return source[key]?.trim() ?? "";
}

function hasNonEmptyEnvValue(source: NodeJS.ProcessEnv, key: string): boolean {
  return getTrimmedEnvValue(source, key).length > 0;
}

function parseStringEnv(source: NodeJS.ProcessEnv, key: string, fallback?: string): string {
  const value = getTrimmedEnvValue(source, key);

  if (value) {
    return value;
  }

  return fallback ?? "";
}

function requireNonEmptyEnv(source: NodeJS.ProcessEnv, key: string): string {
  const value = getTrimmedEnvValue(source, key);

  if (!value) {
    throw new Error(
      `Missing required environment variable: ${key}. Local portal runs require a non-empty value.`,
    );
  }

  return value;
}

function parseBooleanEnv(
  source: NodeJS.ProcessEnv,
  key: string,
  fallback: boolean,
): boolean {
  const value = getTrimmedEnvValue(source, key);

  if (!value) {
    return fallback;
  }

  switch (value.toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    case "0":
    case "false":
    case "no":
    case "off":
      return false;
    default:
      throw new Error(
        `Invalid boolean environment variable: ${key}. Expected true/false, 1/0, yes/no, or on/off.`,
      );
  }
}

function parseNumberEnv(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const value = getTrimmedEnvValue(source, key);

  if (!value) {
    return fallback;
  }

  const parsed = Number(value);

  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid numeric environment variable: ${key}. Received "${value}".`);
  }

  return parsed;
}

function parsePortalBaseUrl(source: NodeJS.ProcessEnv): string {
  return parseStringEnv(source, "PORTAL_BASE_URL", "https://app.finalehealth.com");
}

function parsePlaywrightHeadless(source: NodeJS.ProcessEnv): boolean {
  return parseBooleanEnv(source, "PLAYWRIGHT_HEADLESS", true);
}

export function getPortalWorkerStartupDiagnostics(
  source: NodeJS.ProcessEnv,
  loadedEnvPaths: string[],
): PortalWorkerStartupDiagnostics {
  return {
    loadedEnvPaths,
    hasPortalUsername: hasNonEmptyEnvValue(source, "PORTAL_USERNAME"),
    hasPortalPassword: hasNonEmptyEnvValue(source, "PORTAL_PASSWORD"),
    playwrightHeadless: parsePlaywrightHeadless(source),
    portalBaseUrl: parsePortalBaseUrl(source),
  };
}

export function loadPortalWorkerEnv(source: NodeJS.ProcessEnv): PortalWorkerEnv {
  return {
    portalBaseUrl: parsePortalBaseUrl(source),
    portalUsername: requireNonEmptyEnv(source, "PORTAL_USERNAME"),
    portalPassword: requireNonEmptyEnv(source, "PORTAL_PASSWORD"),
    playwrightHeadless: parsePlaywrightHeadless(source),
    playwrightSlowMoMs: parseNumberEnv(source, "PLAYWRIGHT_SLOW_MO_MS", 0),
  };
}
