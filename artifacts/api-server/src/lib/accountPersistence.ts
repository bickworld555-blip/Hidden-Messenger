import { AccountModel } from "../models/account";
import { connectMongoAtlas, isMongoAtlasConnected } from "./mongo";

export async function persistVerifiedAccount(
  accountId: string,
  authenticatedAt: Date,
) {
  const connected = await connectMongoAtlas();
  if (!connected || !isMongoAtlasConnected()) {
    throw new Error("MongoDB Atlas is unavailable.");
  }

  await AccountModel.updateOne(
    { _id: accountId },
    {
      $set: { lastAuthenticatedAt: authenticatedAt },
      $setOnInsert: {
        contactSync: {
          mode: "local-only",
          lastMetadataSyncAt: null,
        },
      },
    },
    { upsert: true, runValidators: true },
  ).exec();
}
