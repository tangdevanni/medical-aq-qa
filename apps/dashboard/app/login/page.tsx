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
          <span className="eyebrow">OASIS QA</span>
          <h1 className="page-title">Sign in</h1>
          <p>
            Review patient queues, OASIS snapshots, referral support, and documentation gaps for your assigned agencies.
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
        </form>
      </section>
    </main>
  );
}
