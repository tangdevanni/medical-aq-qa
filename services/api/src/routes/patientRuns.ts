import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  toPatientRunDetail,
  toPatientRunFindingsResponse,
  toPatientRunSummary,
} from "../mappers/controlPlaneViews";
import type { BatchControlPlaneService } from "../services/batchControlPlaneService";

const runIdParamsSchema = z.object({
  runId: z.string().min(1),
});

async function getRunId(request: { params: unknown }): Promise<string> {
  return runIdParamsSchema.parse(request.params).runId;
}

export async function registerPatientRunRoutes(
  app: FastifyInstance<any, any, any, any>,
  service: BatchControlPlaneService,
): Promise<void> {
  app.get("/api/patient-runs/:runId", async (request, reply) => {
    const runId = await getRunId(request);
    const patientRun = await service.getPatientRun(runId);
    if (!patientRun) {
      reply.code(404);
      return { message: `Patient run not found: ${runId}` };
    }

    return toPatientRunDetail(patientRun.batchId, patientRun.summary, patientRun.detail);
  });

  app.get("/api/patient-runs/:runId/findings", async (request, reply) => {
    const runId = await getRunId(request);
    const patientRun = await service.getPatientRun(runId);
    if (!patientRun) {
      reply.code(404);
      return { message: `Patient run not found: ${runId}` };
    }

    return toPatientRunFindingsResponse(patientRun.batchId, patientRun.summary, patientRun.detail);
  });

  app.post("/api/patient-runs/:runId/retry", async (request, reply) => {
    const runId = await getRunId(request);
    reply.code(202);
    const patientRun = await service.retryPatientRun(runId);
    return toPatientRunSummary(patientRun.batchId, patientRun.summary);
  });
}
