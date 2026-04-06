import { type LoginPageDiagnostics } from "../portal/pages/LoginPage";

export function formatLoginDiagnostics(
  prefix: string,
  diagnostics: Pick<
    LoginPageDiagnostics,
    | "currentUrl"
    | "title"
    | "usernameFieldPopulated"
    | "passwordFieldPopulated"
    | "loginButtonEnabled"
    | "inlineErrorDetected"
    | "inlineErrorText"
    | "authenticatedPageDetected"
    | "passwordInputFound"
    | "loginButtonFound"
    | "visibleInputCount"
    | "headingMarkers"
  >,
): string {
  return `${prefix} url=${diagnostics.currentUrl}; title=${diagnostics.title ?? "null"}; usernameFieldPopulated=${diagnostics.usernameFieldPopulated}; passwordFieldPopulated=${diagnostics.passwordFieldPopulated}; loginButtonEnabled=${diagnostics.loginButtonEnabled}; inlineErrorDetected=${diagnostics.inlineErrorDetected}; inlineErrorText=${diagnostics.inlineErrorText ?? "null"}; authenticatedPageDetected=${diagnostics.authenticatedPageDetected}; passwordInputFound=${diagnostics.passwordInputFound}; loginButtonFound=${diagnostics.loginButtonFound}; visibleInputCount=${diagnostics.visibleInputCount}; headingMarkers=${diagnostics.headingMarkers.join(" | ") || "none"}`;
}
