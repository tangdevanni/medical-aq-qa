import Link from "next/link";
import { getDashboardSession } from "../../lib/auth/session";
import { loadDashboardEnv } from "../../lib/env";
import { redirect } from "next/navigation";

type LoginPageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function getErrorMessage(errorValue: string | string[] | undefined): string | null {
  if (errorValue === "invalid_credentials") {
    return "Invalid email or password.";
  }
  return null;
}

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const session = await getDashboardSession();
  if (session?.selectedAgencyId) {
    redirect("/agency");
  }
  if (session) {
    redirect("/select-agency");
  }

  const resolvedSearchParams = await searchParams;
  const error = getErrorMessage(resolvedSearchParams?.error);
  const env = loadDashboardEnv();

  return (
    <main className="page-shell stack">
      <section className="hero-panel">
        <div className="hero-copy">
          <span className="eyebrow">QA Access</span>
          <h1 className="page-title">Sign in to the QA dashboard</h1>
          <p>
            Dashboard access is separate from workbook synchronization and portal automation. Sign in, select an agency, and review the agency-scoped patient queue already maintained by the backend refresh cycle.
          </p>
        </div>

        <form className="hero-form" action="/auth/login" method="post">
          <label className="field">
            <span>Email</span>
            <input
              autoCapitalize="none"
              autoComplete="username"
              className="input"
              name="email"
              spellCheck={false}
              type="email"
              required
            />
          </label>

          <label className="field">
            <span>Password</span>
            <input
              autoComplete="current-password"
              className="input"
              name="password"
              type="password"
              required
            />
          </label>

          <div className="actions">
            <button className="button" type="submit">Sign in</button>
          </div>

          {error ? <div className="badge danger">{error}</div> : null}
          {!env.isProduction && env.allowPlaintextPasswords ? (
            <div className="muted">
              Local development is allowing plaintext passwords from `DASHBOARD_QA_USERS_JSON`.
            </div>
          ) : null}
          <Link className="link" href="/healthz">Health check</Link>
        </form>
      </section>
    </main>
  );
}
