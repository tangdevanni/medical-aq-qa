import { createHash } from "node:crypto";
import { z } from "zod";

const qaUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  name: z.string().min(1),
  allowedAgencyIds: z.array(z.string().min(1)).default(["default"]),
});

const dashboardEnvSchema = z.object({
  NEXT_PUBLIC_API_BASE_URL: z.string().url().default("http://127.0.0.1:3000"),
  DASHBOARD_SESSION_SECRET: z.string().min(1).default("local-dashboard-session-secret"),
  DASHBOARD_QA_USERS_JSON: z.string().default(JSON.stringify([
    {
      email: "qa@starhhc.local",
      password: "star1234",
      name: "Star QA",
      allowedAgencyIds: [
        "default",
        "aplus-home-health",
        "active-home-health",
        "avery-home-health",
        "meadows-home-health",
      ],
    },
  ])),
});

export type DashboardQaUser = z.infer<typeof qaUserSchema>;
export type DashboardEnv = z.infer<typeof dashboardEnvSchema> & {
  qaUsers: DashboardQaUser[];
};

export function loadDashboardEnv(source: NodeJS.ProcessEnv = process.env): DashboardEnv {
  const env = dashboardEnvSchema.parse(source);
  const parsedUsers = z.array(qaUserSchema).parse(JSON.parse(env.DASHBOARD_QA_USERS_JSON));

  return {
    ...env,
    qaUsers: parsedUsers,
  };
}

export function hashQaUserPassword(password: string): string {
  return createHash("sha256").update(password).digest("hex");
}
