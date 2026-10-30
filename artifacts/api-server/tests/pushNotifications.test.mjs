import assert from "node:assert/strict";
import test from "node:test";
import {
  allowPushTest,
  createPushNotificationService,
  derivePushAccountId,
} from "../src/lib/pushNotifications.ts";

process.env.SESSION_SECRET = "test-only-push-token-secret";

const token = (suffix) => `ExponentPushToken[${suffix.padEnd(24, "x").slice(0, 24)}]`;
const account = (suffix) => derivePushAccountId(`88017${suffix.padEnd(8, "0").slice(0, 8)}`, "test-session-secret");

function createMemoryPersistence() {
  const records = new Map();

  const persistence = {
    records,
    async pruneExpired(now) {
      for (const [fingerprint, registration] of records) {
        if (registration.expiresAt <= now) records.delete(fingerprint);
      }
    },
    async register(registration, now, limits) {
      await persistence.pruneExpired(now);
      const accountExists = [...records.values()].some(
        (value) => value.accountId === registration.accountId,
      );
      const accountCount = new Set([...records.values()].map((value) => value.accountId)).size;
      if (!accountExists && accountCount >= limits.maxAccounts) return false;
      const deviceCount = [...records.values()].filter(
        (value) =>
          value.accountId === registration.accountId &&
          value.tokenFingerprint !== registration.tokenFingerprint,
      ).length;
      if (deviceCount >= limits.maxTokensPerAccount) return false;
      records.set(registration.tokenFingerprint, { ...registration });
      return true;
    },
    async listActive(accountId, now) {
      await persistence.pruneExpired(now);
      return [...records.values()]
        .filter((registration) => registration.accountId === accountId)
        .map(({ tokenFingerprint, encryptedToken }) => ({ tokenFingerprint, encryptedToken }));
    },
    async remove(accountId, tokenFingerprint) {
      if (records.get(tokenFingerprint)?.accountId === accountId) {
        records.delete(tokenFingerprint);
      }
    },
  };

  return persistence;
}

function makeFetchResponse(ticket) {
  return new Response(JSON.stringify({ data: [ticket] }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

test("push account identifiers are opaque and stable", () => {
  const id = account("12345678");
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(id, account("12345678"));
  assert.notEqual(id, "8801712345678");
  assert.notEqual(id, account("87654321"));
});

test("encrypted registrations are available to a new service instance after restart", async () => {
  const persistence = createMemoryPersistence();
  const firstService = createPushNotificationService(persistence);
  const accountId = account("message");
  const pushToken = token("message-device");
  assert.equal(
    await firstService.registerExpoPushToken(accountId, pushToken, Date.now() + 60_000),
    true,
  );

  const stored = [...persistence.records.values()][0];
  assert.notEqual(stored.encryptedToken, pushToken);
  assert.match(stored.encryptedToken, /^v1\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);

  let requestBody;
  const restartedService = createPushNotificationService(persistence);
  const result = await restartedService.sendGenericPushNotification({
    accountId,
    type: "message",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (url, init) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    requestBody = JSON.parse(init.body);
    return makeFetchResponse({ status: "ok", id: "ticket-1" });
  });

  assert.deepEqual(result, { acceptedCount: 1, tokenCount: 1 });
  assert.equal(requestBody.length, 1);
  assert.equal(requestBody[0].to, pushToken);
  assert.equal(requestBody[0].title, "Hidden Messenger");
  assert.equal(requestBody[0].body, "New message");
  assert.deepEqual(requestBody[0].data, {
    type: "message",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
    accountId,
  });
  assert.equal("phone" in requestBody[0].data, false);
  assert.equal("text" in requestBody[0].data, false);
  assert.equal("media" in requestBody[0].data, false);
  assert.equal("key" in requestBody[0].data, false);
});

test("call alerts use short expiry and never carry call bearer credentials", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const accountId = account("call-alert");
  assert.equal(
    await service.registerExpoPushToken(accountId, token("call-device"), Date.now() + 60_000),
    true,
  );
  let sent;
  await service.sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "d9b2c1a7e6f84350a1bc9876def01234",
  }, async (_, init) => {
    sent = JSON.parse(init.body)[0];
    return makeFetchResponse({ status: "ok", id: "ticket-call" });
  });
  assert.equal(sent.body, "Incoming call");
  assert.equal(sent.ttl, 60);
  assert.deepEqual(Object.keys(sent.data).sort(), ["accountId", "routeId", "type"]);
  assert.equal("joinToken" in sent.data, false);
  assert.equal("invite" in sent.data, false);
});

