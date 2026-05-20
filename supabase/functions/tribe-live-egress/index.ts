import { EgressClient } from 'npm:livekit-server-sdk@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const { action, roomName, sessionId, egressId } = await req.json() as {
      action: 'start' | 'stop';
      roomName?: string;
      sessionId?: string;
      egressId?: string;
    };

    const livekitUrl = Deno.env.get('LIVEKIT_URL')!;
    const apiKey = Deno.env.get('LIVEKIT_API_KEY')!;
    const apiSecret = Deno.env.get('LIVEKIT_API_SECRET')!;
    const s3AccessKey = Deno.env.get('S3_ACCESS_KEY')!;
    const s3SecretKey = Deno.env.get('S3_SECRET_KEY')!;
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;

    // e.g. https://nitruxotcddfkxyaosiy.supabase.co → nitruxotcddfkxyaosiy
    const projectRef = supabaseUrl.replace('https://', '').split('.')[0];

    const client = new EgressClient(livekitUrl, apiKey, apiSecret);

    if (action === 'start') {
      if (!roomName || !sessionId) {
        return new Response(JSON.stringify({ error: 'roomName and sessionId required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const filepath = `${sessionId}.mp4`;
      const s3Endpoint = `https://${projectRef}.supabase.co/storage/v1/s3`;

      const info = await client.startRoomCompositeEgress(roomName, {
        file: {
          fileType: 1, // MP4
          filepath,
          output: {
            case: 's3',
            value: {
              accessKey: s3AccessKey,
              secret: s3SecretKey,
              bucket: 'tribe-live-videos',
              region: 'auto',
              endpoint: s3Endpoint,
              forcePathStyle: true,
            },
          },
        },
      });

      const videoUrl = `https://${projectRef}.supabase.co/storage/v1/object/public/tribe-live-videos/${filepath}`;

      return new Response(JSON.stringify({ egressId: info.egressId, videoUrl }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'stop') {
      if (!egressId) {
        return new Response(JSON.stringify({ error: 'egressId required' }), {
          status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      await client.stopEgress(egressId);

      return new Response(JSON.stringify({ stopped: true }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action' }), {
      status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
