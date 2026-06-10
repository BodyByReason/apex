/**
 * ww-chat-notify
 *
 * Triggered by a Supabase DB webhook on INSERT to ww_chat_messages.
 * Fetches every push_token from profiles (except the sender) and fans
 * out an Expo push notification so users are alerted when someone posts
 * in the Walk & Water group chat.
 *
 * Expo's push endpoint accepts up to 100 tokens per request, so tokens
 * are chunked if the user base grows.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK_SIZE = 100;

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

type WebhookPayload = {
  type: 'INSERT';
  table: string;
  record: {
    id: string;
    user_id: string;
    display_name: string;
    body: string;
    created_at: string;
  };
};

type ExpoPushMessage = {
  to: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  sound?: 'default';
};

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const payload: WebhookPayload = await req.json();
    const { record } = payload;

    if (!record?.body || !record?.user_id) {
      return new Response(JSON.stringify({ ok: true, skipped: 'no record' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Fetch all push tokens except the sender's
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('push_token')
      .neq('id', record.user_id)
      .not('push_token', 'is', null);

    if (error) {
      console.error('[ww-chat-notify] profiles fetch error:', error.message);
      return new Response(JSON.stringify({ ok: false, error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const tokens = (profiles ?? [])
      .map((p: { push_token: string | null }) => p.push_token)
      .filter((t): t is string => typeof t === 'string' && t.startsWith('ExponentPushToken'));

    if (tokens.length === 0) {
      return new Response(JSON.stringify({ ok: true, sent: 0 }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const senderName = record.display_name || 'Someone';
    const messagePreview = record.body.length > 80
      ? record.body.slice(0, 77) + '…'
      : record.body;

    const messages: ExpoPushMessage[] = tokens.map((token) => ({
      to: token,
      title: `💬 ${senderName}`,
      body: messagePreview,
      sound: 'default',
      data: { screen: 'WalkWaterCommunity', tab: 'chat' },
    }));

    // Fan out in chunks of 100 (Expo limit per request)
    let totalSent = 0;
    for (const batch of chunk(messages, CHUNK_SIZE)) {
      const res = await fetch(EXPO_PUSH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(batch),
      });
      if (res.ok) {
        totalSent += batch.length;
      } else {
        console.error('[ww-chat-notify] Expo push error:', await res.text());
      }
    }

    return new Response(JSON.stringify({ ok: true, sent: totalSent }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('[ww-chat-notify] unexpected error:', err);
    return new Response(JSON.stringify({ ok: false, error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
