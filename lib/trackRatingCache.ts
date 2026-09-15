import type { ListenRow } from './listen';
import { supabase } from './supabase';

const snapshots = new Map<string, Record<string, ListenRow>>();
const generations = new Map<string, number>();
const listeners = new Set<() => void>();
const empty: Record<string, ListenRow> = {};
export const trackRatingSnapshot = (uid?: string) => uid ? snapshots.get(uid) || empty : empty;
export function subscribeTrackRatings(listener: () => void) {
  listeners.add(listener); return () => { listeners.delete(listener); };
}
export async function refreshTrackRatings(uid: string) {
  const version = (generations.get(uid) || 0) + 1;
  generations.set(uid, version);
  const next: Record<string, ListenRow> = {};
  for(let offset=0;;offset+=1000){
    const {data,error}=await supabase.from('listen_list').select('*').eq('user_id',uid)
      .eq('item_type','track').order('id').range(offset,offset+999);
    if(error)throw error;
    for(const row of data || [])next[`${row.provider}:${row.provider_id}`]=row;
    if(!data || data.length<1000)break;
  }
  if(generations.get(uid)!==version)return;
  snapshots.set(uid,next);listeners.forEach(fn=>fn());
}
export function clearTrackRatings() {
  for(const uid of generations.keys())generations.set(uid,(generations.get(uid)||0)+1);
  snapshots.clear();listeners.forEach(fn=>fn());
}
