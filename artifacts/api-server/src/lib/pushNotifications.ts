import { createHmac } from "node:crypto";

const PUSH_ENDPOINT = "https://exp.host/--/api/v2/push/send";
const MAX_TOKENS_PER_ACCOUNT = 8;
const PUSH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_ACCOUNTS = 10_000;
const RECEIPT_CHECK_DELAY_MS = 15 * 60 * 1000;

type PushKind = "call" | "message" | "test";
type PushRecord = { expiresAt: number };
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
type ReceiptRef = { accountId: string; token: string; ticketId: string };

const tokensByAccount = new Map<string, Map<string, PushRecord>>();
const testCooldowns = new Map<string, number>();

const accountIdPattern = /^[A-Za-z0-9_-]{43}$/;
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

export function isOpaquePushRouteId(value: unknown): value is string {
  return typeof value === "string" && routeIdPattern.test(value);
}

function pruneExpiredTokens(now: number) {
  for (const [accountId, accountTokens] of tokensByAccount) {
    for (const [token, record] of accountTokens) {
      if (record.expiresAt <= now) accountTokens.delete(token);
    }
    if (!accountTokens.size) tokensByAccount.delete(accountId);
  }
  for (const [accountId, retryAt] of testCooldowns) {
    if (retryAt <= now) testCooldowns.delete(accountId);
  }
  if (tokensByAccount.size > MAX_ACCOUNTS) {
    const removeCount = tokensByAccount.size - MAX_ACCOUNTS;
    let removed = 0;
    for (const accountId of tokensByAccount.keys()) {
      tokensByAccount.delete(accountId);
      if (++removed >= removeCount) break;
    }
  }
}

export function registerExpoPushToken(accountId: string, token: string, expiresAt: number) {
  if (!accountIdPattern.test(accountId) || !isExpoPushToken(token)) return false;
  const now = Date.now();
  pruneExpiredTokens(now);
  const accountTokens = tokensByAccount.get(accountId) ?? new Map<string, PushRecord>();
  if (!accountTokens.has(token) && accountTokens.size >= MAX_TOKENS_PER_ACCOUNT) return false;
  accountTokens.set(token, {
    expiresAt: Math.min(expiresAt, now + PUSH_TOKEN_TTL_MS),
  });
  tokensByAccount.set(accountId, accountTokens);
  return true;
}

export function revokeExpoPushToken(accountId: string, token: string) {
  if (!accountIdPattern.test(accountId) || !isExpoPushToken(token)) return false;
  const accountTokens = tokensByAccount.get(accountId);
  if (!accountTokens) return true;
  accountTokens.delete(token);
  if (!accountTokens.size) tokensByAccount.delete(accountId);
  return true;
}

export function allowPushTest(accountId: string) {
  if (!accountIdPattern.test(accountId)) return false;
  const now = Date.now();
  pruneExpiredTokens(now);
  const retryAt = testCooldowns.get(accountId) ?? 0;
  if (retryAt > now) return false;
  testCooldowns.set(accountId, now + 30_000);
  return true;
}

export async function sendGenericPushNotification(
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
  pruneExpiredTokens(Date.now());
  const accountTokens = tokensByAccount.get(input.accountId);
  if (!accountTokens?.size) return { acceptedCount: 0, tokenCount: 0 };

  const tokens = [...accountTokens.keys()];
  const messages: PushMessage[] = tokens.map((token) => ({
    to: token,
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

  const response = await postToExpo(PUSH_ENDPOINT, messages, headers, fetcher);
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
        receiptRefs.push({ accountId: input.accountId, token: tokens[index], ticketId: ticket.id });
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
      revokeExpoPushToken(input.accountId, tokens[index]);
    }
  }
  if (receiptRefs.length) scheduleReceiptCheck(receiptRefs, headers, fetcher);
  return { acceptedCount, tokenCount: tokens.length };
}

async function postToExpo(url: string, body: unknown, headers: Record<string, string>, fetcher: typeof fetch) {
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
    await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
  }
  throw new Error("The push provider is temporarily unavailable.");
}

function scheduleReceiptCheck(receipts: ReceiptRef[], headers: Record<string, string>, fetcher: typeof fetch) {
  const timer = setTimeout(() => {
    void (async () => {
      try {
        const response = await postToExpo(
          "https://exp.host/--/api/v2/push/getReceipts",
          { ids: receipts.map((receipt) => receipt.ticketId) },
          headers,
          fetcher,
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
            revokeExpoPushToken(receipt.accountId, receipt.token);
          }
        }
      } catch {
        // Receipt lookup errors do not expose notification payloads.
      }
    })();
  }, RECEIPT_CHECK_DELAY_MS);
  timer.unref?.();
}
