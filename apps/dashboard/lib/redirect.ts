import { NextResponse } from "next/server";

export function resolveDashboardRedirectLocation(
  path: string,
  source: Record<string, string | undefined> = process.env,
): string {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error(`Same-origin redirect path must be root-relative: ${path}`);
  }

  const explicitPublicBaseUrl = source.DASHBOARD_PUBLIC_BASE_URL?.trim();

  if (!explicitPublicBaseUrl) {
    return path;
  }

  const parsed = new URL(explicitPublicBaseUrl);
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
