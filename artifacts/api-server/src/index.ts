import { createServer } from "node:http";
import app from "./app";
import { logger } from "./lib/logger";
import { attachSignalingGateway } from "./lib/signaling";
import { initializePushTokenPersistence } from "./lib/pushNotifications";
import { connectMongoAtlas } from "./lib/mongo";

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

void connectMongoAtlas().catch((error) => {
  logger.error(
    { subsystem: "mongodb-atlas", errorName: error instanceof Error ? error.name : "UnknownError" },
    "MongoDB Atlas connection could not be established at startup",
  );
});

server.on("error", (err) => {
  logger.error({ err }, "Error listening on port");
  process.exit(1);
});

server.listen(port, () => {
  logger.info({ port }, "Server listening");
});
