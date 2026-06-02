/* ========================================================================
   File: components/Chip.tsx
   PURPOSE: Small selectable chip.
   ======================================================================== */
import React from 'react';
import { Pressable, Text, View, ViewProps } from 'react-native';
import { glassPillBase } from '../constants/ui';
import { themeByName } from '../theme/themes';
import { useTheme } from '../theme/useTheme';

type Props = ViewProps & {
  selected?: boolean;
  label: string;
  onPress?: () => void;
};

export default function Chip({ selected, label, onPress, style, ...rest }: Props) {
  const { colors, themeName } = useTheme();
  const isDark = themeByName[themeName]?.isDark ?? true;
  const base = glassPillBase(colors, { selected, isDark });

  return (
    <Pressable onPress={onPress}>
      <View
        style={[
          base,
          { position: 'relative' },
          style,
        ]}
        {...rest}
      >
        <Text style={{ color: selected ? colors.text.secondary : colors.text.muted, fontWeight: '800', fontSize: 12, lineHeight: 16 }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
