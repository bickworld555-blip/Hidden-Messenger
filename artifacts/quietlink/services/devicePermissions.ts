import { Platform } from 'react-native';
import * as Audio from 'expo-audio';
import * as ImagePicker from 'expo-image-picker';
import { getOptionalNotificationsModule } from '@/services/quietLinkNotifications';

export type DevicePermissionName = 'camera' | 'microphone' | 'gallery' | 'notifications';
export type DevicePermissionState = {
  status: 'granted' | 'denied' | 'undetermined' | 'unavailable';
  canAskAgain: boolean;
  limited?: boolean;
};

const unavailable: DevicePermissionState = { status: 'unavailable', canAskAgain: false };

function normalizePermission(response: {
  granted: boolean;
  canAskAgain: boolean;
  accessPrivileges?: string;
  status: string;
}): DevicePermissionState {
  return {
    status: response.granted ? 'granted' : response.status === 'undetermined' ? 'undetermined' : 'denied',
    canAskAgain: response.canAskAgain,
    limited: response.accessPrivileges === 'limited',
  };
}

export async function getDevicePermission(name: DevicePermissionName): Promise<DevicePermissionState> {
  if (Platform.OS === 'web') return unavailable;
  try {
    switch (name) {
      case 'camera':
        return normalizePermission(await ImagePicker.getCameraPermissionsAsync());
      case 'microphone':
        return normalizePermission(await Audio.getRecordingPermissionsAsync());
      case 'gallery':
        return normalizePermission(await ImagePicker.getMediaLibraryPermissionsAsync());
      case 'notifications': {
        const Notifications = await getOptionalNotificationsModule();
        if (!Notifications?.getPermissionsAsync) return unavailable;
        return normalizePermission(await Notifications.getPermissionsAsync());
      }
    }
  } catch {
    return unavailable;
  }
}

export async function requestDevicePermission(name: DevicePermissionName): Promise<DevicePermissionState> {
  if (Platform.OS === 'web') return unavailable;
  try {
    switch (name) {
      case 'camera':
        return normalizePermission(await ImagePicker.requestCameraPermissionsAsync());
      case 'microphone':
        return normalizePermission(await Audio.requestRecordingPermissionsAsync());
      case 'gallery':
        return normalizePermission(await ImagePicker.requestMediaLibraryPermissionsAsync());
      case 'notifications': {
        const Notifications = await getOptionalNotificationsModule();
        if (!Notifications?.requestPermissionsAsync) return unavailable;
        return normalizePermission(await Notifications.requestPermissionsAsync());
      }
    }
  } catch {
    return unavailable;
  }
}
