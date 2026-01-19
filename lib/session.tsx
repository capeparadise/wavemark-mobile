import type { Session, User } from '@supabase/supabase-js';
import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from './supabase';

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

  return (
    <SessionContext.Provider value={{ session, user: session?.user ?? null, loading }}>
      {children}
    </SessionContext.Provider>
  );
}

export const useSession = () => useContext(SessionContext);
