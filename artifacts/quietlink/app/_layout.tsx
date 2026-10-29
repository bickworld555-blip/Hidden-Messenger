import React, { useEffect } from 'react';
import { ActivityIndicator, Platform, StyleSheet, View } from 'react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ErrorBoundary } from '@/components/ErrorBoundary';
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
} from '@/services/quietLinkNotifications';
import { useColors } from '@/hooks/useColors';

// Prevent the splash screen from auto-hiding before asset loading is complete.
SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

function RootLayoutNav({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  useEffect(() => {
    let disposed = false;
    let responseListener: { remove: () => void } | null = null;

    void (async () => {
      const Notifications = await getOptionalNotificationsModule();
      if (disposed || !Notifications?.addNotificationResponseReceivedListener) return;
      await configureLocalNotifications();
      if (disposed) return;
      try {
        responseListener = Notifications.addNotificationResponseReceivedListener((response) => {
          const data = response.notification.request.content.data as Record<string, unknown>;
          if (data.type === 'call' && typeof data.callId === 'string') {
            router.push({
              pathname: '/call/[id]',
              params: {
                id: data.callId,
                name: typeof data.name === 'string' ? data.name : 'Hidden Messenger contact',
                mode: data.mode === 'video' ? 'video' : 'audio',
                stage: 'incoming',
              },
            });
          } else if (data.type === 'message' && typeof data.conversationId === 'string') {
            router.push({ pathname: '/chat/[id]', params: { id: data.conversationId } });
          }
        });
      } catch {
        // Native notification listeners are optional in Expo Go and previews.
      }
    })();

    return () => {
      disposed = true;
      responseListener?.remove();
    };
  }, [router]);

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

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync();
    }
  }, [fontsLoaded, fontError]);

  if (!fontsLoaded && !fontError) return null;

  return (
    <SafeAreaProvider>
      <ErrorBoundary>
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
      </ErrorBoundary>
    </SafeAreaProvider>
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
