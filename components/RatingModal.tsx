import { normalizeAdvancedOrder, normalizeRatingOrder, ratingSectionLabels, type RatingSection } from '../lib/ratingOrder';
/* ========================================================================
  File: components/RatingModal.tsx
  PURPOSE: Cross-platform rating modal (1–10 slider with haptics & animation).
  ======================================================================== */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Animated, Dimensions, GestureResponderEvent, KeyboardAvoidingView, Platform, Modal, PanResponder, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { H } from './haptics';
import { useTheme } from '../theme/useTheme';
import { advancedRatingTotal, offersArtworkRating, ratingDetailsForSubmit, type RatingDetails } from '../lib/ratingDisplay';
import { normalizeReview, REVIEW_MAX_LENGTH } from '../lib/review';
import { useRatingPreferences } from '../lib/ratingPreferences';

type Props = {
  visible: boolean;
  title?: string;
  initial?: number;           // 1..10
  initialDetails?: RatingDetails | null;
  itemType?: string;
  individualTrack?: boolean;
  initialReview?: string | null;
  advanced?: boolean;
  onCancel: () => void;
  onSubmit: (stars: number, details?: RatingDetails | null, review?: string | null) => void;
  onRateLater?: () => void;
  statusLabel?: string; // optional status text (e.g., Marked as listened)
  onUndoStatus?: () => void; // optional undo handler (e.g., mark not listened)
};

