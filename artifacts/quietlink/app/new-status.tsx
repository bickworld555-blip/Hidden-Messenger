import React, { useState } from 'react';
import { Alert, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

export default function NewStatusScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [text, setText] = useState('');
  const save = () => {
    if (!text.trim()) return;
    Alert.alert('Preview only', 'This status was not shared. Status publishing is not connected in this prototype.', [{ text: 'OK', onPress: () => router.back() }]);
  };
  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 10), paddingBottom: insets.bottom + 12 }]}>
      <View style={styles.header}>
        <Pressable onPress={() => router.back()} hitSlop={10}><Feather name="x" size={22} color={colors.foreground} /></Pressable>
        <Text style={[styles.title, { color: colors.foreground }]}>New status</Text>
        <Pressable onPress={save} disabled={!text.trim()} hitSlop={10} accessibilityLabel="Publish status">
          <Feather name="check" size={22} color={text.trim() ? colors.primary : colors.mutedForeground} />
        </Pressable>
      </View>
      <View style={[styles.editor, { backgroundColor: colors.accent }]}>
        <TextInput
          value={text}
          onChangeText={setText}
          placeholder="Share a thought..."
          placeholderTextColor={colors.mutedForeground}
          maxLength={220}
          multiline
          autoFocus
          style={[styles.input, { color: colors.accentForeground }]}
          accessibilityLabel="Status text"
        />
        <Text style={[styles.count, { color: colors.mutedForeground }]}>{text.length}/220</Text>
      </View>
      <Text style={[styles.note, { color: colors.mutedForeground }]}>Status preview is local to this screen and won’t be published.</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingHorizontal: 18 },
  header: { minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { fontSize: 18, fontWeight: '700' },
  editor: { flex: 1, marginTop: 16, borderRadius: 22, padding: 20, justifyContent: 'center' },
  input: { textAlign: 'center', fontSize: 24, fontWeight: '600', minHeight: 120 },
  count: { textAlign: 'right', fontSize: 10 },
  note: { textAlign: 'center', fontSize: 11, marginTop: 14 },
});
