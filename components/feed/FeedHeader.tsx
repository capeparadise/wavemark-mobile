import { BlurView } from 'expo-blur';
import React, { useMemo } from 'react';
import { Pressable, Text, View } from 'react-native';
import { H } from '../haptics';
import { useTheme } from '../../theme/useTheme';

export type FeedMode = 'artist' | 'social';

export default function FeedHeader({
  subtitle,
  subtitleAccessory,
  rightAccessory,
  mode,
  onModeChange,
  children,
}: {
  subtitle: string;
  subtitleAccessory?: React.ReactNode;
  rightAccessory?: React.ReactNode;
  mode: FeedMode;
  onModeChange: (next: FeedMode) => void;
  children?: React.ReactNode;
}) {
  const { colors } = useTheme();
  const heroDate = useMemo(
    () => new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' }),
    [],
  );

  return (
    <View style={{ marginBottom: 10, paddingTop: 2 }}>
      <View style={{ overflow: 'hidden' }}>
        <BlurView intensity={10} tint="dark" style={{ paddingVertical: 10, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text.muted, fontSize: 11, fontWeight: '800' }}>{heroDate}</Text>
              <Text style={{ color: colors.text.primary, fontSize: 24, fontWeight: '900', marginTop: 2 }}>Your Wave</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 3 }}>
                <Text style={{ color: colors.text.subtle, flex: 1, fontSize: 13, lineHeight: 18 }}>{subtitle}</Text>
                {subtitleAccessory}
              </View>

              <View style={{ flexDirection: 'row', marginTop: 10, alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, flexDirection: 'row', padding: 3, borderRadius: 13, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle, gap: 4 }}>
                    {([
                      { key: 'artist', label: 'Artists' },
                      { key: 'social', label: 'Social' },
                    ] as const).map(({ key, label }) => {
                    const selected = mode === key;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => {
                          if (mode === key) return;
                          H.tap();
                          onModeChange(key);
                        }}
                        style={({ pressed }) => ({
                          flex: 1,
                          opacity: pressed ? 0.85 : 1,
                        })}
                      >
                        <View style={{
                          paddingHorizontal: 12,
                          paddingVertical: 8,
                          borderRadius: 10,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected ? colors.accent.primary : 'transparent',
                        }}>
                          <Text style={{ color: selected ? colors.text.inverted : colors.text.secondary, fontWeight: '800', fontSize: 13 }}>{label}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {!!children && (
                <View style={{ marginTop: 10 }}>
                  {children}
                </View>
              )}
            </View>

            <View style={{ alignItems: 'flex-end' }}>
              {rightAccessory}
            </View>
          </View>
        </BlurView>
      </View>
    </View>
  );
}
