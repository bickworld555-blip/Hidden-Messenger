import mongoose from "mongoose";
import { logger } from "./logger";

const MAX_CONNECT_ATTEMPTS = 4;
const BASE_RETRY_DELAY_MS = 500;

let connectionAttempt: Promise<boolean> | undefined;

function sleep(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function connectMongoAtlas() {
  const uri = process.env["MONGODB_URI"];
  if (!uri) {
    logger.warn({ subsystem: "mongodb-atlas" }, "MongoDB Atlas is not configured");
    return false;
  }
  if (mongoose.connection.readyState === 1) return true;
  if (connectionAttempt) return connectionAttempt;

  connectionAttempt = (async () => {
    mongoose.set("bufferCommands", false);

    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt += 1) {
      try {
        await mongoose.connect(uri, {
          appName: "HiddenMessengerAPI",
          autoIndex: false,
          connectTimeoutMS: 8_000,
          maxPoolSize: 10,
          retryWrites: true,
          serverSelectionTimeoutMS: 8_000,
          tls: true,
        });
        logger.info({ subsystem: "mongodb-atlas" }, "MongoDB Atlas connected");
        return true;
      } catch (error) {
        const errorName = error instanceof Error ? error.name : "UnknownError";
        logger.warn(
          { subsystem: "mongodb-atlas", attempt, maxAttempts: MAX_CONNECT_ATTEMPTS, errorName },
          "MongoDB Atlas connection attempt failed",
        );
        if (attempt < MAX_CONNECT_ATTEMPTS) {
          await sleep(BASE_RETRY_DELAY_MS * 2 ** (attempt - 1));
        }
      }
    }

    throw new Error("MongoDB Atlas connection failed after retries.");
  })();

  try {
    return await connectionAttempt;
  } finally {
    connectionAttempt = undefined;
  }
}

export function isMongoAtlasConnected() {
  return mongoose.connection.readyState === 1;
}
