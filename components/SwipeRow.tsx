/* ========================================================================
   File: components/SwipeRow.tsx
   PURPOSE: Animated, polished swipe with full-swipe actions (no extra taps).
   VISUALS: Soft reveal, bold pill chip, stable labels, icons.
   ======================================================================== */
import React, { useMemo, useRef } from 'react';
import { Animated, Text, View } from 'react-native';
import { Swipeable } from 'react-native-gesture-handler';
import { useTheme } from '../theme/useTheme';

type MaybePromise = void | Promise<void>;

type Props = {
  isDone: boolean;
  onToggleDone: () => MaybePromise;
  onRemove: () => MaybePromise;
  children: React.ReactNode;
  disabled?: boolean;
  leftThreshold?: number;   // swipe distance to trigger left action
  rightThreshold?: number;  // swipe distance to trigger right action
  onHapticSuccess?: () => void; // pass H.success
  onHapticTap?: () => void;     // pass H.tap
  onHapticError?: () => void;   // pass H.error
};

function Pill({
  text,
  bg,
  textColor,
  align = 'left',
  progress,
  icon,
}: {
  text: string;
    bg: string;
  textColor: string;
  align?: 'left' | 'right';
  progress: Animated.AnimatedInterpolation<string | number>;
    icon?: string;
}) {
  // Scale and fade the chip as you drag
  const scale = progress.interpolate({ inputRange: [0, 1], outputRange: [0.9, 1] });
  const opacity = progress.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0.6, 1] });

  return (
    <Animated.View
      style={{
        transform: [{ scale }],
        opacity,
          backgroundColor: bg,
        paddingHorizontal: 14,
        paddingVertical: 8,
        borderRadius: 12,
        alignSelf: align === 'left' ? 'flex-start' : 'flex-end',
        marginLeft: align === 'left' ? 12 : 0,
        marginRight: align === 'right' ? 12 : 0,
      }}
    >
        <Text style={{ color: textColor, fontWeight: '800' }}>{text}</Text>
    </Animated.View>
  );
}

export default function SwipeRow({
  isDone,
  onToggleDone,
  onRemove,
  children,
  disabled,
  leftThreshold = 56,
  rightThreshold = 56,
  onHapticSuccess,
  onHapticTap,
  onHapticError,
}: Props) {
  const { colors } = useTheme();
  const ref = useRef<Swipeable>(null);

  const close = () => {
    try { ref.current?.close(); } catch {}
  };

  // Renderers receive "progress" (0..1) and "dragX". We animate the pill.
  const left = useMemo(
    () => (progress: Animated.AnimatedInterpolation<number>) => (
      <View style={{ flex: 1, justifyContent: 'center', backgroundColor: colors.bg.muted }}>
        <Pill
          text={isDone ? 'Not listened' : 'Listened'}
          bg={colors.accent.primary}
          textColor={colors.text.inverted}
          align="left"
          progress={progress}
        />
      </View>
    ),
    [colors, isDone]
  );

  const right = useMemo(
    () => (progress: Animated.AnimatedInterpolation<number>) => (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'flex-end', backgroundColor: colors.bg.muted }}>
        <Pill
          text="Remove"
          bg={colors.accent.primary}
          textColor={colors.text.inverted}
          align="right"
          progress={progress}
        />
      </View>
    ),
    [colors]
  );

  return (
    <Swipeable
      ref={ref}
      enabled={!disabled}
      renderLeftActions={left}
      renderRightActions={right}
      leftThreshold={leftThreshold}
      rightThreshold={rightThreshold}
      friction={2.2}             // a bit of resistance for a premium feel
      overshootLeft={false}
      overshootRight={false}
      onSwipeableLeftOpen={async () => {
        if (disabled) return;
        try {
          onHapticTap?.();
          await Promise.resolve(onToggleDone());
          onHapticSuccess?.();
        } catch {
          onHapticError?.();
        } finally {
          close();
        }
      }}
      onSwipeableRightOpen={async () => {
        if (disabled) return;
        try {
          onHapticTap?.();
          await Promise.resolve(onRemove());
          onHapticSuccess?.();
        } catch {
          onHapticError?.();
        } finally {
          close();
        }
      }}
    >
      {children}
    </Swipeable>
  );
}
