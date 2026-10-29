import React from 'react';
import { Alert, Platform, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useMessages } from '@/context/MessageContext';
import { useColors } from '@/hooks/useColors';

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

export default function SettingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { storageStatus, storageError, messagingStatus, resetEncryptedVault } = useMessages();
  const [previews, setPreviews] = React.useState(true);
  const explainNotReady = (feature: string) => Alert.alert(feature, 'This feature is not connected in the prototype. Messages are never sent to a messaging network.');
  return (
    <ScrollView style={[styles.screen, { backgroundColor: colors.background }]} contentContainerStyle={{ paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 10), paddingBottom: insets.bottom + 100 }}>
      <View style={styles.page}>
        <ScreenHeader title="Settings" subtitle="Privacy is a product feature" />
        <View style={[styles.profileCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <Avatar initials="AK" color="#5D8F82" size={54} />
          <View style={{ flex: 1 }}>
            <Text style={[styles.profileName, { color: colors.foreground }]}>Alex Kim</Text>
            <Text style={[styles.profileId, { color: colors.mutedForeground }]}>QuietLink ID · not registered</Text>
          </View>
          <Feather name="edit-2" size={16} color={colors.mutedForeground} />
        </View>

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>PRIVACY & SECURITY</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow
            icon="shield"
            title="Encryption status"
            detail={storageStatus === 'encrypted' ? 'SQLCipher local vault · E2EE pending' : 'Local vault unavailable · E2EE pending'}
            onPress={() => Alert.alert(
              'Encryption status',
              `${storageError ? `${storageError}\n\n` : ''}Local vault: ${storageStatus === 'encrypted' ? 'SQLCipher active' : 'unavailable'}. End-to-end protocol: not configured; message sending is locked. Media and device transfer are unavailable.`,
            )}
          />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="message-square" title="Message sending" detail={messagingStatus === 'locked' ? 'Locked until E2EE review' : 'Encrypted transport ready'} onPress={() => Alert.alert('Message sending', messagingStatus === 'locked' ? 'No reviewed E2EE protocol and encrypted transport are installed. Messages and media cannot be sent.' : 'Encrypted transport is configured.')} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="lock" title="App lock" detail="Unavailable in this preview" onPress={() => explainNotReady('App lock')} trailing={<Text style={[styles.notAvailable, { color: colors.mutedForeground }]}>Not set</Text>} />
          <View style={[styles.separator, { backgroundColor: colors.border }]} />
          <SettingRow icon="eye" title="Message previews" detail="Show message text in notifications" trailing={<Switch value={previews} onValueChange={setPreviews} trackColor={{ true: colors.primary }} />} />
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

        <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>APP</Text>
        <View style={[styles.group, { backgroundColor: colors.card, borderColor: colors.border }]}>
          <SettingRow icon="image" title="Storage and media" detail="Media encryption is not connected" onPress={() => explainNotReady('Storage and media')} />
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
              ? 'Demo history is stored in the local SQLCipher vault. E2EE is not configured, so sending is locked. Media encryption and device transfer are not connected. Flash storage and backups cannot be reliably shredded.'
              : 'Demo history is held in app memory and is not transmitted. E2EE is not configured, so sending is locked. Flash storage and backups cannot be reliably shredded.'}
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
});
