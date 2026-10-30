import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import type { PushTokenPersistence } from "./pushTokenPersistence";

const PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const MAX_TOKENS_PER_ACCOUNT = 8;
const PUSH_TEST_COOLDOWN_MS = 30_000;
const PUSH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACCOUNTS = 10_000;
const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

type PushKind = "call" | "message" | "test";
type PushMessage = {
  to: string;
  title: "Hidden Messenger";
  body: "Incoming call" | "New message" | "Notifications are enabled";
  data: { type: PushKind; routeId: string; accountId: string };
  sound: "default";
  priority: "high";
  channelId: "quietlink-alerts";
  ttl: number;
};
type ReceiptRef = { accountId: string; tokenFingerprint: string; ticketId: string };
type PushTokenKeys = { encryption: Buffer; fingerprint: Buffer; deviceId: Buffer };
type PushNotificationServiceOptions = {
  retrySleep?: (milliseconds: number) => Promise<void>;
  receiptCheckDelayMs?: number;
};

const TOKEN_ENVELOPE_VERSION = "v1";
const TOKEN_NONCE_BYTES = 12;
const TOKEN_TAG_BYTES = 16;
const TOKEN_KEY_SALT = Buffer.from("Hidden Messenger push token registry v1");

const accountIdPattern = /^[A-Za-z0-9_-]{43}$/;
const pushDeviceIdPattern = /^[A-Za-z0-9_-]{43}$/;
const pushTokenPattern = /^(?:Expo|Exponent)PushToken\[[A-Za-z0-9_-]{20,240}\]$/;
const routeIdPattern = /^(?:[A-Fa-f0-9]{32}|[a-f0-9-]{36}|[A-Za-z0-9_-]{22,128})$/;

export function derivePushAccountId(phone: string, secret: string) {
  if (!secret) throw new Error("Push account identity is not configured.");
  return createHmac("sha256", secret)
    .update(`Hidden Messenger push account v1\0${phone}`)
    .digest("base64url");
}

export function isExpoPushToken(token: unknown): token is string {
  return typeof token === "string" && token.length <= 256 && pushTokenPattern.test(token);
}

export function isOpaquePushDeviceId(value: unknown): value is string {
  return typeof value === "string" && pushDeviceIdPattern.test(value);
}

export function isOpaquePushRouteId(value: unknown): value is string {
  return typeof value === "string" && routeIdPattern.test(value);
}

function derivePushTokenKeys(): PushTokenKeys {
  const masterSecret = process.env["SESSION_SECRET"];
  if (!masterSecret) throw new Error("Push token encryption is not configured.");
  return {
    encryption: Buffer.from(
      hkdfSync("sha256", masterSecret, TOKEN_KEY_SALT, "aes-256-gcm", 32),
    ),
    fingerprint: Buffer.from(
      hkdfSync("sha256", masterSecret, TOKEN_KEY_SALT, "token-fingerprint", 32),
    ),
    deviceId: Buffer.from(
      hkdfSync("sha256", masterSecret, TOKEN_KEY_SALT, "push-device-id-v1", 32),
    ),
  };
}

function clearPushTokenKeys(keys: PushTokenKeys) {
  keys.encryption.fill(0);
  keys.fingerprint.fill(0);
  keys.deviceId.fill(0);
}

function fingerprintPushToken(token: string, key: Buffer) {
  return createHmac("sha256", key).update(token).digest("hex");
}

function deriveOpaquePushDeviceId(
  accountId: string,
  tokenFingerprint: string,
  key: Buffer,
) {
  return createHmac("sha256", key)
    .update(`Hidden Messenger push device id v1\0${accountId}\0${tokenFingerprint}`)
    .digest("base64url");
}

function pushTokenAad(accountId: string, tokenFingerprint: string) {
  return Buffer.from(JSON.stringify([
    "Hidden Messenger push-token registration v1",
    accountId,
    tokenFingerprint,
  ]));
}

