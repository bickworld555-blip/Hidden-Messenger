import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import * as SecureStore from 'expo-secure-store';
import {
  setLocalNotificationPreference,
  setRemotePushPreference,
} from '@/services/quietLinkNotifications';

export type RingtoneName = 'soft' | 'classic' | 'pulse';
export type VibrationPattern = 'off' | 'short' | 'double';

export type AppSettings = {
  callSoundsEnabled: boolean;
  ringtone: RingtoneName;
  vibrationPattern: VibrationPattern;
  chatSoundsEnabled: boolean;
  localNotificationsEnabled: boolean;
  pushNotificationsEnabled: boolean;
};

type AppSettingsContextValue = {
  settings: AppSettings;
  ready: boolean;
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>;
};

const SETTINGS_KEY = 'quietlink.app-settings.v1';
const DEFAULT_SETTINGS: AppSettings = {
  callSoundsEnabled: true,
  ringtone: 'soft',
  vibrationPattern: 'double',
  chatSoundsEnabled: true,
  localNotificationsEnabled: false,
  pushNotificationsEnabled: false,
};
const secureOptions: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null);

function parseSettings(value: string | null): AppSettings {
  if (!value) return DEFAULT_SETTINGS;
  try {
    const saved = JSON.parse(value) as Partial<AppSettings>;
    const ringtone = saved.ringtone === 'classic' || saved.ringtone === 'pulse' ? saved.ringtone : 'soft';
    const vibrationPattern = saved.vibrationPattern === 'off' || saved.vibrationPattern === 'short'
      ? saved.vibrationPattern
      : 'double';
    return {
      callSoundsEnabled: saved.callSoundsEnabled !== false,
      ringtone,
      vibrationPattern,
      chatSoundsEnabled: saved.chatSoundsEnabled !== false,
      localNotificationsEnabled: saved.localNotificationsEnabled === true,
      pushNotificationsEnabled: saved.pushNotificationsEnabled === true,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function AppSettingsProvider({ children }: { children: React.ReactNode }) {
  const [settings, setSettings] = useState<AppSettings>(DEFAULT_SETTINGS);
  const [ready, setReady] = useState(false);
  const settingsRef = useRef(settings);

  useEffect(() => {
    let active = true;
    void SecureStore.getItemAsync(SETTINGS_KEY, secureOptions)
      .then((value) => {
        if (!active) return;
        const saved = parseSettings(value);
        settingsRef.current = saved;
        setSettings(saved);
        setLocalNotificationPreference(saved.localNotificationsEnabled);
        setRemotePushPreference(saved.pushNotificationsEnabled);
      })
      .catch(() => {
        // Preferences stay in memory if protected storage is unavailable.
      })
      .finally(() => {
        if (active) setReady(true);
      });
    return () => { active = false; };
  }, []);

  const updateSettings = useCallback(async (patch: Partial<AppSettings>) => {
    const next = { ...settingsRef.current, ...patch };
    settingsRef.current = next;
    setSettings(next);
    if (patch.localNotificationsEnabled !== undefined) {
      setLocalNotificationPreference(next.localNotificationsEnabled);
    }
    if (patch.pushNotificationsEnabled !== undefined) {
      setRemotePushPreference(next.pushNotificationsEnabled);
    }
    try {
      await SecureStore.setItemAsync(SETTINGS_KEY, JSON.stringify(next), secureOptions);
    } catch {
      // Keep the current session usable; the preference will reset if the app restarts.
    }
  }, []);

  const value = useMemo(() => ({ settings, ready, updateSettings }), [settings, ready, updateSettings]);
  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>;
}

export function useAppSettings() {
  const context = useContext(AppSettingsContext);
  if (!context) throw new Error('useAppSettings must be used inside AppSettingsProvider');
  return context;
}
