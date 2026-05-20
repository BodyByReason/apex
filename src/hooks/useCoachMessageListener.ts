/**
 * useCoachMessageListener
 *
 * Subscribes to Supabase Realtime for new rows in `coach_messages`
 * where the current user is the client and sender = 'coach'.
 *
 * When a message arrives:
 *   • Fires a local push notification (visible even in foreground)
 *   • Works as long as the app is in the foreground or background.
 *     For killed-state delivery the Supabase edge function must call
 *     the Expo Push API using the push_token stored in profiles.
 */
import { useEffect } from 'react';

import { sendCoachMessageNotification } from '@/lib/notifications';
import { supabase } from '@/lib/supabase';

type CoachMessage = {
  id: string;
  user_id: string;
  sender_role: 'coach' | 'user';
  content: string;
  created_at: string;
};

export function useCoachMessageListener(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;

    const channel = supabase
      .channel(`coach-messages-${userId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'coach_messages',
          filter: `user_id=eq.${userId}`,
        },
        (payload) => {
          const msg = payload.new as CoachMessage;
          // Only notify for inbound (coach → client) messages
          if (msg.sender_role === 'coach') {
            sendCoachMessageNotification(msg.content).catch(() => null);
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel).catch(() => null);
    };
  }, [userId]);
}