function encryptPushToken(
  token: string,
  accountId: string,
  tokenFingerprint: string,
  key: Buffer,
) {
  const nonce = randomBytes(TOKEN_NONCE_BYTES);
  const aad = pushTokenAad(accountId, tokenFingerprint);
  try {
    const cipher = createCipheriv("aes-256-gcm", key, nonce);
    cipher.setAAD(aad);
    const ciphertext = Buffer.concat([
      cipher.update(token, "utf8"),
      cipher.final(),
    ]);
    return [
      TOKEN_ENVELOPE_VERSION,
      nonce.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  } finally {
    aad.fill(0);
  }
}

function decryptPushToken(
  encryptedToken: string,
  accountId: string,
  tokenFingerprint: string,
  key: Buffer,
) {
  const [version, nonceValue, tagValue, ciphertextValue, ...extra] =
    encryptedToken.split(".");
  const base64UrlPattern = /^[A-Za-z0-9_-]+$/;
  if (
    version !== TOKEN_ENVELOPE_VERSION ||
    extra.length > 0 ||
    !nonceValue ||
    !tagValue ||
    !ciphertextValue ||
    !base64UrlPattern.test(nonceValue) ||
    !base64UrlPattern.test(tagValue) ||
    !base64UrlPattern.test(ciphertextValue)
  ) {
    throw new Error("Stored push registration is invalid.");
  }

  const nonce = Buffer.from(nonceValue, "base64url");
  const tag = Buffer.from(tagValue, "base64url");
  const ciphertext = Buffer.from(ciphertextValue, "base64url");
  if (
    nonce.length !== TOKEN_NONCE_BYTES ||
    tag.length !== TOKEN_TAG_BYTES ||
    ciphertext.length > 256
  ) {
    throw new Error("Stored push registration is invalid.");
  }

  const aad = pushTokenAad(accountId, tokenFingerprint);
  let plaintext: Buffer | null = null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, nonce);
    decipher.setAAD(aad);
    decipher.setAuthTag(tag);
    plaintext = Buffer.concat([
      decipher.update(ciphertext),
      decipher.final(),
    ]);
    const token = plaintext.toString("utf8");
    if (!isExpoPushToken(token)) {
      throw new Error("Stored push registration is invalid.");
    }
    return token;
  } finally {
    plaintext?.fill(0);
    aad.fill(0);
    nonce.fill(0);
    tag.fill(0);
    ciphertext.fill(0);
  }
}

