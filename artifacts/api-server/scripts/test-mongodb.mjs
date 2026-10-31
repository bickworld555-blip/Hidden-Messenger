import { randomUUID } from "node:crypto";
import mongoose from "mongoose";
import { AccountModel } from "../src/models/account.ts";

const uri = process.env["MONGODB_URI"];
if (!uri) {
  console.error("MONGODB_URI is required to run the Atlas connectivity check.");
  process.exit(1);
}

const probeId = `atlas-probe-${randomUUID()}`;
let connected = false;

try {
  await mongoose.connect(uri, {
    appName: "HiddenMessengerAtlasCheck",
    connectTimeoutMS: 8_000,
    serverSelectionTimeoutMS: 8_000,
    tls: true,
  });
  connected = true;

  await AccountModel.updateOne(
    { _id: probeId },
    {
      $set: { lastAuthenticatedAt: new Date() },
      $setOnInsert: {
        contactSync: { mode: "local-only", lastMetadataSyncAt: null },
      },
    },
    { upsert: true, runValidators: true },
  ).exec();
  const found = await AccountModel.findById(probeId)
    .select("_id lastAuthenticatedAt contactSync.mode")
    .lean()
    .exec();
  if (!found || found.contactSync?.mode !== "local-only") {
    throw new Error("Atlas account schema read did not return the written record.");
  }

  const deleted = await AccountModel.deleteOne({ _id: probeId }).exec();
  if (deleted.deletedCount !== 1) {
    throw new Error("Atlas probe cleanup did not remove the temporary record.");
  }

  console.info("MongoDB Atlas account-schema insert/read/delete checks passed.");
} catch (error) {
  const name = error instanceof Error ? error.name : "UnknownError";
  console.error(`MongoDB Atlas connectivity check failed (${name}).`);
  process.exitCode = 1;
} finally {
  if (connected) {
    await AccountModel.deleteOne({ _id: probeId }).exec().catch(() => undefined);
    await mongoose.disconnect();
  }
}
