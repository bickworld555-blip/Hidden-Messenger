import assert from "node:assert/strict";
import test from "node:test";
import {
  allowPushTest,
  derivePushAccountId,
  registerExpoPushToken,
  revokeExpoPushToken,
  sendGenericPushNotification,
} from "../src/lib/pushNotifications.ts";

const token = (suffix) => `ExponentPushToken[${suffix.padEnd(24, "x").slice(0, 24)}]`;
const account = (suffix) => derivePushAccountId(`88017${suffix.padEnd(8, "0").slice(0, 8)}`, "test-session-secret");

test("push account identifiers are opaque and stable", () => {
  const id = account("12345678");
  assert.match(id, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(id, account("12345678"));
  assert.notEqual(id, "8801712345678");
  assert.notEqual(id, account("87654321"));
});

test("sender transmits only generic copy and opaque routing metadata", async () => {
  const accountId = account("message");
  const pushToken = token("message-device");
  assert.equal(registerExpoPushToken(accountId, pushToken, Date.now() + 60_000), true);

  let requestBody;
  const fetcher = async (url, init) => {
    assert.equal(url, "https://exp.host/--/api/v2/push/send");
    requestBody = JSON.parse(init.body);
    return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket-1" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  const result = await sendGenericPushNotification({
    accountId,
    type: "message",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, fetcher);

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
  const accountId = account("call-alert");
  assert.equal(registerExpoPushToken(accountId, token("call-device"), Date.now() + 60_000), true);
  let sent;
  await sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "d9b2c1a7e6f84350a1bc9876def01234",
  }, async (_, init) => {
    sent = JSON.parse(init.body)[0];
    return new Response(JSON.stringify({ data: [{ status: "ok", id: "ticket-call" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  assert.equal(sent.body, "Incoming call");
  assert.equal(sent.ttl, 60);
  assert.deepEqual(Object.keys(sent.data).sort(), ["accountId", "routeId", "type"]);
  assert.equal("joinToken" in sent.data, false);
  assert.equal("invite" in sent.data, false);
});

test("revoked and expired tokens are not sent", async () => {
  const accountId = account("revoked");
  const revokedToken = token("revoked-device");
  const expiredToken = token("expired-device");
  assert.equal(registerExpoPushToken(accountId, revokedToken, Date.now() + 60_000), true);
  assert.equal(revokeExpoPushToken(accountId, revokedToken), true);
  assert.equal(registerExpoPushToken(accountId, expiredToken, Date.now() - 1), true);
  const result = await sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    assert.fail("No request should be sent without active tokens");
  });
  assert.deepEqual(result, { acceptedCount: 0, tokenCount: 0 });
});

test("DeviceNotRegistered provider tickets remove stale tokens", async () => {
  const accountId = account("stale");
  const pushToken = token("stale-device");
  assert.equal(registerExpoPushToken(accountId, pushToken, Date.now() + 60_000), true);

  const result = await sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => new Response(JSON.stringify({
    data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
  }), { status: 200, headers: { "content-type": "application/json" } }));

  assert.deepEqual(result, { acceptedCount: 0, tokenCount: 1 });
  assert.deepEqual(await sendGenericPushNotification({
    accountId,
    type: "call",
    routeId: "f47ac10b58cc4372a5670e02b2c3d479",
  }, async () => {
    assert.fail("Stale token must be pruned");
  }), { acceptedCount: 0, tokenCount: 0 });
});

test("test alerts are rate limited per account", () => {
  const accountId = account("test-limit");
  assert.equal(allowPushTest(accountId), true);
  assert.equal(allowPushTest(accountId), false);
});
