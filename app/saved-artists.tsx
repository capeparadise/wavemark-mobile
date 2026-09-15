import React,{useCallback,useState} from 'react';
import {ActivityIndicator,Alert,FlatList,Image,Pressable,Text,View} from 'react-native';
import {router,useFocusEffect} from 'expo-router';
import Screen from '../components/Screen';
import ListenViewSwitcher from '../components/ListenViewSwitcher';
import {fetchSavedArtists,setArtistSaved,type SavedArtist} from '../lib/savedArtists';
import {useTheme} from '../theme/useTheme';
import {useSession} from '../lib/session';

export default function SavedArtistsScreen(){
  const {colors}=useTheme(),{user}=useSession();
  const [rows,setRows]=useState<SavedArtist[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[revision,setRevision]=useState(0);
  useFocusEffect(useCallback(()=>{let active=true;setRows([]);setLoading(true);setError('');fetchSavedArtists().then(data=>{if(active)setRows(data);}).catch(e=>{if(active)setError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[user?.id,revision]));
  return <Screen>
    <View style={{paddingVertical:12}}><ListenViewSwitcher value="artists" /></View>
    <Text style={{color:colors.text.muted,marginVertical:12}}>A place for artists you want to explore. Saving doesn’t follow them.</Text>
    {loading?<ActivityIndicator/>:error?<View><Text style={{color:colors.text.muted}}>{error}</Text><Pressable onPress={()=>setRevision(v=>v+1)} style={{minHeight:44}}><Text style={{color:colors.accent.primary}}>Retry</Text></Pressable></View>:<FlatList data={rows} keyExtractor={a=>`${a.provider}:${a.artist_id}`} ListEmptyComponent={<Text style={{color:colors.text.muted}}>No saved artists yet. Open an artist’s profile and tap Save artist.</Text>}
      renderItem={({item})=><View style={{flexDirection:'row',alignItems:'center',paddingVertical:14,borderBottomWidth:0.5,borderBottomColor:colors.border.subtle,gap:12}}>
        <Pressable accessibilityRole="button" onPress={()=>router.push({pathname:item.provider==='spotify'?'/artist/[id]/mini':'/artist/[id]',params:{id:item.artist_id,name:item.artist_name}})} style={{flex:1,flexDirection:'row',alignItems:'center',gap:12}}>
          {item.image_url?<Image source={{uri:item.image_url}} style={{width:52,height:52,borderRadius:26}}/>:<View style={{width:52,height:52,borderRadius:26,backgroundColor:colors.bg.muted,alignItems:'center',justifyContent:'center'}}><Text style={{color:colors.text.secondary}}>♪</Text></View>}
          <Text numberOfLines={2} style={{flex:1,color:colors.text.secondary,fontWeight:'700',fontSize:16}}>{item.artist_name}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel={`Remove ${item.artist_name}`} style={{minHeight:44,justifyContent:'center'}} onPress={()=>Alert.alert('Remove saved artist?',item.artist_name,[{text:'Cancel',style:'cancel'},{text:'Remove',style:'destructive',onPress:async()=>{try{await setArtistSaved(item,false);setRows(old=>old.filter(a=>a.artist_id!==item.artist_id||a.provider!==item.provider));}catch(e:any){Alert.alert('Could not remove',e.message);}}}])}><Text style={{color:colors.text.muted}}>Remove</Text></Pressable>
      </View>}/>}
  </Screen>;
}
