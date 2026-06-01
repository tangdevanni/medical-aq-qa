import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BatchControlPlaneService } from "../services/batchControlPlaneService";

const agencyParamsSchema = z.object({
  agencyId: z.string().min(1),
});

const reviewerStatusBodySchema = z.object({
  workItemId: z.string().min(1),
  status: z.enum(["red", "yellow", "green"]),
  updatedBy: z.string().min(1).nullable().optional(),
});

const agencyRefreshBodySchema = z.object({
  mode: z.enum(["delta", "full"]).default("delta"),
  reprojectOnly: z.boolean().default(false),
  forceStages: z
    .array(z.enum(["referral", "oasis", "poc", "visit_notes", "dashboard"]))
    .default([]),
});

async function getAgencyId(request: FastifyRequest): Promise<string> {
  return agencyParamsSchema.parse(request.params).agencyId;
}

export async function registerAgencyRoutes(
  app: FastifyInstance<any, any, any, any>,
  service: BatchControlPlaneService,
): Promise<void> {
  app.get("/api/agencies", async () => {
    return service.listAgencies();
  });

  app.get("/api/agencies/:agencyId/dashboard", async (request, reply) => {
    const agencyId = await getAgencyId(request);
    try {
      return await service.getAgencyDashboardSnapshot(agencyId);
    } catch (error) {
      reply.code(404);
      return {
        message: error instanceof Error ? error.message : `Agency not found: ${agencyId}`,
      };
    }
  });

  app.post("/api/agencies/:agencyId/refresh", async (request, reply) => {
    const agencyId = await getAgencyId(request);
    const body = agencyRefreshBodySchema.parse(request.body ?? {});
    try {
      const batch = await service.triggerAgencyRefresh(agencyId, body);
      return {
        agencyId,
        batchId: batch.id,
        status: batch.status,
        sourceWorkbookName: batch.sourceWorkbook.originalFileName,
        storedPath: batch.sourceWorkbook.storedPath,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : `Unable to refresh agency: ${agencyId}`;
      reply.code(message.includes("not found") ? 404 : message.includes("already running") ? 409 : 500);
      return {
        message,
      };
    }
  });

  app.post("/api/agencies/:agencyId/dashboard/reviewer-status", async (request, reply) => {
    const agencyId = await getAgencyId(request);
    const body = reviewerStatusBodySchema.parse(request.body ?? {});
    try {
      return await service.updateAgencyDashboardReviewerStatus({
        agencyId,
        workItemId: body.workItemId,
        status: body.status,
        updatedBy: body.updatedBy ?? null,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to update dashboard reviewer status.";
      reply.code(message.includes("not found") || message.includes("not in the active") ? 404 : 500);
      return { message };
    }
  });
}
