import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachSignalingGateway } from "./lib/signaling";
import { initializePushTokenPersistence } from "./lib/pushNotifications";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const server = createServer(app);
attachSignalingGateway(server);

void initializePushTokenPersistence().catch(() => {
  logger.warn(
    { subsystem: "push-token-registry" },
    "Could not prune expired push registrations at startup",
  );
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
