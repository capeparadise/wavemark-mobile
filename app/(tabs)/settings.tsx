import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, Text, TextInput, View } from 'react-native';
import { buildAlbumUrl, buildTrackInAlbumUrl } from '../../lib/apple';
import { bulkRefreshAppleLinks } from '../../lib/listen';
import { getMarketOverride, initMarketOverride, setMarketOverride } from '../../lib/market';
import { getMarket as getDeviceMarket } from '../../lib/spotify';
import { supabase } from '../../lib/supabase';

export default function SettingsTab() {
  const [market, setMarket] = useState<string>('');
  const [saved, setSaved] = useState(false);
  const [repairing, setRepairing] = useState(false);
  const [repairDone, setRepairDone] = useState(false);
  const [repairCount, setRepairCount] = useState<number | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [refreshResult, setRefreshResult] = useState<{ processed: number; updated: number } | null>(null);

  useEffect(() => {
    (async () => {
      await initMarketOverride();
      const v = getMarketOverride();
      setMarket(v ?? '');
    })();
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

  const repairAppleLinks = async () => {
    if (repairing) return;
    setRepairDone(false);
    setRepairCount(null);
    setRepairing(true);
    try {
      // Fetch listen_list rows missing canonical music.apple.com URL
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
      const stripDecor = (t: string) => t
        .replace(/\s*-\s*(deluxe|expanded|remaster(ed)?|clean|explicit|anniversary|edition)\b.*$/i,'')
        .replace(/\s*\((deluxe|expanded|remaster(ed)?|clean|explicit|anniversary|edition)\).*$/i,'')
        .trim();
      for (const r of targets) {
        try {
          // Attempt lookup by existing apple_id first
          let appleId: string | null = r.apple_id || null;
          let url: string | null = null;
          if (appleId) {
            const lu = await fetch(`https://itunes.apple.com/lookup?id=${encodeURIComponent(appleId)}&country=${cc}`).then(x => x.ok ? x.json() : null).catch(() => null) as any;
            const row = lu?.results?.[0];
            if (row) {
              const albumId = row.collectionId ? String(row.collectionId) : null;
              const trackId = row.trackId ? String(row.trackId) : null;
              if (r.item_type === 'track' && albumId && trackId) {
                url = buildTrackInAlbumUrl(trackId, row.trackName || r.title, albumId, row.collectionName || r.title, ccLower);
              } else if (albumId) {
                url = buildAlbumUrl(albumId, row.collectionName || r.title, ccLower);
              }
            }
          }
          // If no URL from lookup, perform search
          if (!url) {
            const term = encodeURIComponent([r.title, r.artist_name].filter(Boolean).join(' '));
            const entity = r.item_type === 'track' ? 'musicTrack' : 'album';
            // Use attribute to bias the search
            const attr = r.item_type === 'track' ? 'songTerm' : 'albumTerm';
            const searchRes = await fetch(`https://itunes.apple.com/search?term=${term}&country=${cc}&entity=${entity}&attribute=${attr}&limit=15`).then(x => x.ok ? x.json() : null).catch(() => null) as any;
            const picks = Array.isArray(searchRes?.results) ? searchRes.results : [];
            const wantTitle = norm(stripDecor(r.title));
            const wantArtist = norm(String(r.artist_name || ''));
            const wantYear = typeof r.release_date === 'string' && r.release_date ? Number(r.release_date.slice(0,4)) : null;
            // Helpers for better fuzzy matching
            const collapseLetters = (s: string) => s.replace(/(.)\1+/g,'$1');
            function levenshtein(a: string, b: string): number {
              const m = a.length, n = b.length;
              const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
              for (let i=0;i<=m;i++) dp[i][0]=i; for (let j=0;j<=n;j++) dp[0][j]=j;
              for (let i=1;i<=m;i++) for (let j=1;j<=n;j++) {
                const cost = a[i-1]===b[j-1]?0:1;
                dp[i][j] = Math.min(
                  dp[i-1][j] + 1,
                  dp[i][j-1] + 1,
                  dp[i-1][j-1] + cost
                );
              }
              return dp[m][n];
            }
            const titleTokens = wantTitle.split(' ').filter(t => t.length > 2);
            const titleVariants = new Set<string>([wantTitle]);
            // singular/plural basic
            if (wantTitle.endsWith('s')) titleVariants.add(wantTitle.slice(0,-1));
            else titleVariants.add(wantTitle + 's');
            // collapse double letters
            titleVariants.add(collapseLetters(wantTitle));
            const artistVariants = new Set<string>([wantArtist]);
            artistVariants.add(collapseLetters(wantArtist));

            let best: any = null; let bestScore = -1;
            for (const p of picks) {
              const rawTitle = r.item_type==='track' ? (p.trackName||'') : (p.collectionName||'');
              const gotTitleRawNorm = norm(stripDecor(rawTitle));
              const gotTitleCollapsed = collapseLetters(gotTitleRawNorm);
              const gotArtistNorm = norm(String(p.artistName||''));
              const gotArtistCollapsed = collapseLetters(gotArtistNorm);
              const candYear = (() => { try { return Number(String(p.releaseDate||'').slice(0,4)) || null; } catch { return null; }})();
              let s = 0;
              // Exact or variant matches
              if (titleVariants.has(gotTitleRawNorm) || titleVariants.has(gotTitleCollapsed)) s += 5;
              else {
                // Token coverage
                const coverage = titleTokens.reduce((acc,t) => acc + (gotTitleRawNorm.includes(t) ? 1 : 0), 0);
                if (coverage === titleTokens.length && titleTokens.length) s += 4;
                else if (coverage >= Math.ceil(titleTokens.length/2)) s += 2;
              }
              // Levenshtein small distance
              const lev = levenshtein(wantTitle, gotTitleRawNorm);
              if (lev <= 2) s += 2; else if (lev <= 4) s += 1;
              // Artist match
              if (wantArtist) {
                if (artistVariants.has(gotArtistNorm) || artistVariants.has(gotArtistCollapsed)) s += 4;
                else if (gotArtistNorm.includes(wantArtist) || wantArtist.includes(gotArtistNorm)) s += 2;
              }
              // Year proximity
              if (wantYear && candYear) {
                const dy = Math.abs(wantYear - candYear);
                if (dy === 0) s += 2; else if (dy === 1) s += 1; else if (dy >= 5) s -= 1;
              }
              // Penalize singles when expecting album
              if (r.item_type === 'album' && / - single$/i.test(String(p.collectionName||''))) s -= 3;
              // If track, penalize mismatch plurality if tokens differ strongly
              if (r.item_type === 'track' && titleTokens.length && !gotTitleRawNorm.includes(titleTokens[0])) s -= 1;
              if (s > bestScore) { best = p; bestScore = s; }
            }
            const minScore = r.item_type === 'track' ? 6 : 5;
            if (best) {
              const albumId = best.collectionId ? String(best.collectionId) : null;
              const trackId = best.trackId ? String(best.trackId) : null;
              if (bestScore >= minScore && r.item_type === 'track' && albumId && trackId) {
                url = buildTrackInAlbumUrl(trackId, best.trackName || r.title, albumId, best.collectionName || r.title, ccLower);
                appleId = trackId;
              } else if (bestScore >= minScore && albumId) {
                url = buildAlbumUrl(albumId, best.collectionName || r.title, ccLower);
                appleId = albumId;
              }
            }
          }
          if (url) {
            await supabase.from('listen_list').update({ apple_url: url, apple_id: appleId }).eq('id', r.id);
            fixed++;
          }
        } catch {}
      }
      setRepairCount(fixed);
      setRepairDone(true);
    } catch (e: any) {
      Alert.alert('Repair failed', String(e?.message || e));
    } finally {
      setRepairing(false);
    }
  };

  const APPLE_ENABLED = process.env.EXPO_PUBLIC_ENABLE_APPLE === 'true';
  return (
    <View style={{ flex: 1, padding: 16 }}>
      <Text style={{ fontSize: 22, fontWeight: '700', marginBottom: 8 }}>Settings</Text>
      <Text style={{ color: '#6b7280', marginBottom: 16 }}>Personalize how results are fetched.</Text>

      <View style={{ marginBottom: 16 }}>
        <Text style={{ fontWeight: '700', marginBottom: 6 }}>Market override</Text>
        <TextInput
          value={market}
          onChangeText={setMarket}
          placeholder="e.g., GB or US"
          autoCapitalize="characters"
          style={{ borderWidth: 1, borderColor: '#e5e7eb', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8 }}
        />
        <Text style={{ color: '#6b7280', marginTop: 6 }}>Leave blank to use device locale.</Text>
        <View style={{ flexDirection: 'row', gap: 12, marginTop: 12 }}>
          <Pressable onPress={onSave} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#111827' }}>
            <Text style={{ color: 'white', fontWeight: '700' }}>Save</Text>
          </Pressable>
          <Pressable onPress={onClear} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, backgroundColor: '#e5e7eb' }}>
            <Text style={{ color: '#111827', fontWeight: '700' }}>Clear</Text>
          </Pressable>
          {saved && <Text style={{ color: '#10b981', alignSelf: 'center' }}>Saved</Text>}
        </View>
      </View>
      {APPLE_ENABLED ? (
        <View style={{ marginBottom: 24 }}>
          <Text style={{ fontWeight: '700', marginBottom: 6 }}>Apple Music Deep Links</Text>
          <Text style={{ color: '#6b7280', marginBottom: 8 }}>Fix stored items so they use canonical music.apple.com URLs.</Text>
          <Pressable onPress={repairAppleLinks} disabled={repairing} style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: repairing ? '#9ca3af' : '#111827' }}>
            {repairing ? <ActivityIndicator color="#fff" /> : <Text style={{ color: 'white', fontWeight: '700' }}>Repair Apple Links</Text>}
          </Pressable>
          {repairDone && <Text style={{ marginTop: 8, color: '#10b981' }}>{repairCount ?? 0} repaired</Text>}
          <View style={{ height: 12 }} />
          <Text style={{ color: '#6b7280', marginBottom: 8 }}>Bulk refresh low-confidence or missing Apple links (IDs + canonical URLs).</Text>
          <Pressable
            onPress={async () => {
              if (refreshing) return;
              setRefreshing(true);
              setRefreshResult(null);
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
            style={{ paddingHorizontal: 12, paddingVertical: 10, borderRadius: 8, backgroundColor: refreshing ? '#9ca3af' : '#111827' }}
          >
            {refreshing ? <ActivityIndicator color="#fff" /> : <Text style={{ color: 'white', fontWeight: '700' }}>Bulk Refresh Apple Links</Text>}
          </Pressable>
          {refreshResult && (
            <Text style={{ marginTop: 8, color: '#10b981' }}>
              Processed {refreshResult.processed}, updated {refreshResult.updated}
            </Text>
          )}
        </View>
      ) : null}
    </View>
  );
}
