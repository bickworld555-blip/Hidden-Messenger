import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const pushDeviceRegistrationsTable = pgTable(
  "push_device_registrations",
  {
    tokenFingerprint: text("token_fingerprint").primaryKey(),
    accountId: text("account_id").notNull(),
    encryptedToken: text("encrypted_token").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    accountIndex: index("push_device_registrations_account_idx").on(table.accountId),
    expiryIndex: index("push_device_registrations_expiry_idx").on(table.expiresAt),
  }),
);

export const insertPushDeviceRegistrationSchema =
  createInsertSchema(pushDeviceRegistrationsTable);
export type InsertPushDeviceRegistration = z.infer<
  typeof insertPushDeviceRegistrationSchema
>;
export type PushDeviceRegistration =
  typeof pushDeviceRegistrationsTable.$inferSelect;
