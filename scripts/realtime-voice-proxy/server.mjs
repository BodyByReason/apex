import http from 'node:http';
import crypto from 'node:crypto';

import { WebSocketServer, WebSocket } from 'ws';

const PORT = Number(process.env.PORT || 8080);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const OPENAI_REALTIME_MODEL = process.env.OPENAI_REALTIME_MODEL || 'gpt-realtime-mini';
const OPENAI_REALTIME_VOICE = process.env.OPENAI_REALTIME_VOICE || 'marin';
const OPENAI_TRANSCRIBE_MODEL = process.env.OPENAI_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe';
const APP_BEARER_TOKEN = process.env.APP_BEARER_TOKEN || '';

if (!OPENAI_API_KEY) {
  throw new Error('Missing OPENAI_API_KEY');
}

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Origin': '*',
};

function sendJson(ws, payload) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(payload));
  }
}

function unauthorized(res) {
  res.writeHead(401, {
    ...corsHeaders,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ error: 'missing or invalid app bearer token' }));
}

function getSessionConfig(overrides = {}) {
  const session = overrides?.session ?? {};
  return {
    type: 'realtime',
    model: OPENAI_REALTIME_MODEL,
    instructions:
      session.instructions ||
      'You are an AI Coach. Speak warmly, clearly, and concisely. Ask one coaching question at a time. Avoid long monologues.',
    audio: {
      input: {
        format: { rate: 24000, type: 'audio/pcm' },
        noise_reduction: { type: 'near_field' },
        transcription: {
          language: 'en',
          model: OPENAI_TRANSCRIBE_MODEL,
        },
        turn_detection: {
          create_response: true,
          eagerness: 'auto',
          interrupt_response: true,
          type: 'semantic_vad',
        },
        ...(session.audio?.input ?? {}),
      },
      output: {
        format: { rate: 24000, type: 'audio/pcm' },
        speed: 1.0,
        voice: OPENAI_REALTIME_VOICE,
        ...(session.audio?.output ?? {}),
      },
    },
    max_output_tokens: 220,
    truncation: {
      retention_ratio: 0.8,
      token_limits: { post_instructions: 8000 },
      type: 'retention_ratio',
    },
    ...(session ?? {}),
  };
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(200, corsHeaders);
    res.end('ok');
    return;
  }

  if (req.url === '/healthz' && req.method === 'GET') {
    res.writeHead(200, {
      ...corsHeaders,
      'Content-Type': 'application/json',
    });
    res.end(JSON.stringify({ ok: true, realtimeModel: OPENAI_REALTIME_MODEL }));
    return;
  }

  if (req.url === '/api/realtime/client-secret' && req.method === 'POST') {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ') || (APP_BEARER_TOKEN && authHeader !== `Bearer ${APP_BEARER_TOKEN}`)) {
      unauthorized(res);
      return;
    }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);

    let requestBody = {};
    try {
      requestBody = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    } catch {
      requestBody = {};
    }

    const body = {
      expires_after: {
        anchor: 'created_at',
        seconds: 120,
      },
      session: getSessionConfig(requestBody),
    };

    try {
      const response = await fetch('https://api.openai.com/v1/realtime/client_secrets', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      });

      const text = await response.text();
      res.writeHead(response.status, {
        ...corsHeaders,
        'Content-Type': 'application/json',
      });
      res.end(text);
    } catch (error) {
      res.writeHead(500, {
        ...corsHeaders,
        'Content-Type': 'application/json',
      });
      res.end(
        JSON.stringify({
          error: 'failed_to_mint_client_secret',
          message: error instanceof Error ? error.message : 'Unknown error',
        }),
      );
    }
    return;
  }

  res.writeHead(404, {
    ...corsHeaders,
    'Content-Type': 'application/json',
  });
  res.end(JSON.stringify({ error: 'not_found' }));
});

const wss = new WebSocketServer({ path: '/ws/realtime-proxy', server });

wss.on('connection', async (clientSocket, req) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader.startsWith('Bearer ') || (APP_BEARER_TOKEN && authHeader !== `Bearer ${APP_BEARER_TOKEN}`)) {
    clientSocket.close(4001, 'unauthorized');
    return;
  }

  const sessionId = crypto.randomUUID();
  let upstream;

  try {
    upstream = new WebSocket(
      `wss://api.openai.com/v1/realtime?model=${encodeURIComponent(OPENAI_REALTIME_MODEL)}`,
      {
        headers: {
          Authorization: `Bearer ${OPENAI_API_KEY}`,
        },
      },
    );

    upstream.on('open', () => {
      sendJson(upstream, {
        type: 'session.update',
        session: getSessionConfig(),
      });
    });

    upstream.on('message', (buffer) => {
      const event = JSON.parse(buffer.toString());
      switch (event.type) {
        case 'session.created':
        case 'session.updated':
          sendJson(clientSocket, { sessionId, type: 'session.ready' });
          break;
        case 'response.output_audio.delta':
          sendJson(clientSocket, { audio: event.delta, type: 'audio.delta' });
          break;
        case 'response.output_audio_transcript.delta':
          sendJson(clientSocket, { text: event.delta, type: 'transcript.delta' });
          break;
        case 'response.done':
          sendJson(clientSocket, { response: event.response, type: 'response.done' });
          break;
        case 'error':
          sendJson(clientSocket, { error: event.error, type: 'error' });
          break;
        default:
          sendJson(clientSocket, { event, type: 'event' });
          break;
      }
    });

    upstream.on('close', () => {
      if (clientSocket.readyState === WebSocket.OPEN) {
        clientSocket.close(1011, 'upstream_closed');
      }
    });

    upstream.on('error', (error) => {
      sendJson(clientSocket, {
        error: { message: error instanceof Error ? error.message : 'upstream_realtime_error' },
        type: 'error',
      });
    });

    clientSocket.on('message', (buffer) => {
      let message;
      try {
        message = JSON.parse(buffer.toString());
      } catch {
        sendJson(clientSocket, { error: { message: 'invalid_json' }, type: 'error' });
        return;
      }

      if (!upstream || upstream.readyState !== WebSocket.OPEN) return;

      switch (message.type) {
        case 'start':
          break;
        case 'audio':
          sendJson(upstream, {
            audio: message.audio,
            type: 'input_audio_buffer.append',
          });
          break;
        case 'commit':
          sendJson(upstream, { type: 'input_audio_buffer.commit' });
          sendJson(upstream, { type: 'response.create' });
          break;
        case 'cancel':
          sendJson(upstream, { type: 'response.cancel' });
          break;
        case 'ping':
          sendJson(clientSocket, { type: 'pong' });
          break;
        default:
          sendJson(clientSocket, {
            error: { message: `unknown_client_message:${message.type}` },
            type: 'error',
          });
      }
    });

    clientSocket.on('close', () => {
      try {
        upstream?.close();
      } catch {
        // noop
      }
    });
  } catch (error) {
    clientSocket.close(1011, error instanceof Error ? error.message : 'proxy_failure');
  }
});

server.listen(PORT, () => {
  console.log(`APEX realtime voice proxy listening on http://localhost:${PORT}`);
});