export default function RatingModal({
  visible,
  title = 'Rate',
  initial = 0,
  initialDetails = null,
  initialReview = null,
  advanced = false,
  itemType,
  individualTrack = false,
  onCancel,
  onSubmit,
  onRateLater,
  statusLabel,
  onUndoStatus,
}: Props) {
  const { colors } = useTheme();
  const { preferences, ready: preferencesReady } = useRatingPreferences();
  const artworkEnabled = preferencesReady && preferences.artwork && offersArtworkRating(itemType, individualTrack);
  const DEBUG_TOUCH = true;
  const dbg = (...args: any[]) => { if (DEBUG_TOUCH) console.log('[RatingModal]', ...args); };
  // Coerce initial into 1..10 with a sensible default (7) if empty
  const initialValue = useMemo(() => {
    const n = Math.round(Number(initial || 0));
    if (!n || Number.isNaN(n)) return 7;
    return Math.max(1, Math.min(10, n));
  }, [initial]);

  const [value, setValue] = useState<number>(initialValue);
  // Main slider state & geometry (restored)
  const [trackW, setTrackW] = useState<number>(0);
  const [trackLeft, setTrackLeft] = useState<number>(0);
  const mainTrackRef = useRef<View | null>(null);
  const scale = useRef(new Animated.Value(1)).current;
  const lastHaptic = useRef<number | null>(null);
  const [details, setDetails] = useState<RatingDetails>({});
  const [review, setReview] = useState('');
  const [editorExpanded, setEditorExpanded] = useState(false);
  const scrollMaxH = Math.min(560, Math.round(Dimensions.get('window').height * 0.6));
  const [scrollLock, setScrollLock] = useState(false);

  // RatingModal can stay mounted while a different release is selected or the
  // saved rating changes. Reset the slider whenever it opens so "Change
  // rating" reflects the stored value rather than the previous/default one.
  useEffect(() => {
    if (visible) setValue(initialValue);
  }, [initialValue, visible]);

  // Sync initial details
  useEffect(() => {
    if (visible) setDetails(initialDetails ?? {});
  }, [initialDetails, visible]);

  useEffect(() => {
    if (!visible) return;
    const nextReview = String(initialReview ?? '').slice(0, REVIEW_MAX_LENGTH);
    setReview(nextReview);
    setEditorExpanded(false);
  }, [initialReview, visible]);

  // Animate big number
  useEffect(() => {
    Animated.sequence([
      Animated.timing(scale, { toValue: 1.08, duration: 110, useNativeDriver: true }),
      Animated.spring(scale, { toValue: 1, useNativeDriver: true, friction: 6 }),
    ]).start();
  }, [value, scale]);

  // Haptic for main slider integer change
  useEffect(() => {
    if (lastHaptic.current !== value) { lastHaptic.current = value; try { H.tap(); } catch {} }
  }, [value]);

  // Main slider derived geometry
  const min = 1, max = 10, steps = max - min;
  const thumbSize = 24;
  const padX = 12;
  const ratio = steps === 0 ? 0 : (value - min) / steps;
  const filledW = Math.max(0, Math.min(trackW, padX + ratio * (trackW - padX * 2)));
  const thumbX = Math.max(padX, Math.min(trackW - padX, filledW));

  const setFromLocalX = (xLocal: number) => {
    if (trackW <= 0) return;
    const clamped = Math.max(padX, Math.min(trackW - padX, xLocal));
    const denom = Math.max(1, (trackW - padX * 2));
    const r = (clamped - padX) / denom;
    const v = Math.round(min + r * steps);
    setValue(Math.max(min, Math.min(max, v)));
  };
  const setFromPageX = (pageX: number) => {
    if (!trackLeft || trackW <= 0) return;
    setFromLocalX(pageX - trackLeft);
  };

  const mainPan = React.useMemo(() => PanResponder.create({
    onStartShouldSetPanResponder: () => true,
    onMoveShouldSetPanResponder: () => true,
    onStartShouldSetPanResponderCapture: () => true,
    onMoveShouldSetPanResponderCapture: () => true,
    onPanResponderGrant: (e: GestureResponderEvent) => {
      setScrollLock(true);
      dbg('MAIN grant', { trackW, locX: e.nativeEvent.locationX });
      if (trackW > 0) setFromLocalX(e.nativeEvent.locationX);
    },
    onPanResponderMove: (e: GestureResponderEvent) => {
      setFromLocalX(e.nativeEvent.locationX);
    },
    onPanResponderRelease: () => { dbg('MAIN release'); setScrollLock(false); },
    onPanResponderTerminate: () => { dbg('MAIN terminate'); setScrollLock(false); },
    onPanResponderTerminationRequest: () => false,
  }), [trackW]);
  // Small reusable slider for categories (fixed first-tap + persistence)
  const CategorySlider = ({ label, keyName }: { label: string; keyName: 'production' | 'vocals' | 'lyrics' | 'replay' }) => {
    // Mirror main slider: integer value 1..10, haptic on change, drag updates immediately.
    const dbgCat = (...args: any[]) => dbg(`[${keyName}]`, ...args);
    const lastH = useRef<number | null>(null);
    const minV = 1, maxV = 10;
    const [val, setVal] = useState<number>(() => {
      const raw = Math.round(Number((details as any)[keyName] ?? 7));
      if (!raw || Number.isNaN(raw)) return 7;
      return Math.min(maxV, Math.max(minV, raw));
    });

    useEffect(() => {
      const extRaw = Math.round(Number((details as any)[keyName]));
      if (extRaw && !Number.isNaN(extRaw) && extRaw !== val) {
        setVal(Math.min(maxV, Math.max(minV, extRaw)));
      }
    }, [details, keyName]);

    const selectValue = (n: number) => {
      const next = Math.min(maxV, Math.max(minV, n));
      setVal(next);
      setDetails((d) => ({ ...d, [keyName]: next }));
      if (lastH.current !== next) { lastH.current = next; try { H.tap(); } catch {} }
      dbgCat('select', next);
    };

    return (
      <View style={{ marginTop: 14 }}>
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginBottom: 6 }}>
          <Text style={{ fontWeight: '700', color: colors.text.secondary }}>{label}</Text>
          <Text style={{ color: colors.text.muted }}>{val}/10</Text>
        </View>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
          {Array.from({ length: 10 }).map((_, i) => {
            const n = i + 1;
            const active = n === val;
            return (
              <Pressable
                key={n}
                onPress={() => selectValue(n)}
                style={{
                  flex: 1,
                  height: 32,
                  borderRadius: 8,
                  backgroundColor: active ? colors.accent.primary : colors.bg.muted,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Text style={{ color: active ? colors.text.inverted : colors.text.muted, fontWeight: '700', fontSize: 12 }}>{n}</Text>
              </Pressable>
            );
          })}
        </View>
      </View>
    );
  };

  const noteEditor = (preferencesReady && preferences.notes ? <View style={{ marginTop: 8, ...(editorExpanded ? { flex: 1 } : {}) }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '700', fontSize: editorExpanded ? 20 : 14 }}>Your note</Text>
              <Pressable accessibilityRole="button" accessibilityLabel={editorExpanded ? 'Finish editing note' : 'Expand note editor'} onPress={() => setEditorExpanded(value => !value)} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={{ color: colors.accent.primary, fontWeight: '700' }}>{editorExpanded ? 'Done' : 'Expand'}</Text>
              </Pressable>
            </View>
            {editorExpanded ? <Text numberOfLines={2} style={{ color: colors.text.muted, marginBottom: 10 }}>{title} · Save your rating when you’re finished.</Text> : null}
            {(
              <View style={{ marginTop: 4, ...(editorExpanded ? { flex: 1 } : {}) }}>
                <TextInput
                  accessibilityLabel="Rating note"
                  value={review}
                  onChangeText={setReview}
                  placeholder="What stood out? (optional)"
                  placeholderTextColor={colors.text.muted}
                  multiline
                  maxLength={REVIEW_MAX_LENGTH}
                  textAlignVertical="top"
                  style={{
                    minHeight: 82,
                    ...(editorExpanded ? { flex: 1 } : { height: 90 }),
                    borderRadius: 14,
                    borderWidth: 1,
                    borderColor: colors.border.subtle,
                    backgroundColor: colors.bg.secondary,
                    color: colors.text.secondary,
                    paddingHorizontal: 12,
                    paddingVertical: 11,
                    fontSize: 16,
                    lineHeight: 24,
                  }}
                />
                <Text style={{ color: colors.text.muted, fontSize: 11, textAlign: 'right', marginTop: 5 }}>
                  {review.length}/{REVIEW_MAX_LENGTH}
                </Text>
              </View>
            )}
          </View> : null);

  const ratingSections: Partial<Record<RatingSection, React.ReactNode>> = {
    overall: <>
            {/* Slider */}
            {advanced ? <Text style={{ color: colors.text.secondary, fontWeight: '700', marginTop: 4 }}>Overall impression · {value}/10</Text> : null}
            <View style={{ marginTop: 8, marginBottom: 6 }}>
              <View
                ref={mainTrackRef}
                collapsable={false}
                onLayout={(e) => {
                  setTrackW(e.nativeEvent.layout.width);
                  mainTrackRef.current?.measureInWindow?.((x: number) => { if (typeof x === 'number') setTrackLeft(x); });
                }}
                style={{ height: 48, justifyContent: 'center', width: '100%', paddingVertical: 6 }}
                {...mainPan.panHandlers}
              >
                {/* Track background */}
                <View style={{ height: 6, borderRadius: 4, backgroundColor: colors.bg.muted }} pointerEvents="none" />
                {/* Filled track */}
                <View style={{ position: 'absolute', left: 0, right: undefined, width: filledW, height: 6, borderRadius: 4, backgroundColor: colors.accent.primary }} pointerEvents="none" />
                {/* Thumb */}
                <View
                  style={{ position: 'absolute', left: thumbX - thumbSize / 2, width: thumbSize, height: thumbSize, borderRadius: thumbSize / 2, backgroundColor: colors.text.inverted, borderWidth: 2, borderColor: colors.accent.primary, shadowColor: colors.shadow.light, shadowOpacity: 0.1, shadowRadius: 4, shadowOffset: { width: 0, height: 1 } }}
                  pointerEvents="none"
                />
              </View>
              {/* Endpoints labels */}
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 }}>
                <Text style={{ color: colors.text.muted, fontWeight: '700' }}>1</Text>
                <Text style={{ color: colors.text.muted, fontWeight: '700' }}>10</Text>
              </View>
            </View>

 </>,
    advanced: advanced ? <View style={{ marginTop: 16 }}>
      <Text style={{ color: colors.text.secondary, fontSize: 18, fontWeight: '800' }}>Advanced ratings</Text>
      {normalizeAdvancedOrder(preferences.advancedOrder ?? preferences.order).map(key => <CategorySlider key={key} label={ratingSectionLabels[key]} keyName={key} />)}
    </View> : null,
    artwork: <>
            {artworkEnabled ? <View
              style={{ marginTop: 18, paddingTop: 16, borderTopWidth: 1, borderTopColor: colors.border.subtle, gap: 8 }}>
              <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
                <Text style={{ color: colors.text.secondary, fontSize: 18, fontWeight: '800' }}>Artwork rating</Text>
                {details.artwork != null ? <Pressable accessibilityRole="button" accessibilityLabel="Clear artwork rating" onPress={() => setDetails(d => ({ ...d, artwork: undefined }))} style={{ minHeight: 44, justifyContent: 'center' }}><Text style={{ color: colors.accent.primary }}>Clear</Text></Pressable> : null}
              </View>
              <Text style={{ color: colors.text.muted }}>Separate from your music score.</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Array.from({ length: 10 }, (_, i) => i + 1).map(score => <Pressable key={score}
                  accessibilityRole="button" accessibilityLabel={`Artwork ${score} out of 10`} accessibilityState={{ selected: details.artwork === score }}
                  onPress={() => { setDetails(d => ({ ...d, artwork: score })); H.tap(); }}
                  style={{ width: '17%', minHeight: 44, borderRadius: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: details.artwork === score ? colors.accent.primary : colors.bg.muted }}>
                  <Text style={{ color: details.artwork === score ? colors.text.inverted : colors.text.secondary, fontWeight: '700' }}>{score}</Text>
                </Pressable>)}
              </View>
            </View> : null}
 </>,
    notes: noteEditor,
  };

  return (
    <Modal animationType="slide" transparent visible={visible} onRequestClose={() => editorExpanded ? setEditorExpanded(false) : onCancel()}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: colors.overlay.dim, justifyContent: 'flex-end' }}>
        <View
          style={{
            backgroundColor: colors.bg.primary,
            borderTopLeftRadius: 32,
            borderTopRightRadius: 32,
            padding: 18,
            paddingBottom: 22,
            shadowColor: colors.shadow.light, shadowOpacity: 0.12, shadowRadius: 12, shadowOffset: { width: 0, height: -4 },
            elevation: 8,
            ...(editorExpanded ? { height: '90%' as const } : {}),
          }}
        >
          {statusLabel ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 6 }}>
              <Text style={{ color: colors.text.muted, fontWeight: '600' }}>{statusLabel}</Text>
              {onUndoStatus ? (
                <Pressable onPress={onUndoStatus} style={{ marginLeft: 10 }}>
                  <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Undo</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}

          {!editorExpanded ? <ScrollView
            showsVerticalScrollIndicator
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="interactive"
            style={{ maxHeight: scrollMaxH }}
            contentContainerStyle={{ paddingBottom: 8 }}
            scrollEnabled={!scrollLock}
            onStartShouldSetResponderCapture={() => { dbg('SCROLL capture start'); return false; }}
            onMoveShouldSetResponderCapture={() => { dbg('SCROLL capture move'); return false; }}
          >
            {/* Title */}
            <Text style={{ fontSize: 18, fontWeight: '800', textAlign: 'center', letterSpacing: 0.2, marginBottom: 8, color: colors.text.secondary }}>
              {title}
            </Text>

            {/* Big animated number */}
            <View style={{ alignItems: 'center', marginVertical: 8 }}>
              <Animated.Text style={{ fontSize: 44, fontWeight: '900', transform: [{ scale }], color: colors.text.secondary }}>
                {advanced ? `${advancedRatingTotal(value, { production: 7, vocals: 7, lyrics: 7, replay: 7, ...details })}/50` : `${value}/10`}
              </Animated.Text>
            </View>

            {normalizeRatingOrder(preferences.order).map(section => (
              <React.Fragment key={section}>{ratingSections[section]}</React.Fragment>
            ))}

          </ScrollView> : null}

          {editorExpanded ? noteEditor : null}

          {/* Actions */}
          {!editorExpanded ? <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 12, marginTop: 10 }}>
            <Pressable onPress={onCancel}>
              <Text style={{ padding: 10, color: colors.text.secondary }}>Cancel</Text>
            </Pressable>
            {onRateLater ? (
              <Pressable onPress={onRateLater} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, backgroundColor: colors.bg.muted }}>
                <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Rate later</Text>
              </Pressable>
            ) : null}
            <Pressable
              disabled={!preferencesReady}
              onPress={() => onSubmit(
                value || 1,
                ratingDetailsForSubmit(details, advanced, artworkEnabled || (!individualTrack && initialDetails?.artwork != null)),
                preferences.notes ? normalizeReview(review) : initialReview,
              )}
              style={{ backgroundColor: colors.accent.primary, paddingHorizontal: 16, paddingVertical: 10, borderRadius: 12 }}
            >
              <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Save</Text>
            </Pressable>
          </View> : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
