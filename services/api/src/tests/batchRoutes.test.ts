import assert from "node:assert/strict";
import { describe, it } from "node:test";
import Fastify from "fastify";
import { registerBatchRoutes } from "../routes/batches";

function createAcceptedBatch(id = "batch-1") {
  return {
    id,
    status: "RUNNING",
    run: {
      requestedAt: "2026-06-04T00:00:00.000Z",
    },
    parse: {
      requestedAt: null,
    },
  };
}

describe("batch routes", () => {
  it("accepts a run start without returning dashboard detail", async () => {
    const app = Fastify();
    let startCalled = false;
    await registerBatchRoutes(app, {
      async startBatchRunDetached(batchId: string, options: { mode?: string }) {
        startCalled = true;
        assert.equal(batchId, "batch-1");
        assert.equal(options.mode, "delta");
        return createAcceptedBatch(batchId);
      },
      async getKnownPatientArtifactsForBatch() {
        throw new Error("run start should not build dashboard detail");
      },
    } as any);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/runs/batch-1/start",
        payload: {
          mode: "delta",
        },
      });

      assert.equal(response.statusCode, 202);
      assert.equal(startCalled, true);
      const body = response.json() as Record<string, unknown>;
      assert.equal(body.batchId, "batch-1");
      assert.equal(body.status, "RUNNING");
      assert.equal(body.refreshAcceptedAt, "2026-06-04T00:00:00.000Z");
      assert.equal(body.statusUrl, "/api/runs/batch-1/status");
      assert.equal("patients" in body, false);
    } finally {
      await app.close();
    }
  });

  it("accepts a sample run without returning dashboard detail", async () => {
    const app = Fastify();
    await registerBatchRoutes(app, {
      async createPatientSampleBatch(input: { sourceBatchId: string; patientIds?: string[] }) {
        assert.equal(input.sourceBatchId, "batch-1");
        assert.deepEqual(input.patientIds, ["patient-1"]);
        return createAcceptedBatch("sample-batch-1");
      },
      async startBatchRunDetached(batchId: string) {
        assert.equal(batchId, "sample-batch-1");
        return createAcceptedBatch(batchId);
      },
      async getKnownPatientArtifactsForBatch() {
        throw new Error("sample run should not build dashboard detail");
      },
    } as any);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/runs/batch-1/sample",
        payload: {
          patientIds: ["patient-1"],
          mode: "delta",
        },
      });

      assert.equal(response.statusCode, 202);
      const body = response.json() as Record<string, unknown>;
      assert.equal(body.batchId, "sample-batch-1");
      assert.equal(body.status, "RUNNING");
      assert.equal(body.statusUrl, "/api/runs/sample-batch-1/status");
      assert.equal("patients" in body, false);
    } finally {
      await app.close();
    }
  });

  it("accepts blocked-run retries without returning dashboard detail", async () => {
    const app = Fastify();
    await registerBatchRoutes(app, {
      async retryBlockedPatientRuns(batchId: string) {
        assert.equal(batchId, "batch-1");
        return createAcceptedBatch(batchId);
      },
      async getKnownPatientArtifactsForBatch() {
        throw new Error("retry should not build dashboard detail");
      },
    } as any);

    try {
      const response = await app.inject({
        method: "POST",
        url: "/api/batches/batch-1/retry-blocked",
      });

      assert.equal(response.statusCode, 202);
      const body = response.json() as Record<string, unknown>;
      assert.equal(body.batchId, "batch-1");
      assert.equal(body.status, "RUNNING");
      assert.equal(body.statusUrl, "/api/runs/batch-1/status");
      assert.equal("patients" in body, false);
    } finally {
      await app.close();
    }
  });
});