export function createPushNotificationService(
  persistence: PushTokenPersistence,
  options: PushNotificationServiceOptions = {},
) {
  const retrySleep = options.retrySleep ?? sleepFor;
  const receiptCheckDelayMs = options.receiptCheckDelayMs ?? RECEIPT_CHECK_DELAY_MS;

  return {
    async pruneExpiredRegistrations() {
      const now = Date.now();
      await Promise.all([
        persistence.pruneExpired(now),
        persistence.pruneExpiredTestCooldowns(now),
      ]);
    },

    async allowPushTest(accountId: string, now = Date.now()) {
      if (!accountIdPattern.test(accountId)) return false;
      return persistence.claimTestCooldown(accountId, now, PUSH_TEST_COOLDOWN_MS);
    },

    async registerExpoPushToken(accountId: string, token: string, expiresAt: number) {
      if (
        !accountIdPattern.test(accountId) ||
        !isExpoPushToken(token) ||
        !Number.isFinite(expiresAt)
      ) return false;
      const now = Date.now();
      const boundedExpiresAt = Math.min(expiresAt, now + PUSH_TOKEN_TTL_MS);
      if (boundedExpiresAt <= now) return false;

      const keys = derivePushTokenKeys();
      try {
        const tokenFingerprint = fingerprintPushToken(token, keys.fingerprint);
        const encryptedToken = encryptPushToken(
          token,
          accountId,
          tokenFingerprint,
          keys.encryption,
        );
        await persistence.pruneExpired(now);
        return await persistence.register({
          accountId,
          tokenFingerprint,
          encryptedToken,
          expiresAt: boundedExpiresAt,
        }, now, {
          maxTokensPerAccount: MAX_TOKENS_PER_ACCOUNT,
          maxAccounts: MAX_ACCOUNTS,
        });
      } finally {
        clearPushTokenKeys(keys);
      }
    },

    async getPushDeviceIdForToken(accountId: string, token: string) {
      if (!accountIdPattern.test(accountId) || !isExpoPushToken(token)) return null;
      const keys = derivePushTokenKeys();
      try {
        const tokenFingerprint = fingerprintPushToken(token, keys.fingerprint);
        return deriveOpaquePushDeviceId(accountId, tokenFingerprint, keys.deviceId);
      } finally {
        clearPushTokenKeys(keys);
      }
    },

    async listRegisteredPushDevices(accountId: string, now = Date.now()) {
      if (!accountIdPattern.test(accountId)) return [];
      const registrations = await persistence.listDeviceRegistrations(accountId, now);
      const keys = derivePushTokenKeys();
      try {
        return registrations.map(({ tokenFingerprint, expiresAt }) => ({
          deviceId: deriveOpaquePushDeviceId(accountId, tokenFingerprint, keys.deviceId),
          expiresAt: new Date(expiresAt).toISOString(),
        }));
      } finally {
        clearPushTokenKeys(keys);
      }
    },

    async revokePushDevice(accountId: string, deviceId: string, now = Date.now()) {
      if (!accountIdPattern.test(accountId) || !isOpaquePushDeviceId(deviceId)) return false;
      const registrations = await persistence.listDeviceRegistrations(accountId, now);
      const keys = derivePushTokenKeys();
      try {
        const match = registrations.find(({ tokenFingerprint }) =>
          deriveOpaquePushDeviceId(accountId, tokenFingerprint, keys.deviceId) === deviceId);
        if (!match) return false;
        await persistence.remove(accountId, match.tokenFingerprint);
        return true;
      } finally {
        clearPushTokenKeys(keys);
      }
    },

    async revokeExpoPushToken(accountId: string, token: string) {
      if (!accountIdPattern.test(accountId) || !isExpoPushToken(token)) return false;
      const keys = derivePushTokenKeys();
      try {
        const tokenFingerprint = fingerprintPushToken(token, keys.fingerprint);
        await persistence.remove(accountId, tokenFingerprint);
        return true;
      } finally {
        clearPushTokenKeys(keys);
      }
    },

    async sendGenericPushNotification(
      input: { accountId: string; type: PushKind; routeId: string },
      fetcher: typeof fetch = fetch,
    ) {
      if (
        !accountIdPattern.test(input.accountId) ||
        !isOpaquePushRouteId(input.routeId) ||
        !["call", "message", "test"].includes(input.type)
      ) {
        throw new Error("The notification route is invalid.");
      }

      const now = Date.now();
      await persistence.pruneExpired(now);
      const registrations = await persistence.listActive(input.accountId, now);
      if (!registrations.length) return { acceptedCount: 0, tokenCount: 0 };

      const keys = derivePushTokenKeys();
      const tokens: Array<{ value: string; fingerprint: string }> = [];
      try {
        for (const registration of registrations) {
          try {
            tokens.push({
              value: decryptPushToken(
                registration.encryptedToken,
                input.accountId,
                registration.tokenFingerprint,
                keys.encryption,
              ),
              fingerprint: registration.tokenFingerprint,
            });
          } catch {
            await persistence.remove(input.accountId, registration.tokenFingerprint).catch(() => undefined);
          }
        }
      } finally {
        clearPushTokenKeys(keys);
      }
      if (!tokens.length) return { acceptedCount: 0, tokenCount: 0 };

      const messages: PushMessage[] = tokens.map(({ value }) => ({
        to: value,
        title: "Hidden Messenger",
        body: input.type === "call"
          ? "Incoming call"
          : input.type === "message"
            ? "New message"
            : "Notifications are enabled",
        data: {
          type: input.type,
          routeId: input.routeId,
          accountId: input.accountId,
        },
        sound: "default",
        priority: "high",
        channelId: "quietlink-alerts",
        ttl: input.type === "message" ? 3_600 : 60,
      }));

      const headers: Record<string, string> = {
        accept: "application/json",
        "content-type": "application/json",
      };
      const accessToken = process.env["EXPO_ACCESS_TOKEN"];
      if (accessToken) headers.authorization = `Bearer ${accessToken}`;

      const response = await postToExpo(PUSH_ENDPOINT, messages, headers, fetcher, retrySleep);
      const payload = await response.json().catch(() => null);
      const tickets =
        payload && typeof payload === "object" && "data" in payload && Array.isArray(payload.data)
          ? payload.data as Array<Record<string, unknown>>
          : null;
      if (!tickets || tickets.length !== tokens.length) {
        throw new Error("The push provider returned an invalid response.");
      }

      let acceptedCount = 0;
      const receiptRefs: ReceiptRef[] = [];
      for (const [index, ticket] of tickets.entries()) {
        if (ticket.status === "ok") {
          acceptedCount += 1;
          if (typeof ticket.id === "string") {
            receiptRefs.push({
              accountId: input.accountId,
              tokenFingerprint: tokens[index].fingerprint,
              ticketId: ticket.id,
            });
          }
          continue;
        }
        const details = ticket.details;
        if (
          details &&
          typeof details === "object" &&
          "error" in details &&
          details.error === "DeviceNotRegistered"
        ) {
          await persistence.remove(input.accountId, tokens[index].fingerprint).catch(() => undefined);
        }
      }
      if (receiptRefs.length) {
        scheduleReceiptCheck(
          receiptRefs,
          persistence,
          headers,
          fetcher,
          retrySleep,
          receiptCheckDelayMs,
        );
      }
      return { acceptedCount, tokenCount: tokens.length };
    },
  };
}

