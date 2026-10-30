import assert from "node:assert/strict";
import test from "node:test";
import { PostgresPushTokenPersistence } from "../src/lib/pushTokenPersistence.ts";
import {
  createPushNotificationService,
  derivePushAccountId,
} from "../src/lib/pushNotifications.ts";

const enabled = process.env.RUN_PUSH_TOKEN_DB_INTEGRATION === "1";

test("a registration survives a service restart using the shared database", {
  skip: !enabled,
}, async () => {
  assert.ok(process.env.SESSION_SECRET, "SESSION_SECRET must be configured");
  const persistence = new PostgresPushTokenPersistence();
  const accountId = derivePushAccountId(
    "8801700000000",
    process.env.SESSION_SECRET,
  );
  const pushToken = `ExponentPushToken[integration-test-${process.pid}-${Date.now()}]`;
  const expiresAt = Date.now() + 60_000;
  const firstService = createPushNotificationService(persistence);

  try {
    assert.equal(
      await firstService.registerExpoPushToken(accountId, pushToken, expiresAt),
      true,
    );

    const restartedService = createPushNotificationService(
      new PostgresPushTokenPersistence(),
    );
    let sentPayload;
    const result = await restartedService.sendGenericPushNotification({
      accountId,
      type: "test",
      routeId: "f47ac10b58cc4372a5670e02b2c3d479",
    }, async (_url, init) => {
      sentPayload = JSON.parse(init.body);
      return new Response(JSON.stringify({ data: [{ status: "ok" }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    assert.deepEqual(result, { acceptedCount: 1, tokenCount: 1 });
    assert.equal(sentPayload[0].to === pushToken, true);
    assert.equal(sentPayload[0].body, "Notifications are enabled");
  } finally {
    await firstService.revokeExpoPushToken(accountId, pushToken);
  }
});
