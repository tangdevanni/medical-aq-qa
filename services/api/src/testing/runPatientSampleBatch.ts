import { createApp } from "../app";

async function main(): Promise<void> {
  const [sourceBatchId, patientId] = process.argv.slice(2);

  if (!sourceBatchId || !patientId) {
    throw new Error("Usage: tsx src/testing/runPatientSampleBatch.ts <sourceBatchId> <patientId>");
  }

  const app = await createApp();

  try {
    const response = await app.inject({
      method: "POST",
      url: `/api/runs/${sourceBatchId}/sample`,
      payload: {
        patientIds: [patientId],
      },
    });

    const body = response.body.length > 0 ? response.json() : null;
    console.log(
      JSON.stringify(
        {
          statusCode: response.statusCode,
          body,
        },
        null,
        2,
      ),
    );

    if (response.statusCode >= 400) {
      process.exitCode = 1;
    }
  } finally {
    await app.close();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown sample batch execution error.");
  process.exitCode = 1;
});
