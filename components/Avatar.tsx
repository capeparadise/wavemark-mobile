import React from 'react';
import { Image, View } from 'react-native';

const PLACEHOLDER = require('../assets/images/icon.png');

export default function Avatar({
  uri,
  size = 44,
  borderColor,
  backgroundColor,
}: {
  uri: string | null | undefined;
  size?: number;
  borderColor?: string;
  backgroundColor?: string;
}) {
  const borderRadius = Math.round(size / 2);
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius,
        overflow: 'hidden',
        borderWidth: borderColor ? 1 : 0,
        borderColor: borderColor ?? 'transparent',
        backgroundColor: backgroundColor ?? 'transparent',
      }}
    >
      <Image
        source={uri ? { uri } : PLACEHOLDER}
        style={{ width: size, height: size }}
      />
    </View>
  );
}

