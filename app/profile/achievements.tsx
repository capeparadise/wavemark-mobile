import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, Text, View } from 'react-native';
import Screen from '../../components/Screen';
import { computeAchievements } from '../../lib/achievements';
import { fetchProfileSnapshot, loadCachedProfileSnapshot, type ProfileSnapshot } from '../../lib/stats';
import { useTheme } from '../../theme/useTheme';

export const options = { title: 'Achievements' };

export default function AchievementsScreen() {
  const { colors } = useTheme();
  const [items, setItems] = useState<ReturnType<typeof computeAchievements>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      const cached = await loadCachedProfileSnapshot();
      if (cached && mounted) setItems(computeAchievements(cached));
      const snap = await fetchProfileSnapshot();
      if (mounted) {
        setItems(computeAchievements(snap));
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  return (
    <Screen edges={['left', 'right']}>
      {loading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator />
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(a) => a.id}
          renderItem={({ item }) => (
            <View style={{
              padding: 12,
              borderRadius: 12,
              backgroundColor: item.unlocked ? colors.accent.success + '1a' : colors.bg.secondary,
              borderWidth: 1,
              borderColor: item.unlocked ? colors.accent.success : colors.border.subtle,
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}>
              <View style={{ flex: 1, marginRight: 8 }}>
                <Text style={{ fontWeight: '800', color: colors.text.secondary }}>{item.title}</Text>
                <Text style={{ color: colors.text.muted, marginTop: 2 }}>{item.description}</Text>
              </View>
              <Text style={{ fontWeight: '800', color: item.unlocked ? colors.accent.success : colors.text.muted }}>
                {item.unlocked ? 'Unlocked' : 'Locked'}
              </Text>
            </View>
          )}
        />
      )}
    </Screen>
  );
}
