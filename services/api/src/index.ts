import { createApp } from "./app";
import { loadEnv } from "./config/env";

async function main(): Promise<void> {
  const env = loadEnv();
  const app = await createApp();

  await app.listen({
    host: env.API_HOST,
    port: env.API_PORT,
  });
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Unknown API startup error.");
  process.exitCode = 1;
});
