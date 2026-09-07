import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Avatar from '../../components/Avatar';
import ListenerFollowButton from '../../components/ListenerFollowButton';
import Screen from '../../components/StackScreen';
import { ensureMyProfile, searchListenerProfiles, type ListenerSearchResult, type PublicProfile } from '../../lib/profileSocial';
import { useTheme } from '../../theme/useTheme';

export default function PeopleSearchScreen() {
  const { colors } = useTheme();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ListenerSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    ensureMyProfile()
      .then((next) => { if (mounted) setProfile(next); })
      .finally(() => { if (mounted) setProfileLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const clean = query.trim().replace(/^@+/, '').toLowerCase();
    setError(null);
    if (clean.length < 2 || !profile?.username) {
      setResults([]);
      setSearching(false);
      return;
    }
    let active = true;
    setSearching(true);
    const timer = setTimeout(() => {
      searchListenerProfiles(clean)
        .then((rows) => { if (active) setResults(rows); })
        .catch((e: any) => {
          if (!active) return;
          setResults([]);
          setError(/function .* does not exist|schema cache/i.test(String(e?.message || ''))
            ? 'People search will be available after the profile update is installed.'
            : 'People search is unavailable right now.');
        })
        .finally(() => { if (active) setSearching(false); });
    }, 300);
    return () => {
      active = false;
      clearTimeout(timer);
    };
  }, [profile?.username, query]);

  const openListener = (username: string | null) => {
    if (!username) return;
    router.push({ pathname: '/profile/listener/[username]', params: { username } });
  };

  if (profileLoading) {
    return <Screen><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View></Screen>;
  }

  if (!profile?.username || !profile.profile_setup_completed) {
    return (
      <Screen edges={['left', 'right']}>
        <View style={{ flex: 1, justifyContent: 'center', paddingBottom: 56, gap: 18 }}>
          <View style={{ alignSelf: 'center', width: 68, height: 68, borderRadius: 34, backgroundColor: colors.accent.primary + '20', alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="at" size={30} color={colors.accent.primary as any} />
          </View>
          <View style={{ gap: 7 }}>
            <Text style={{ color: colors.text.secondary, textAlign: 'center', fontSize: 24, fontWeight: '900' }}>Choose your username</Text>
            <Text style={{ color: colors.text.muted, textAlign: 'center', fontSize: 15, lineHeight: 21 }}>
              Create your listener identity before finding and following other music fans.
            </Text>
          </View>
          <Pressable
            onPress={() => router.push({ pathname: '/profile/setup', params: { next: 'people' } })}
            style={({ pressed }) => ({ alignSelf: 'center', minWidth: 190, paddingHorizontal: 20, paddingVertical: 13, borderRadius: 999, backgroundColor: colors.accent.primary, opacity: pressed ? 0.84 : 1 })}
          >
            <Text style={{ color: colors.text.inverted, textAlign: 'center', fontWeight: '900' }}>Set up profile</Text>
          </Pressable>
        </View>
      </Screen>
    );
  }

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 10, paddingBottom: 36, gap: 18 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: colors.text.secondary, fontSize: 25, fontWeight: '900' }}>Find your people</Text>
            <Text style={{ marginTop: 3, color: colors.text.muted }}>You’re @{profile.username}</Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Edit profile" onPress={() => router.push('/profile/setup')} hitSlop={8} style={{ width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.bg.muted }}>
            <Ionicons name="create-outline" size={20} color={colors.text.secondary as any} />
          </Pressable>
        </View>

        <View style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, borderRadius: 15, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.secondary }}>
          <Ionicons name="search" size={19} color={colors.text.muted as any} />
          <TextInput
            value={query}
            onChangeText={(value) => setQuery(value.toLowerCase())}
            placeholder="Search by @username"
            placeholderTextColor={colors.text.muted}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={{ flex: 1, color: colors.text.secondary, fontSize: 16, paddingVertical: 12 }}
          />
          {searching ? <ActivityIndicator size="small" /> : query ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear search" onPress={() => setQuery('')} hitSlop={8}>
              <Ionicons name="close-circle" size={19} color={colors.text.muted as any} />
            </Pressable>
          ) : null}
        </View>

        <View style={{ flexDirection: 'row', gap: 10 }}>
          <Pressable onPress={() => router.push({ pathname: '/profile/friend-requests', params: { tab: 'requests' } })} style={({ pressed }) => ({ flex: 1, paddingVertical: 11, borderRadius: 13, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.secondary, opacity: pressed ? 0.84 : 1 })}>
            <Text style={{ color: colors.text.secondary, textAlign: 'center', fontWeight: '800' }}>Requests</Text>
          </Pressable>
          <Pressable onPress={() => router.push({ pathname: '/profile/friend-requests', params: { tab: 'following' } })} style={({ pressed }) => ({ flex: 1, paddingVertical: 11, borderRadius: 13, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.secondary, opacity: pressed ? 0.84 : 1 })}>
            <Text style={{ color: colors.text.secondary, textAlign: 'center', fontWeight: '800' }}>Following</Text>
          </Pressable>
        </View>

        {error ? <Text style={{ color: '#ff453a', lineHeight: 20 }}>{error}</Text> : null}

        <View>
          {query.trim().replace(/^@+/, '').length < 2 ? (
            <View style={{ paddingVertical: 42, alignItems: 'center', gap: 8 }}>
              <Ionicons name="people-outline" size={30} color={colors.text.muted as any} />
              <Text style={{ color: colors.text.muted, textAlign: 'center' }}>Enter at least two characters of a username.</Text>
            </View>
          ) : !searching && !error && results.length === 0 ? (
            <View style={{ paddingVertical: 42, alignItems: 'center', gap: 8 }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>No listeners found</Text>
              <Text style={{ color: colors.text.muted }}>Check the username and try again.</Text>
            </View>
          ) : (
            results.map((result) => (
              <Pressable
                key={result.user_id}
                accessibilityRole="button"
                accessibilityLabel={`${result.display_name}, @${result.username}`}
                onPress={() => openListener(result.username)}
                style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 13, borderBottomWidth: 1, borderBottomColor: colors.border.subtle, opacity: pressed ? 0.84 : 1 })}
              >
                <Avatar uri={result.avatar_url} size={48} borderColor={colors.border.subtle} backgroundColor={colors.bg.muted} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 15 }} numberOfLines={1}>{result.display_name}</Text>
                  <View style={{ marginTop: 3, flexDirection: 'row', alignItems: 'center', gap: 5 }}>
                    <Text style={{ color: colors.text.muted }} numberOfLines={1}>@{result.username}</Text>
                    {result.is_private ? <Ionicons name="lock-closed" size={11} color={colors.text.muted as any} /> : null}
                  </View>
                </View>
                <ListenerFollowButton
                  compact
                  userId={result.user_id}
                  username={result.username}
                  initialStatus={result.relationship_status}
                  onChanged={(status) => setResults((current) => current.map((row) => row.user_id === result.user_id ? { ...row, relationship_status: status === 'following' ? 'following' : status === 'requested' ? 'requested' : 'none' } : row))}
                />
              </Pressable>
            ))
          )}
        </View>
      </ScrollView>
    </Screen>
  );
}
