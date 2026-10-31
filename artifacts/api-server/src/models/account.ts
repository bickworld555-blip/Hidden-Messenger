import mongoose from "mongoose";

const { model, models, Schema } = mongoose;

const AccountSchema = new Schema(
  {
    _id: { type: String, required: true },
    lastAuthenticatedAt: { type: Date, required: true },
    contactSync: {
      mode: {
        type: String,
        enum: ["local-only"],
        required: true,
        default: "local-only",
      },
      lastMetadataSyncAt: { type: Date, default: null },
    },
  },
  {
    collection: "accounts",
    minimize: false,
    strict: "throw",
    timestamps: true,
    versionKey: false,
  },
);

export const AccountModel =
  models["HiddenMessengerAccount"] ??
  model("HiddenMessengerAccount", AccountSchema);
