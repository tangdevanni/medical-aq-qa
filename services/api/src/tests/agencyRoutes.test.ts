import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { registerAgencyRoutes } from "../routes/agencies";

describe("agency routes", () => {
  it("accepts manual refresh without returning a full dashboard payload", async () => {
    const app = Fastify();
    await registerAgencyRoutes(app, {
      async startAgencyRefresh(agencyId: string) {
        assert.equal(agencyId, "default");
        return {
          id: "batch-1",
          status: "RUNNING",
          updatedAt: "2026-06-04T00:00:00.000Z",
          run: {
            requestedAt: "2026-06-04T00:00:00.000Z",
          },
          sourceWorkbook: {
            originalFileName: "default-oasis-30-days.xlsx",
            storedPath: "/data/control-plane/batches/default/batch-1/source.xlsx",
          },
        };
      },
    } as any);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/agencies/default/refresh",
        payload: {
          mode: "delta",
        },
      });

      assert.equal(response.statusCode, 202);
      const body = response.json() as Record<string, unknown>;
      assert.deepEqual(Object.keys(body).sort(), [
        "agencyId",
        "batchId",
        "refreshAcceptedAt",
        "sourceWorkbookName",
        "status",
        "statusUrl",
        "storedPath",
      ].sort());
      assert.equal(body.agencyId, "default");
      assert.equal(body.batchId, "batch-1");
      assert.equal(body.status, "RUNNING");
      assert.equal(body.statusUrl, "/api/runs/batch-1/status");
    } finally {
      await app.close();
    }
  });

  it("reports duplicate manual refreshes as conflicts", async () => {
    const app = Fastify();
    await registerAgencyRoutes(app, {
      async startAgencyRefresh() {
        throw new Error("Agency refresh already running for Default Subsidiary.");
      },
    } as any);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/agencies/default/refresh",
        payload: {
          mode: "delta",
        },
      });

      assert.equal(response.statusCode, 409);
      assert.match(response.json<{ message: string }>().message, /already running/);
    } finally {
      await app.close();
    }
  });
});
