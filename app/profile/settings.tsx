import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import Screen from '../../components/Screen';
import { emit } from '../../lib/events';
import { bulkRefreshAppleLinks } from '../../lib/listen';
import { getMarketOverride, initMarketOverride, setMarketOverride } from '../../lib/market';
import { getMarket as getDeviceMarket, spotifyLookup } from '../../lib/spotify';
import { supabase } from '../../lib/supabase';
import { getAdvancedRatingsEnabled, setAdvancedRatingsEnabled } from '../../lib/user';
import { isHapticsEnabled, setHapticsEnabled } from '../../components/haptics';
import { themeList } from '../../theme/themes';
import { useTheme } from '../../theme/useTheme';
import { backfillArtworkMissing } from '../../lib/listen';

export default function ProfileSettingsPage() {
  const { colors, themeName, setThemeName } = useTheme();
  const [market, setMarket] = useState<string>('');
  const [saved, setSaved] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairDone, setRepairDone] = useState(false);
  const [repairCount, setRepairCount] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{ processed: number; updated: number } | null>(null);
  const [repairSinglesBusy, setRepairSinglesBusy] = useState(false);
  const [repairSinglesResult, setRepairSinglesResult] = useState<{ scanned: number; changed: number } | null>(null);
  const [advEnabled, setAdvEnabled] = useState<boolean>(false);
  const [advSaving, setAdvSaving] = useState<boolean>(false);
  const [hapticsEnabled, setHapticsEnabledState] = useState<boolean>(true);
  const [hapticSaving, setHapticSaving] = useState<boolean>(false);

  useEffect(() => {
    (async () => {
      await initMarketOverride();
      const v = getMarketOverride();
      setMarket(v ?? '');
    })();
  }, []);

  useEffect(() => {
    // Load advanced rating preference
    getAdvancedRatingsEnabled().then(setAdvEnabled).catch(() => setAdvEnabled(false));
    // Load haptics pref
    setHapticsEnabledState(isHapticsEnabled());
  }, []);

  useEffect(() => {
    if (saved) {
      const t = setTimeout(() => setSaved(false), 1200);
      return () => clearTimeout(t);
    }
  }, [saved]);

  const onSave = async () => {
    const v = market.trim().toUpperCase();
    if (v && !/^[A-Z]{2}$/.test(v)) {
      Alert.alert('Market must be a 2-letter country code (e.g., GB, US)');
      return;
    }
    await setMarketOverride(v || null);
    setSaved(true);
  };

  const onClear = async () => {
    await setMarketOverride(null);
    setMarket('');
    setSaved(true);
  };

  const APPLE_ENABLED = process.env.EXPO_PUBLIC_ENABLE_APPLE === 'true';

  const onSignOut = () => {
    if (signingOut) return;
    Alert.alert('Sign out?', 'You can sign back in anytime.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Sign out',
        style: 'destructive',
        onPress: async () => {
          try {
            setSigningOut(true);
            const { error } = await supabase.auth.signOut();
            if (error) Alert.alert('Sign out failed', error.message);
          } finally {
            setSigningOut(false);
          }
        },
      },
    ]);
  };

  return (
    <Screen edges={['left', 'right']}>
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 28 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8, color: colors.text.secondary }}>Settings</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 18 }}>Personalize how results are fetched.</Text>

      <View style={{ marginBottom: 20 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Appearance</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 10 }}>Pick a color mood for the app.</Text>
        <View style={{ gap: 10 }}>
          {themeList.map((theme) => {
            const active = theme.name === themeName;
            return (
              <Pressable
                key={theme.name}
                onPress={() => { if (!active) setThemeName(theme.name); }}
                style={{
                  padding: 12,
                  borderRadius: 14,
                  backgroundColor: colors.bg.secondary,
                  borderWidth: 1,
                  borderColor: active ? colors.accent.primary : colors.border.subtle,
                }}
              >
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontWeight: '700', color: colors.text.secondary }}>{theme.label}</Text>
                    <Text style={{ color: colors.text.muted, marginTop: 2 }}>{theme.description}</Text>
                  </View>
                  <View style={{ alignItems: 'flex-end', gap: 6 }}>
                    <View style={{ flexDirection: 'row', gap: 6 }}>
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.blend.top, borderWidth: 1, borderColor: theme.colors.border.subtle }} />
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.blend.mid, borderWidth: 1, borderColor: theme.colors.border.subtle }} />
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.bg.primary, borderWidth: 1, borderColor: theme.colors.border.subtle }} />
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.accent.primary }} />
                      <View style={{ width: 16, height: 16, borderRadius: 8, backgroundColor: theme.colors.bg.elevated }} />
                    </View>
                    <Text style={{ fontSize: 11, fontWeight: '700', color: active ? colors.accent.primary : colors.text.muted }}>
                      {active ? 'Active' : 'Tap to apply'}
                    </Text>
                  </View>
                </View>
              </Pressable>
            );
          })}
        </View>
      </View>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Market override</Text>
        <TextInput
          value={market}
          onChangeText={setMarket}
          placeholder="e.g., GB or US"
          autoCapitalize="characters"
          placeholderTextColor={colors.text.muted}
          style={{
            borderWidth: 1,
            borderColor: colors.border.subtle,
            borderRadius: 8,
            paddingHorizontal: 12,
            paddingVertical: 8,
            backgroundColor: colors.bg.secondary,
            color: colors.text.secondary,
          }}
        />
        <Text style={{ color: colors.text.muted, marginTop: 6 }}>Leave blank to use device locale.</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <Pressable onPress={onSave} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.accent.primary }}>
            <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Save</Text>
          </Pressable>
          <Pressable onPress={onClear} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: colors.bg.muted }}>
            <Text style={{ color: colors.text.secondary, fontWeight: '700' }}>Clear</Text>
          </Pressable>
          {saved && <Text style={{ color: colors.accent.success, alignSelf: 'center' }}>Saved</Text>}
        </View>
      </View>

      {/* Advanced rating mode */}
      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Advanced rating mode</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 8 }}>Enable detailed category sliders when rating songs.</Text>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
          <Text style={{ fontSize: 16, color: colors.text.secondary }}>Enable</Text>
          <Switch
            value={advEnabled}
            onValueChange={async (v) => {
              if (advSaving) return;
              setAdvSaving(true);
              setAdvEnabled(v);
              const ok = await setAdvancedRatingsEnabled(v);
              if (!ok) {
                setAdvEnabled(!v);
                Alert.alert('Could not save preference');
              }
              if (ok) {
                // notify app so listeners can update immediately
                try { emit('prefs:advanced_ratings', v); } catch {}
              }
              setAdvSaving(false);
            }}
            trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
            thumbColor={advEnabled ? colors.text.inverted : colors.bg.primary}
            ios_backgroundColor={colors.border.subtle}
          />
        </View>
      </View>

        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Haptics</Text>
          <Text style={{ color: colors.text.muted, marginBottom: 8 }}>Turn on/off haptic feedback.</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 }}>
            <Text style={{ fontSize: 16, color: colors.text.secondary }}>Enable</Text>
            <Switch
              value={hapticsEnabled}
              onValueChange={async (v) => {
                if (hapticSaving) return;
                setHapticSaving(true);
                setHapticsEnabledState(v);
                try {
                  await setHapticsEnabled(v);
                } catch {
                  setHapticsEnabledState(!v);
                  Alert.alert('Could not save preference');
                }
                setHapticSaving(false);
              }}
              trackColor={{ false: colors.border.subtle, true: colors.accent.primary }}
              thumbColor={hapticsEnabled ? colors.text.inverted : colors.bg.primary}
              ios_backgroundColor={colors.border.subtle}
            />
          </View>
      </View>

      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Data repair: Artwork</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 8 }}>
          Fix missing album artwork for saved items.
        </Text>
        <Pressable
          onPress={async () => {
            try {
              setRepairing(true);
              const res = await backfillArtworkMissing(25);
              setRepairCount(res?.changed ?? 0);
              setRepairDone(true);
              Alert.alert('Done', `${res?.changed ?? 0} items updated`);
            } catch (e:any) {
              Alert.alert('Backfill failed', String(e?.message || e));
            } finally {
              setRepairing(false);
            }
          }}
          disabled={repairing}
          style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: repairing ? colors.bg.muted : colors.accent.primary }}
        >
          {repairing ? <ActivityIndicator color={colors.text.inverted} /> : <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Fix artwork</Text>}
        </Pressable>
      </View>

      <View style={{ marginBottom: 24 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Data repair: Singles vs Albums</Text>
        <Text style={{ color: colors.text.muted, marginBottom: 8 }}>
          If a single was saved as an album, this will correct the stored type to track.
        </Text>
        <Pressable
          onPress={async () => {
            if (repairSinglesBusy) return;
            setRepairSinglesResult(null);
            setRepairSinglesBusy(true);
            try {
              const { data: auth } = await supabase.auth.getUser();
              const user = auth?.user;
              if (!user) throw new Error('Not signed in');
              // Fetch candidate rows: stored as album but likely singles
              const { data: rows, error } = await supabase
                .from('listen_list')
                .select('id,item_type,title,artist_name,spotify_id,spotify_url')
                .eq('user_id', user.id)
                .eq('item_type', 'album');
              if (error) throw new Error(error.message);
              const list = rows || [];
              let changed = 0;
              let scanned = 0;
              for (const r of list) {
                scanned++;
                try {
                  // Heuristic: Spotify track URL indicates single/track
                  const isTrackUrl = !!r.spotify_url && /open\.spotify\.com\/track\//.test(r.spotify_url);
                  let isSingle = false;
                  if (r.spotify_id) {
                    const res = await spotifyLookup(r.spotify_id, 'album');
                    const first = res?.[0];
                    // albumType === 'single' should be treated as track for listen_list purposes
                    if (first?.albumType === 'single' || first?.type === 'track') isSingle = true;
                  }
                  if (isTrackUrl || isSingle) {
                    const upd = await supabase
                      .from('listen_list')
                      .update({ item_type: 'track' })
                      .eq('id', r.id);
                    if (!upd.error) changed++;
                  }
                } catch {}
              }
              setRepairSinglesResult({ scanned, changed });
              // Notify listeners (e.g., Listen tab) to refresh immediately
              emit('listen:updated');
            } catch (e: any) {
              Alert.alert('Repair failed', String(e?.message || e));
            } finally {
              setRepairSinglesBusy(false);
            }
          }}
          disabled={repairSinglesBusy}
          style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: repairSinglesBusy ? colors.bg.muted : colors.accent.primary, marginBottom: 8 }}
        >
          {repairSinglesBusy ? (
            <ActivityIndicator color={colors.text.inverted} />
          ) : (
            <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Repair Singles Tagged As Albums</Text>
          )}
        </Pressable>
        {repairSinglesResult && (
          <Text style={{ color: colors.accent.success }}>
            Scanned {repairSinglesResult.scanned}, changed {repairSinglesResult.changed}
          </Text>
        )}
      </View>

	      {APPLE_ENABLED ? (
	        <View style={{ marginBottom: 24 }}>
	          <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Apple Music Deep Links</Text>
	          <Pressable
            onPress={async () => {
              if (repairing) return;
              setRepairDone(false);
              setRepairCount(null);
              setRepairing(true);
              try {
                const { data: auth } = await supabase.auth.getUser();
                const user = auth?.user;
                if (!user) throw new Error('Not signed in');
                const { data: rows } = await supabase
                  .from('listen_list')
                  .select('id,item_type,title,artist_name,apple_url,apple_id,provider_id,release_date')
                  .eq('user_id', user.id);
                const targets = (rows || []).filter(r => !r.apple_url || !/https:\/\/music\.apple\.com\//.test(r.apple_url));
                let fixed = 0;
                const cc = (getDeviceMarket() || 'US').toUpperCase();
                const ccLower = cc.toLowerCase();
                const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,' ').trim();
                for (const r of targets) {
                  try {
                    let url: string | null = null;
                    const term = encodeURIComponent([r.title, r.artist_name].filter(Boolean).join(' '));
                    const entity = r.item_type === 'track' ? 'musicTrack' : 'album';
                    const searchRes = await fetch(`https://itunes.apple.com/search?term=${term}&country=${cc}&entity=${entity}&limit=8`).then(x => x.ok ? x.json() : null).catch(() => null) as any;
                    const picks = Array.isArray(searchRes?.results) ? searchRes.results : [];
                    const wantTitle = norm(r.title);
                    const match = picks.find((p: any) => norm(r.item_type==='track'?p.trackName:p.collectionName) === wantTitle);
                    if (match) {
                      const albumId = match.collectionId ? String(match.collectionId) : null;
                      const trackId = match.trackId ? String(match.trackId) : null;
                      if (r.item_type === 'track' && albumId && trackId) url = `https://music.apple.com/${ccLower}/album/${albumId}?i=${trackId}`;
                      else if (albumId) url = `https://music.apple.com/${ccLower}/album/${albumId}`;
                    }
                    if (url) {
                      await supabase.from('listen_list').update({ apple_url: url }).eq('id', r.id);
                      fixed++;
                    }
                  } catch {}
                }
                setRepairCount(fixed);
                setRepairDone(true);
              } catch (e:any) {
                Alert.alert('Repair failed', String(e?.message || e));
              } finally {
                setRepairing(false);
              }
            }}
            disabled={repairing}
            style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: repairing ? colors.bg.muted : colors.accent.primary, marginBottom: 12 }}
          >
            {repairing ? <ActivityIndicator color={colors.text.inverted} /> : <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Repair Apple Links</Text>}
          </Pressable>
          {repairDone && <Text style={{ marginBottom: 12, color: colors.accent.success }}>{repairCount ?? 0} repaired</Text>}
          <Pressable
            onPress={async () => {
              if (refreshing) return;
              setRefreshResult(null);
              setRefreshing(true);
              try {
                const res = await bulkRefreshAppleLinks(150);
                setRefreshResult(res);
              } catch (e:any) {
                Alert.alert('Bulk refresh failed', String(e?.message || e));
              } finally {
                setRefreshing(false);
              }
            }}
            disabled={refreshing}
            style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: refreshing ? colors.bg.muted : colors.accent.primary }}
          >
            {refreshing ? <ActivityIndicator color={colors.text.inverted} /> : <Text style={{ color: colors.text.inverted, fontWeight: '700' }}>Bulk Refresh Apple Links</Text>}
          </Pressable>
          {refreshResult && (
            <Text style={{ marginTop: 8, color: colors.accent.success }}>
              Processed {refreshResult.processed}, updated {refreshResult.updated}
            </Text>
	          )}
	        </View>
	      ) : null}

        <View style={{ marginTop: 8 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6, color: colors.text.secondary }}>Account</Text>
          <Pressable
            onPress={onSignOut}
            disabled={signingOut}
            style={{
              padding: 12,
              borderRadius: 14,
              backgroundColor: colors.bg.secondary,
              borderWidth: 1,
              borderColor: colors.border.subtle,
              opacity: signingOut ? 0.6 : 1,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <Text style={{ fontWeight: '700', color: '#ff3b30' }}>
                Sign out
              </Text>
              {signingOut ? <ActivityIndicator /> : null}
            </View>
          </Pressable>
        </View>
	      </ScrollView>
	    </Screen>
	  );
	}
