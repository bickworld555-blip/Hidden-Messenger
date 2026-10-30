import React, { useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { Feather } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScreenHeader } from '@/components/ScreenHeader';
import { useColors } from '@/hooks/useColors';
import { parseCallInvite } from '@/security/secureCallVerification';

export default function CallsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const scanHandled = useRef(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scanError, setScanError] = useState('');

  const openScanner = async () => {
    if (Platform.OS === 'web') {
      setScanError('Join calls by scanning an invitation QR in the rebuilt native iOS or Android app.');
      return;
    }
    const permission = cameraPermission?.granted ? cameraPermission : await requestCameraPermission();
    if (permission.status !== 'granted') {
      setScanError('Allow camera access to scan a call invitation.');
      if (permission.status === 'denied' && !permission.canAskAgain) {
        Alert.alert('Camera access denied', 'Open device settings to allow QR scanning.', [
          { text: 'Cancel', style: 'cancel' },
          {
            text: 'Open settings',
            onPress: () => {
              if (Platform.OS !== 'web') void Linking.openSettings().catch(() => setScanError('Could not open device settings.'));
            },
          },
        ]);
      }
      return;
    }
    scanHandled.current = false;
    setScanError('');
    setScannerOpen(true);
  };

  const handleScannedQr = (value: string) => {
    if (scanHandled.current) return;
    scanHandled.current = true;
    const invite = parseCallInvite(value);
    if (!invite) {
      setScannerOpen(false);
      setScanError('This is not a valid or current Hidden Messenger call invitation.');
      return;
    }
    setScannerOpen(false);
    router.push({
      pathname: '/call/[id]',
      params: {
        id: invite.roomId,
        name: 'Secure call',
        mode: invite.mode,
        role: 'joiner',
        invite: value,
      },
    });
  };

  return (
    <View style={[
      styles.screen,
      {
        backgroundColor: colors.background,
        paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 10),
        paddingBottom: insets.bottom + 86,
      },
    ]}>
      <View style={styles.headerWrap}>
        <ScreenHeader title="Calls" subtitle="QR-verified peer-to-peer calls" />
      </View>
      {scannerOpen ? (
        <View style={styles.scanner}>
          <CameraView
            style={StyleSheet.absoluteFill}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ['qr'] }}
            onBarcodeScanned={({ data }) => handleScannedQr(data)}
          />
          <View style={styles.scannerFooter}>
            <Text style={styles.scannerTitle}>Scan call invitation</Text>
            <Text style={styles.scannerCopy}>The short-lived QR contains a one-time pairing token.</Text>
            <Pressable onPress={() => setScannerOpen(false)} style={styles.closeButton} accessibilityRole="button" accessibilityLabel="Close scanner">
              <Feather name="x" size={20} color="#FFFFFF" />
            </Pressable>
          </View>
        </View>
      ) : (
        <View style={styles.content}>
          <View style={[styles.hero, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <View style={[styles.heroIcon, { backgroundColor: colors.accent }]}>
              <Feather name="shield" size={24} color={colors.primary} />
            </View>
            <Text style={[styles.title, { color: colors.foreground }]}>Private calls, verified in person</Text>
            <Text style={[styles.body, { color: colors.mutedForeground }]}>
              Start an audio or video call from a chat. The other device scans its temporary invitation, then scans a second QR to confirm the WebRTC fingerprint before media starts.
            </Text>
            <View style={[styles.privacyNote, { backgroundColor: colors.accent }]}>
              <Feather name="lock" size={14} color={colors.primary} />
              <Text style={[styles.privacyText, { color: colors.accentForeground }]}>
                Media uses WebRTC DTLS-SRTP. Signaling relays setup data only; it does not carry call audio or video.
              </Text>
            </View>
          </View>
          <Pressable
            onPress={() => void openScanner()}
            style={({ pressed }) => [
              styles.joinButton,
              { backgroundColor: pressed ? colors.accent : colors.primary },
            ]}
            accessibilityRole="button"
            accessibilityLabel="Scan a secure call invitation"
          >
            <Feather name="camera" size={19} color={colors.primaryForeground} />
            <Text style={[styles.joinButtonText, { color: colors.primaryForeground }]}>Scan call invitation</Text>
          </Pressable>
          {scanError ? <Text style={[styles.error, { color: colors.destructive }]}>{scanError}</Text> : null}
          {Platform.OS === 'web' ? (
            <Text style={[styles.webNote, { color: colors.mutedForeground }]}>
              Web preview cannot access native WebRTC. Use a custom iOS or Android development build.
            </Text>
          ) : null}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerWrap: { paddingHorizontal: 20 },
  content: { flex: 1, paddingHorizontal: 20, paddingTop: 22, gap: 14 },
  hero: { borderWidth: 1, borderRadius: 23, padding: 19, gap: 13 },
  heroIcon: { width: 48, height: 48, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  body: { fontSize: 13, lineHeight: 19 },
  privacyNote: { flexDirection: 'row', alignItems: 'flex-start', gap: 9, padding: 11, borderRadius: 13 },
  privacyText: { flex: 1, fontSize: 11, lineHeight: 16 },
  joinButton: { minHeight: 54, borderRadius: 17, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 9 },
  joinButtonText: { fontSize: 13, fontWeight: '700' },
  error: { fontSize: 12, lineHeight: 17, textAlign: 'center' },
  webNote: { fontSize: 11, lineHeight: 16, textAlign: 'center', marginTop: 4 },
  scanner: { flex: 1, margin: 18, overflow: 'hidden', borderRadius: 22 },
  scannerFooter: { ...StyleSheet.absoluteFill, alignItems: 'center', justifyContent: 'flex-end', padding: 22, gap: 9, backgroundColor: 'rgba(0,0,0,0.2)' },
  scannerTitle: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },
  scannerCopy: { color: '#FFFFFF', fontSize: 12, lineHeight: 17, textAlign: 'center', maxWidth: 270 },
  closeButton: { width: 46, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.55)', marginTop: 5 },
});
