import React from 'react';
import { reloadAppAsync } from 'expo';
import {
  Pressable,
  StatusBar,
  StyleSheet,
  Text,
  useColorScheme,
  View,
} from 'react-native';
import type { ErrorFallbackProps } from '@/components/ErrorFallback';
import colors from '@/constants/colors';

export function RootStartupErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const isDark = useColorScheme() === 'dark';
  const palette = isDark ? colors.dark : colors.light;

  const restart = async () => {
    try {
      await reloadAppAsync();
    } catch {
      resetError();
    }
  };

  return (
    <View style={[styles.container, { backgroundColor: palette.background }]}>
      <StatusBar
        barStyle={isDark ? 'light-content' : 'dark-content'}
      />
      <View style={styles.content}>
        <Text
          accessibilityRole="header"
          style={[styles.title, { color: palette.foreground }]}
        >
          Hidden Messenger couldn’t start
        </Text>
        <Text style={[styles.message, { color: palette.mutedForeground }]}>
          A startup error interrupted the app. Restart Hidden Messenger to try again.
        </Text>
        {__DEV__ ? (
          <Text selectable style={[styles.details, { color: palette.mutedForeground }]}>
            {error.message}
          </Text>
        ) : null}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Restart Hidden Messenger"
          onPress={() => { void restart(); }}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: palette.primary,
              opacity: pressed ? 0.8 : 1,
            },
          ]}
        >
          <Text style={[styles.buttonText, { color: palette.primaryForeground }]}>
            Restart app
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 32,
  },
  content: {
    alignItems: 'center',
    alignSelf: 'center',
    gap: 16,
    maxWidth: 480,
    width: '100%',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
  },
  details: {
    fontSize: 13,
    lineHeight: 19,
    textAlign: 'center',
  },
  button: {
    alignItems: 'center',
    borderRadius: 12,
    minWidth: 180,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  buttonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
