import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { redirectToSameOrigin, resolveDashboardRedirectLocation } from "./redirect";

describe("redirectToSameOrigin", () => {
  it("keeps live ALB users on the current browser origin", () => {
    const location = resolveDashboardRedirectLocation("/select-agency", {
      DASHBOARD_PUBLIC_BASE_URL: "http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com",
    });

    assert.equal(
      location,
      "http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com/select-agency",
    );
  });

  it("falls back to a relative Location header for local same-origin redirects", () => {
    const location = resolveDashboardRedirectLocation("/select-agency", {});

    assert.equal(location, "/select-agency");
  });

  it("uses the configured dashboard public origin in route responses", () => {
    process.env.DASHBOARD_PUBLIC_BASE_URL = "http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com";
    const response = redirectToSameOrigin("/select-agency");
    delete process.env.DASHBOARD_PUBLIC_BASE_URL;

    assert.equal(response.status, 303);
    assert.equal(
      response.headers.get("Location"),
      "http://medical-ai-qa-prod-alb-925770298.us-east-2.elb.amazonaws.com/select-agency",
    );
  });

  it("rejects non-root-relative redirect targets", () => {
    assert.throws(() => redirectToSameOrigin("https://example.com/select-agency"));
    assert.throws(() => redirectToSameOrigin("//example.com/select-agency"));
  });
});
