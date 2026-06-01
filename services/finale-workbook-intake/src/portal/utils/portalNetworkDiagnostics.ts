import { lookup } from "node:dns/promises";
import https from "node:https";
import { sanitizePortalUrl, classifyPortalNavigationError, type PortalNavigationErrorCategory } from "./portalNavigation";

export interface PortalNetworkDiagnostic {
  checkedAt: string;
  url: string;
  host: string;
  dnsResolved: boolean;
  httpsReachable: boolean;
  statusCode: number | null;
  latencyMs: number;
  errorCategory: PortalNavigationErrorCategory | null;
  errorMessage: string | null;
}

function requestHead(url: URL, timeoutMs: number): Promise<number | null> {
  return new Promise((resolve, reject) => {
    const request = https.request(
      {
        protocol: url.protocol,
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname || "/",
        method: "HEAD",
        timeout: timeoutMs,
        headers: {
          "user-agent": "MedicalAIQA-portal-diagnostic/1.0",
        },
      },
      (response) => {
        response.resume();
        resolve(response.statusCode ?? null);
      },
    );

    request.on("timeout", () => {
      request.destroy(new Error("PORTAL_CONNECT_TIMEOUT"));
    });
    request.on("error", reject);
    request.end();
  });
}

export async function diagnosePortalNetwork(input: {
  portalUrl: string;
  timeoutMs?: number;
}): Promise<PortalNetworkDiagnostic> {
  const startedAt = Date.now();
  const timeoutMs = input.timeoutMs ?? 8_000;
  const url = new URL(input.portalUrl);
  let dnsResolved = false;

  try {
    await lookup(url.hostname);
    dnsResolved = true;
  } catch (error) {
    const { category } = classifyPortalNavigationError(error);
    return {
      checkedAt: new Date().toISOString(),
      url: sanitizePortalUrl(input.portalUrl),
      host: url.hostname,
      dnsResolved: false,
      httpsReachable: false,
      statusCode: null,
      latencyMs: Date.now() - startedAt,
      errorCategory: category,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }

  try {
    const statusCode = await requestHead(url, timeoutMs);
    return {
      checkedAt: new Date().toISOString(),
      url: sanitizePortalUrl(input.portalUrl),
      host: url.hostname,
      dnsResolved,
      httpsReachable: true,
      statusCode,
      latencyMs: Date.now() - startedAt,
      errorCategory: null,
      errorMessage: null,
    };
  } catch (error) {
    const { category } = classifyPortalNavigationError(error);
    return {
      checkedAt: new Date().toISOString(),
      url: sanitizePortalUrl(input.portalUrl),
      host: url.hostname,
      dnsResolved,
      httpsReachable: false,
      statusCode: null,
      latencyMs: Date.now() - startedAt,
      errorCategory: category,
      errorMessage: error instanceof Error ? error.message : String(error),
    };
  }
}
