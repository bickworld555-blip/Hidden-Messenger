import { createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { Router, type Request } from "express";
import { logger } from "../lib/logger";

const router = Router();

const SMS_ENDPOINT = "https://api.sms.net.bd/sendsms";
const OTP_TTL_MS = 5 * 60 * 1000;
const OTP_RESEND_COOLDOWN_MS = 60 * 1000;
const OTP_WINDOW_MS = 15 * 60 * 1000;
const MAX_OTP_REQUESTS_PER_PHONE = 3;
const MAX_OTP_REQUESTS_PER_IP = 10;
const MAX_OTP_ATTEMPTS = 5;
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const MAX_TRACKED_KEYS = 5000;

type OtpChallenge = {
  phone: string;
  digest: Buffer;
  expiresAt: number;
  attemptsRemaining: number;
};

type RequestWindow = {
  timestamps: number[];
  lastAt: number;
};

type AuthSession = {
  phone: string;
  expiresAt: number;
};

const challenges = new Map<string, OtpChallenge>();
const phoneRequestWindows = new Map<string, RequestWindow>();
const ipRequestWindows = new Map<string, RequestWindow>();
const sessions = new Map<string, AuthSession>();

function hashKey(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function normalizeBangladeshPhone(value: unknown) {
  if (typeof value !== "string" || value.length > 32) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);

  if (/^01[3-9]\d{8}$/.test(digits)) digits = `88${digits}`;
  else if (/^1[3-9]\d{8}$/.test(digits)) digits = `880${digits}`;

  return /^8801[3-9]\d{8}$/.test(digits) ? digits : null;
}

function otpDigest(phone: string, code: string, secret: string) {
  return createHmac("sha256", secret)
    .update(`QuietLink OTP v1\0${phone}\0${code}`)
    .digest();
}

function pruneState(now: number) {
  for (const [key, challenge] of challenges) {
    if (challenge.expiresAt <= now) {
      challenge.digest.fill(0);
      challenges.delete(key);
    }
  }
  for (const [key, session] of sessions) {
    if (session.expiresAt <= now) sessions.delete(key);
  }
  for (const windows of [phoneRequestWindows, ipRequestWindows]) {
    for (const [key, window] of windows) {
      window.timestamps = window.timestamps.filter((timestamp) => timestamp > now - OTP_WINDOW_MS);
      if (!window.timestamps.length && now - window.lastAt > OTP_WINDOW_MS) windows.delete(key);
    }
    if (windows.size > MAX_TRACKED_KEYS) {
      const excess = windows.size - MAX_TRACKED_KEYS;
      let removed = 0;
      for (const key of windows.keys()) {
        windows.delete(key);
        removed += 1;
        if (removed >= excess) break;
      }
    }
  }
}

function retryAfterForPhone(window: RequestWindow | undefined, now: number) {
  if (!window) return 0;
  const cooldown = OTP_RESEND_COOLDOWN_MS - (now - window.lastAt);
  if (cooldown > 0) return Math.ceil(cooldown / 1000);
  const recent = window.timestamps.filter((timestamp) => timestamp > now - OTP_WINDOW_MS);
  if (recent.length >= MAX_OTP_REQUESTS_PER_PHONE) {
    return Math.max(1, Math.ceil((recent[0] + OTP_WINDOW_MS - now) / 1000));
  }
  return 0;
}

function retryAfterForIp(window: RequestWindow | undefined, now: number) {
  if (!window) return 0;
  const recent = window.timestamps.filter((timestamp) => timestamp > now - OTP_WINDOW_MS);
  if (recent.length >= MAX_OTP_REQUESTS_PER_IP) {
    return Math.max(1, Math.ceil((recent[0] + OTP_WINDOW_MS - now) / 1000));
  }
  return 0;
}

function recordRequest(window: RequestWindow | undefined, now: number) {
  const updated = window ?? { timestamps: [], lastAt: 0 };
  updated.timestamps = updated.timestamps.filter((timestamp) => timestamp > now - OTP_WINDOW_MS);
  updated.timestamps.push(now);
  updated.lastAt = now;
  return updated;
}

function sendError(
  res: import("express").Response,
  status: number,
  code: string,
  message: string,
  retryAfterSeconds?: number,
) {
  res.status(status).json({
    code,
    message,
    ...(retryAfterSeconds === undefined ? {} : { retryAfterSeconds }),
  });
}

function getSessionFromRequest(req: Request) {
  const match = req.get("authorization")?.match(/^Bearer ([A-Za-z0-9_-]{40,})$/i);
  if (!match) return null;
  const tokenHash = hashKey(match[1]);
  const session = sessions.get(tokenHash);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(tokenHash);
    return null;
  }
  return { tokenHash, session };
}

function providerFailure(errorCode: number) {
  switch (errorCode) {
    case 403:
    case 405:
      return { status: 503, code: "SMS_AUTH_FAILED", message: "The SMS gateway could not authorize this request." };
    case 410:
      return { status: 503, code: "SMS_ACCOUNT_EXPIRED", message: "The SMS gateway account has expired." };
    case 411:
      return { status: 503, code: "SMS_ACCOUNT_SUSPENDED", message: "The SMS gateway account is suspended or expired." };
    case 416:
      return { status: 400, code: "INVALID_PHONE", message: "The SMS gateway rejected this Bangladesh mobile number." };
    case 417:
      return { status: 503, code: "SMS_INSUFFICIENT_BALANCE", message: "The SMS gateway has insufficient balance to send a code." };
    case 420:
      return { status: 502, code: "SMS_CONTENT_BLOCKED", message: "The SMS gateway blocked the verification message." };
    default:
      return { status: 502, code: "SMS_PROVIDER_ERROR", message: "The SMS gateway could not send the verification code." };
  }
}

