import { createServer } from "node:http";
import { createLogger } from "@medical-ai-qa/shared-logging";
import { getHealthPayload } from "./health";

const port = Number(process.env.API_PORT ?? "3000");
const logger = createLogger({ service: "api" });

const server = createServer((_request, response) => {
  const payload = JSON.stringify(getHealthPayload());
  response.writeHead(200, { "content-type": "application/json" });
  response.end(payload);
});

server.listen(port, () => {
  logger.info("API listening.", { port });
});
