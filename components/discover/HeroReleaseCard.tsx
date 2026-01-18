import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import { Dimensions, Image, ImageBackground, Platform, Pressable, Text, View } from 'react-native';
import { formatDate } from '../../lib/date';
import { useTheme } from '../../theme/useTheme';

export type HeroReleaseCardProps = {
  title: string;
  artist?: string | null;
  imageUrl?: string | null;
  releaseDate?: string | null;
  saved?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
  delayLongPress?: number;
  onSave?: () => void;
  width?: number;
  height?: number;
};

export default function HeroReleaseCard({
  title,
  artist,
  imageUrl,
  releaseDate,
  saved,
  onPress,
  onLongPress,
  delayLongPress,
  onSave,
  width,
  height,
}: HeroReleaseCardProps) {
  const { colors } = useTheme();
  const screenWidth = Dimensions.get('window').width;

  const cardWidth = width ?? Math.floor(screenWidth * 0.86);
  const cardHeight = height ?? 220;
  const coverSize = 112;

  const dateLabel = useMemo(() => {
    if (!releaseDate) return null;
    try {
      return formatDate(releaseDate);
    } catch {
      return null;
    }
  }, [releaseDate]);

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={delayLongPress}
      style={({ pressed }) => ({
        width: cardWidth,
        height: cardHeight,
        borderRadius: 26,
        overflow: 'hidden',
        backgroundColor: colors.bg.muted,
        transform: [{ scale: pressed ? 0.995 : 1 }],
        opacity: pressed ? 0.95 : 1,
      })}
    >
      <ImageBackground
        source={imageUrl ? { uri: imageUrl } : undefined}
        resizeMode="cover"
        style={{ flex: 1 }}
      >
        <View style={{ ...StyleSheetFill, backgroundColor: 'rgba(0,0,0,0.25)' }} />
        <LinearGradient
          colors={['rgba(0,0,0,0)', 'rgba(0,0,0,0.35)', 'rgba(0,0,0,0.72)']}
          locations={[0, 0.5, 1]}
          style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: Math.floor(cardHeight * 0.62) }}
          pointerEvents="none"
        />

        <Pressable
          onPress={onSave}
          disabled={!onSave}
          hitSlop={10}
          style={({ pressed }) => ({
            position: 'absolute',
            top: 12,
            right: 12,
            width: 38,
            height: 38,
            borderRadius: 99,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'rgba(20,20,25,0.42)',
            borderWidth: 1,
            borderColor: 'rgba(255,255,255,0.12)',
            opacity: pressed ? 0.85 : 1,
          })}
        >
          <Ionicons
            name={saved ? 'bookmark' : 'bookmark-outline'}
            size={18}
            color={saved ? colors.accent.success : colors.text.secondary}
          />
        </Pressable>

        <View style={{ position: 'absolute', left: 14, right: 14, bottom: 14, flexDirection: 'row', gap: 12, alignItems: 'flex-end' }}>
          <View
            style={{
              width: coverSize,
              height: coverSize,
              borderRadius: 18,
              backgroundColor: colors.bg.secondary,
              overflow: 'hidden',
              borderWidth: 1,
              borderColor: 'rgba(255,255,255,0.14)',
              ...(Platform.OS === 'android'
                ? { elevation: 8 }
                : {
                    shadowColor: '#000',
                    shadowOpacity: 0.35,
                    shadowRadius: 12,
                    shadowOffset: { width: 0, height: 8 },
                  }),
            }}
          >
            {imageUrl ? (
              <Image source={{ uri: imageUrl }} style={{ width: coverSize, height: coverSize }} />
            ) : (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
                <Text style={{ color: colors.text.muted, fontWeight: '900', fontSize: 18 }}>{(title || '?').slice(0, 1).toUpperCase()}</Text>
              </View>
            )}
          </View>

          <View style={{ flex: 1, minWidth: 0, paddingBottom: 6 }}>
            <Text style={{ color: '#fff', fontWeight: '900', fontSize: 18, letterSpacing: 0.2 }} numberOfLines={1} ellipsizeMode="tail">
              {title}
            </Text>
            {!!artist && (
              <Text style={{ color: 'rgba(255,255,255,0.84)', fontWeight: '600', fontSize: 13, marginTop: 4 }} numberOfLines={1} ellipsizeMode="tail">
                {artist}
              </Text>
            )}
            {!!dateLabel && (
              <Text style={{ color: 'rgba(255,255,255,0.68)', fontSize: 12, marginTop: 4 }} numberOfLines={1} ellipsizeMode="tail">
                {dateLabel}
              </Text>
            )}
          </View>
        </View>
      </ImageBackground>
    </Pressable>
  );
}

const StyleSheetFill = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
};

