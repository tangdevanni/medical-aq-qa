import { NextResponse } from "next/server";

export function resolveDashboardRedirectLocation(
  path: string,
  source: Record<string, string | undefined> = process.env,
): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`Same-origin redirect path must be root-relative: ${path}`);
  }

  const explicitPublicBaseUrl = source.DASHBOARD_PUBLIC_BASE_URL?.trim();
  const apiBaseUrl = source.NEXT_PUBLIC_API_BASE_URL?.trim();
  const publicBaseUrl = explicitPublicBaseUrl || apiBaseUrl;

  if (!publicBaseUrl) {
    return path;
  }

  const parsed = new URL(publicBaseUrl);
  return new URL(path, parsed.origin).toString();
}

export function redirectToSameOrigin(path: string, status = 303): NextResponse {
  return new NextResponse(null, {
    status,
    headers: {
      Location: resolveDashboardRedirectLocation(path),
    },
  });
}
