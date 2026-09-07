import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import Screen from '../../components/StackScreen';
import { checkUsernameAvailable, ensureMyProfile, isValidUsername, saveMySocialProfile } from '../../lib/profileSocial';
import { useTheme } from '../../theme/useTheme';

type Availability = 'idle' | 'checking' | 'available' | 'taken' | 'error';

function usernameValidationMessage(value: string) {
  const clean = value.trim().replace(/^@+/, '').toLowerCase();
  if (!clean) return null;
  if (clean.length < 3) return 'Username must be at least 3 characters.';
  if (clean.length > 20) return 'Username must be 20 characters or fewer.';

  const unsupported = Array.from(new Set(clean.match(/[^a-z0-9._]/g) || []));
  if (unsupported.length) {
    const readable = unsupported.map((character) => character === ' ' ? 'a space' : `“${character}”`).join(', ');
    return `Remove unsupported ${unsupported.length === 1 ? 'character' : 'characters'}: ${readable}.`;
  }
  if (!/^[a-z0-9]/.test(clean)) return 'Start your username with a letter or number.';
  if (!/[a-z0-9]$/.test(clean)) return 'End your username with a letter or number.';
  return null;
}

export default function ProfileSetupScreen() {
  const { colors } = useTheme();
  const params = useLocalSearchParams<{ next?: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const [originalUsername, setOriginalUsername] = useState('');
  const [isPrivate, setIsPrivate] = useState(true);
  const [availability, setAvailability] = useState<Availability>('idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    ensureMyProfile()
      .then((profile) => {
        if (!mounted || !profile) return;
        setDisplayName(profile.display_name || '');
        setUsername(profile.username || '');
        setOriginalUsername(profile.username || '');
        setIsPrivate(profile.is_private !== false);
      })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const clean = username.trim().replace(/^@+/, '').toLowerCase();
    setError(null);
    if (!clean) {
      setAvailability('idle');
      return;
    }
    if (!isValidUsername(clean)) {
      setAvailability('idle');
      return;
    }
    if (clean === originalUsername) {
      setAvailability('available');
      return;
    }
    setAvailability('checking');
    const timer = setTimeout(() => {
      checkUsernameAvailable(clean)
        .then((available) => setAvailability(available ? 'available' : 'taken'))
        .catch(() => setAvailability('error'));
    }, 350);
    return () => clearTimeout(timer);
  }, [originalUsername, username]);

  const cleanUsername = username.trim().replace(/^@+/, '').toLowerCase();
  const validationMessage = usernameValidationMessage(username);
  const invalidUsername = !!cleanUsername && !!validationMessage;
  const valid = !validationMessage && isValidUsername(cleanUsername) && displayName.trim().length > 0;

  const onSave = async () => {
    if (!valid || saving) return;
    try {
      setSaving(true);
      setError(null);
      const result = await saveMySocialProfile({
        username: cleanUsername,
        displayName,
        isPrivate,
      });
      if (!result.ok) {
        setError(result.message);
        if (/taken/i.test(result.message)) setAvailability('taken');
        return;
      }
      if (params.next === 'people') router.replace('/profile/people');
      else if (params.next === 'home') router.replace('/(tabs)');
      else router.back();
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return <Screen><View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator /></View></Screen>;
  }

  return (
    <Screen edges={['left', 'right']}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingTop: 10, paddingBottom: 36, gap: 24 }}>
          <View style={{ gap: 6 }}>
            <Text style={{ color: colors.text.secondary, fontSize: 28, fontWeight: '900' }}>Your listener identity</Text>
            <Text style={{ color: colors.text.muted, fontSize: 15, lineHeight: 21 }}>
              Choose how other music fans find you. Your username is unique; your display name can be anything you like.
            </Text>
          </View>

          <View style={{ gap: 18 }}>
            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Display name</Text>
              <TextInput
                value={displayName}
                onChangeText={setDisplayName}
                placeholder="Your name"
                placeholderTextColor={colors.text.muted}
                maxLength={40}
                autoCorrect={false}
                style={{ minHeight: 50, borderRadius: 14, borderWidth: 1, borderColor: colors.border.subtle, backgroundColor: colors.bg.secondary, color: colors.text.secondary, paddingHorizontal: 14, fontSize: 16 }}
              />
            </View>

            <View style={{ gap: 8 }}>
              <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Username</Text>
              <View style={{ minHeight: 50, flexDirection: 'row', alignItems: 'center', borderRadius: 14, borderWidth: 1, borderColor: invalidUsername || availability === 'taken' ? '#ff453a' : availability === 'available' ? colors.accent.success : colors.border.subtle, backgroundColor: colors.bg.secondary, paddingHorizontal: 14 }}>
                <Text style={{ color: colors.text.muted, fontSize: 16 }}>@</Text>
                <TextInput
                  value={username}
                  onChangeText={(value) => setUsername(value.replace(/^@+/, '').toLowerCase())}
                  placeholder="username"
                  placeholderTextColor={colors.text.muted}
                  autoCapitalize="none"
                  autoCorrect={false}
                  maxLength={20}
                  style={{ flex: 1, color: colors.text.secondary, paddingVertical: 12, fontSize: 16 }}
                />
                {availability === 'checking' ? <ActivityIndicator size="small" /> : null}
                {availability === 'available' ? <Ionicons name="checkmark-circle" size={20} color={colors.accent.success as any} /> : null}
              </View>
              <Text accessibilityLiveRegion="polite" style={{ color: invalidUsername || availability === 'taken' ? '#ff453a' : colors.text.muted, fontSize: 12 }}>
                {validationMessage
                  ? validationMessage
                  : availability === 'taken'
                  ? 'That username is already taken.'
                  : availability === 'error'
                    ? 'Availability could not be checked yet.'
                    : '3–20 letters, numbers, dots or underscores.'}
              </Text>
            </View>
          </View>

          <View style={{ gap: 10 }}>
            <Text style={{ color: colors.text.secondary, fontWeight: '800' }}>Who can see your music?</Text>
            {([
              { private: true, icon: 'lock-closed-outline' as const, title: 'Private', body: 'People send a request before seeing your listening profile.' },
              { private: false, icon: 'globe-outline' as const, title: 'Public', body: 'Anyone on Ripple can follow you and see your listening profile.' },
            ]).map((option) => {
              const selected = isPrivate === option.private;
              return (
                <Pressable
                  key={option.title}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setIsPrivate(option.private)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 12,
                    padding: 14,
                    borderRadius: 16,
                    borderWidth: selected ? 2 : 1,
                    borderColor: selected ? colors.accent.primary : colors.border.subtle,
                    backgroundColor: selected ? colors.accent.primary + '12' : colors.bg.secondary,
                    opacity: pressed ? 0.86 : 1,
                  })}
                >
                  <View style={{ width: 38, height: 38, borderRadius: 19, alignItems: 'center', justifyContent: 'center', backgroundColor: selected ? colors.accent.primary + '22' : colors.bg.muted }}>
                    <Ionicons name={option.icon} size={19} color={selected ? colors.accent.primary as any : colors.text.muted as any} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: colors.text.secondary, fontWeight: '800', fontSize: 15 }}>{option.title}</Text>
                    <Text style={{ marginTop: 3, color: colors.text.muted, lineHeight: 18 }}>{option.body}</Text>
                  </View>
                  <Ionicons name={selected ? 'radio-button-on' : 'radio-button-off'} size={21} color={selected ? colors.accent.primary as any : colors.text.muted as any} />
                </Pressable>
              );
            })}
          </View>

          {error ? <Text style={{ color: '#ff453a', lineHeight: 20 }}>{error}</Text> : null}

          <Pressable
            accessibilityRole="button"
            disabled={!valid || availability === 'taken' || saving}
            onPress={onSave}
            style={({ pressed }) => ({
              minHeight: 52,
              borderRadius: 14,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: colors.accent.primary,
              opacity: !valid || availability === 'taken' || saving ? 0.45 : pressed ? 0.84 : 1,
            })}
          >
            <Text style={{ color: colors.text.inverted, fontSize: 16, fontWeight: '900' }}>{saving ? 'Saving…' : 'Save profile'}</Text>
          </Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}