test("revoked and expired registrations are removed and not sent", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const accountId = account("revoked");
  const revokedToken = token("revoked-device");
  assert.equal(
    await service.registerExpoPushToken(accountId, revokedToken, Date.now() + 60_000),
    true,
  );
  assert.equal(await service.revokeExpoPushToken(accountId, revokedToken), true);
  assert.equal(persistence.records.size, 0);
  assert.equal(
    await service.registerExpoPushToken(accountId, token("expired-device"), Date.now() - 1),
    false,
  );
  const result = await service.sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    assert.fail("No request should be sent without active tokens");
  });
  assert.deepEqual(result, { acceptedCount: 0, tokenCount: 0 });
});

test("a device token is bound to only one signed-in account", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const firstAccount = account("first");
  const secondAccount = account("second");
  const pushToken = token("shared-device");
  assert.equal(
    await service.registerExpoPushToken(firstAccount, pushToken, Date.now() + 60_000),
    true,
  );
  assert.equal(
    await service.registerExpoPushToken(secondAccount, pushToken, Date.now() + 60_000),
    true,
  );

  assert.deepEqual(await service.sendGenericPushNotification({
    accountId: firstAccount,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    assert.fail("The previous account must no longer receive this device's alerts");
  }), { acceptedCount: 0, tokenCount: 0 });

  assert.deepEqual(await service.sendGenericPushNotification({
    accountId: secondAccount,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => makeFetchResponse({ status: "ok" })), {
    acceptedCount: 1,
    tokenCount: 1,
  });
});

test("provider rejection removes stale tokens from persistent storage", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const accountId = account("stale");
  const pushToken = token("stale-device");
  assert.equal(
    await service.registerExpoPushToken(accountId, pushToken, Date.now() + 60_000),
    true,
  );

  const result = await service.sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => makeFetchResponse({
    status: "error",
    details: { error: "DeviceNotRegistered" },
  }));

  assert.deepEqual(result, { acceptedCount: 0, tokenCount: 1 });
  assert.equal(persistence.records.size, 0);
  assert.deepEqual(await service.sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    assert.fail("Stale token must be pruned");
  }), { acceptedCount: 0, tokenCount: 0 });
});

test("tampered encrypted tokens are discarded without a provider send", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const accountId = account("tamper");
  const pushToken = token("tamper-device");
  await service.registerExpoPushToken(accountId, pushToken, Date.now() + 60_000);
  const [fingerprint, record] = [...persistence.records.entries()][0];
  const [version, nonce, tag, ciphertext] = record.encryptedToken.split(".");
  const changedCiphertext = `${ciphertext[0] === "A" ? "B" : "A"}${ciphertext.slice(1)}`;
  persistence.records.set(fingerprint, {
    ...record,
    encryptedToken: [version, nonce, tag, changedCiphertext].join("."),
  });

  const result = await service.sendGenericPushNotification({
    accountId,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    assert.fail("A token with a failed GCM tag must not be sent");
  });
  assert.deepEqual(result, { acceptedCount: 0, tokenCount: 0 });
  assert.equal(persistence.records.size, 0);
});

test("device registration limits are preserved", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const accountId = account("device-limit");
  for (let index = 0; index < 8; index += 1) {
    assert.equal(
      await service.registerExpoPushToken(
        accountId,
        token(`device-${index}`),
        Date.now() + 60_000,
      ),
      true,
    );
  }
  assert.equal(
    await service.registerExpoPushToken(
      accountId,
      token("device-overflow"),
      Date.now() + 60_000,
    ),
    false,
  );
  assert.equal(persistence.records.size, 8);
});

test("test alerts are rate limited per account", () => {
  const accountId = account("test-limit");
  assert.equal(allowPushTest(accountId), true);
  assert.equal(allowPushTest(accountId), false);
});
