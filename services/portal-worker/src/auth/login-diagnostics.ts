import { type LoginPageDiagnostics } from "../portal/pages/LoginPage";

export function formatLoginDiagnostics(
  prefix: string,
  diagnostics: Pick<
    LoginPageDiagnostics,
    "currentUrl" | "title" | "passwordInputFound" | "loginButtonFound" | "visibleInputCount" | "headingMarkers"
  >,
): string {
  return `${prefix} url=${diagnostics.currentUrl}; title=${diagnostics.title ?? "null"}; passwordInputFound=${diagnostics.passwordInputFound}; loginButtonFound=${diagnostics.loginButtonFound}; visibleInputCount=${diagnostics.visibleInputCount}; headingMarkers=${diagnostics.headingMarkers.join(" | ") || "none"}`;
}
