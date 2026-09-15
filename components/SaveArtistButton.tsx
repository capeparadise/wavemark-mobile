import React,{useCallback,useRef,useState} from 'react';
import {Alert,Pressable,Text} from 'react-native';
import {useFocusEffect} from '@react-navigation/native';
import {fetchSavedArtists,setArtistSaved,type SavedArtist} from '../lib/savedArtists';
import {useSession} from '../lib/session';
import {useTheme} from '../theme/useTheme';

export default function SaveArtistButton({artist}:{artist:SavedArtist}) {
  const {colors}=useTheme(),{user}=useSession();
  const [saved,setSaved]=useState(false),[ready,setReady]=useState(false),[busy,setBusy]=useState(false);
  const [loadError,setLoadError]=useState('');
  const lock=useRef(false);
  useFocusEffect(useCallback(()=>{
    let active=true;setReady(false);setSaved(false);setLoadError('');
    fetchSavedArtists().then(rows=>{if(active){setSaved(rows.some(row=>row.provider===artist.provider&&row.artist_id===artist.artist_id));setReady(true);}}).catch(e=>{if(active){setLoadError(e.message);setReady(true);}});
    return()=>{active=false;};
  },[user?.id,artist.provider,artist.artist_id]));
  return <Pressable accessibilityRole="button" accessibilityLabel={saved?'Remove artist bookmark':'Save artist to check out'} disabled={!ready||busy}
    onPress={async()=>{if(loadError){Alert.alert('Artist bookmark',loadError);return;}if(lock.current)return;lock.current=true;setBusy(true);try{await setArtistSaved(artist,!saved);setSaved(!saved);}catch(e:any){Alert.alert('Artist bookmark',e.message);}finally{lock.current=false;setBusy(false);}}}
    style={{paddingHorizontal:12,paddingVertical:8,borderRadius:14,borderWidth:1,borderColor:saved?colors.accent.primary:colors.border.subtle}}>
    <Text style={{color:saved?colors.accent.primary:colors.text.secondary,fontWeight:'600'}}>{busy?'Saving…':saved?'Artist saved':'Save artist'}</Text>
  </Pressable>;
}
