import { useRef, useState } from 'react';
import {
  Animated,
  FlatList,
  Image,
  NativeScrollEvent,
  NativeSyntheticEvent,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { H } from '../components/haptics';
import GlassCard from '../components/GlassCard';
import Screen from '../components/Screen';
import { setHasSeenOnboarding } from '../lib/onboarding';
import { useTheme } from '../theme/useTheme';

const ONBOARDING_SCREENS = [
  {
    id: 'discover',
    label: 'DISCOVER',
    title: 'Find music for your taste',
    body: 'Discover helps you quickly spot new music that you care about.',
    cta: 'Next',
  },
  {
    id: 'feed',
    label: 'FEED',
    title: 'Keep up with artists and friends',
    body: 'See updates from the people and artists you follow.',
    cta: 'Next',
  },
  {
    id: 'profile',
    label: 'PROFILE',
    title: 'Shape your ripple',
    body: 'Your profile shows what you’re into — what you like, what you share, and how people find you.',
    cta: 'Get Started',
  },
] as const;

const ART = {
  jungle: require('../assets/onboarding/discover1.png'),
  freefall: require('../assets/onboarding/discover2.png'),
  inhale: require('../assets/onboarding/discover3.png'),
  enough: require('../assets/onboarding/discover4.png'),
  feed1: require('../assets/onboarding/feed1.png'),
  feed2: require('../assets/onboarding/feed2.png'),
  feed3: require('../assets/onboarding/feed3.png'),
  feedAvatar1: require('../assets/onboarding/feed-avatar-1.png'),
  feedAvatar2: require('../assets/onboarding/feed-avatar-2.png'),
  feedAvatar3: require('../assets/onboarding/feed-avatar-3.png'),
  profileHighlight: require('../assets/onboarding/profile1.png'),
  profileAvatar: require('../assets/onboarding/profile-avatar.png'),
} as const;

const MOCK_DISCOVER = [
  {
    title: 'Jungle',
    artist: 'Fred again..',
    artwork: ART.jungle,
  },
  {
    title: 'Freefall',
    artist: 'Kaytranada',
    artwork: ART.freefall,
  },
  {
    title: 'Escapism',
    artist: 'RAYE',
    artwork: ART.inhale,
  },
  {
    title: 'Too Much',
    artist: 'Sampha',
    artwork: ART.enough,
  },
] as const;

const MOCK_FEED = [
  {
    id: '1',
    type: 'release',
    actor: 'Sampha',
    text: 'released Spirit 2.0',
    artwork: ART.feed1,
    avatar: ART.feedAvatar1,
    timestamp: '2m ago',
    isArtist: true,
  },
  {
    id: '2',
    type: 'activity',
    actor: 'Alex',
    text: 'added Drake to their rotation',
    artwork: ART.feed2,
    avatar: ART.feedAvatar2,
    timestamp: '12m ago',
    isArtist: false,
  },
  {
    id: '3',
    type: 'follow',
    actor: 'Jamie',
    text: 'followed Little Simz',
    artwork: ART.feed3,
    avatar: ART.feedAvatar3,
    timestamp: '1h ago',
    isArtist: false,
  },
] as const;

const MOCK_PROFILE = {
  username: '@username',
  stats: [
    { label: 'Top tracks', value: '128' },
    { label: 'Following', value: '64' },
  ],
  highlight: {
    title: 'Darkest Hour',
    artist: 'Nick Frayzier',
    artwork: ART.profileHighlight,
  },
} as const;

function withAlpha(color: string, opacity: number) {
  if (color.startsWith('#')) {
    let hex = color.slice(1);
    if (hex.length === 3) {
      hex = hex.split('').map((char) => char + char).join('');
    }
    if (hex.length === 6) {
      const value = Number.parseInt(hex, 16);
      const r = (value >> 16) & 255;
      const g = (value >> 8) & 255;
      const b = value & 255;
      return `rgba(${r}, ${g}, ${b}, ${opacity})`;
    }
  }
  return color;
}

function DiscoverPreview() {
  const { colors } = useTheme();

  return (
    <View pointerEvents="none" style={styles.previewWrap}>
      <GlassCard style={[styles.previewSurface, styles.previewSurfaceEmphasis]}>
        <Text style={[styles.previewHeading, { color: colors.text.muted }]}>Today for you</Text>
        <View style={styles.discoverList}>
          {MOCK_DISCOVER.map((item, index) => (
            <View
              key={item.title}
              style={[
                styles.discoverPreviewRow,
                index === 0 ? styles.primaryCardWrap : null,
                {
                  backgroundColor: withAlpha(colors.bg.secondary, 0.86),
                  borderColor: colors.border.subtle,
                },
              ]}
            >
              <Image
                source={item.artwork}
                style={styles.discoverPreviewArt}
                resizeMode="cover"
              />
              <View style={styles.discoverPreviewCopy}>
                <Text style={[styles.discoverPreviewTitle, { color: colors.text.secondary }]} numberOfLines={1}>
                  {item.title}
                </Text>
                <Text style={[styles.discoverPreviewArtist, { color: colors.text.muted }]} numberOfLines={1}>
                  {item.artist}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </GlassCard>
    </View>
  );
}

function FeedPreview() {
  const { colors } = useTheme();

  return (
    <View pointerEvents="none" style={styles.previewWrap}>
      <GlassCard style={styles.previewSurface}>
        <Text style={[styles.previewHeading, { color: colors.text.muted }]}>Recent activity</Text>
        <View style={styles.feedPreviewList}>
          {MOCK_FEED.map((item, index) => (
            <View
              key={item.id}
              style={[
                styles.feedPreviewRow,
                index === 0 ? styles.feedPreviewRowActive : null,
                index < MOCK_FEED.length - 1
                  ? { borderBottomWidth: 1, borderBottomColor: withAlpha(colors.border.subtle, 0.45) }
                  : null,
              ]}
            >
              <View
                style={[
                  styles.feedPreviewAvatarWrap,
                  {
                    borderColor: item.isArtist
                      ? withAlpha(colors.accent.primary, 0.34)
                      : colors.border.muted,
                  },
                ]}
              >
                <Image source={item.avatar} style={styles.feedPreviewAvatar} resizeMode="cover" />
              </View>
              <View style={styles.feedPreviewCopy}>
                <Text style={[styles.feedPreviewText, { color: colors.text.secondary }]} numberOfLines={2}>
                  <Text style={{ fontWeight: '700' }}>{item.actor} </Text>
                  {item.text}
                </Text>
                <Text style={[styles.feedPreviewTime, { color: colors.text.muted }]}>{item.timestamp}</Text>
              </View>
              <View
                style={[
                  styles.feedPreviewThumbWrap,
                  index === 0 ? styles.feedPreviewThumbWrapActive : null,
                  {
                    borderColor: colors.border.subtle,
                    backgroundColor: withAlpha(colors.bg.secondary, 0.8),
                  },
                ]}
              >
                <Image
                  source={item.artwork}
                  style={styles.feedPreviewThumb}
                  resizeMode="cover"
                />
              </View>
            </View>
          ))}
        </View>
      </GlassCard>
    </View>
  );
}

function ProfilePreview() {
  const { colors } = useTheme();

  return (
    <View pointerEvents="none" style={styles.previewWrap}>
      <View style={styles.profilePreviewStack}>
        <GlassCard style={[styles.profileHeroCard, styles.previewSurfaceEmphasis]}>
          <View style={styles.profileHeroTop}>
            <View style={styles.profileIdentity}>
              <View
                style={[
                  styles.profileAvatarWrap,
                  {
                    borderColor: colors.border.muted,
                    backgroundColor: colors.bg.muted,
                  },
                ]}
              >
                <Image source={ART.profileAvatar} style={styles.profileAvatarImage} resizeMode="cover" />
              </View>
              <View>
                <Text style={[styles.profileName, { color: colors.text.secondary }]}>{MOCK_PROFILE.username}</Text>
                <Text style={[styles.profileLabel, { color: colors.text.muted }]}>Profile</Text>
              </View>
            </View>
          </View>
        </GlassCard>

        <View style={styles.profileStatsPreviewRow}>
          {MOCK_PROFILE.stats.map((stat) => (
            <GlassCard key={stat.label} style={styles.profileStatCard}>
              <Text style={[styles.profileStatLabel, { color: colors.text.muted }]}>{stat.label}</Text>
              <Text style={[styles.profileStatValue, { color: colors.text.secondary }]}>{stat.value}</Text>
            </GlassCard>
          ))}
        </View>

        <GlassCard style={styles.profileHighlightCard}>
          <Text style={[styles.profileHighlightHeading, { color: colors.text.muted }]}>Highlighted track</Text>
          <View style={styles.profileHighlightRow}>
            <View style={styles.profileHighlightArtWrap}>
              <Image
                source={MOCK_PROFILE.highlight.artwork}
                style={styles.profileHighlightArt}
                resizeMode="cover"
              />
            </View>
            <View style={styles.profileHighlightCopy}>
              <Text style={[styles.profileHighlightTitle, { color: colors.text.secondary }]} numberOfLines={1}>
                {MOCK_PROFILE.highlight.title}
              </Text>
              <Text style={[styles.profileHighlightArtist, { color: colors.text.muted }]} numberOfLines={1}>
                {MOCK_PROFILE.highlight.artist}
              </Text>
            </View>
          </View>
        </GlassCard>
      </View>
    </View>
  );
}

function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  const { colors } = useTheme();

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.primaryButton,
        {
          backgroundColor: withAlpha(colors.accent.primary, 0.9),
          borderColor: withAlpha(colors.text.inverted, 0.08),
          opacity: disabled ? 0.55 : pressed ? 0.88 : 1,
        },
      ]}
    >
      <Text style={[styles.primaryButtonLabel, { color: colors.text.inverted }]}>{label}</Text>
    </Pressable>
  );
}

