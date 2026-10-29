import { Platform } from 'react-native';

let localNotificationsEnabled = false;
type NotificationsApi = typeof import('expo-notifications');
let notificationsApiPromise: Promise<NotificationsApi | null> | null = null;

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
              shouldShowBanner: localNotificationsEnabled,
              shouldShowList: localNotificationsEnabled,
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
