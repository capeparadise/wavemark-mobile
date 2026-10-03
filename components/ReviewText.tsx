import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { REVIEW_PREVIEW_LENGTH } from '../lib/review';
import { useTheme } from '../theme/useTheme';

export default function ReviewText({ text }: { text: string }) {
  const { colors } = useTheme();
  const [expanded, setExpanded] = useState(false);
  const long = text.length > REVIEW_PREVIEW_LENGTH;
  return <View style={{ marginTop: 6, gap: 2 }}>
    <Text selectable style={{ color: colors.text.secondary, fontSize: 16, lineHeight: 24 }}>
      {long && !expanded ? `${text.slice(0, REVIEW_PREVIEW_LENGTH).trimEnd()}…` : text}
    </Text>
    {long ? <Pressable accessibilityRole="button" accessibilityState={{ expanded }}
      onPress={event => { event.stopPropagation(); setExpanded(value => !value); }}
      style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start', paddingRight: 12 }}>
      <Text style={{ color: colors.accent.primary, fontSize: 15, fontWeight: '700' }}>{expanded ? 'Show less' : 'Read more'}</Text>
    </Pressable> : null}
  </View>;
}
