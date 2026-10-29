import React from 'react';
import { Alert, Linking, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, Vibration, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SoundPreviewButton } from '@/components/SoundPreviewButton';
import { useAppSettings, type RingtoneName, type VibrationPattern } from '@/context/AppSettingsContext';
import { useMessages } from '@/context/MessageContext';
import { useAuth } from '@/context/AuthContext';
import { useColors } from '@/hooks/useColors';
import { getDevicePermission, requestDevicePermission, type DevicePermissionName, type DevicePermissionState } from '@/services/devicePermissions';
import { scheduleLocalNotificationTest } from '@/services/quietLinkNotifications';

const ringtoneOptions: { value: RingtoneName; label: string }[] = [
  { value: 'soft', label: 'Soft' },
  { value: 'classic', label: 'Classic' },
  { value: 'pulse', label: 'Pulse' },
];

const vibrationOptions: { value: VibrationPattern; label: string }[] = [
  { value: 'off', label: 'Off' },
  { value: 'short', label: 'Short' },
  { value: 'double', label: 'Double' },
];

function SettingRow({
  icon,
  title,
  detail,
  onPress,
  trailing,
}: {
  icon: React.ComponentProps<typeof Feather>['name'];
  title: string;
  detail: string;
  onPress?: () => void;
  trailing?: React.ReactNode;
}) {
  const colors = useColors();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.settingRow, { backgroundColor: pressed ? colors.secondary : colors.card }]} accessibilityRole={onPress ? 'button' : undefined}>
      <View style={[styles.settingIcon, { backgroundColor: colors.secondary }]}><Feather name={icon} size={17} color={colors.primary} /></View>
      <View style={styles.settingCopy}>
        <Text style={[styles.settingTitle, { color: colors.foreground }]}>{title}</Text>
        <Text style={[styles.settingDetail, { color: colors.mutedForeground }]}>{detail}</Text>
      </View>
      {trailing ?? <Feather name="chevron-right" size={17} color={colors.mutedForeground} />}
    </Pressable>
  );
}

function PermissionRow({ name, title, detail, icon }: {
  name: DevicePermissionName;
  title: string;
  detail: string;
  icon: React.ComponentProps<typeof Feather>['name'];
}) {
  const colors = useColors();
  const [permission, setPermission] = React.useState<DevicePermissionState>({ status: 'undetermined', canAskAgain: true });
  const [busy, setBusy] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setPermission(await getDevicePermission(name));
  }, [name]);

  React.useEffect(() => { void refresh(); }, [refresh]);

  const request = async () => {
    if (busy || permission.status === 'unavailable') return;
    setBusy(true);
    try {
      if (permission.status === 'denied' && !permission.canAskAgain) {
        await Linking.openSettings();
        return;
      }
      setPermission(await requestDevicePermission(name));
    } catch {
      Alert.alert('Permission settings unavailable', 'Open your device settings to review this permission.');
    } finally {
      setBusy(false);
    }
  };

  const stateLabel = busy
    ? 'Checking'
    : permission.status === 'unavailable'
      ? 'Unavailable'
      : permission.status === 'granted'
        ? permission.limited ? 'Limited' : 'Allowed'
        : permission.status === 'denied'
          ? permission.canAskAgain ? 'Allow' : 'Settings'
          : 'Allow';

  return (
    <SettingRow
      icon={icon}
      title={title}
      detail={detail}
      onPress={() => void request()}
      trailing={<Text style={[styles.permissionStatus, { color: permission.status === 'granted' ? colors.primary : colors.mutedForeground }]}>{stateLabel}</Text>}
    />
  );
}

