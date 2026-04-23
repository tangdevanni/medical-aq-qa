import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  toDashboardPatientDetail,
  toDashboardPatientSummary,
  toDashboardPatientStatus,
  toDashboardRunDetail,
  toDashboardRunListItem,
  toPatientArtifactsResponse,
  toPatientRunLogResponse,
  toBatchSummaryResponse,
} from "../mappers/dashboardRunViews";
import type { BatchControlPlaneService } from "../services/batchControlPlaneService";

const batchIdParamsSchema = z.object({
  id: z.string().min(1),
});

const batchPatientParamsSchema = z.object({
  batchId: z.string().min(1),
  patientId: z.string().min(1),
});

const latestPatientQuerySchema = z.object({
  subsidiaryId: z.string().min(1),
});

const sampleBatchBodySchema = z.object({
  limit: z.number().int().positive().max(50).optional(),
  patientIds: z.array(z.string().min(1)).max(50).optional(),
});

async function getBatchId(request: FastifyRequest): Promise<string> {
  const params = batchIdParamsSchema.parse(request.params);
  return params.id;
}

async function getBatchPatientParams(request: FastifyRequest): Promise<{
  batchId: string;
  patientId: string;
}> {
  return batchPatientParamsSchema.parse(request.params);
}

async function readUploadPayload(request: FastifyRequest): Promise<{
  fileName: string;
  fileBuffer: Buffer;
  billingPeriod: string | null;
  subsidiaryId: string | null;
}> {
  const parts = request.parts();
  let fileName: string | null = null;
  let fileBuffer: Buffer | null = null;
  let billingPeriod: string | null = null;
  let subsidiaryId: string | null = null;

  for await (const part of parts) {
    if (part.type === "file") {
      fileName = part.filename;
      fileBuffer = await part.toBuffer();
      continue;
    }

    if (part.fieldname === "billingPeriod") {
      billingPeriod = String(part.value).trim() || null;
      continue;
    }

    if (part.fieldname === "subsidiaryId") {
      subsidiaryId = String(part.value).trim() || null;
    }
  }

  if (!fileName || !fileBuffer) {
    throw new Error("Workbook upload is required.");
  }

  if (!fileName.toLowerCase().endsWith(".xlsx")) {
    throw new Error("Only .xlsx workbook uploads are supported.");
  }

  return {
    fileName,
    fileBuffer,
    billingPeriod,
    subsidiaryId,
  };
}

async function buildDashboardPatientView(
  service: BatchControlPlaneService,
  batchId: string,
  patientId: string,
) {
  const knownArtifacts = await service.getKnownPatientArtifacts(batchId, patientId);
  if (!knownArtifacts) {
    return null;
  }

  return {
    batch: knownArtifacts.batch,
    summary: knownArtifacts.summary,
    workItem: knownArtifacts.workItem,
    artifactContents: knownArtifacts.artifactContents,
  };
}

async function buildDashboardRunDetail(
  service: BatchControlPlaneService,
  batchId: string,
) {
  const batch = await service.getBatch(batchId);
  if (!batch) {
    return null;
  }

  const patientViews = await Promise.all(
    batch.patientRuns.map((patientRun) => buildDashboardPatientView(service, batchId, patientRun.workItemId)),
  );

  return toDashboardRunDetail({
    batch,
    patients: patientViews
      .filter((patient): patient is NonNullable<typeof patient> => patient !== null)
      .map((patient) => toDashboardPatientSummary(patient)),
  });
}

async function buildDashboardRunListEntry(
  service: BatchControlPlaneService,
  batchId: string,
) {
  const batch = await service.getBatch(batchId);
  if (!batch) {
    return null;
  }

  const patientRuns = await service.getPatientRuns(batchId);
  return toDashboardRunListItem(
    batch,
    patientRuns.map((patientRun) => ({
      status: patientRun.processingStatus,
      errorSummary: patientRun.errorSummary,
    })),
  );
}