export default function OnboardingScreen() {
  const { width } = useWindowDimensions();
  const { colors } = useTheme();
  const listRef = useRef<FlatList<(typeof ONBOARDING_SCREENS)[number]>>(null);
  const scrollX = useRef(new Animated.Value(0)).current;
  const skipNextHapticRef = useRef(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isFinishing, setIsFinishing] = useState(false);

  const finishOnboarding = async (withHaptic = false) => {
    if (isFinishing) return;
    if (withHaptic) H.tap();
    setIsFinishing(true);
    try {
      await setHasSeenOnboarding();
    } catch {}
    router.replace('/(tabs)');
  };

  const goToNext = () => {
    if (activeIndex >= ONBOARDING_SCREENS.length - 1) {
      void finishOnboarding(true);
      return;
    }
    H.tap();
    skipNextHapticRef.current = true;
    listRef.current?.scrollToIndex({ index: activeIndex + 1, animated: true });
  };

  const handleMomentumScrollEnd = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const nextIndex = Math.round(event.nativeEvent.contentOffset.x / width);
    const clampedIndex = Math.max(0, Math.min(nextIndex, ONBOARDING_SCREENS.length - 1));
    if (clampedIndex !== activeIndex) {
      if (skipNextHapticRef.current) {
        skipNextHapticRef.current = false;
      } else {
        H.tap();
      }
    }
    setActiveIndex(clampedIndex);
  };

  const inputRange = ONBOARDING_SCREENS.map((_, index) => index * width);
  const renderVisual = (id: (typeof ONBOARDING_SCREENS)[number]['id']) => {
    if (id === 'discover') return <DiscoverPreview />;
    if (id === 'feed') return <FeedPreview />;
    return <ProfilePreview />;
  };

  return (
    <Screen edges={['top', 'right', 'bottom', 'left']} style={styles.screen}>
      <View pointerEvents="none" style={StyleSheet.absoluteFill}>
        <Animated.View
          style={[
            styles.backgroundOrbLarge,
            {
              backgroundColor: withAlpha(colors.accent.primary, 0.16),
              opacity: scrollX.interpolate({
                inputRange,
                outputRange: [0.32, 0.18, 0.1],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  translateX: scrollX.interpolate({
                    inputRange,
                    outputRange: [-110, -10, 44],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  translateY: scrollX.interpolate({
                    inputRange,
                    outputRange: [-150, -44, -20],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  scale: scrollX.interpolate({
                    inputRange,
                    outputRange: [1.14, 0.96, 0.82],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.backgroundOrbCenter,
            {
              backgroundColor: withAlpha(colors.blend.glow, 0.22),
              opacity: scrollX.interpolate({
                inputRange,
                outputRange: [0.08, 0.18, 0.07],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  translateX: scrollX.interpolate({
                    inputRange,
                    outputRange: [110, 8, -26],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  translateY: scrollX.interpolate({
                    inputRange,
                    outputRange: [42, 8, -18],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  scale: scrollX.interpolate({
                    inputRange,
                    outputRange: [1.1, 1, 0.78],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        />
        <Animated.View
          style={[
            styles.backgroundOrbBottom,
            {
              backgroundColor: withAlpha(colors.accent.subtle, 0.18),
              opacity: scrollX.interpolate({
                inputRange,
                outputRange: [0.16, 0.12, 0.06],
                extrapolate: 'clamp',
              }),
              transform: [
                {
                  translateX: scrollX.interpolate({
                    inputRange,
                    outputRange: [-34, 22, 54],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  translateY: scrollX.interpolate({
                    inputRange,
                    outputRange: [92, 24, -8],
                    extrapolate: 'clamp',
                  }),
                },
                {
                  scale: scrollX.interpolate({
                    inputRange,
                    outputRange: [1.06, 0.94, 0.82],
                    extrapolate: 'clamp',
                  }),
                },
              ],
            },
          ]}
        />
      </View>

      <View style={styles.header}>
        <Pressable
          disabled={isFinishing}
          onPress={() => {
            H.tap();
            void finishOnboarding();
          }}
          style={({ pressed }) => ({
            opacity: isFinishing ? 0.5 : pressed ? 0.7 : 1,
            paddingVertical: 8,
            paddingHorizontal: 4,
          })}
        >
          <Text style={[styles.skipLabel, { color: colors.text.secondary }]}>Skip</Text>
        </Pressable>
      </View>

      <Animated.FlatList
        ref={listRef}
        data={ONBOARDING_SCREENS}
        keyExtractor={(item) => item.id}
        horizontal
        pagingEnabled
        bounces={false}
        showsHorizontalScrollIndicator={false}
        scrollEventThrottle={16}
        onScroll={Animated.event(
          [{ nativeEvent: { contentOffset: { x: scrollX } } }],
          { useNativeDriver: true },
        )}
        onMomentumScrollEnd={handleMomentumScrollEnd}
        renderItem={({ item, index }) => {
          const itemInputRange = [(index - 1) * width, index * width, (index + 1) * width];

          return (
            <Animated.View
              style={[
                styles.slide,
                {
                  opacity: scrollX.interpolate({
                    inputRange: itemInputRange,
                    outputRange: [0.9, 1, 0.9],
                    extrapolate: 'clamp',
                  }),
                  transform: [
                    {
                      scale: scrollX.interpolate({
                        inputRange: itemInputRange,
                        outputRange: [0.978, 1, 0.978],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                  width,
                },
              ]}
            >
              <Text style={[styles.sectionLabel, { color: colors.text.muted }]}>{item.label}</Text>
              {renderVisual(item.id)}
              <View style={styles.copyBlock}>
                <Text style={[styles.title, { color: colors.text.secondary }]}>{item.title}</Text>
                <Text style={[styles.body, { color: colors.text.muted }]}>{item.body}</Text>
              </View>
            </Animated.View>
          );
        }}
      />

      <View style={styles.footer}>
        <View style={styles.dots}>
          {ONBOARDING_SCREENS.map((item, index) => (
            <Animated.View
              key={item.id}
              style={[
                styles.dot,
                {
                  backgroundColor: index === activeIndex ? colors.accent.primary : colors.border.muted,
                  opacity: scrollX.interpolate({
                    inputRange: [(index - 1) * width, index * width, (index + 1) * width],
                    outputRange: [0.72, 1, 0.72],
                    extrapolate: 'clamp',
                  }),
                  transform: [
                    {
                      scaleX: scrollX.interpolate({
                        inputRange: [(index - 1) * width, index * width, (index + 1) * width],
                        outputRange: [1, 2.25, 1],
                        extrapolate: 'clamp',
                      }),
                    },
                  ],
                },
              ]}
            />
          ))}
        </View>

        <PrimaryButton
          label={isFinishing ? 'Loading…' : ONBOARDING_SCREENS[activeIndex]?.cta ?? 'Next'}
          onPress={goToNext}
          disabled={isFinishing}
        />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  screen: {
    paddingHorizontal: 0,
  },
  header: {
    alignItems: 'flex-end',
    paddingHorizontal: 20,
    paddingTop: 8,
  },
  slide: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 28,
  },
  previewWrap: {
    width: '100%',
    alignItems: 'center',
  },
  previewSurface: {
    width: '100%',
    maxWidth: 320,
    padding: 14,
    gap: 12,
  },
  previewSurfaceEmphasis: {
    transform: [{ scale: 1 }],
  },
  previewHeading: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  discoverList: {
    gap: 10,
  },
  discoverPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderRadius: 16,
    padding: 10,
  },
  discoverPreviewArt: {
    width: 46,
    height: 46,
    borderRadius: 8,
  },
  discoverPreviewCopy: {
    flex: 1,
  },
  discoverPreviewTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  discoverPreviewArtist: {
    fontSize: 13,
    marginTop: 2,
  },
  primaryCardWrap: {
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
  feedPreviewAvatarWrap: {
    width: 36,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    overflow: 'hidden',
  },
  feedPreviewAvatar: {
    width: 36,
    height: 36,
  },
  feedPreviewList: {
    gap: 0,
  },
  feedPreviewRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 12,
  },
  feedPreviewRowActive: {
    backgroundColor: 'rgba(255,255,255,0.02)',
    borderRadius: 14,
  },
  feedPreviewCopy: {
    flex: 1,
    gap: 4,
  },
  feedPreviewText: {
    fontSize: 14,
    lineHeight: 18,
  },
  feedPreviewTime: {
    fontSize: 12,
    fontWeight: '600',
  },
  feedPreviewThumbWrap: {
    width: 46,
    height: 46,
    borderRadius: 12,
    borderWidth: 1,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  feedPreviewThumbWrapActive: {
    transform: [{ scale: 1 }],
  },
  feedPreviewThumb: {
    width: 46,
    height: 46,
    borderRadius: 12,
  },
  profilePreviewStack: {
    width: '100%',
    maxWidth: 320,
    gap: 10,
  },
  profileHeroCard: {
    paddingVertical: 12,
  },
  profileHeroTop: {
    width: '100%',
  },
  profileIdentity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileAvatarWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    borderWidth: 1,
    overflow: 'hidden',
  },
  profileAvatarImage: {
    width: 44,
    height: 44,
  },
  profileName: {
    fontSize: 17,
    fontWeight: '800',
  },
  profileLabel: {
    fontSize: 13,
    marginTop: 2,
  },
  profileStatsPreviewRow: {
    flexDirection: 'row',
    gap: 10,
  },
  profileStatCard: {
    flex: 1,
    minHeight: 76,
    paddingVertical: 14,
  },
  profileStatLabel: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  profileStatValue: {
    fontSize: 20,
    fontWeight: '800',
    marginTop: 6,
  },
  profileHighlightCard: {
    gap: 10,
  },
  profileHighlightHeading: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.3,
  },
  profileHighlightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  profileHighlightArt: {
    width: 46,
    height: 46,
    borderRadius: 12,
  },
  profileHighlightArtWrap: {
    borderRadius: 12,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.14,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 7 },
    elevation: 5,
  },
  profileHighlightCopy: {
    flex: 1,
  },
  profileHighlightTitle: {
    fontSize: 15,
    fontWeight: '700',
  },
  profileHighlightArtist: {
    fontSize: 13,
    marginTop: 2,
  },
  copyBlock: {
    alignItems: 'center',
    gap: 10,
    maxWidth: 314,
    marginTop: 34,
  },
  sectionLabel: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 2.8,
    marginBottom: 18,
  },
  title: {
    fontSize: 30,
    fontWeight: '700',
    letterSpacing: -0.8,
    lineHeight: 36,
    maxWidth: 292,
    textAlign: 'center',
  },
  body: {
    fontSize: 16,
    lineHeight: 23,
    maxWidth: 306,
    textAlign: 'center',
  },
  footer: {
    gap: 22,
    paddingBottom: 28,
    paddingHorizontal: 20,
    paddingTop: 30,
  },
  dots: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 10,
    justifyContent: 'center',
  },
  dot: {
    borderRadius: 999,
    height: 8,
    width: 8,
  },
  skipLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  primaryButton: {
    alignItems: 'center',
    borderRadius: 16,
    borderWidth: 1,
    minHeight: 56,
    justifyContent: 'center',
  },
  primaryButtonLabel: {
    fontSize: 16,
    fontWeight: '700',
  },
  backgroundOrbLarge: {
    position: 'absolute',
    top: -110,
    left: -120,
    width: 300,
    height: 300,
    borderRadius: 150,
  },
  backgroundOrbCenter: {
    position: 'absolute',
    top: 150,
    right: -120,
    width: 320,
    height: 320,
    borderRadius: 160,
  },
  backgroundOrbBottom: {
    position: 'absolute',
    bottom: -140,
    left: -70,
    width: 280,
    height: 280,
    borderRadius: 140,
  },
});
