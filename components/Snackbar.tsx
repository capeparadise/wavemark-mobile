import React, { useEffect } from 'react';
import { Animated, Pressable, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '../theme/useTheme';

type Props = {
  visible: boolean;
  message: string;
  actionLabel?: string;
  durationMs?: number;
  onAction?: () => void;
  onTimeout?: () => void;
};

export default function Snackbar({
  visible,
  message,
  actionLabel = 'Undo',
  durationMs = 5000,
  onAction,
  onTimeout,
}: Props) {
  const { colors } = useTheme();
  const opacity = React.useRef(new Animated.Value(0)).current;
  const inset = useSafeAreaInsets();

  useEffect(() => {
    if (visible) {
      Animated.timing(opacity, { toValue: 1, duration: 180, useNativeDriver: true }).start();
      const t = setTimeout(() => onTimeout?.(), durationMs);
      return () => clearTimeout(t);
    } else {
      Animated.timing(opacity, { toValue: 0, duration: 120, useNativeDriver: true }).start();
    }
  }, [visible]);

  if (!visible) return null;

  return (
    <Animated.View style={{
      position: 'absolute', left: 12, right: 12, bottom: 24 + inset.bottom,
      backgroundColor: colors.bg.elevated, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12,
      flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', opacity
    }}>
      <Text style={{ color: colors.text.inverted }}>{message}</Text>
      {onAction && (
        <Pressable onPress={onAction} hitSlop={12}>
          <Text style={{ color: colors.accent.primary, fontWeight: '700' }}>{actionLabel}</Text>
        </Pressable>
      )}
    </Animated.View>
  );
}
