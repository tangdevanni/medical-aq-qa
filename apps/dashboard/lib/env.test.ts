import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  hashQaUserPassword,
  loadDashboardEnv,
  verifyQaUserPassword,
  type DashboardQaUser,
} from "./env";

describe("dashboard env", () => {
  it("verifies hashed QA user passwords", () => {
    const user: DashboardQaUser = {
      email: "qa@example.com",
      name: "QA User",
      passwordHash: hashQaUserPassword("correct horse battery staple"),
      allowedAgencyIds: ["default"],
    };

    assert.equal(verifyQaUserPassword(user, "correct horse battery staple"), true);
    assert.equal(verifyQaUserPassword(user, "wrong password"), false);
  });

  it("rejects plaintext QA users in production", () => {
    assert.throws(() =>
      loadDashboardEnv({
        NODE_ENV: "production",
        NEXT_PUBLIC_API_BASE_URL: "https://dashboard.example.com",
        DASHBOARD_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
        DASHBOARD_QA_USERS_JSON: JSON.stringify([
          {
            email: "qa@example.com",
            password: "plaintext-password",
            name: "QA User",
            allowedAgencyIds: ["default"],
          },
        ]),
      }),
    );
  });

  it("accepts hashed QA users with an explicit production secret", () => {
    const env = loadDashboardEnv({
      NODE_ENV: "production",
      NEXT_PUBLIC_API_BASE_URL: "https://dashboard.example.com",
      DASHBOARD_SESSION_SECRET: "0123456789abcdef0123456789abcdef",
      DASHBOARD_QA_USERS_JSON: JSON.stringify([
        {
          email: "qa@example.com",
          passwordHash: hashQaUserPassword("strong-password"),
          name: "QA User",
          allowedAgencyIds: ["default"],
        },
      ]),
    });

    assert.equal(env.isProduction, true);
    assert.equal(env.sessionTtlSeconds, 12 * 60 * 60);
    assert.equal(env.qaUsers.length, 1);
    assert.equal(verifyQaUserPassword(env.qaUsers[0]!, "strong-password"), true);
  });

  it("enables auth audit logging when a CloudWatch log group is configured", () => {
    const env = loadDashboardEnv({
      NEXT_PUBLIC_API_BASE_URL: "https://dashboard.example.com",
      DASHBOARD_AUTH_AUDIT_LOG_GROUP: "dashboard-auth-audit",
      AWS_REGION: "us-east-2",
    });

    assert.equal(env.authAuditEnabled, true);
    assert.equal(env.authAuditLogGroup, "dashboard-auth-audit");
    assert.equal(env.authAuditRegion, "us-east-2");
  });

  it("rejects auth audit logging without an AWS region", () => {
    assert.throws(() =>
      loadDashboardEnv({
        NEXT_PUBLIC_API_BASE_URL: "https://dashboard.example.com",
        DASHBOARD_AUTH_AUDIT_LOG_GROUP: "dashboard-auth-audit",
      }),
    );
  });
});
