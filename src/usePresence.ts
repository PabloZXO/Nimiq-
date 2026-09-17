import { useEffect } from 'react';
import { api } from './api';
import type { User } from './types';

export function usePresence(user: User | null) {
  useEffect(() => {
    if (!user?.nickname || !user.wallet) return;
    const controller = new AbortController();
    let pending = false;
    async function heartbeat() {
      if (document.visibilityState !== 'visible' || !navigator.onLine || pending) return;
      pending = true;
      try { await api('/presence', {}, controller.signal); }
      catch { /* Presence expires on the server when the connection is lost. */ }
      finally { pending = false; }
    }
    void heartbeat();
    const timer = setInterval(heartbeat, 15000);
    document.addEventListener('visibilitychange', heartbeat);
    window.addEventListener('online', heartbeat);
    return () => {
      clearInterval(timer); controller.abort();
      document.removeEventListener('visibilitychange', heartbeat);
      window.removeEventListener('online', heartbeat);
    };
  }, [user?.id, user?.nickname, user?.wallet?.verifiedAt]);
}
