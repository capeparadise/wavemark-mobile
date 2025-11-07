/* ========================================================================
   File: components/Chip.tsx
   PURPOSE: Small selectable chip.
   ======================================================================== */
import React from 'react';
import { Pressable, Text, View, ViewProps } from 'react-native';

type Props = ViewProps & {
  selected?: boolean;
  label: string;
  onPress?: () => void;
};

export default function Chip({ selected, label, onPress, style, ...rest }: Props) {
  return (
    <Pressable onPress={onPress}>
      <View
        style={[
          {
            paddingHorizontal: 12,
            paddingVertical: 8,
            borderRadius: 14,
            borderWidth: 1,
            borderColor: selected ? '#1f2937' : '#e5e7eb',
            backgroundColor: selected ? '#111827' : '#ffffff',
          },
          style,
        ]}
        {...rest}
      >
        <Text style={{ color: selected ? '#ffffff' : '#111827', fontWeight: '700', fontSize: 12 }}>
          {label}
        </Text>
      </View>
    </Pressable>
  );
}