export async function registerBatchRoutes(
  app: FastifyInstance<any, any, any, any>,
  service: BatchControlPlaneService,
): Promise<void> {
  app.post("/api/batches/upload", async (request, reply) => {
    const payload = await readUploadPayload(request);
    const batch = await service.createBatchUpload(payload);
    await service.parseBatch(batch.id);
    await service.startBatchRun(batch.id);
    reply.code(201);
    return buildDashboardRunDetail(service, batch.id);
  });

  app.post("/api/batches/:id/parse", async (request) => {
    const batchId = await getBatchId(request);
    await service.parseBatch(batchId);
    return buildDashboardRunDetail(service, batchId);
  });

  app.post("/api/batches/:id/run", async (request, reply) => {
    const batchId = await getBatchId(request);
    await service.startBatchRun(batchId);
    reply.code(202);
    return buildDashboardRunDetail(service, batchId);
  });

  app.post("/api/batches/:id/retry-blocked", async (request, reply) => {
    const batchId = await getBatchId(request);
    reply.code(202);
    await service.retryBlockedPatientRuns(batchId);
    return buildDashboardRunDetail(service, batchId);
  });

  app.post("/api/batches/:id/deactivate", async (request) => {
    const batchId = await getBatchId(request);
    await service.deactivateBatch(batchId);
    return buildDashboardRunDetail(service, batchId);
  });

  app.get("/api/batches", async () => {
    const batches = await Promise.all(
      (await service.listBatches()).map((batch) => buildDashboardRunListEntry(service, batch.id)),
    );
    return batches.filter((batch): batch is NonNullable<typeof batch> => batch !== null);
  });

  app.get("/batches", async () => {
    const batches = await Promise.all(
      (await service.listBatches()).map((batch) => buildDashboardRunListEntry(service, batch.id)),
    );
    return batches.filter((batch): batch is NonNullable<typeof batch> => batch !== null);
  });

  app.get("/api/batches/:id", async (request, reply) => {
    const batchId = await getBatchId(request);
    const detail = await buildDashboardRunDetail(service, batchId);
    if (!detail) {
      reply.code(404);
    return { message: `Batch not found: ${batchId}` };
    }

    return detail;
  });

  app.get("/batches/:batchId", async (request, reply) => {
    const { batchId } = batchPatientParamsSchema.pick({ batchId: true }).parse(request.params);
    const detail = await buildDashboardRunDetail(service, batchId);
    if (!detail) {
      reply.code(404);
      return { message: `Batch not found: ${batchId}` };
    }

    return detail;
  });

  app.get("/api/batches/:id/work-items", async (request) => {
    const batchId = await getBatchId(request);
    return service.getWorkItems(batchId);
  });

  app.get("/api/batches/:id/parser-exceptions", async (request) => {
    const batchId = await getBatchId(request);
    return service.getParserExceptions(batchId);
  });

  app.get("/api/batches/:id/summary", async (request, reply) => {
    const batchId = await getBatchId(request);
    const batch = await service.getBatch(batchId);
    if (!batch) {
      reply.code(404);
      return { message: `Batch not found: ${batchId}` };
    }

    return toBatchSummaryResponse(batch);
  });

  app.get("/api/batches/:id/patient-runs", async (request) => {
    const batchId = await getBatchId(request);
    const patientViews = await Promise.all(
      (await service.getPatientRuns(batchId)).map((patientRun) =>
        buildDashboardPatientView(service, batchId, patientRun.workItemId),
      ),
    );
    return patientViews
      .filter((patient): patient is NonNullable<typeof patient> => patient !== null)
      .map((patient) => toDashboardPatientSummary(patient));
  });

  app.get("/batches/:batchId/patients/:patientId", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patient = await buildDashboardPatientView(service, batchId, patientId);
    if (!patient) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toDashboardPatientDetail(patient);
  });

  app.get("/api/batches/:batchId/patients/:patientId", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patient = await buildDashboardPatientView(service, batchId, patientId);
    if (!patient) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toDashboardPatientDetail(patient);
  });

  app.get("/batches/:batchId/patients/:patientId/log", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patientLog = await service.getBatchPatientLog(batchId, patientId);
    if (!patientLog) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toPatientRunLogResponse({
      batchId,
      patientRunSummary: patientLog.summary,
      log: patientLog.log,
    });
  });

  app.get("/api/batches/:batchId/patients/:patientId/log", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patientLog = await service.getBatchPatientLog(batchId, patientId);
    if (!patientLog) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toPatientRunLogResponse({
      batchId,
      patientRunSummary: patientLog.summary,
      log: patientLog.log,
    });
  });

  app.get("/batches/:batchId/patients/:patientId/artifacts", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patientArtifacts = await service.getBatchPatientArtifacts(batchId, patientId);
    if (!patientArtifacts) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toPatientArtifactsResponse({
      batchId,
      patientRunSummary: patientArtifacts.summary,
      artifacts: patientArtifacts.artifacts,
    });
  });

  app.get("/api/batches/:batchId/patients/:patientId/artifacts", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patientArtifacts = await service.getBatchPatientArtifacts(batchId, patientId);
    if (!patientArtifacts) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toPatientArtifactsResponse({
      batchId,
      patientRunSummary: patientArtifacts.summary,
      artifacts: patientArtifacts.artifacts,
    });
  });

  app.post("/api/runs/upload", async (request, reply) => {
    const payload = await readUploadPayload(request);
    const batch = await service.createBatchUpload(payload);
    await service.parseBatch(batch.id);
    await service.startBatchRun(batch.id);
    reply.code(201);
    return buildDashboardRunDetail(service, batch.id);
  });

  app.post("/api/runs/:id/parse", async (request) => {
    const batchId = await getBatchId(request);
    await service.parseBatch(batchId);
    return buildDashboardRunDetail(service, batchId);
  });

  app.post("/api/runs/:id/start", async (request, reply) => {
    const batchId = await getBatchId(request);
    await service.startBatchRun(batchId);
    reply.code(202);
    return buildDashboardRunDetail(service, batchId);
  });

  app.post("/api/runs/:id/sample", async (request, reply) => {
    const batchId = await getBatchId(request);
    const body = sampleBatchBodySchema.parse((request.body ?? {}) as unknown);
    const sampleBatch = await service.createPatientSampleBatch({
      sourceBatchId: batchId,
      limit: body.limit,
      patientIds: body.patientIds,
    });
    await service.startBatchRun(sampleBatch.id);
    reply.code(202);
    return buildDashboardRunDetail(service, sampleBatch.id);
  });

  app.post("/api/runs/:id/deactivate", async (request) => {
    const batchId = await getBatchId(request);
    await service.deactivateBatch(batchId);
    return buildDashboardRunDetail(service, batchId);
  });

  app.get("/api/runs", async () => {
    const runs = await Promise.all(
      (await service.listBatches()).map((batch) => buildDashboardRunListEntry(service, batch.id)),
    );
    return runs.filter((run): run is NonNullable<typeof run> => run !== null);
  });

  app.get("/runs", async () => {
    const runs = await Promise.all(
      (await service.listBatches()).map((batch) => buildDashboardRunListEntry(service, batch.id)),
    );
    return runs.filter((run): run is NonNullable<typeof run> => run !== null);
  });

  app.get("/api/runs/:id", async (request, reply) => {
    const batchId = await getBatchId(request);
    const detail = await buildDashboardRunDetail(service, batchId);
    if (!detail) {
      reply.code(404);
      return { message: `Run not found: ${batchId}` };
    }

    return detail;
  });

  app.get("/runs/:id", async (request, reply) => {
    const batchId = await getBatchId(request);
    const detail = await buildDashboardRunDetail(service, batchId);
    if (!detail) {
      reply.code(404);
      return { message: `Run not found: ${batchId}` };
    }

    return detail;
  });

  app.get("/api/runs/:id/status", async (request, reply) => {
    const batchId = await getBatchId(request);
    const batch = await service.getBatch(batchId);
    if (!batch) {
      reply.code(404);
      return { message: `Run not found: ${batchId}` };
    }

    return {
      ...toBatchSummaryResponse(batch),
      eligibleWorkItemCount: batch.parse.eligibleWorkItemCount,
    };
  });

  app.get("/api/runs/:batchId/patients/:patientId", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patient = await buildDashboardPatientView(service, batchId, patientId);
    if (!patient) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toDashboardPatientDetail(patient);
  });

  app.get("/api/runs/:batchId/patients/:patientId/artifacts", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patientArtifacts = await service.getBatchPatientArtifacts(batchId, patientId);
    if (!patientArtifacts) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toPatientArtifactsResponse({
      batchId,
      patientRunSummary: patientArtifacts.summary,
      artifacts: patientArtifacts.artifacts,
    });
  });

  app.get("/api/runs/:batchId/patients/:patientId/status", async (request, reply) => {
    const { batchId, patientId } = await getBatchPatientParams(request);
    const patient = await buildDashboardPatientView(service, batchId, patientId);
    if (!patient) {
      reply.code(404);
      return { message: `Patient not found: ${patientId}` };
    }

    return toDashboardPatientStatus(patient);
  });

  app.get("/api/patients/:patientId/latest", async (request, reply) => {
    const params = z.object({ patientId: z.string().min(1) }).parse(request.params);
    const query = latestPatientQuerySchema.parse(request.query);
    const latestPatient = await service.getLatestPatientForSubsidiary({
      subsidiaryId: query.subsidiaryId,
      patientId: params.patientId,
    });
    if (!latestPatient) {
      reply.code(404);
      return {
        message: `Patient not found: ${params.patientId}`,
      };
    }

    const patient = await buildDashboardPatientView(
      service,
      latestPatient.batch.id,
      latestPatient.summary.workItemId,
    );
    if (!patient) {
      reply.code(404);
      return {
        message: `Patient not found: ${params.patientId}`,
      };
    }

    return toDashboardPatientDetail(patient);
  });
}
