import { supabase } from './supabase';

export const testSupabaseConnection = async () => {
  const { data, error } = await supabase
    .from('releases')
    .select('*')
    .limit(5);

  if (error) {
    console.error(error);
    return { success: false, message: error.message };
  }

  return { success: true, message: `Fetched ${data.length} releases.` };
};
