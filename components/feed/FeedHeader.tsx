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
    <View style={{ marginHorizontal: -8, marginBottom: 10, paddingTop: 4 }}>
      <View style={{ borderRadius: 20, overflow: 'hidden', backgroundColor: 'transparent' }}>
        <View style={{ position: 'absolute', top: -40, right: -10, width: 120, height: 120, backgroundColor: colors.accent.primary, opacity: 0.2, borderRadius: 999 }} />
        <View style={{ position: 'absolute', bottom: -30, left: -14, width: 110, height: 110, backgroundColor: colors.accent.success, opacity: 0.2, borderRadius: 999 }} />
        <BlurView intensity={20} tint="dark" style={{ padding: 16, borderRadius: 20, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text.subtle, fontSize: 12, fontWeight: '700' }}>{heroDate}</Text>
              <Text style={{ color: colors.text.inverted, fontSize: 26, fontWeight: '800', marginTop: 4 }}>Your Wave</Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginTop: 6 }}>
                <Text style={{ color: colors.text.subtle, flex: 1 }}>{subtitle}</Text>
                {subtitleAccessory}
              </View>

              <View style={{ flexDirection: 'row', marginTop: 12, alignItems: 'center', gap: 10 }}>
                <View style={{ flex: 1, flexDirection: 'row', padding: 4, borderRadius: 14, backgroundColor: colors.bg.muted, borderWidth: 1, borderColor: colors.border.subtle, gap: 6 }}>
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
                          paddingHorizontal: 14,
                          paddingVertical: 10,
                          borderRadius: 12,
                          alignItems: 'center',
                          justifyContent: 'center',
                          backgroundColor: selected ? colors.accent.primary : 'transparent',
                        }}>
                          <Text style={{ color: selected ? colors.text.inverted : colors.text.secondary, fontWeight: '800' }}>{label}</Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </View>

              {!!children && (
                <View style={{ marginTop: 12 }}>
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
