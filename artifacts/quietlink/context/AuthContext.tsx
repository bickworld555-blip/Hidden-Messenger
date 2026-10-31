import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import {
  getAuthSession,
  logoutAuthSession,
  requestOtp as requestOtpApi,
  setAuthTokenGetter,
  setBaseUrl,
  verifyOtp as verifyOtpApi,
} from "@workspace/api-client-react";
import { disableRemotePushNotifications } from "@/services/quietLinkNotifications";

const SESSION_TOKEN_KEY = "quietlink.auth.access-token.v1";
const SESSION_PHONE_KEY = "quietlink.auth.phone.v1";
const SESSION_ACCOUNT_ID_KEY = "quietlink.auth.account-id.v1";
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const apiDomain = process.env.EXPO_PUBLIC_DOMAIN;
if (apiDomain) setBaseUrl(`https://${apiDomain}`);

if (Platform.OS === "ios" || Platform.OS === "android") {
  setAuthTokenGetter(() => SecureStore.getItemAsync(SESSION_TOKEN_KEY, secureStoreOptions));
}

export type AuthStatus = "loading" | "signedIn" | "signedOut";

type AuthSession = {
  phone: string | null;
  accountId: string | null;
};

type OtpRequestResult = {
  phone: string;
  expiresInSeconds: number;
  retryAfterSeconds: number;
};

type AuthContextValue = {
  status: AuthStatus;
  session: AuthSession | null;
  isNativeAuthAvailable: boolean;
  requestOtp: (phone: string) => Promise<OtpRequestResult>;
  verifyOtp: (phone: string, code: string) => Promise<void>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);
const isNativeAuthAvailable = Platform.OS === "ios" || Platform.OS === "android";
const SESSION_RESTORE_TIMEOUT_MS = 6000;

function errorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);
  const restoreVersion = useRef(0);

  useEffect(() => {
    let active = true;
    let restoreTimer: ReturnType<typeof setTimeout> | undefined;
    async function restoreSession() {
      if (!isNativeAuthAvailable) {
        if (active) setStatus("signedOut");
        return;
      }

      try {
        const sessionRead = await Promise.race([
          Promise.all([
            SecureStore.getItemAsync(SESSION_TOKEN_KEY, secureStoreOptions),
            SecureStore.getItemAsync(SESSION_PHONE_KEY, secureStoreOptions),
            SecureStore.getItemAsync(SESSION_ACCOUNT_ID_KEY, secureStoreOptions),
          ]).then(([token, phone, accountId]) => ({
            kind: "ready" as const,
            token,
            phone,
            accountId,
          })),
          new Promise<{ kind: "timeout" }>((resolve) => {
            restoreTimer = setTimeout(
              () => resolve({ kind: "timeout" }),
              SESSION_RESTORE_TIMEOUT_MS,
            );
          }),
        ]).finally(() => {
          if (restoreTimer) clearTimeout(restoreTimer);
        });

        if (!active) return;
        if (sessionRead.kind === "timeout") {
          // Do not leave the app on a startup spinner if protected storage stalls.
          setSession(null);
          setStatus("signedOut");
          return;
        }

        const { token, phone: savedPhone, accountId: savedAccountId } = sessionRead;
        if (!token || !savedPhone || !savedAccountId) {
          setSession(null);
          setStatus("signedOut");
          if (token || savedPhone || savedAccountId) {
            void Promise.all([
              SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, secureStoreOptions),
              SecureStore.deleteItemAsync(SESSION_PHONE_KEY, secureStoreOptions),
              SecureStore.deleteItemAsync(SESSION_ACCOUNT_ID_KEY, secureStoreOptions),
            ]).catch(() => undefined);
          }
          return;
        }

        // Use the locally protected session immediately. Server validation is
        // best-effort and must not hold the splash screen or first route open.
        setSession({ phone: savedPhone, accountId: savedAccountId });
        setStatus("signedIn");
        const validationVersion = restoreVersion.current;
        void Promise.resolve()
          .then(() => getAuthSession())
          .then((serverSession) => {
            if (!active || restoreVersion.current !== validationVersion) return;
            setSession({ phone: serverSession.phone, accountId: serverSession.accountId });
          })
          .catch((error: unknown) => {
            if (
              !active ||
              restoreVersion.current !== validationVersion ||
              errorStatus(error) !== 401
            ) return;

            setSession(null);
            setStatus("signedOut");
            void Promise.all([
              SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, secureStoreOptions),
              SecureStore.deleteItemAsync(SESSION_PHONE_KEY, secureStoreOptions),
              SecureStore.deleteItemAsync(SESSION_ACCOUNT_ID_KEY, secureStoreOptions),
            ]).catch(() => undefined);
          });
      } catch {
        if (active) {
          setSession(null);
          setStatus("signedOut");
        }
      }
    }

    void restoreSession();
    return () => {
      active = false;
      if (restoreTimer) clearTimeout(restoreTimer);
    };
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    restoreVersion.current += 1;
    if (!isNativeAuthAvailable) {
      throw new Error("Phone verification is available in the iOS and Android apps.");
    }
    return requestOtpApi({ phone });
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    restoreVersion.current += 1;
    if (!isNativeAuthAvailable) {
      throw new Error("Phone verification is available in the iOS and Android apps.");
    }
    const response = await verifyOtpApi({ phone, code });
    try {
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, response.accessToken, secureStoreOptions);
      await SecureStore.setItemAsync(SESSION_PHONE_KEY, response.phone, secureStoreOptions);
      await SecureStore.setItemAsync(SESSION_ACCOUNT_ID_KEY, response.accountId, secureStoreOptions);
    } catch {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, secureStoreOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(SESSION_PHONE_KEY, secureStoreOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(SESSION_ACCOUNT_ID_KEY, secureStoreOptions).catch(() => undefined);
      throw new Error("Hidden Messenger could not save the session in secure device storage.");
    }
    setSession({ phone: response.phone, accountId: response.accountId });
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    restoreVersion.current += 1;
    if (isNativeAuthAvailable) {
      await disableRemotePushNotifications().catch(() => false);
      try {
        await logoutAuthSession();
      } catch {
        // Local credentials are removed even if the server cannot be reached.
      }
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, secureStoreOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(SESSION_PHONE_KEY, secureStoreOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(SESSION_ACCOUNT_ID_KEY, secureStoreOptions).catch(() => undefined);
    }
    setSession(null);
    setStatus("signedOut");
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, isNativeAuthAvailable, requestOtp, verifyOtp, signOut }),
    [status, session, requestOtp, verifyOtp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("useAuth must be used within AuthProvider");
  return value;
}