router.post("/auth/otp/request", async (req, res) => {
  const phone = normalizeBangladeshPhone((req.body as { phone?: unknown } | undefined)?.phone);
  if (!phone) {
    sendError(res, 400, "INVALID_PHONE", "Enter a valid Bangladesh mobile number, such as +88017XXXXXXXX.");
    return;
  }

  const apiKey = process.env["SMS_NET_BD_API_KEY"];
  const otpSecret = process.env["SESSION_SECRET"];
  if (!apiKey || !otpSecret) {
    sendError(res, 503, "AUTH_NOT_CONFIGURED", "Phone verification is not configured on the server.");
    return;
  }

  const now = Date.now();
  pruneState(now);
  const phoneHash = hashKey(phone);
  const ipHash = hashKey(req.ip || req.socket.remoteAddress || "unknown");
  const phoneWindow = phoneRequestWindows.get(phoneHash);
  const ipWindow = ipRequestWindows.get(ipHash);
  const retryAfter = Math.max(
    retryAfterForPhone(phoneWindow, now),
    retryAfterForIp(ipWindow, now),
  );
  if (retryAfter > 0) {
    sendError(res, 429, "OTP_RATE_LIMITED", "Please wait before requesting another verification code.", retryAfter);
    return;
  }

  phoneRequestWindows.set(phoneHash, recordRequest(phoneWindow, now));
  ipRequestWindows.set(ipHash, recordRequest(ipWindow, now));

  const code = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const message = `Your Hidden Messenger verification code is: ${code}. It expires in 5 minutes.`;
  let providerResponse: globalThis.Response;
  let payload: unknown;
  try {
    providerResponse = await fetch(SMS_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify({ api_key: apiKey, msg: message, to: phone }),
      signal: AbortSignal.timeout(10_000),
    });
    payload = await providerResponse.json().catch(() => null);
  } catch {
    logger.warn({ provider: "sms.net.bd" }, "OTP delivery failed");
    sendError(res, 503, "SMS_PROVIDER_UNAVAILABLE", "The SMS gateway is temporarily unavailable. Try again shortly.");
    return;
  }

  const providerErrorCode =
    payload && typeof payload === "object" && "error" in payload
      ? Number((payload as { error: unknown }).error)
      : Number.NaN;
  if (!providerResponse.ok || providerErrorCode !== 0) {
    logger.warn(
      { provider: "sms.net.bd", providerErrorCode: Number.isFinite(providerErrorCode) ? providerErrorCode : "unknown" },
      "SMS provider rejected OTP request",
    );
    const failure = providerFailure(providerErrorCode);
    sendError(res, failure.status, failure.code, failure.message);
    return;
  }

  const previousChallenge = challenges.get(phoneHash);
  previousChallenge?.digest.fill(0);
  challenges.set(phoneHash, {
    phone,
    digest: otpDigest(phone, code, otpSecret),
    expiresAt: Date.now() + OTP_TTL_MS,
    attemptsRemaining: MAX_OTP_ATTEMPTS,
  });
  res.status(200).json({
    phone,
    expiresInSeconds: Math.floor(OTP_TTL_MS / 1000),
    retryAfterSeconds: Math.floor(OTP_RESEND_COOLDOWN_MS / 1000),
  });
});

router.post("/auth/otp/verify", (req, res) => {
  const body = req.body as { phone?: unknown; code?: unknown } | undefined;
  const phone = normalizeBangladeshPhone(body?.phone);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!phone || !/^\d{6}$/.test(code)) {
    sendError(res, 400, "OTP_INVALID_OR_EXPIRED", "The verification code is invalid or expired.");
    return;
  }

  const otpSecret = process.env["SESSION_SECRET"];
  if (!otpSecret) {
    sendError(res, 503, "AUTH_NOT_CONFIGURED", "Phone verification is not configured on the server.");
    return;
  }

  const now = Date.now();
  pruneState(now);
  const phoneHash = hashKey(phone);
  const challenge = challenges.get(phoneHash);
  if (!challenge || challenge.expiresAt <= now) {
    sendError(res, 400, "OTP_INVALID_OR_EXPIRED", "The verification code is invalid or expired.");
    return;
  }

  const candidate = otpDigest(phone, code, otpSecret);
  const matches = timingSafeEqual(challenge.digest, candidate);
  candidate.fill(0);
  if (!matches) {
    challenge.attemptsRemaining -= 1;
    if (challenge.attemptsRemaining <= 0) {
      challenge.digest.fill(0);
      challenges.delete(phoneHash);
    }
    sendError(res, 400, "OTP_INVALID_OR_EXPIRED", "The verification code is invalid or expired.");
    return;
  }

  challenge.digest.fill(0);
  challenges.delete(phoneHash);
  const accessToken = randomBytes(32).toString("base64url");
  const expiresAt = now + SESSION_TTL_MS;
  sessions.set(hashKey(accessToken), { phone, expiresAt });
  res.status(200).json({
    accessToken,
    phone,
    expiresAt: new Date(expiresAt).toISOString(),
  });
});

router.get("/auth/session", (req, res) => {
  pruneState(Date.now());
  const authenticated = getSessionFromRequest(req);
  if (!authenticated) {
    sendError(res, 401, "UNAUTHENTICATED", "Sign in again to continue.");
    return;
  }
  res.status(200).json({
    phone: authenticated.session.phone,
    expiresAt: new Date(authenticated.session.expiresAt).toISOString(),
  });
});

router.post("/auth/logout", (req, res) => {
  const authenticated = getSessionFromRequest(req);
  if (!authenticated) {
    sendError(res, 401, "UNAUTHENTICATED", "This session is missing or expired.");
    return;
  }
  sessions.delete(authenticated.tokenHash);
  res.status(204).end();
});

export default router;
