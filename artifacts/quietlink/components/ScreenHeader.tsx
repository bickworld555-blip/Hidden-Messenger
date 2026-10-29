import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export function ScreenHeader({
  title,
  subtitle,
  rightIcon,
  onRightPress,
}: {
  title: string;
  subtitle?: string;
  rightIcon?: React.ComponentProps<typeof Feather>['name'];
  onRightPress?: () => void;
}) {
  const colors = useColors();
  return (
    <View style={styles.row}>
      <View style={styles.copy}>
        <Text style={[styles.title, { color: colors.foreground }]}>{title}</Text>
        {subtitle ? <Text style={[styles.subtitle, { color: colors.mutedForeground }]}>{subtitle}</Text> : null}
      </View>
      {rightIcon ? (
        <Pressable onPress={onRightPress} hitSlop={12} accessibilityRole="button" accessibilityLabel={rightIcon}>
          <Feather name={rightIcon} size={21} color={colors.foreground} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { minHeight: 62, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  copy: { gap: 2 },
  title: { fontSize: 29, fontWeight: '700', letterSpacing: -0.8 },
  subtitle: { fontSize: 13, fontWeight: '500' },
});