function ChoicePills<T extends string>({ value, choices, onSelect }: {
  value: T;
  choices: { value: T; label: string }[];
  onSelect: (value: T) => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.pillRow}>
      {choices.map((choice) => (
        <Pressable
          key={choice.value}
          onPress={() => onSelect(choice.value)}
          style={[styles.pill, { backgroundColor: value === choice.value ? colors.primary : colors.secondary }]}
          accessibilityRole="button"
          accessibilityState={{ selected: value === choice.value }}
        >
          <Text style={[styles.pillText, { color: value === choice.value ? colors.primaryForeground : colors.secondaryForeground }]}>{choice.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { storageStatus, storageError, messagingStatus, resetEncryptedVault } = useMessages();
  const { session, signOut } = useAuth();
  const { settings, updateSettings } = useAppSettings();
  const explainNotReady = (feature: string) => Alert.alert(feature, 'This feature is not connected in the prototype. Messages are never sent to a messaging network.');
  const handleLocalNotifications = async (enabled: boolean) => {
    if (!enabled) {
      await updateSettings({ localNotificationsEnabled: false });
      return;
    }
    const permission = await requestDevicePermission('notifications');
    if (permission.status === 'granted') {
      await updateSettings({ localNotificationsEnabled: true });
    } else {
      Alert.alert(
        'Notifications are not allowed',
        permission.status === 'unavailable'
          ? 'Notifications are unavailable in this web preview. Use a rebuilt iOS or Android app.'
          : 'Allow notifications in device settings to enable local alerts.',
      );
    }
  };
  const previewVibration = (pattern: VibrationPattern) => {
    if (Platform.OS === 'web' || pattern === 'off') return;
    Vibration.vibrate(pattern === 'short' ? 130 : [0, 100, 85, 130]);
  };
  const previewLocalNotification = async () => {
    if (!settings.localNotificationsEnabled) {
      Alert.alert('Enable local notifications first', 'Turn on Local notifications above, then tap this row again to schedule a generic alert.');
      return;
    }
    try {
      const scheduled = await scheduleLocalNotificationTest();
      if (!scheduled) Alert.alert('Notification permission required', 'Allow notifications to receive the local test alert.');
    } catch {
      Alert.alert('Local alert unavailable', 'The device could not schedule a local notification.');
    }
  };
  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 10), paddingBottom: insets.bottom + 100 }}>
      <View style={styles.page}>
        <ScreenHeader title="Settings" subtitle="Privacy is a product feature" />
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Avatar initials={session?.phone?.slice(-2) ?? 'QL'} color="#5D8F82" size={54} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>Phone account</Text>
            <Text style={[styles.profileId, { color: colors.mutedForeground }]}>{session?.phone ? `+${session.phone}` : 'Signed-in device session'}</Text>
          </View>
          <Feather name="shield" size={17} color={colors.primary} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ACCOUNT</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="log-out"
            title="Sign out"
            detail="Revoke this device session"
            onPress={() => Alert.alert(
              'Sign out of QuietLink?',
              'This removes the saved device token and asks the API to revoke this session.',
              [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
              ],
            )}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PRIVACY & SECURITY</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="shield"
            title="Encryption status"
            detail={storageStatus === 'encrypted' ? 'SQLCipher vault · local media only' : 'Local vault unavailable · E2EE pending'}
            onPress={() => Alert.alert(
              'Encryption status',
              `${storageError ? `${storageError}\n\n` : ''}Local vault: ${storageStatus === 'encrypted' ? 'SQLCipher active' : 'unavailable'}. Imported media is encrypted at rest only. Message sending, media sharing, and device transfer remain locked pending E2EE review.`,
            )}
          />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="message-square" title="Message sending" detail={messagingStatus === 'locked' ? 'Locked until E2EE review' : 'Encrypted transport ready'} onPress={() => Alert.alert('Message sending', messagingStatus === 'locked' ? 'No reviewed E2EE protocol and encrypted transport are installed. Messages and media cannot be sent.' : 'Encrypted transport is configured.')} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="lock" title="App lock" detail="Unavailable in this preview" onPress={() => explainNotReady('App lock')} trailing={<Text style={[styles.notAvailable, { color: colors.mutedForeground }]}>Not set</Text>} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="eye" title="Message previews" detail="Always hidden; alert payloads stay generic" onPress={() => Alert.alert('Message privacy', 'QuietLink local notifications never include chat text or media. Remote push delivery is not connected.')} trailing={<Feather name="lock" size={14} color={colors.mutedForeground} />} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow
            icon="refresh-cw"
            title="Transfer chats"
            detail="Unavailable until E2EE is reviewed"
            onPress={() => Alert.alert(
              'Device transfer unavailable',
              'No chat history or vault key is transferred. A reviewed E2EE protocol and native local-network transport must be approved and tested first.',
            )}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>RINGTONE SETTINGS</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="phone-incoming" title="Call sounds" detail="Play local ringtone and call tones" trailing={<Switch value={settings.callSoundsEnabled} onValueChange={(value) => void updateSettings({ callSoundsEnabled: value })} trackColor={{ true: colors.primary }} />} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow
            icon="music"
            title="Incoming ringtone"
            detail={`Selected tone · ${ringtoneOptions.find((item) => item.value === settings.ringtone)?.label ?? 'Soft'}`}
            trailing={<SoundPreviewButton tone={settings.ringtone} label="incoming ringtone" />}
          />
          <ChoicePills value={settings.ringtone} choices={ringtoneOptions} onSelect={(value) => void updateSettings({ ringtone: value })} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="radio" title="Outgoing ringback" detail="Preview the local ringback tone" trailing={<SoundPreviewButton tone="ringback" label="outgoing ringback" />} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="phone-off" title="Call disconnect" detail="Preview the local end-call tone" trailing={<SoundPreviewButton tone="ended" label="call disconnect" />} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow
            icon="smartphone"
            title="Vibration pattern"
            detail={`Selected pattern · ${vibrationOptions.find((item) => item.value === settings.vibrationPattern)?.label ?? 'Double'}`}
            onPress={() => {
              const nextIndex = (vibrationOptions.findIndex((item) => item.value === settings.vibrationPattern) + 1) % vibrationOptions.length;
              const next = vibrationOptions[nextIndex].value;
              void updateSettings({ vibrationPattern: next });
              previewVibration(next);
            }}
            trailing={<Text style={[styles.permissionStatus, { color: colors.mutedForeground }]}>{vibrationOptions.find((item) => item.value === settings.vibrationPattern)?.label}</Text>}
          />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>CHAT SETTINGS</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="volume-2" title="In-app message sounds" detail="Play a subtle sent or incoming sound" trailing={<Switch value={settings.chatSoundsEnabled} onValueChange={(value) => void updateSettings({ chatSoundsEnabled: value })} trackColor={{ true: colors.primary }} />} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="corner-up-right" title="Sent sound" detail="Preview the message sent tone" trailing={<SoundPreviewButton tone="sent" label="sent message" />} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="message-circle" title="Incoming sound" detail="Preview the message received tone" trailing={<SoundPreviewButton tone="incoming" label="incoming message" />} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>NOTIFICATIONS & PERMISSIONS</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="bell"
            title="Local notifications"
            detail="Use generic alerts without message text"
            trailing={<Switch value={settings.localNotificationsEnabled} onValueChange={(value) => void handleLocalNotifications(value)} trackColor={{ true: colors.primary }} />}
          />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="send" title="Remote push delivery" detail="Not connected · no push sender is configured" onPress={() => Alert.alert('Remote alerts unavailable', 'QuietLink has no push-delivery service or device-token registration endpoint yet. Local notifications can be tested below; incoming calls and messages cannot wake the app.')} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="bell" title="Test local alert" detail="Schedule a generic device notification" onPress={() => void previewLocalNotification()} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <PermissionRow name="camera" title="Camera" detail="Needed for a future video-call connection" icon="camera" />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <PermissionRow name="microphone" title="Microphone" detail="Needed for calls and encrypted voice capture" icon="mic" />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <PermissionRow name="gallery" title="Photo library" detail="Requested only when you choose an attachment" icon="image" />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <PermissionRow name="notifications" title="Notifications" detail="Permission for local and future push alerts" icon="bell" />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>APP</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="image" title="Storage and media" detail="Local AES-GCM encryption · preview locked" onPress={() => Alert.alert('Storage and media', 'Imported media is encrypted locally with per-file AES-256-GCM keys stored in the SQLCipher vault. Preview and media sending remain locked; the native media renderer and E2EE key wrapper are not installed.')} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="help-circle" title="Privacy notes" detail="What the prototype does and does not protect" onPress={() => explainNotReady('Privacy notes')} />
          {storageStatus === 'encrypted' ? (
            <>
              <View style={[styles.separator, { backgroundColor: colors.border }]} />
              <SettingRow
                icon="trash-2"
                title="Reset local vault"
                detail="Delete local chats and rotate the vault key"
                onPress={() => Alert.alert(
                  'Reset the local vault?',
                  'This permanently deletes local chat history and removes the current vault key before creating a new empty vault. Flash storage, backups, and OS caches cannot be guaranteed erased. App uninstall does not run this action.',
                  [
                    { text: 'Cancel', style: 'cancel' },
                    {
                      text: 'Reset vault',
                      style: 'destructive',
                      onPress: () => {
                        void resetEncryptedVault().then(
                          () => Alert.alert('Vault reset', 'A new empty encrypted vault is ready. This was best-effort key deletion, not a forensic-proof wipe.'),
                          () => Alert.alert('Reset failed', 'The vault could not be safely reset. Check the encryption status before continuing.'),
                        );
                      },
                    },
                  ],
                )}
              />
            </>
          ) : null}
        </View>

        <View style={[styles.disclosure, { backgroundColor: colors.accent }]}>
          <Feather name="alert-triangle" size={16} color={colors.primary} />
          <Text style={[styles.disclosureText, { color: colors.accentForeground }]}>
            {storageStatus === 'encrypted'
              ? 'Demo history is stored in the local SQLCipher vault. Imported media is encrypted locally only. E2EE sending, voice recording, real calls, remote push, and device transfer are not connected. Flash storage and backups cannot be reliably shredded.'
              : 'Demo history is held in app memory and is not transmitted. Local media import requires SQLCipher. E2EE sending, voice recording, real calls, remote push, and device transfer are not connected.'}
          </Text>
        </View>
        <Text style={[styles.version, { color: colors.mutedForeground }]}>QuietLink · Private by design, transparent by default</Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  page: { paddingHorizontal: 20 },
  profileCard: { marginTop: 16, borderWidth: 1, borderRadius: 18, padding: 15, flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 28 },
  profileName: { fontSize: 15, fontWeight: '700' },
  profileId: { fontSize: 11, marginTop: 4 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.15, marginBottom: 9, marginTop: 4 },
  group: { borderRadius: 17, borderWidth: 1, overflow: 'hidden', marginBottom: 23 },
   settingRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, paddingVertical: 8 },
  settingIcon: { width: 34, height: 34, borderRadius: 11, alignItems: 'center', justifyContent: 'center' },
  settingCopy: { flex: 1 },
  settingTitle: { fontSize: 13, fontWeight: '600' },
  settingDetail: { fontSize: 10.5, marginTop: 3 },
  separator: { height: StyleSheet.hairlineWidth, marginLeft: 58 },
  disclosure: { padding: 13, borderRadius: 14, flexDirection: 'row', alignItems: 'flex-start', gap: 9 },
  disclosureText: { flex: 1, fontSize: 10.5, lineHeight: 16 },
  version: { textAlign: 'center', fontSize: 10.5, marginTop: 20 },
  notAvailable: { fontSize: 10, fontWeight: '600', marginRight: 3 },
  permissionStatus: { fontSize: 10, fontWeight: '700', marginRight: 3 },
  pillRow: { flexDirection: 'row', gap: 7, paddingHorizontal: 58, paddingBottom: 13, paddingTop: 2 },
  pill: { minHeight: 29, paddingHorizontal: 12, borderRadius: 10, justifyContent: 'center', alignItems: 'center' },
  pillText: { fontSize: 10, fontWeight: '700' },
});
