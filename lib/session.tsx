import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { ensureMyProfile } from './profileSocial';
import { supabase } from './supabase';
import { clearTrackRatings, refreshTrackRatings } from './trackRatingCache';
import { on, off } from './events';
import { writeAccountCache } from './accountCache';

type SessionCtx = {
  session: Session | null;
  user: User | null;
  loading: boolean;
};
const SessionContext = createContext<SessionCtx>({ session: null, user: null, loading: true });

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);

  useEffect(() => {
    supabase.auth
      .getSession()
      .then(({ data }: { data: any }) => {
        setSession(data.session ?? null);
      })
      .finally(() => {
        setLoading(false);
      });
    const { data: sub } = supabase.auth.onAuthStateChange((_event: any, sess: Session | null) => {
      setSession(sess ?? null);
    });
    return () => { sub.subscription.unsubscribe(); };
  }, []);

  useEffect(() => {
    if (!session?.user?.id) return;
    let active = true;
    ensureMyProfile().then(profile => {
      if (active && profile?.user_id === session.user.id) {
        void writeAccountCache('profile_identity_v1', session.user.id, profile);
      }
    }).catch(() => {});
    return () => { active = false; };
  }, [session?.user?.id]);

  useEffect(() => {
    clearTrackRatings();
    const uid=session?.user?.id;
    if(!uid)return;
    let timer:ReturnType<typeof setTimeout> | undefined;
    const refresh=()=>{clearTimeout(timer);timer=setTimeout(()=>{void refreshTrackRatings(uid).catch(()=>{});},0);};
    refresh();on('listen:updated',refresh);on('listen:refresh',refresh);
    return()=>{clearTimeout(timer);off('listen:updated',refresh);off('listen:refresh',refresh);clearTrackRatings();};
  },[session?.user?.id]);

  return (
    <SessionContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
