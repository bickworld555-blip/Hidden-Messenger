import assert from "node:assert/strict";
import test from "node:test";
import {
  createPushNotificationService,
  derivePushAccountId,
} from "../src/lib/pushNotifications.ts";

process.env.SESSION_SECRET = "test-only-push-token-secret";

const token = (suffix) => `ExponentPushToken[${suffix.padEnd(24, "x").slice(0, 24)}]`;
const account = (suffix) => derivePushAccountId(`88017${suffix.padEnd(8, "0").slice(0, 8)}`, "test-session-secret");

function createMemoryPersistence() {
  const records = new Map();
  const cooldowns = new Map();

  const persistence = {
    records,
    cooldowns,
    async pruneExpired(now) {
      for (const [fingerprint, registration] of records) {
        if (registration.expiresAt <= now) records.delete(fingerprint);
      }
    },
    async pruneExpiredTestCooldowns(now) {
      for (const [accountId, expiresAt] of cooldowns) {
        if (expiresAt <= now) cooldowns.delete(accountId);
      }
    },
    async claimTestCooldown(accountId, now, cooldownMs) {
      await persistence.pruneExpiredTestCooldowns(now);
      const expiresAt = cooldowns.get(accountId) ?? 0;
      if (expiresAt > now) return false;
      cooldowns.set(accountId, now + cooldownMs);
      return true;
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
    async listDeviceRegistrations(accountId, now) {
      await persistence.pruneExpired(now);
      return [...records.values()]
        .filter((registration) => registration.accountId === accountId)
        .map(({ tokenFingerprint, expiresAt }) => ({ tokenFingerprint, expiresAt }));
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
  assert.equal(stored.encryptedToken !== pushToken, true);
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
  assert.equal(requestBody[0].to === pushToken, true);
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

test("delayed DeviceNotRegistered receipts remove the device registration", async () => {
  const persistence = createMemoryPersistence();
  const accountId = account("delayed-receipt");
  const pushToken = token("delayed-device");
  let resolveRemoved;
  const removed = new Promise((resolve) => {
    resolveRemoved = resolve;
  });
  const remove = persistence.remove;
  persistence.remove = async (registeredAccountId, fingerprint) => {
    await remove(registeredAccountId, fingerprint);
    resolveRemoved();
  };
  const service = createPushNotificationService(persistence, {
    receiptCheckDelayMs: 0,
    retrySleep: async () => {},
  });
  await service.registerExpoPushToken(accountId, pushToken, Date.now() + 60_000);

  let sendCount = 0;
  let receiptCount = 0;
  const result = await service.sendGenericPushNotification({
    accountId,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (url, init) => {
    if (url.endsWith("/push/send")) {
      sendCount += 1;
      return makeFetchResponse({ status: "ok", id: "delayed-ticket" });
    }
    assert.equal(url, "https://exp.host/--/api/v2/push/getReceipts");
    receiptCount += 1;
    assert.deepEqual(JSON.parse(init.body), { ids: ["delayed-ticket"] });
    return new Response(JSON.stringify({
      data: {
        "delayed-ticket": {
          status: "error",
          details: { error: "DeviceNotRegistered" },
        },
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(result, { acceptedCount: 1, tokenCount: 1 });
  await Promise.race([
    removed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("receipt cleanup timed out")), 1_000)),
  ]);
  assert.equal(sendCount, 1);
  assert.equal(receiptCount, 1);
  assert.equal(persistence.records.size, 0);
});

test("an immediate rejection removes only its device while siblings remain deliverable", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const accountId = account("mixed-immediate");
  const rejectedToken = token("immediate-rejected");
  const healthyToken = token("immediate-healthy");
  await service.registerExpoPushToken(accountId, rejectedToken, Date.now() + 60_000);
  await service.registerExpoPushToken(accountId, healthyToken, Date.now() + 60_000);

  const firstResult = await service.sendGenericPushNotification({
    accountId,
    type: "message",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (_url, init) => {
    const messages = JSON.parse(init.body);
    assert.deepEqual(messages.map((message) => message.to === rejectedToken), [true, false]);
    assert.deepEqual(messages.map((message) => message.to === healthyToken), [false, true]);
    assert.ok(messages.every((message) => message.body === "New message"));
    return new Response(JSON.stringify({
      data: [
        { status: "error", details: { error: "DeviceNotRegistered" } },
        { status: "ok" },
      ],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(firstResult, { acceptedCount: 1, tokenCount: 2 });
  assert.equal(persistence.records.size, 1);

  const nextResult = await service.sendGenericPushNotification({
    accountId,
    type: "message",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (_url, init) => {
    const messages = JSON.parse(init.body);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to === rejectedToken, false);
    assert.equal(messages[0].to === healthyToken, true);
    return makeFetchResponse({ status: "ok" });
  });

  assert.deepEqual(nextResult, { acceptedCount: 1, tokenCount: 1 });
});

test("delayed receipts remove only the matching failed device", async () => {
  const persistence = createMemoryPersistence();
  const accountId = account("mixed-receipts");
  const rejectedToken = token("receipt-rejected");
  const healthyToken = token("receipt-healthy");
  let resolveRemoved;
  const removed = new Promise((resolve) => {
    resolveRemoved = resolve;
  });
  const remove = persistence.remove;
  persistence.remove = async (registeredAccountId, fingerprint) => {
    await remove(registeredAccountId, fingerprint);
    resolveRemoved();
  };
  const service = createPushNotificationService(persistence, {
    receiptCheckDelayMs: 0,
    retrySleep: async () => {},
  });
  await service.registerExpoPushToken(accountId, rejectedToken, Date.now() + 60_000);
  await service.registerExpoPushToken(accountId, healthyToken, Date.now() + 60_000);

  let sendCount = 0;
  let receiptCount = 0;
  const firstResult = await service.sendGenericPushNotification({
    accountId,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (url, init) => {
    if (url.endsWith("/push/send")) {
      sendCount += 1;
      const messages = JSON.parse(init.body);
      assert.deepEqual(messages.map((message) => message.to === rejectedToken), [true, false]);
      assert.deepEqual(messages.map((message) => message.to === healthyToken), [false, true]);
      return new Response(JSON.stringify({
        data: [
          { status: "ok", id: "ticket-rejected-device" },
          { status: "ok", id: "ticket-healthy-device" },
        ],
      }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    assert.equal(url, "https://exp.host/--/api/v2/push/getReceipts");
    receiptCount += 1;
    assert.deepEqual(JSON.parse(init.body), {
      ids: ["ticket-rejected-device", "ticket-healthy-device"],
    });
    return new Response(JSON.stringify({
      data: {
        "ticket-healthy-device": { status: "ok" },
        "ticket-rejected-device": {
          status: "error",
          details: { error: "DeviceNotRegistered" },
        },
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(firstResult, { acceptedCount: 2, tokenCount: 2 });
  await Promise.race([
    removed,
    new Promise((_, reject) => setTimeout(() => reject(new Error("receipt cleanup timed out")), 1_000)),
  ]);
  assert.equal(sendCount, 1);
  assert.equal(receiptCount, 1);
  assert.equal(persistence.records.size, 1);

  const nextResult = await service.sendGenericPushNotification({
    accountId,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (url, init) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    const messages = JSON.parse(init.body);
    assert.equal(messages.length, 1);
    assert.equal(messages[0].to === rejectedToken, false);
    assert.equal(messages[0].to === healthyToken, true);
    return makeFetchResponse({ status: "ok" });
  });
  assert.deepEqual(nextResult, { acceptedCount: 1, tokenCount: 1 });
});

test("an old account receipt cannot remove a device rebound to another account", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence, {
    receiptCheckDelayMs: 0,
    retrySleep: async () => {},
  });
  const oldAccount = account("old-receipt-owner");
  const newAccount = account("new-receipt-owner");
  const pushToken = token("rebound-device");
  let resolveCleanupAttempt;
  const cleanupAttempted = new Promise((resolve) => {
    resolveCleanupAttempt = resolve;
  });
  const remove = persistence.remove;
  persistence.remove = async (accountId, fingerprint) => {
    await remove(accountId, fingerprint);
    if (accountId === oldAccount) resolveCleanupAttempt();
  };

  await service.registerExpoPushToken(oldAccount, pushToken, Date.now() + 60_000);
  const oldAccountResult = await service.sendGenericPushNotification({
    accountId: oldAccount,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (url) => {
    if (url.endsWith("/push/send")) {
      return makeFetchResponse({ status: "ok", id: "old-account-ticket" });
    }
    return new Response(JSON.stringify({
      data: {
        "old-account-ticket": {
          status: "error",
          details: { error: "DeviceNotRegistered" },
        },
      },
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  await service.registerExpoPushToken(newAccount, pushToken, Date.now() + 60_000);
  assert.deepEqual(oldAccountResult, { acceptedCount: 1, tokenCount: 1 });
  await Promise.race([
    cleanupAttempted,
    new Promise((_, reject) => setTimeout(() => reject(new Error("receipt cleanup timed out")), 1_000)),
  ]);

  assert.equal(persistence.records.size, 1);
  assert.equal([...persistence.records.values()][0].accountId === newAccount, true);

  let deliveredToReboundDevice = false;
  const newAccountResult = await service.sendGenericPushNotification({
    accountId: newAccount,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (_url, init) => {
    const messages = JSON.parse(init.body);
    deliveredToReboundDevice =
      messages.length === 1 && messages[0].to === pushToken;
    return makeFetchResponse({ status: "ok" });
  });

  assert.deepEqual(newAccountResult, { acceptedCount: 1, tokenCount: 1 });
  assert.equal(deliveredToReboundDevice, true);
  assert.deepEqual(await service.sendGenericPushNotification({
    accountId: oldAccount,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    assert.fail("The previous account must no longer receive this device's alerts");
  }), { acceptedCount: 0, tokenCount: 0 });
});

test("429 provider responses retry twice with bounded deterministic delays", async () => {
  const persistence = createMemoryPersistence();
  const accountId = account("retry-429");
  const service = createPushNotificationService(persistence, {
    retrySleep: async (milliseconds) => delays.push(milliseconds),
  });
  const delays = [];
  await service.registerExpoPushToken(accountId, token("retry-429-device"), Date.now() + 60_000);

  let attempts = 0;
  const result = await service.sendGenericPushNotification({
    accountId,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    attempts += 1;
    return attempts < 3
      ? new Response(null, { status: 429 })
      : makeFetchResponse({ status: "ok" });
  });

  assert.deepEqual(result, { acceptedCount: 1, tokenCount: 1 });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("repeated server errors stop after three attempts with a generic error", async () => {
  const persistence = createMemoryPersistence();
  const accountId = account("retry-5xx");
  const delays = [];
  const service = createPushNotificationService(persistence, {
    retrySleep: async (milliseconds) => delays.push(milliseconds),
  });
  await service.registerExpoPushToken(accountId, token("retry-5xx-device"), Date.now() + 60_000);

  let attempts = 0;
  await assert.rejects(service.sendGenericPushNotification({
    accountId,
    type: "message",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    attempts += 1;
    return new Response(null, { status: 503 });
  }), { message: "The push provider could not accept the alert." });
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [250, 500]);
});

test("provider failures do not expose device tokens or message text", async () => {
  const persistence = createMemoryPersistence();
  const accountId = account("generic-errors");
  const pushToken = token("generic-error-device");
  const privateText = "synthetic private message text";
  const service = createPushNotificationService(persistence, {
    retrySleep: async () => {},
  });
  await service.registerExpoPushToken(accountId, pushToken, Date.now() + 60_000);

  await assert.rejects(service.sendGenericPushNotification({
    accountId,
    type: "message",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    throw new Error(`${pushToken} ${privateText}`);
  }), (error) => {
    assert.equal(error.message, "The push provider is temporarily unavailable.");
    assert.equal(error.message.includes(pushToken), false);
    assert.equal(error.message.includes(privateText), false);
    return true;
  });
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

test("users can revoke one opaque push device without affecting sibling devices", async () => {
  const persistence = createMemoryPersistence();
  const service = createPushNotificationService(persistence);
  const accountId = account("device-management");
  const otherAccount = account("different-account");
  const revokedToken = token("managed-device-one");
  const retainedToken = token("managed-device-two");

  await service.registerExpoPushToken(accountId, revokedToken, Date.now() + 60_000);
  await service.registerExpoPushToken(accountId, retainedToken, Date.now() + 60_000);
  const devices = await service.listRegisteredPushDevices(accountId);
  assert.equal(devices.length, 2);
  assert.equal(devices.every((device) => /^[A-Za-z0-9_-]{43}$/.test(device.deviceId)), true);
  assert.equal(devices.every((device) => Number.isFinite(Date.parse(device.expiresAt))), true);
  assert.equal(devices.every((device) => !("token" in device)), true);
  assert.equal(JSON.stringify(devices).includes(revokedToken), false);
  assert.equal(JSON.stringify(devices).includes(retainedToken), false);

  const revokedDeviceId = await service.getPushDeviceIdForToken(accountId, revokedToken);
  const retainedDeviceId = await service.getPushDeviceIdForToken(accountId, retainedToken);
  assert.equal(devices.some((device) => device.deviceId === revokedDeviceId), true);
  assert.equal(await service.revokePushDevice(otherAccount, revokedDeviceId), false);
  assert.equal((await service.listRegisteredPushDevices(accountId)).length, 2);
  assert.equal(await service.revokePushDevice(accountId, revokedDeviceId), true);

  const remainingDevices = await service.listRegisteredPushDevices(accountId);
  assert.equal(remainingDevices.length, 1);
  assert.equal(remainingDevices[0].deviceId === retainedDeviceId, true);

  let deliveredOnlyToRetainedDevice = false;
  const result = await service.sendGenericPushNotification({
    accountId,
    type: "test",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async (_url, init) => {
    const messages = JSON.parse(init.body);
    deliveredOnlyToRetainedDevice =
      messages.length === 1 && messages[0].to === retainedToken;
    return new Response(JSON.stringify({ data: [{ status: "ok" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });

  assert.deepEqual(result, { acceptedCount: 1, tokenCount: 1 });
  assert.equal(deliveredOnlyToRetainedDevice, true);
  assert.equal(await service.revokePushDevice(accountId, revokedDeviceId), false);
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

test("test cooldown survives service restarts and expires", async () => {
  const persistence = createMemoryPersistence();
  const accountId = account("test-limit");
  const now = Date.now();
  const firstService = createPushNotificationService(persistence);
  assert.equal(await firstService.allowPushTest(accountId, now), true);

  assert.deepEqual([...persistence.cooldowns.entries()].map(([id, expiresAt]) => [
    id === accountId,
    expiresAt === now + 30_000,
  ]), [[true, true]]);

  const restartedService = createPushNotificationService(persistence);
  assert.equal(await restartedService.allowPushTest(accountId, now + 29_999), false);
  assert.equal(await restartedService.allowPushTest(accountId, now + 30_000), true);
});

test("simultaneous test requests claim only one cooldown", async () => {
  const persistence = createMemoryPersistence();
  const accountId = account("parallel-test-limit");
  const now = Date.now();
  const services = [
    createPushNotificationService(persistence),
    createPushNotificationService(persistence),
  ];
  const results = await Promise.all(
    services.map((service) => service.allowPushTest(accountId, now)),
  );
  assert.deepEqual(results.sort(), [false, true]);
});
