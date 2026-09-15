import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import { verifiedSpotifyArtistId } from '../lib/artistIdentity';
import Ionicons from '@expo/vector-icons/Ionicons';
import { LinearGradient } from 'expo-linear-gradient';
import Screen from './Screen';
import SaveArtistButton from './SaveArtistButton';
import { useTheme } from '../theme/useTheme';
import { fetchArtistById, fetchAllAlbums, fetchTopTracks, buildAlbumUrl, buildTrackUrl, type AppleArtist, type AppleAlbum, type AppleTrack } from '../lib/apple';
import { addToListenList } from '../lib/listen';
import { goToRelease } from '../lib/navigation';
import { formatDate } from '../lib/date';
import { toast } from '../lib/toast';

type Format = 'all' | 'single' | 'project' | 'tracks' | 'eps';
export default function AppleArtistRoute() {
  const { id, name } = useLocalSearchParams<{id:string;name?:string}>();
  const spotifyId = verifiedSpotifyArtistId(String(id || ''));
  if (spotifyId) return <Redirect href={{pathname:'/artist/[id]/mini',params:{id:spotifyId,...(name?{name}:{})}}}/>;
  return <AppleArtistScreen/>;
}

function AppleArtistScreen() {
  const { colors } = useTheme();
  const { id, name, tab } = useLocalSearchParams<{id:string;name?:string;tab?:string}>();
  const [artist,setArtist]=useState<AppleArtist|null>(null);
  const [albums,setAlbums]=useState<AppleAlbum[]>([]);
  const [tracks,setTracks]=useState<AppleTrack[]>([]);
  const [format,setFormat]=useState<Format>('all');
  const [busy,setBusy]=useState(true);
  const [errors,setErrors]=useState<string[]>([]);
  const [revision,setRevision]=useState(0);
  const [saving,setSaving]=useState<Set<string>>(new Set());
  const locks=useRef(new Set<string>());
  const displayName=artist?.name || name || 'Artist';
  useEffect(()=>{setFormat(tab==='tracks'?'tracks':tab==='eps'?'eps':tab==='albums'?'project':'all');},[id,tab]);
  useEffect(()=>{
    let active=true;setBusy(true);setErrors([]);setArtist(null);setAlbums([]);setTracks([]);
    if(!/^\d+$/.test(id || '')){setErrors(['Invalid artist link.']);setBusy(false);return;}
    void Promise.allSettled([fetchArtistById(Number(id)),fetchAllAlbums(Number(id)),fetchTopTracks(Number(id))]).then(results=>{
      if(!active)return;
      const [profile,releases,songs]=results;
      if(profile.status==='fulfilled')setArtist(profile.value);
      if(releases.status==='fulfilled')setAlbums([...new Map(releases.value.map(a=>[a.collectionId,a])).values()]);
      if(songs.status==='fulfilled')setTracks([...new Map(songs.value.map(t=>[t.trackId,t])).values()]);
      setErrors(results.flatMap((r,i)=>r.status==='rejected'?[['Artist details could not load.','Releases could not load.','Top tracks could not load.'][i]]:[]));
      setBusy(false);
    });
    return()=>{active=false;};
  },[id,revision]);
  const releases=useMemo(()=>albums.filter(a=>format==='single'?a.trackCount===1:format==='project'?(a.trackCount??2)>1:format==='eps'?/\bEP\b/i.test(a.collectionName):true)
    .sort((a,b)=>(Date.parse(b.releaseDate||'')||0)-(Date.parse(a.releaseDate||'')||0)),[albums,format]);
  const rows=(format==='tracks'?tracks:releases).map(item=>{
    const track='trackId' in item;
    return {item,key:`${track?'track':'album'}:${track?item.trackId:item.collectionId}`,title:track?item.trackName:item.collectionName,artist:item.artistName,image:item.artworkUrl,date:item.releaseDate,label:track?'TRACK':item.trackCount===1?'SINGLE':'PROJECT'};
  });
  return <Screen><ScrollView contentContainerStyle={{paddingBottom:80}} refreshControl={<RefreshControl refreshing={busy} onRefresh={()=>setRevision(v=>v+1)}/> }>
    <LinearGradient colors={[`${colors.accent.primary}44`,colors.bg.primary]} style={{minHeight:230,borderRadius:20,padding:18,justifyContent:'space-between'}}>
      <Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={()=>router.canGoBack()?router.back():router.replace('/(tabs)/discover')} style={{width:44,height:44,borderRadius:22,backgroundColor:colors.overlay.dim,alignItems:'center',justifyContent:'center'}}><Ionicons name="chevron-back" size={22} color={colors.text.secondary}/></Pressable>
      <View><Text style={{fontSize:30,fontWeight:'800',color:colors.text.secondary}}>{displayName}</Text><Text style={{color:colors.text.muted,marginTop:6}}>{artist?.primaryGenreName || 'Artist'} · Apple Music</Text></View>
    </LinearGradient>
    <Text style={{fontSize:18,fontWeight:'800',color:colors.text.secondary,marginTop:20,marginBottom:8}}>Artist releases</Text>
    <View style={{alignItems:'flex-start',marginBottom:12}}><SaveArtistButton key={id} artist={{provider:'apple',artist_id:id,artist_name:displayName,image_url:null}}/></View>
    <View style={{flexDirection:'row',flexWrap:'wrap',gap:8}}>
      {([{key:'all',label:'All formats'},{key:'single',label:'Singles'},{key:'project',label:'Projects'},{key:'tracks',label:'Top tracks'},...(tab==='eps'?[{key:'eps',label:'EPs'}]:[])] as {key:Format;label:string}[]).map(option=>
        <Pressable key={option.key} accessibilityRole="button" accessibilityState={{selected:format===option.key}} onPress={()=>setFormat(option.key)} style={{minHeight:44,justifyContent:'center'}}><View style={{paddingHorizontal:10,paddingVertical:6,borderRadius:999,borderWidth:1,borderColor:format===option.key?colors.accent.primary:colors.border.subtle,backgroundColor:format===option.key?`${colors.accent.primary}22`:'transparent'}}><Text style={{color:format===option.key?colors.accent.primary:colors.text.secondary,fontSize:12,fontWeight:'700'}}>{option.label}</Text></View></Pressable>)}
    </View>
    {!!errors.length && <View style={{paddingVertical:12}}><Text style={{color:colors.text.muted}}>{errors.join(' ')}</Text><Pressable onPress={()=>setRevision(v=>v+1)} style={{minHeight:44,justifyContent:'center'}}><Text style={{color:colors.accent.primary}}>Retry</Text></Pressable></View>}
    {busy && !rows.length ? <ActivityIndicator style={{margin:24}}/> : !rows.length ? <Text style={{color:colors.text.muted,paddingVertical:24}}>No releases match this filter.</Text> : rows.map(row=><View key={row.key} style={{flexDirection:'row',alignItems:'center',borderBottomWidth:StyleSheet.hairlineWidth,borderBottomColor:colors.border.subtle,paddingVertical:12,gap:10}}>
      <Pressable accessibilityRole="button" accessibilityLabel={`Open ${row.title}`} onPress={()=>{
        const item=row.item, track='trackId' in item, appleId=String(track?item.trackId:item.collectionId);
        goToRelease(appleId,{provider:'apple',appleId,appleUrl:track?buildTrackUrl(item.trackId,item.trackName):buildAlbumUrl(item.collectionId,item.collectionName),title:row.title,artistName:row.artist,artistId:id,imageUrl:row.image,releaseDate:row.date,type:track?'track':'album',totalTracks:track?1:item.trackCount});
      }} style={{flex:1,flexDirection:'row',alignItems:'center',gap:12}}>
        {row.image?<Image source={{uri:row.image}} style={{width:64,height:64,borderRadius:12}}/>:<View style={{width:64,height:64,borderRadius:12,backgroundColor:colors.bg.muted,alignItems:'center',justifyContent:'center'}}><Ionicons name="musical-notes-outline" size={24} color={colors.text.muted}/></View>}
        <View style={{flex:1}}><Text style={{fontSize:10,color:colors.accent.primary,fontWeight:'700',marginBottom:3}}>{row.label}</Text><Text style={{color:colors.text.secondary,fontWeight:'700',fontSize:15}} numberOfLines={2}>{row.title}</Text><Text style={{color:colors.text.muted,fontSize:12,marginTop:4}} numberOfLines={1}>{[row.artist,row.date?formatDate(row.date):null].filter(Boolean).join(' · ')}</Text></View>
      </Pressable>
      <Pressable accessibilityRole="button" accessibilityLabel={`Save ${row.title}`} disabled={saving.has(row.key)} style={{width:44,height:44,alignItems:'center',justifyContent:'center'}} onPress={async()=>{
        if(locks.current.has(row.key))return;locks.current.add(row.key);setSaving(new Set(locks.current));
        try{const result='trackId' in row.item?await addToListenList('track',row.item):await addToListenList('album',row.item);if(!result.ok)throw new Error(result.message || 'Please try again.');toast('Saved to Listen List');}
        catch(e:any){Alert.alert('Could not save',e.message);}finally{locks.current.delete(row.key);setSaving(new Set(locks.current));}
      }}>{saving.has(row.key)?<ActivityIndicator size="small"/>:<Ionicons name="bookmark-outline" size={20} color={colors.text.muted}/>}</Pressable>
    </View>)}
  </ScrollView></Screen>;
}
