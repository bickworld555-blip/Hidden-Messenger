import React from 'react';
import { Platform, StyleSheet, useColorScheme, View, type ColorValue } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { NativeTabs } from 'expo-router/native-tabs';
import { SymbolView } from 'expo-symbols';
import { useColors } from '@/hooks/useColors';

function NativeTabLayout() {
  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <NativeTabs.Trigger.Icon sf={{ default: 'bubble.left.and.bubble.right', selected: 'bubble.left.and.bubble.right.fill' }} />
        <NativeTabs.Trigger.Label>Chats</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="calls">
        <NativeTabs.Trigger.Icon sf={{ default: 'phone', selected: 'phone.fill' }} />
        <NativeTabs.Trigger.Label>Calls</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="status">
        <NativeTabs.Trigger.Icon sf={{ default: 'circle.dashed', selected: 'circle.dashed.inset.filled' }} />
        <NativeTabs.Trigger.Label>Status</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="settings">
        <NativeTabs.Trigger.Icon sf={{ default: 'gearshape', selected: 'gearshape.fill' }} />
        <NativeTabs.Trigger.Label>Settings</NativeTabs.Trigger.Label>
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const isDark = useColorScheme() === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';
  const icon = (name: React.ComponentProps<typeof Feather>['name']) =>
    ({ color, focused }: { color?: ColorValue | null; focused: boolean }) =>
      isIOS ? (
        <SymbolView name={name === 'message-circle' ? 'bubble.left.and.bubble.right' : name === 'phone' ? 'phone' : name === 'circle' ? 'circle.dashed' : 'gearshape'} tintColor={color ?? colors.primary} size={22} />
      ) : (
        <Feather name={name} size={21} color={focused ? colors.primary : colors.mutedForeground} />
      );

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarStyle: {
          position: 'absolute',
          height: Platform.OS === 'web' ? 84 : 62,
          paddingTop: 7,
          backgroundColor: isIOS ? 'transparent' : colors.card,
          borderTopWidth: isWeb ? 1 : StyleSheet.hairlineWidth,
          borderTopColor: colors.border,
          elevation: 0,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView intensity={90} tint={isDark ? 'dark' : 'light'} style={StyleSheet.absoluteFill} />
          ) : (
            <View style={[StyleSheet.absoluteFill, { backgroundColor: colors.card }]} />
          ),
        tabBarLabelStyle: { fontSize: 10, fontWeight: '600' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Chats', tabBarIcon: icon('message-circle') }} />
      <Tabs.Screen name="calls" options={{ title: 'Calls', tabBarIcon: icon('phone') }} />
      <Tabs.Screen name="status" options={{ title: 'Status', tabBarIcon: icon('circle') }} />
      <Tabs.Screen name="settings" options={{ title: 'Settings', tabBarIcon: icon('settings') }} />
    </Tabs>
  );
}

export default function TabLayout() {
  return isLiquidGlassAvailable() ? <NativeTabLayout /> : <ClassicTabLayout />;
}
