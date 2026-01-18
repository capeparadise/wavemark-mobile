/* ========================================================================
   File: components/Chip.tsx
   PURPOSE: Small selectable chip.
   ======================================================================== */
import React from 'react';
import { Pressable, Text, View, ViewProps } from 'react-native';
import { ui } from '../constants/ui';
import { useTheme } from '../theme/useTheme';

type Props = ViewProps & {
  selected?: boolean;
  label: string;
  onPress?: () => void;
};

export default function Chip({ selected, label, onPress, style, ...rest }: Props) {
  const { colors } = useTheme();
  const baseBg = 'rgba(255,255,255,0.05)';
  const selectedGlow = colors.accent.primary + '26';

  return (
    <Pressable onPress={onPress}>
      <View
        style={[
          {
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: ui.radius.lg,
            borderWidth: selected ? 1 : 0,
            borderColor: selected ? colors.accent.primary + '44' : 'transparent',
            backgroundColor: selected ? selectedGlow : baseBg,
            shadowColor: colors.accent.primary,
            shadowOpacity: selected ? 0.16 : 0.04,
            shadowRadius: selected ? 14 : 6,
            shadowOffset: { width: 0, height: 3 },
            position: 'relative',
          },
          style,
        ]}
        {...rest}
      >
        {selected && (
          <View style={{ position: 'absolute', left: 10, right: 10, top: 6, height: 2, borderRadius: 2, backgroundColor: colors.accent.primary + '55' }} />
        )}
        <Text style={{ color: selected ? colors.text.secondary : colors.text.muted, fontWeight: '700', fontSize: 12 }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
