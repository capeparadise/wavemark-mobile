import React, { createContext, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ActivityIndicator, Alert, Image, Modal, Platform, Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import RatingModal from './RatingModal';
import { supabase } from '../lib/supabase';
import { addToListFromSearch, getDefaultPlayer, openByDefaultPlayer, setRating, setRatingDetailed, type ListenRow } from '../lib/listen';
import { bulkListenAction } from '../lib/listenBulk';
import { type ReleaseTrack } from '../lib/releaseModel';
import { advancedRatingTotal } from '../lib/ratingDisplay';
import { getAdvancedRatingsEnabled } from '../lib/user';
import { emit, on, off } from '../lib/events';
import { toast } from '../lib/toast';
import { useTheme } from '../theme/useTheme';
import { useSession } from '../lib/session';
import { trackRatingSnapshot, subscribeTrackRatings, refreshTrackRatings } from '../lib/trackRatingCache';

const TrackRows = createContext<Record<string,ListenRow>>({});
export function TrackRatingsProvider({tracks,children}:{tracks:ReleaseTrack[];children:React.ReactNode}) {
  const {user}=useSession();
  const rows=useSyncExternalStore(subscribeTrackRatings,()=>trackRatingSnapshot(user?.id));
  useFocusEffect(useCallback(()=>{
    if(user?.id){void refreshTrackRatings(user.id).catch(()=>{});}
  },[user?.id]));
  return <TrackRows.Provider key={user?.id || 'signed-out'} value={rows}>{children}</TrackRows.Provider>;
}

// Always addresses a track row, never its enclosing album row.
export default function TrackRatingButton({ track, artworkUrl, artist, releaseDate }: {
  track: ReleaseTrack; artworkUrl?: string | null; artist?: string | null; releaseDate?: string | null;
}) {
  const { colors } = useTheme();
  const provider = track.provider;
  const providerId = String(track.providerId || track.id || '').trim();
  const loadedRows=useContext(TrackRows);
  const [row, setRow] = useState<ListenRow | null>(()=>loadedRows[`${provider}:${providerId}`] || null);
  const [visible, setVisible] = useState(false);
  const [menuVisible, setMenuVisible] = useState(false);
  const [player, setPlayer] = useState<'apple'|'spotify'>('apple');
  const pendingRating = useRef(false);
  const insets = useSafeAreaInsets();
  const [advanced, setAdvanced] = useState(false);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  useEffect(()=>{setRow(loadedRows[`${provider}:${providerId}`] || null);},[loadedRows,provider,providerId]);
  useFocusEffect(useCallback(()=>{void getAdvancedRatingsEnabled().then(setAdvanced).catch(()=>{});},[]));
  const lookup = useCallback(async () => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth.user) throw new Error('Please sign in to rate music.');
    const { data, error } = await supabase.from('listen_list').select('*')
      .eq('user_id', auth.user.id).eq('item_type', 'track')
      .eq('provider', provider).eq('provider_id', providerId).maybeSingle();
    if (error) throw error;
    return data as ListenRow | null;
  }, [provider, providerId]);
  if (!providerId || (provider !== 'apple' && provider !== 'spotify')) return null;
  const addTrack = () => addToListFromSearch({type:'track',providerId,title:track.title,
    artist:track.artist || artist,artworkUrl,releaseDate,
    spotifyUrl:provider==='spotify' ? track.spotifyUrl || `https://open.spotify.com/track/${providerId}` : null,
    appleUrl:provider==='apple' ? track.appleUrl : null});
  const closeMenu = () => { if(!locked.current){pendingRating.current=false;setMenuVisible(false);} };
  const runMenu = async (action:()=>Promise<void>) => {
    if(locked.current)return;locked.current=true;setBusy(true);
    try{await action();setMenuVisible(false);}catch(e:any){Alert.alert('Could not update track',e.message || 'Please try again.');}
    finally{locked.current=false;setBusy(false);}
  };
  const actions = [
    {label:row?.rating?'Change rating':'Rate track',icon:'star-outline' as const,onPress:()=>{
      if(locked.current)return;
      pendingRating.current=Platform.OS==='ios';setMenuVisible(false);
      if(Platform.OS!=='ios')setVisible(true);
    }},
    {label:row && !row.done_at?'Remove from Listen List':'Save to Listen List',icon:row && !row.done_at?'bookmark' as const:'bookmark-outline' as const,onPress:()=>runMenu(async()=>{
      const current=await lookup();
      if(current && !current.done_at){
        const removed=await bulkListenAction([current.id],'remove');
        if(!removed.length)throw new Error('This track has a rating or listening activity. It has been kept to protect your history.');
        setRow(null);toast('Removed from Listen List');
      }else{
        const result=await addTrack();if(!result.ok || !result.row)throw new Error(result.message || 'Could not save track.');
        setRow(result.row);emit('listen:updated');emit('listen:refresh');toast('Saved to Listen List');
      }
    })},
    {label:player==='apple'?'Open in Apple Music':'Open in Spotify',icon:'play-outline' as const,onPress:()=>runMenu(async()=>{
      const opened = await openByDefaultPlayer(row || {id:providerId,item_type:'track',provider,provider_id:providerId,
        title:track.title,artist_name:track.artist || artist || null,artwork_url:artworkUrl,
        apple_id:provider==='apple'?providerId:null,apple_url:track.appleUrl || null,
        spotify_id:provider==='spotify'?providerId:null,spotify_url:track.spotifyUrl || null,done_at:null},player);
      if(!opened)throw new Error('Could not open this track in your music app.');
    })},
  ];
  return <>
    {row?.rating ? <Text accessibilityLabel={`Rating ${row.rating} out of 10`} style={{color:colors.text.muted,fontSize:12,fontVariant:['tabular-nums']}}>
      {advanced && advancedRatingTotal(row.rating,row.rating_details)!==null ? `${advancedRatingTotal(row.rating,row.rating_details)}/50` : `${row.rating}/10`}
    </Text> : null}
    <Pressable accessibilityRole="button" accessibilityLabel={`Options for ${track.title}`}
      disabled={busy} style={{ minHeight:44, width:44, justifyContent:'center', alignItems:'center' }}
      onPress={async () => {
        if(locked.current) return; locked.current=true; setBusy(true);
        try { const [current,pref,preferred]=await Promise.all([lookup(),getAdvancedRatingsEnabled(),getDefaultPlayer()]); setRow(current);setAdvanced(pref);setPlayer(preferred);setMenuVisible(true); }
        catch(e:any){Alert.alert('Could not load rating',e.message || 'Please try again.');}
        finally{locked.current=false;setBusy(false);}
      }}>
      {busy ? <ActivityIndicator size="small" color={colors.accent.primary} /> : <Ionicons name="ellipsis-horizontal" size={20} color={colors.text.muted} />}
    </Pressable>
    <Modal transparent visible={menuVisible} animationType="slide" onRequestClose={closeMenu}
      onDismiss={()=>{if(pendingRating.current){pendingRating.current=false;setVisible(true);}}}>
      <Pressable accessibilityLabel="Close track options" style={{flex:1,backgroundColor:colors.overlay.dim}} onPress={closeMenu}/>
      <View style={{position:'absolute',left:0,right:0,bottom:0,backgroundColor:colors.bg.secondary,borderTopLeftRadius:28,borderTopRightRadius:28,borderWidth:1,borderColor:colors.border.subtle,paddingHorizontal:18,paddingTop:10,paddingBottom:Math.max(18,insets.bottom+8)}}>
        <View style={{width:38,height:4,borderRadius:2,backgroundColor:colors.border.strong,alignSelf:'center',marginBottom:15}}/>
        <Text style={{color:colors.text.muted,fontSize:11,fontWeight:'700',letterSpacing:0.9}}>TRACK OPTIONS</Text>
        <View style={{flexDirection:'row',alignItems:'center',gap:12,paddingVertical:14,borderBottomWidth:1,borderBottomColor:colors.border.subtle}}>
          {artworkUrl ? <Image source={{uri:artworkUrl}} style={{width:48,height:48,borderRadius:10}}/>:null}
          <View style={{flex:1}}><Text style={{color:colors.text.secondary,fontSize:17,fontWeight:'700'}} numberOfLines={2}>{track.title}</Text><Text style={{color:colors.text.muted,marginTop:3,fontSize:13}}>{track.artist || artist}</Text></View>
        </View>
        {actions.map(action=><Pressable key={action.label} accessibilityRole="button" disabled={busy} onPress={action.onPress}
          style={({pressed})=>({minHeight:54,flexDirection:'row',alignItems:'center',gap:13,paddingVertical:12,borderBottomWidth:1,borderBottomColor:colors.border.subtle,opacity:busy?0.5:pressed?0.7:1})}>
          <Ionicons name={action.icon} size={21} color={colors.accent.primary}/><Text style={{color:colors.text.secondary,fontSize:15,fontWeight:'600',flex:1}}>{action.label}</Text>
        </Pressable>)}
        <Pressable accessibilityRole="button" onPress={closeMenu} disabled={busy} style={{marginTop:10,paddingVertical:12,borderRadius:14,backgroundColor:colors.bg.muted}}><Text style={{color:colors.text.secondary,textAlign:'center',fontWeight:'700'}}>Cancel</Text></Pressable>
      </View>
    </Modal>
    <RatingModal visible={visible} title={track.title} initial={row?.rating ?? 0} individualTrack
      advanced={advanced} initialDetails={row?.rating_details} initialReview={row?.review} onCancel={() => {if(!locked.current)setVisible(false);}}
      onSubmit={async (score,details,review) => {
        if(locked.current)return;locked.current=true;setBusy(true);
        try {
          let current=await lookup();
          if(!current){
            const added=await addToListFromSearch({type:'track',providerId,title:track.title,
              artist:track.artist || artist, artworkUrl,releaseDate,
              spotifyUrl:provider==='spotify' ? track.spotifyUrl || `https://open.spotify.com/track/${providerId}` : null,
              appleUrl:provider==='apple' ? track.appleUrl : null});
            if(!added.ok || !added.row)throw new Error(added.message || 'Could not prepare track.');
            current=added.row;
          }
          if(!current || current.item_type !== 'track')throw new Error('Could not identify the individual track.');
          const options={doneAt:current.done_at || new Date().toISOString()};
          const result=advanced && details
            ? await setRatingDetailed(current.id,score,{...details, artwork: current.rating_details?.artwork},review,options)
            : await setRating(current.id,score,review,options);
          if(!result.ok || !result.row)throw new Error(result.message || 'Could not save rating.');
          setRow({...current,...result.row,done_at:options.doneAt});setVisible(false);
          emit('listen:updated');emit('listen:refresh');toast('Track rated and marked as listened');
        }catch(e:any){Alert.alert('Could not save rating',e.message || 'Please try again.');}
        finally{locked.current=false;setBusy(false);}
      }}/>
  </>;
}
