import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import RatingOrderList from '../../components/RatingOrderList';
import Screen from '../../components/StackScreen';
import { useTheme } from '../../theme/useTheme';
import { getAdvancedRatingsEnabled, setAdvancedRatingsEnabled } from '../../lib/user';
import { emit } from '../../lib/events';
import { saveRatingPreferences, useRatingPreferences } from '../../lib/ratingPreferences';
import { normalizeAdvancedOrder, normalizeRatingOrder, type RatingSection } from '../../lib/ratingOrder';

export default function RatingSettings() {
  const { colors } = useTheme();
  const { preferences, ready, userId } = useRatingPreferences();
  const [advanced, setAdvanced] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const [draftOrder, setDraftOrder] = useState<RatingSection[] | null>(null);
  const [draftAdvancedOrder, setDraftAdvancedOrder] = useState<RatingSection[] | null>(null);
  const [dragging, setDragging] = useState(false);
  const scroll = useRef<ScrollView | null>(null);
  const viewportView = useRef<View | null>(null);
  const offset = useRef(0);
  const contentHeight = useRef(0);
  const viewport = useRef({ top: 0, height: 0 });
  const fingerY = useRef(0);
  const order = draftOrder || normalizeRatingOrder(preferences.order);
  const advancedOrder = draftAdvancedOrder || normalizeAdvancedOrder(preferences.advancedOrder ?? preferences.order);
  useEffect(() => {
    if (!dragging) return;
    const timer = setInterval(() => {
      const y = fingerY.current - viewport.current.top;
      const delta = y < 70 ? -10 : y > viewport.current.height - 70 ? 10 : 0;
      if (!delta) return;
      offset.current = Math.max(0, Math.min(Math.max(0, contentHeight.current - viewport.current.height), offset.current + delta));
      scroll.current?.scrollTo({ y: offset.current, animated: false });
    }, 32);
    return () => clearInterval(timer);
  }, [dragging]);
  const reorder = async (next: RatingSection[] = normalizeRatingOrder(null), internal = false, reset = false) => {
    if (locked.current || !userId) return;
    locked.current = true; setBusy(true);
    if (internal) setDraftAdvancedOrder(next); else setDraftOrder(next);
    try {
      await saveRatingPreferences(userId, { ...preferences,
        ...(reset ? { order: normalizeRatingOrder(null), advancedOrder: normalizeAdvancedOrder(null) } :
          internal ? { advancedOrder: normalizeAdvancedOrder(next) } : { order: normalizeRatingOrder(next), advancedOrder: normalizeAdvancedOrder(preferences.advancedOrder ?? preferences.order) }) });
    } catch { Alert.alert('Could not save rating order', 'Please try again.'); }
    finally { locked.current = false; setBusy(false); setDraftOrder(null); setDraftAdvancedOrder(null); }
  };
  useEffect(() => {
    let active = true;
    getAdvancedRatingsEnabled().then(value => { if (active) { setAdvanced(value); setLoaded(true); } }).catch(() => {
      if (active) Alert.alert('Could not load rating settings', 'Go back and reopen this screen to retry.');
    });
    return () => { active = false; };
  }, []);
  const change = async (key: 'advanced' | 'artwork' | 'notes', value: boolean) => {
    if (locked.current || !userId) return;
    locked.current = true; setBusy(true);
    try {
      if (key === 'advanced') {
        if (!await setAdvancedRatingsEnabled(value)) throw new Error();
        setAdvanced(value); emit('prefs:advanced_ratings', value);
      } else await saveRatingPreferences(userId, { ...preferences, [key]: value });
    } catch { Alert.alert('Could not save rating settings', 'Please try again.'); }
    finally { locked.current = false; setBusy(false); }
  };
  return <Screen><View ref={viewportView} collapsable={false} style={{ flex: 1 }}
    onLayout={() => viewportView.current?.measureInWindow((_x, y, _width, height) => { viewport.current = { top: y, height }; })}>
    <ScrollView ref={scroll} scrollEnabled={!dragging}
    onContentSizeChange={(_width, height) => { contentHeight.current = height; }}
    onScroll={event => { offset.current = event.nativeEvent.contentOffset.y; }} scrollEventThrottle={16}
    contentContainerStyle={{ paddingTop: 12, paddingBottom: 40, gap: 18 }}>
    <Text style={{ color: colors.text.secondary, fontSize: 24, fontWeight: '800' }}>Make ratings yours</Text>
    <Text style={{ color: colors.text.muted, lineHeight: 21 }}>Choose what appears when you rate. Turning an option off keeps your saved scores and notes.</Text>
    {!ready || !loaded ? <ActivityIndicator /> : ([
      { key: 'advanced' as const, title: 'Advanced ratings', detail: 'Overall impression plus four music categories, scored out of 50.', value: advanced },
      { key: 'artwork' as const, title: 'Artwork ratings', detail: 'A separate artwork score for singles and albums. Doesn’t affect your music total.', value: preferences.artwork },
      { key: 'notes' as const, title: 'Rating notes', detail: 'Show a space for your thoughts with each rating.', value: preferences.notes },
    ]).map(option => <View key={option.key} style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingVertical: 16, borderBottomWidth: 1, borderBottomColor: colors.border.subtle }}>
      <View style={{ flex: 1, gap: 6 }}><Text style={{ color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>{option.title}</Text><Text style={{ color: colors.text.muted, lineHeight: 20 }}>{option.detail}</Text></View>
      <Switch accessibilityLabel={option.title} disabled={busy} value={option.value} onValueChange={value => void change(option.key, value)} trackColor={{ true: colors.accent.primary, false: colors.border.subtle }} />
    </View>)}
    {ready && loaded ? <View style={{ gap: 8 }}>
      <Text style={{ color: colors.text.secondary, fontSize: 18, fontWeight: '800' }}>Rating order</Text>
      <Text style={{ color: colors.text.muted, lineHeight: 20 }}>Drag the handles to change the order. Disabled sections keep their place.</Text>
      <RatingOrderList order={order} disabled={busy}
        enabled={key => key === 'overall' || (key === 'artwork' ? preferences.artwork : key === 'notes' ? preferences.notes : advanced)}
        onDrop={next => void reorder(next)} onDragState={setDragging}
        onDragPosition={y => { fingerY.current = y; }} scrollOffset={() => offset.current} />
      <View style={{ marginTop: 12, paddingLeft: 12, borderLeftWidth: 2, borderLeftColor: colors.border.subtle, gap: 8 }}>
        <Text style={{ color: colors.text.secondary, fontSize: 16, fontWeight: '700' }}>Within advanced ratings</Text>
        <Text style={{ color: colors.text.muted }}>These four scores always stay together.</Text>
        <RatingOrderList order={advancedOrder} disabled={busy} enabled={() => advanced}
          onDrop={next => void reorder(next, true)} onDragState={setDragging}
          onDragPosition={y => { fingerY.current = y; }} scrollOffset={() => offset.current} />
      </View>
      <Pressable accessibilityRole="button" disabled={busy} onPress={() => void reorder(normalizeRatingOrder(null), false, true)} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent.primary }}>Reset order</Text></Pressable>
    </View> : null}
    <Text style={{ color: colors.text.muted, fontSize: 12 }}>Artwork, notes and rating order are saved for this account on this device.</Text>
  </ScrollView></View></Screen>;
}
