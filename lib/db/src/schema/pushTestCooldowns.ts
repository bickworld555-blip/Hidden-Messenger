import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { index, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const pushTestCooldownsTable = pgTable(
  "push_test_cooldowns",
  {
    accountId: text("account_id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    expiryIndex: index("push_test_cooldowns_expiry_idx").on(table.expiresAt),
  }),
);

export const insertPushTestCooldownSchema = createInsertSchema(pushTestCooldownsTable);
export type InsertPushTestCooldown = z.infer<typeof insertPushTestCooldownSchema>;
export type PushTestCooldown = typeof pushTestCooldownsTable.$inferSelect;
