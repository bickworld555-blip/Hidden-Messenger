import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

let localNotificationsEnabled = false;

export function setLocalNotificationPreference(enabled: boolean) {
  localNotificationsEnabled = enabled;
}

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: localNotificationsEnabled,
    shouldShowList: localNotificationsEnabled,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function configureLocalNotifications() {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync('quietlink-alerts', {
    name: 'QuietLink alerts',
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 180, 110, 180],
    sound: 'default',
  });
}

export async function scheduleLocalNotificationTest() {
  if (!localNotificationsEnabled) return false;
  const permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) {
    const requested = await Notifications.requestPermissionsAsync();
    if (!requested.granted) return false;
  }

  await configureLocalNotifications();
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'QuietLink alert test',
      body: 'Local alerts are enabled. Message contents stay hidden.',
      data: { type: 'settings-test' },
      sound: 'default',
    },
    trigger: null,
  });
  return true;
}

export async function scheduleQuietLinkAlert(input: {
  type: 'call' | 'message';
  id: string;
}) {
  if (!localNotificationsEnabled) return false;
  let permission = await Notifications.getPermissionsAsync();
  if (!permission.granted) permission = await Notifications.requestPermissionsAsync();
  if (!permission.granted) return false;

  await configureLocalNotifications();
  const isCall = input.type === 'call';
  await Notifications.scheduleNotificationAsync({
    content: {
      title: 'QuietLink',
      body: isCall ? 'Incoming call' : 'New message',
      data: isCall
        ? { type: 'call', callId: input.id }
        : { type: 'message', conversationId: input.id },
      sound: 'default',
    },
    trigger: null,
  });
  return true;
}
