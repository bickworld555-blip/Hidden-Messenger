import { randomUUID } from "node:crypto";
import mongoose from "mongoose";

const uri = process.env["MONGODB_URI"];
if (!uri) {
  console.error("MONGODB_URI is required to run the Atlas connectivity check.");
  process.exit(1);
}

const collectionName = "atlas_connectivity_probes";
const probeId = randomUUID();
let connected = false;

try {
  await mongoose.connect(uri, {
    appName: "HiddenMessengerAtlasCheck",
    connectTimeoutMS: 8_000,
    serverSelectionTimeoutMS: 8_000,
  });
  connected = true;

  const collection = mongoose.connection.collection(collectionName);
  await collection.insertOne({ _id: probeId, checkedAt: new Date() });
  const found = await collection.findOne({ _id: probeId }, { projection: { _id: 1 } });
  if (!found) throw new Error("Atlas probe read did not return the written record.");

  const deleted = await collection.deleteOne({ _id: probeId });
  if (deleted.deletedCount !== 1) {
    throw new Error("Atlas probe cleanup did not remove the temporary record.");
  }

  console.info("MongoDB Atlas connectivity and read/write/delete checks passed.");
} catch (error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`MongoDB Atlas connectivity check failed (${name}).`);
  process.exitCode = 1;
} finally {
  if (connected) {
    await mongoose.connection.collection(collectionName).deleteOne({ _id: probeId }).catch(() => undefined);
    await mongoose.disconnect();
  }
}
