import { type Logger } from "@medical-ai-qa/shared-logging";
import { type PortalJob, type PortalJobResult } from "@medical-ai-qa/shared-types";
import { executeLoginWorkflow } from "../auth/login-workflow";
import { createPortalContext } from "../browser/context";
import { launchBrowser } from "../browser/launch";
import { WORKFLOW_FAILURE_CODES } from "../errors/failure-codes";
import { WorkflowError } from "../errors/workflow-error";
import { type PortalWorkerEnv } from "../config/env";

export async function runLoginWorkflow(
  job: PortalJob,
  env: PortalWorkerEnv,
  logger: Logger,
): Promise<PortalJobResult> {
  const browser = await launchBrowser(env);

  try {
    const context = await createPortalContext(browser, env);
    const page = await context.newPage();

    const { heading } = await executeLoginWorkflow(
      page,
      job.portalUrl,
      job.credentials.username,
      job.credentials.password,
      logger,
    );

    return {
      jobId: job.jobId,
      portal: job.portal,
      status: "AUTHENTICATED",
      completedAt: new Date().toISOString(),
      summary: "Login workflow completed.",
      landingPage: {
        type: "dashboard",
        navItems: [],
      },
      failures: [],
      data: {
        landingHeading: heading,
      },
    };
  } catch (error: unknown) {
    throw new WorkflowError(
      WORKFLOW_FAILURE_CODES.loginFailed,
      error instanceof Error ? error.message : "Login workflow failed.",
      true,
    );
  } finally {
    await browser.close();
  }
}
