import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RootStartupErrorFallback } from '@/components/RootStartupErrorFallback';
import {
  Inter_400Regular,
  Inter_500Medium,
  Inter_600SemiBold,
  Inter_700Bold,
  useFonts,
} from '@expo-google-fonts/inter';
import { Stack } from 'expo-router';
import { useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { MessageProvider } from '@/context/MessageContext';
import { AuthProvider, useAuth } from '@/context/AuthContext';
import { AppSettingsProvider } from '@/context/AppSettingsContext';
import {
  configureLocalNotifications,
  getOptionalNotificationsModule,
  syncRemotePushRegistration,
} from '@/services/quietLinkNotifications';
import { useColors } from '@/hooks/useColors';
import { useAppSettings } from '@/context/AppSettingsContext';

export const unstable_settings = {
  anchor: 'login',
};

// Prevent the splash screen from auto-hiding before asset loading is complete.
void SplashScreen.preventAutoHideAsync().catch(() => undefined);
const STARTUP_SPLASH_TIMEOUT_MS = 8000;

const queryClient = new QueryClient();

type PushRoute = {
  type: 'call' | 'message' | 'test';
  routeId: string;
  accountId: string;
};
let pendingPushRoute: PushRoute | null = null;

function parsePushRoute(data: Record<string, unknown>): PushRoute | null {
  const type = data.type;
  const accountId = data.accountId;
  const routeId = data.routeId;
  const opaqueId = (value: unknown): value is string =>
    typeof value === 'string' &&
    (/^[A-Fa-f0-9]{32}$/.test(value) || /^[a-f0-9-]{36}$/.test(value) || /^[A-Za-z0-9_-]{22,128}$/.test(value));
  if (
    (type !== 'call' && type !== 'message' && type !== 'test') ||
    typeof accountId !== 'string' ||
    !/^[A-Za-z0-9_-]{43}$/.test(accountId) ||
    !opaqueId(routeId)
  ) return null;
  return { type, routeId, accountId };
}

function RootLayoutNav({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const { session } = useAuth();
  const { settings, ready: settingsReady } = useAppSettings();
  const authRef = useRef({ signedIn, accountId: session?.accountId ?? null });
  authRef.current = { signedIn, accountId: session?.accountId ?? null };

  const routePush = (route: PushRoute) => {
    if (!authRef.current.signedIn || !authRef.current.accountId) {
      pendingPushRoute = route;
      return;
    }
    if (route.accountId !== authRef.current.accountId) return;
    pendingPushRoute = null;
    if (route.type === 'call') {
      router.replace('/(tabs)/calls');
    } else if (route.type === 'message') {
      router.replace('/(tabs)');
    } else {
      router.replace('/(tabs)/settings');
    }
  };

  useEffect(() => {
    let disposed = false;
    let responseListener: { remove: () => void } | null = null;

    void (async () => {
      try {
        const Notifications = await getOptionalNotificationsModule();
        if (disposed || !Notifications) return;
        await configureLocalNotifications();
        if (disposed) return;
        const handleResponse = (response: import('expo-notifications').NotificationResponse) => {
          const data = response.notification.request.content.data as Record<string, unknown>;
          const route = parsePushRoute(data);
          if (route) routePush(route);
          void Notifications.clearLastNotificationResponseAsync?.().catch(() => undefined);
        };
        if (Notifications.addNotificationResponseReceivedListener) {
          responseListener = Notifications.addNotificationResponseReceivedListener(handleResponse);
        }
        const lastResponse = await Notifications.getLastNotificationResponseAsync?.();
        if (!disposed && lastResponse) handleResponse(lastResponse);
      } catch {
        // Notification modules are optional; their startup must never block navigation.
      }
    })();

    return () => {
      disposed = true;
      responseListener?.remove();
    };
  }, [router]);

  useEffect(() => {
    const route = pendingPushRoute;
    if (!route || !signedIn || !session?.accountId) return;
    if (route.accountId !== session.accountId) {
      pendingPushRoute = null;
      return;
    }
    routePush(route);
  }, [signedIn, session?.accountId]);

  useEffect(() => {
    if (!settingsReady || !signedIn || !session?.accountId) return;
    void syncRemotePushRegistration(settings.pushNotificationsEnabled).catch(() => undefined);
  }, [settingsReady, settings.pushNotificationsEnabled, session?.accountId, signedIn]);

  return (
    <Stack screenOptions={{ headerBackTitle: 'Back' }}>
      <Stack.Protected guard={signedIn}>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="chat/[id]" options={{ headerShown: false, animation: 'slide_from_right' }} />
        <Stack.Screen name="call/[id]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="status/[id]" options={{ headerShown: false, presentation: 'fullScreenModal' }} />
        <Stack.Screen name="new-chat" options={{ headerShown: false, presentation: 'modal' }} />
        <Stack.Screen name="new-status" options={{ headerShown: false, presentation: 'modal' }} />
      </Stack.Protected>
      <Stack.Protected guard={!signedIn}>
        <Stack.Screen name="login" options={{ headerShown: false }} />
      </Stack.Protected>
    </Stack>
  );
}

function AppContent() {
  const { status } = useAuth();
  const colors = useColors();

  if (status === 'loading') {
    return (
      <View style={[styles.loading, { backgroundColor: colors.background }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const navigation = <RootLayoutNav signedIn={status === 'signedIn'} />;
  return status === 'signedIn' ? <MessageProvider>{navigation}</MessageProvider> : navigation;
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Inter_400Regular,
    Inter_500Medium,
    Inter_600SemiBold,
    Inter_700Bold,
  });
  const [startupTimedOut, setStartupTimedOut] = useState(false);

  useEffect(() => {
    if (fontsLoaded || fontError) return;
    const timeout = setTimeout(
      () => setStartupTimedOut(true),
      STARTUP_SPLASH_TIMEOUT_MS,
    );
    return () => clearTimeout(timeout);
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (fontsLoaded || fontError || startupTimedOut) {
      void SplashScreen.hideAsync().catch(() => undefined);
    }
  }, [fontsLoaded, fontError, startupTimedOut]);

  if (!fontsLoaded && !fontError && !startupTimedOut) return null;

  return (
    <ErrorBoundary FallbackComponent={RootStartupErrorFallback}>
      <SafeAreaProvider>
        <QueryClientProvider client={queryClient}>
          <GestureHandlerRootView>
            <KeyboardProvider>
              <AuthProvider>
                <AppSettingsProvider>
                  <AppContent />
                </AppSettingsProvider>
              </AuthProvider>
            </KeyboardProvider>
          </GestureHandlerRootView>
        </QueryClientProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: Platform.OS === 'web' ? 48 : 0,
  },
});
