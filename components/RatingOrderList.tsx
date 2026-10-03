import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, PanResponder, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { dropRatingSection, ratingSectionLabels, type RatingSection } from '../lib/ratingOrder';
import { useTheme } from '../theme/useTheme';
import { H } from './haptics';

const ROW_HEIGHT = 58;
type Props = {
  order: RatingSection[];
  disabled: boolean;
  enabled: (key: RatingSection) => boolean;
  onDrop: (order: RatingSection[]) => void;
  onDragState: (active: boolean) => void;
  onDragPosition: (pageY: number) => void;
  scrollOffset: () => number;
};

// Keep handles mounted throughout a drag; preview order never changes their keys.
function Handle({ label, disabled, start, move, end, cancel, accessibleMove }: {
  label: string; disabled: boolean; start: (pageY: number) => void;
  move: (dy: number, pageY: number) => void; end: () => void; cancel: () => void;
  accessibleMove: (direction: number) => void;
}) {
  const { colors } = useTheme();
  const latest = useRef({ disabled, start, move, end, cancel });
  latest.current = { disabled, start, move, end, cancel };
  const responder = useRef(PanResponder.create({
    onStartShouldSetPanResponder: () => !latest.current.disabled,
    onMoveShouldSetPanResponder: () => !latest.current.disabled,
    onPanResponderGrant: event => latest.current.start(event.nativeEvent.pageY),
    onPanResponderMove: (_, gesture) => latest.current.move(gesture.dy, gesture.moveY),
    onPanResponderRelease: () => latest.current.end(),
    onPanResponderTerminate: () => latest.current.cancel(),
    onPanResponderTerminationRequest: () => false,
  })).current;
  return <View {...responder.panHandlers} accessible accessibilityRole="adjustable"
    accessibilityLabel={`Reorder ${label}`} accessibilityHint="Drag up or down. With VoiceOver, swipe up or down to move."
    accessibilityState={{ disabled }} accessibilityActions={[{ name: 'increment', label: 'Move down' }, { name: 'decrement', label: 'Move up' }]}
    onAccessibilityAction={event => { if (!disabled) accessibleMove(event.nativeEvent.actionName === 'increment' ? 1 : -1); }}
    style={{ width: 48, height: 54, alignItems: 'center', justifyContent: 'center' }}>
    <Ionicons name="reorder-three-outline" size={26} color={colors.text.muted} />
  </View>;
}

export default function RatingOrderList(props: Props) {
  const { colors } = useTheme();
  const latest = useRef(props); latest.current = props;
  const drag = useRef<{ key: RatingSection; order: RatingSection[]; from: number; offset: number; dy: number; target: number } | null>(null);
  const [preview, setPreview] = useState<RatingSection[] | null>(null);
  const [activeKey, setActiveKey] = useState<RatingSection | null>(null);
  const translation = useRef(new Animated.Value(0)).current;
  const tick = useRef<ReturnType<typeof setInterval> | null>(null);
  const update = () => {
    const current = drag.current;
    if (!current) return;
    const delta = current.dy + latest.current.scrollOffset() - current.offset;
    const clamped = Math.max(-current.from * ROW_HEIGHT, Math.min((current.order.length - 1 - current.from) * ROW_HEIGHT, delta));
    translation.setValue(clamped);
    const target = Math.max(0, Math.min(current.order.length - 1, Math.round(current.from + clamped / ROW_HEIGHT)));
    if (target !== current.target) {
      current.target = target;
      setPreview(dropRatingSection(current.order, current.key, target));
      H.tap();
    }
  };
  const finish = (commit: boolean) => {
    const current = drag.current;
    drag.current = null;
    if (tick.current) clearInterval(tick.current);
    tick.current = null;
    setActiveKey(null); setPreview(null); translation.setValue(0);
    latest.current.onDragState(false);
    if (commit && current && current.target !== current.from) {
      latest.current.onDrop(dropRatingSection(current.order, current.key, current.target));
      AccessibilityInfo.announceForAccessibility(`${ratingSectionLabels[current.key]}, position ${current.target + 1}`);
    }
  };
  useEffect(() => () => {
    if (tick.current) clearInterval(tick.current);
    latest.current.onDragState(false);
  }, []);
  return <View style={{ height: props.order.length * ROW_HEIGHT }}>
    {props.order.map((key, index) => {
      const active = activeKey === key;
      const position = preview ? preview.indexOf(key) : index;
      return <Animated.View key={key} style={{ position: 'absolute', left: 0, right: 0, top: (active ? index : position) * ROW_HEIGHT,
        height: ROW_HEIGHT, transform: [{ translateY: active ? translation : 0 }], zIndex: active ? 2 : 0,
        flexDirection: 'row', alignItems: 'center', paddingLeft: 8, borderBottomWidth: 1, borderBottomColor: colors.border.subtle,
        backgroundColor: active ? colors.bg.secondary : 'transparent', borderRadius: active ? 10 : 0, opacity: props.disabled ? 0.5 : 1 }}>
        <Animated.Text style={{ flex: 1, color: props.enabled(key) ? colors.text.secondary : colors.text.muted }}>{ratingSectionLabels[key]}{props.enabled(key) ? '' : ' · Off'}</Animated.Text>
        <Handle label={ratingSectionLabels[key]} disabled={props.disabled}
          start={pageY => {
            if (drag.current) return;
            drag.current = { key, order: [...latest.current.order], from: index, offset: latest.current.scrollOffset(), dy: 0, target: index };
            setActiveKey(key); setPreview(latest.current.order); translation.setValue(0);
            latest.current.onDragPosition(pageY); latest.current.onDragState(true); H.tap();
            tick.current = setInterval(update, 16);
          }}
          move={(dy, pageY) => { if (drag.current) { drag.current.dy = dy; latest.current.onDragPosition(pageY); update(); } }}
          end={() => finish(true)} cancel={() => finish(false)}
          accessibleMove={direction => latest.current.onDrop(dropRatingSection(latest.current.order, key, index + direction))} />
      </Animated.View>;
    })}
  </View>;
}
