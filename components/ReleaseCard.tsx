import React from 'react';
import { View, Text, Image, StyleSheet, TouchableOpacity } from 'react-native';
import GlassCard from './GlassCard';
import { ui } from '../constants/ui';
import { useTheme } from '../theme/useTheme';

export default function ReleaseCard({ title, artist, image, onPress }: any) {
  const { colors } = useTheme();

  return (
    <GlassCard asChild>
      <TouchableOpacity onPress={onPress} activeOpacity={0.9} style={{ flexDirection: 'row', alignItems: 'center', gap: ui.spacing.md }}>
        {image && <Image source={{ uri: image }} style={styles.image} />}
        <View style={styles.info}>
          <Text style={[styles.title, { color: colors.text.secondary }]} numberOfLines={1}>{title}</Text>
          <Text style={[styles.artist, { color: colors.text.muted }]} numberOfLines={1}>{artist}</Text>
        </View>
      </TouchableOpacity>
    </GlassCard>
  );
}

const styles = StyleSheet.create({
  image: {
    width: 60,
    height: 60,
    borderRadius: 12,
  },
  info: {
    flex: 1
  },
  title: {
    fontSize: 16,
    fontWeight: 'bold'
  },
  artist: {
    fontSize: 14
  }
});
