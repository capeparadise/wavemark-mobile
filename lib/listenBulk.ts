import { supabase } from './supabase';
import { emit } from './events';

export async function bulkListenAction(ids: string[], action: 'listened' | 'remove') {
  const unique = [...new Set(ids)];
  if (!unique.length || unique.length > 100 || unique.some(id => !/^[0-9a-f-]{36}$/i.test(id))) {
    throw new Error('Select between 1 and 100 saved items.');
  }
  const { data: auth, error: authError } = await supabase.auth.getUser();
  if (authError || !auth.user) throw new Error('Please sign in again.');
  const table = supabase.from('listen_list');
  let query = (action === 'remove' ? table.delete() : table.update({done_at:new Date().toISOString()}))
    .eq('user_id',auth.user.id).in('id',unique).is('done_at',null);
  // Never erase ratings/reviews/history if another screen/device changed a row.
  if(action === 'remove') query=query.is('rating',null).is('rated_at',null).is('review',null).is('rating_details',null);
  const { data, error } = await query.select('id');
  if(error)throw new Error('Could not update the selected items. Please try again.');
  emit('listen:updated');emit('listen:refresh');
  return (data || []).map((row: {id:string})=>row.id);
}
