import Ionicons from '@expo/vector-icons/Ionicons';
import { router } from 'expo-router';
import React, { useState } from 'react';
import { Modal, Pressable, Text, View } from 'react-native';
import { useTheme } from '../theme/useTheme';

type ListenView = 'releases' | 'artists';

export default function ListenViewSwitcher({ value }: { value: ListenView }) {
  const { colors } = useTheme();
  const [open, setOpen] = useState(false);
  const title = value === 'releases' ? 'Your Listen List' : 'Artists to Check Out';
  const choose = (next: ListenView) => {
    setOpen(false);
    if (next === value) return;
    if (next === 'artists') router.push('/saved-artists');
    else router.replace('/(tabs)/listen');
  };

  return <>
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}. Change list`}
      accessibilityState={{ expanded: open }}
      onPress={() => setOpen(true)}
      style={({ pressed }) => ({ minHeight: 44, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.8 : 1 })}
    >
      <Text numberOfLines={1} style={{ fontSize: 22, fontWeight: '800', color: colors.text.secondary, flexShrink: 1 }}>{title}</Text>
      <Ionicons name="chevron-down" size={18} color={colors.accent.primary} />
    </Pressable>
    <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
      <View style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.42)' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close list selection"
          onPress={() => setOpen(false)}
          style={{ position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 }}
        />
        <View style={{ marginTop: 92, marginHorizontal: 20, borderRadius: 18, padding: 8, backgroundColor: colors.bg.elevated, borderWidth: 1, borderColor: colors.border.subtle }}>
          {([
            { key: 'releases' as const, label: 'Your Listen List', detail: 'Music saved for later' },
            { key: 'artists' as const, label: 'Artists to Check Out', detail: 'Artists you want to explore' },
          ]).map(option => {
            const selected = option.key === value;
            return <Pressable
              key={option.key}
              accessibilityRole="menuitem"
              accessibilityState={{ selected }}
              onPress={() => choose(option.key)}
              style={({ pressed }) => ({ minHeight: 64, paddingHorizontal: 14, paddingVertical: 10, borderRadius: 13, flexDirection: 'row', alignItems: 'center', backgroundColor: selected ? `${colors.accent.primary}20` : pressed ? colors.bg.muted : 'transparent' })}
            >
              <View style={{ flex: 1 }}>
                <Text style={{ color: selected ? colors.accent.primary : colors.text.secondary, fontSize: 16, fontWeight: '700' }}>{option.label}</Text>
                <Text style={{ color: colors.text.muted, fontSize: 12, marginTop: 3 }}>{option.detail}</Text>
              </View>
              {selected ? <Ionicons name="checkmark" size={20} color={colors.accent.primary} /> : null}
            </Pressable>;
          })}
        </View>
      </View>
    </Modal>
  </>;
}