type PushNotificationService = ReturnType<typeof createPushNotificationService>;
let persistentPushServicePromise: Promise<PushNotificationService> | null = null;

async function getPersistentPushService() {
  if (!persistentPushServicePromise) {
    persistentPushServicePromise = import("./pushTokenPersistence")
      .then(({ PostgresPushTokenPersistence }) =>
        createPushNotificationService(new PostgresPushTokenPersistence()))
      .catch((error: unknown) => {
        persistentPushServicePromise = null;
        throw error;
      });
  }
  return persistentPushServicePromise;
}

export async function initializePushTokenPersistence() {
  const service = await getPersistentPushService();
  await service.pruneExpiredRegistrations();
}

export async function allowPushTest(accountId: string) {
  if (!accountIdPattern.test(accountId)) return false;
  return (await getPersistentPushService()).allowPushTest(accountId);
}

export async function registerExpoPushToken(accountId: string, token: string, expiresAt: number) {
  return (await getPersistentPushService()).registerExpoPushToken(accountId, token, expiresAt);
}

export async function getPushDeviceIdForToken(accountId: string, token: string) {
  return (await getPersistentPushService()).getPushDeviceIdForToken(accountId, token);
}

export async function listRegisteredPushDevices(accountId: string) {
  return (await getPersistentPushService()).listRegisteredPushDevices(accountId);
}

export async function revokePushDevice(accountId: string, deviceId: string) {
  return (await getPersistentPushService()).revokePushDevice(accountId, deviceId);
}

export async function revokeExpoPushToken(accountId: string, token: string) {
  return (await getPersistentPushService()).revokeExpoPushToken(accountId, token);
}

export async function sendGenericPushNotification(
  input: { accountId: string; type: PushKind; routeId: string },
  fetcher: typeof fetch = fetch,
) {
  return (await getPersistentPushService()).sendGenericPushNotification(input, fetcher);
}

function sleepFor(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}

async function postToExpo(
  url: string,
  body: unknown,
  headers: Record<string, string>,
  fetcher: typeof fetch,
  retrySleep: (milliseconds: number) => Promise<void>,
) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(8_000),
      });
      if (response.ok) return response;
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt === 2) {
        throw new Error("The push provider could not accept the alert.");
      }
    } catch (error) {
      if (error instanceof Error && error.message === "The push provider could not accept the alert.") throw error;
      if (attempt === 2) {
        throw new Error("The push provider is temporarily unavailable.");
      }
    }
    await retrySleep(250 * 2 ** attempt);
  }
  throw new Error("The push provider is temporarily unavailable.");
}

function scheduleReceiptCheck(
  receipts: ReceiptRef[],
  persistence: PushTokenPersistence,
  headers: Record<string, string>,
  fetcher: typeof fetch,
  retrySleep: (milliseconds: number) => Promise<void>,
  delayMs: number,
) {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const response = await postToExpo(
          "https://exp.host/--/api/v2/push/getReceipts",
          { ids: receipts.map((receipt) => receipt.ticketId) },
          headers,
          fetcher,
          retrySleep,
        );
        const payload = await response.json().catch(() => null);
        const data =
          payload && typeof payload === "object" && "data" in payload && payload.data && typeof payload.data === "object"
            ? payload.data as Record<string, Record<string, unknown>>
            : null;
        if (!data) return;
        for (const receipt of receipts) {
          const details = data[receipt.ticketId]?.details;
          if (
            details &&
            typeof details === "object" &&
            "error" in details &&
            details.error === "DeviceNotRegistered"
          ) {
            await persistence.remove(receipt.accountId, receipt.tokenFingerprint).catch(() => undefined);
          }
        }
      } catch {
        // Receipt lookup errors do not expose notification payloads.
      }
    })();
  }, delayMs);
  timer.unref?.();
}
