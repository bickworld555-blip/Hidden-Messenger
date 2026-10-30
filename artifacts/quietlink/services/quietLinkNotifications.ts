import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as SecureStore from 'expo-secure-store';
import {
  registerPushToken,
  revokePushToken,
  sendPushTest,
} from '@workspace/api-client-react';

let localNotificationsEnabled = false;
let remotePushEnabled = false;
const PUSH_TOKEN_KEY = 'hidden-messenger.push-token.v1';
const PUSH_DEVICE_ID_KEY = 'hidden-messenger.push-device-id.v1';
const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};
type NotificationsApi = typeof import('expo-notifications');
let notificationsApiPromise: Promise<NotificationsApi | null> | null = null;

export type PushSetupResult =
  | { ok: true }
  | { ok: false; reason: 'web' | 'module-unavailable' | 'permission-denied' | 'project-id-missing' | 'registration-failed' };

/**
 * Load notifications only in a native runtime and tolerate builds where the
 * optional native notification modules were not compiled in.
 */
export function getOptionalNotificationsModule(): Promise<NotificationsApi | null> {
  if (Platform.OS === 'web') return Promise.resolve(null);
  if (!notificationsApiPromise) {
    notificationsApiPromise = import('expo-notifications')
      .then((Notifications) => {
        try {
          Notifications.setNotificationHandler?.({
            handleNotification: async () => ({
              shouldShowBanner: localNotificationsEnabled || remotePushEnabled,
              shouldShowList: localNotificationsEnabled || remotePushEnabled,
              shouldPlaySound: false,
              shouldSetBadge: false,
            }),
          });
        } catch {
          // Notification presentation is optional; do not block app startup.
        }
        return Notifications;
      })
      .catch(() => null);
  }
  return notificationsApiPromise;
}

export function setLocalNotificationPreference(enabled: boolean) {
  localNotificationsEnabled = enabled;
}

export function setRemotePushPreference(enabled: boolean) {
  remotePushEnabled = enabled;
}

function getEasProjectId() {
  const constants = Constants as typeof Constants & { easConfig?: { projectId?: string } };
  return constants.expoConfig?.extra?.eas?.projectId
    ?? constants.easConfig?.projectId
    ?? process.env.EXPO_PUBLIC_EAS_PROJECT_ID;
}

export async function enableRemotePushNotifications(): Promise<PushSetupResult> {
  if (Platform.OS === 'web') return { ok: false, reason: 'web' };
  const Notifications = await getOptionalNotificationsModule();
  if (
    !Notifications?.getPermissionsAsync ||
    !Notifications.requestPermissionsAsync ||
    !Notifications.getExpoPushTokenAsync
  ) {
    return { ok: false, reason: 'module-unavailable' };
  }
  const projectId = getEasProjectId();
  if (!projectId) return { ok: false, reason: 'project-id-missing' };

  try {
    await configureLocalNotifications();
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
    if (!permission.granted) return { ok: false, reason: 'permission-denied' };

    const token = (await Notifications.getExpoPushTokenAsync({ projectId })).data;
    const previousToken = await SecureStore.getItemAsync(PUSH_TOKEN_KEY, secureStoreOptions);
    const registration = await registerPushToken({ token });
    if (!/^[A-Za-z0-9_-]{43}$/.test(registration.deviceId)) {
      await revokePushToken({ token }).catch(() => undefined);
      return { ok: false, reason: 'registration-failed' };
    }
    try {
      await SecureStore.setItemAsync(PUSH_TOKEN_KEY, token, secureStoreOptions);
      await SecureStore.setItemAsync(PUSH_DEVICE_ID_KEY, registration.deviceId, secureStoreOptions);
    } catch {
      await revokePushToken({ token }).catch(() => undefined);
      await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY, secureStoreOptions).catch(() => undefined);
      await SecureStore.deleteItemAsync(PUSH_DEVICE_ID_KEY, secureStoreOptions).catch(() => undefined);
      return { ok: false, reason: 'registration-failed' };
    }
    if (previousToken && previousToken !== token) {
      await revokePushToken({ token: previousToken }).catch(() => undefined);
    }
    remotePushEnabled = true;
    return { ok: true };
  } catch {
    return { ok: false, reason: 'registration-failed' };
  }
}

export async function disableRemotePushNotifications() {
  const token = await SecureStore.getItemAsync(PUSH_TOKEN_KEY, secureStoreOptions).catch(() => null);
  if (!token) {
    await SecureStore.deleteItemAsync(PUSH_DEVICE_ID_KEY, secureStoreOptions).catch(() => undefined);
    remotePushEnabled = false;
    return true;
  }
  try {
    await revokePushToken({ token });
    await SecureStore.deleteItemAsync(PUSH_TOKEN_KEY, secureStoreOptions);
    await SecureStore.deleteItemAsync(PUSH_DEVICE_ID_KEY, secureStoreOptions);
    remotePushEnabled = false;
    return true;
  } catch {
    // Keep the token locally so the authenticated revoke can retry next launch.
    remotePushEnabled = false;
    return false;
  }
}

export async function getLocalPushDeviceId() {
  return SecureStore.getItemAsync(PUSH_DEVICE_ID_KEY, secureStoreOptions).catch(() => null);
}

export async function sendRemotePushTest() {
  return sendPushTest();
}

export async function syncRemotePushRegistration(enabled: boolean) {
  if (enabled) return enableRemotePushNotifications();
  await disableRemotePushNotifications();
  return { ok: true } as const;
}

export async function configureLocalNotifications() {
  if (Platform.OS === 'web') return false;
  const Notifications = await getOptionalNotificationsModule();
  if (!Notifications) return false;
  if (Platform.OS !== 'android') return true;
  if (!Notifications.setNotificationChannelAsync || !Notifications.AndroidImportance) return false;
  try {
    await Notifications.setNotificationChannelAsync('quietlink-alerts', {
      name: 'Hidden Messenger alerts',
      importance: Notifications.AndroidImportance.HIGH,
      vibrationPattern: [0, 180, 110, 180],
      sound: 'default',
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleLocalNotificationTest() {
  if (!localNotificationsEnabled || Platform.OS === 'web') return false;
  const Notifications = await getOptionalNotificationsModule();
  if (!Notifications?.getPermissionsAsync || !Notifications.scheduleNotificationAsync) return false;
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      if (!Notifications.requestPermissionsAsync) return false;
      permission = await Notifications.requestPermissionsAsync();
      if (!permission.granted) return false;
    }

    await configureLocalNotifications();
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Hidden Messenger alert test',
        body: 'Local alerts are enabled. Message contents stay hidden.',
        data: { type: 'settings-test' },
        sound: 'default',
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}

export async function scheduleQuietLinkAlert(input: {
  type: 'call' | 'message';
  id: string;
}) {
  if (!localNotificationsEnabled || Platform.OS === 'web') return false;
  const Notifications = await getOptionalNotificationsModule();
  if (!Notifications?.getPermissionsAsync || !Notifications.scheduleNotificationAsync) return false;
  try {
    let permission = await Notifications.getPermissionsAsync();
    if (!permission.granted) {
      if (!Notifications.requestPermissionsAsync) return false;
      permission = await Notifications.requestPermissionsAsync();
    }
    if (!permission.granted) return false;

    await configureLocalNotifications();
    const isCall = input.type === 'call';
    await Notifications.scheduleNotificationAsync({
      content: {
        title: 'Hidden Messenger',
        body: isCall ? 'Incoming call' : 'New message',
        data: isCall
          ? { type: 'call', callId: input.id }
          : { type: 'message', conversationId: input.id },
        sound: 'default',
      },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
