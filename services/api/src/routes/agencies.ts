import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { BatchControlPlaneService } from "../services/batchControlPlaneService";

const agencyParamsSchema = z.object({
  agencyId: z.string().min(1),
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
    try {
      const batch = await service.triggerAgencyRefresh(agencyId);
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
}
