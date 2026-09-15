import { supabase } from './supabase';

export type SavedArtist = { provider:'spotify'|'apple'; artist_id:string; artist_name:string; image_url:string|null };
async function owner() {
  const {data,error}=await supabase.auth.getUser();
  if(error || !data.user) throw new Error('Please sign in again.');
  return data.user.id;
}
function check(error:any) {
  if(error) throw new Error(error.code==='42P01'||error.code==='PGRST205'
    ? 'Artist bookmarks are not available on this build yet.' : 'Could not update artist bookmarks. Please try again.');
}
export async function fetchSavedArtists():Promise<SavedArtist[]> {
  const uid=await owner();
  const {data,error}=await supabase.from('saved_artists').select('provider,artist_id,artist_name,image_url').eq('user_id',uid).order('created_at',{ascending:false});
  check(error);return data || [];
}
export async function setArtistSaved(artist:SavedArtist,saved:boolean) {
  const uid=await owner();
  if(!artist.artist_id || !artist.artist_name) throw new Error('Artist details are unavailable.');
  const query=saved ? supabase.from('saved_artists').upsert({...artist,user_id:uid},{onConflict:'user_id,provider,artist_id'})
    : supabase.from('saved_artists').delete().eq('user_id',uid).eq('provider',artist.provider).eq('artist_id',artist.artist_id);
  const {error}=await query;check(error);
}
