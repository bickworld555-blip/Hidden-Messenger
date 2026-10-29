import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
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

const SESSION_TOKEN_KEY = "quietlink.auth.access-token.v1";
const SESSION_PHONE_KEY = "quietlink.auth.phone.v1";
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

function errorStatus(error: unknown) {
  return typeof error === "object" && error !== null && "status" in error
    ? Number((error as { status: unknown }).status)
    : null;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>("loading");
  const [session, setSession] = useState<AuthSession | null>(null);

  useEffect(() => {
    let active = true;
    async function restoreSession() {
      if (!isNativeAuthAvailable) {
        if (active) setStatus("signedOut");
        return;
      }

      try {
        const token = await SecureStore.getItemAsync(SESSION_TOKEN_KEY, secureStoreOptions);
        const savedPhone = await SecureStore.getItemAsync(SESSION_PHONE_KEY, secureStoreOptions);
        if (!token) {
          if (active) {
            setSession(null);
            setStatus("signedOut");
          }
          return;
        }

        try {
          const serverSession = await getAuthSession();
          if (active) {
            setSession({ phone: serverSession.phone });
            setStatus("signedIn");
          }
        } catch (error) {
          if (errorStatus(error) === 401) {
            await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, secureStoreOptions);
            await SecureStore.deleteItemAsync(SESSION_PHONE_KEY, secureStoreOptions);
            if (active) {
              setSession(null);
              setStatus("signedOut");
            }
          } else if (active) {
            // Preserve a device session during a temporary network outage.
            setSession({ phone: savedPhone });
            setStatus("signedIn");
          }
        }
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
    };
  }, []);

  const requestOtp = useCallback(async (phone: string) => {
    if (!isNativeAuthAvailable) {
      throw new Error("Phone verification is available in the iOS and Android apps.");
    }
    return requestOtpApi({ phone });
  }, []);

  const verifyOtp = useCallback(async (phone: string, code: string) => {
    if (!isNativeAuthAvailable) {
      throw new Error("Phone verification is available in the iOS and Android apps.");
    }
    const response = await verifyOtpApi({ phone, code });
    try {
      await SecureStore.setItemAsync(SESSION_TOKEN_KEY, response.accessToken, secureStoreOptions);
      await SecureStore.setItemAsync(SESSION_PHONE_KEY, response.phone, secureStoreOptions);
    } catch {
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, secureStoreOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(SESSION_PHONE_KEY, secureStoreOptions).catch(() => undefined);
      throw new Error("Hidden Messenger could not save the session in secure device storage.");
    }
    setSession({ phone: response.phone });
    setStatus("signedIn");
  }, []);

  const signOut = useCallback(async () => {
    if (isNativeAuthAvailable) {
      try {
        await logoutAuthSession();
      } catch {
        // Local credentials are removed even if the server cannot be reached.
      }
      await SecureStore.deleteItemAsync(SESSION_TOKEN_KEY, secureStoreOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(SESSION_PHONE_KEY, secureStoreOptions).catch(() => undefined);
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
