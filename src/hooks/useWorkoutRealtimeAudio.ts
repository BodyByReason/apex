import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';

import { useRealtimeWorkoutCoach } from '@/hooks/useRealtimeWorkoutCoach';
import { useWorkoutElevenLabsCoach } from '@/hooks/useWorkoutElevenLabsCoach';
import { useWorkoutRealtimeWebRTC } from '@/hooks/useWorkoutRealtimeWebRTC';
import type { CoachVoiceOption } from '@/lib/coachVoice';
import { env } from '@/lib/env';
import {
  buildWorkoutRealtimeInstructions,
  buildWorkoutRealtimeSessionConfig,
  WORKOUT_REALTIME_TOOLS,
  type RealtimeWorkoutToolCall,
  type RealtimeWorkoutToolResult,
} from '@/lib/openaiRealtimeWorkout';

type ConnectWorkoutCoachInput = {
  coachVoice: CoachVoiceOption | null;
  currentExercise: string;
  kickoffPrompt?: string | null;
  todayWorkout: string;
  userName?: string | null;
  workoutContext: string;
};

type UseWorkoutRealtimeAudioArgs = {
  onToolCall: (call: RealtimeWorkoutToolCall) => Promise<RealtimeWorkoutToolResult>;
};

function getPreferredTransport() {
  const configured = env.openaiRealtimeTransport.trim().toLowerCase();
  if (configured === 'client-webrtc' || configured === 'server-proxy') {
    return configured;
  }
  return 'server-proxy';
}

function getPreferredAndroidVadMode() {
  const configured = env.openaiRealtimeAndroidVadMode.trim().toLowerCase();
  if (configured === 'server_vad' || configured === 'semantic_vad') {
    return configured;
  }
  return 'semantic_vad';
}

export function useWorkoutRealtimeAudio({ onToolCall }: UseWorkoutRealtimeAudioArgs) {
  const realtimeCoach = useRealtimeWorkoutCoach({ onToolCall });
  const webrtcCoach = useWorkoutRealtimeWebRTC({ onToolCall });
  const elevenLabsCoach = useWorkoutElevenLabsCoach({ onToolCall });
  const realtimeDisconnect = realtimeCoach.disconnect;
  const realtimeLastError = realtimeCoach.lastError;
  const webrtcDisconnect = webrtcCoach.disconnect;
  const webrtcAssistantTranscript = webrtcCoach.assistantTranscript;
  const webrtcDebugState = webrtcCoach.debugState;
  const webrtcLastError = webrtcCoach.lastError;
  const webrtcSupported = webrtcCoach.supported;

  const preferredTransport = useMemo(() => getPreferredTransport(), []);
  const preferredAndroidVadMode = useMemo(() => getPreferredAndroidVadMode(), []);
  const speechToSpeechEnabled = env.openaiSpeechToSpeechEnabled;
  const elevenLabsAgentEnabled = env.elevenLabsAgentEnabled;
  const proxyUrl = env.openaiRealtimeProxyUrl;
  const [proxyStatus, setProxyStatus] = useState<'idle' | 'checking' | 'ready' | 'unavailable'>('idle');
  const supportsNativeLiveMode = Platform.OS === 'android' || Platform.OS === 'ios';

  const liveAudioTransportReady =
    speechToSpeechEnabled &&
    preferredTransport === 'client-webrtc' &&
    webrtcSupported &&
    supportsNativeLiveMode;

  useEffect(() => {
    if (!speechToSpeechEnabled || preferredTransport !== 'server-proxy' || !proxyUrl) {
      setProxyStatus('idle');
      return;
    }

    let cancelled = false;
    setProxyStatus('checking');

    fetch(`${proxyUrl.replace(/\/$/, '')}/healthz`)
      .then(async (response) => {
        if (cancelled) return;
        setProxyStatus(response.ok ? 'ready' : 'unavailable');
      })
      .catch(() => {
        if (!cancelled) {
          setProxyStatus('unavailable');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [preferredTransport, proxyUrl, speechToSpeechEnabled]);

  const transportPhase = speechToSpeechEnabled
    ? liveAudioTransportReady
        ? 'live-audio-ready'
      : proxyStatus === 'ready'
        ? 'proxy-ready'
        : 'session-ready'
    : 'legacy';

  const transportSummary = useMemo(() => {
    if (!speechToSpeechEnabled) {
      return 'Legacy mic capture with Realtime coaching brain.';
    }

    if (liveAudioTransportReady) {
      return Platform.OS === 'android'
        ? 'Direct client WebRTC speech-to-speech is live. On Android, use the volume buttons during the session to raise call volume if Serena sounds quiet.'
        : 'Direct client WebRTC speech-to-speech is live.';
    }

    if (preferredTransport === 'client-webrtc' && speechToSpeechEnabled && !webrtcSupported) {
      return 'Client WebRTC speech-to-speech needs a dev build with react-native-webrtc. Expo Go will stay on the fallback mic loop.';
    }

    if (preferredTransport === 'server-proxy' && proxyStatus === 'checking') {
      return 'Checking the APEX realtime voice proxy.';
    }

    if (preferredTransport === 'server-proxy' && proxyStatus === 'ready') {
      return 'APEX realtime voice proxy is reachable. The app is still on the fallback mic loop until the native PCM client is wired in.';
    }

    if (preferredTransport === 'server-proxy' && proxyStatus === 'unavailable') {
      return 'APEX realtime voice proxy is not reachable yet, so the fallback mic loop is still active.';
    }

    return preferredTransport === 'client-webrtc'
      ? 'Realtime coach session is live. Direct mobile WebRTC audio transport is the next unlock.'
      : 'Realtime coach session is live. Server-mediated mobile audio transport is the next unlock.';
  }, [liveAudioTransportReady, preferredTransport, proxyStatus, speechToSpeechEnabled, supportsNativeLiveMode, webrtcSupported]);

  const connectWorkoutCoach = useCallback(async (input: ConnectWorkoutCoachInput) => {
    const coachLabel = input.coachVoice?.label ?? 'Marcus';

    // ── ElevenLabs Agents path (primary when enabled) ──────────────────────
    if (elevenLabsAgentEnabled && supportsNativeLiveMode) {
      const agentId = coachLabel === 'Serena'
        ? env.elevenLabsAgentSerenaId
        : env.elevenLabsAgentMarcusId;

      if (agentId) {
        const instructions = buildWorkoutRealtimeInstructions({
          coachVoice: input.coachVoice,
          workoutContext: input.workoutContext,
        });

        return elevenLabsCoach.connect({
          agentId,
          instructions,
          kickoffPrompt: input.kickoffPrompt ?? null,
          sessionMetadata: {
            coachLabel,
            currentExercise: input.currentExercise,
            platform: Platform.OS,
            todayWorkout: input.todayWorkout,
            userName: input.userName ?? null,
          },
          voiceId: input.coachVoice?.id ?? null,
          workoutContext: input.workoutContext,
        });
      }
    }

    // ── OpenAI Realtime WebRTC path ─────────────────────────────────────────
    const instructions = buildWorkoutRealtimeInstructions({
      coachVoice: input.coachVoice,
      workoutContext: input.workoutContext,
    });

    const sessionConfig = buildWorkoutRealtimeSessionConfig({
      coachVoice: input.coachVoice,
      turnDetectionMode:
        Platform.OS === 'android' ? preferredAndroidVadMode : 'semantic_vad',
      tools: WORKOUT_REALTIME_TOOLS,
    });

    if (liveAudioTransportReady) {
      return webrtcCoach.connect({
        instructions,
        kickoffPrompt: input.kickoffPrompt ?? null,
        sessionConfig,
        sessionMetadata: {
          coachLabel,
          currentExercise: input.currentExercise,
          platform: Platform.OS,
          realtimeTransport: preferredTransport,
          speechToSpeechEnabled,
          todayWorkout: input.todayWorkout,
        },
        tools: WORKOUT_REALTIME_TOOLS,
      });
    }

    return realtimeCoach.connect({
      instructions,
      sessionConfig,
      sessionMetadata: {
        coachLabel,
        currentExercise: input.currentExercise,
        platform: Platform.OS,
        realtimeTransport: preferredTransport,
        speechToSpeechEnabled,
        todayWorkout: input.todayWorkout,
      },
      tools: WORKOUT_REALTIME_TOOLS,
    });
  }, [elevenLabsAgentEnabled, elevenLabsCoach, liveAudioTransportReady, preferredAndroidVadMode, preferredTransport, realtimeCoach, speechToSpeechEnabled, supportsNativeLiveMode, webrtcCoach]);

  const liveDebugSummary = useMemo(() => {
    if (elevenLabsAgentEnabled && supportsNativeLiveMode) {
      return `ElevenLabs Agent · status ${elevenLabsCoach.status} · ${elevenLabsCoach.isSpeaking ? 'speaking' : 'listening'}${elevenLabsCoach.lastError ? ` · error ${elevenLabsCoach.lastError}` : ''}`;
    }

    if (!liveAudioTransportReady) {
      return null;
    }

    const debug = webrtcDebugState;
    const vadLabel =
      Platform.OS === 'android' ? preferredAndroidVadMode : 'semantic_vad';

    return `Live debug · VAD ${vadLabel} · stage ${debug.negotiationStage ?? 'idle'} · conn ${debug.connectionState ?? 'pending'} · ice ${debug.iceConnectionState ?? 'pending'} · channel ${debug.dataChannelOpen ? 'open' : 'closed'} · session ${debug.sessionCreated ? 'created' : 'pending'} / ${debug.sessionUpdated ? 'updated' : 'pending'} · speech starts ${debug.speechStartedCount} · speech stops ${debug.speechStoppedCount} · responses ${debug.responseStartedCount}/${debug.responseDoneCount}${webrtcLastError ? ` · error ${webrtcLastError}` : ''}${debug.lastMicError ? ` · mic ${debug.lastMicError}` : ''}${debug.lastEventType ? ` · last ${debug.lastEventType}` : ''}`;
  }, [elevenLabsAgentEnabled, elevenLabsCoach.isSpeaking, elevenLabsCoach.lastError, elevenLabsCoach.status, liveAudioTransportReady, preferredAndroidVadMode, supportsNativeLiveMode, webrtcDebugState, webrtcLastError]);

  // Destructure stable function refs — avoids depending on the whole
  // elevenLabsCoach object (which was new every render before the ref fix).
  const elevenLabsDisconnect = elevenLabsCoach.disconnect;
  const elevenLabsSendContextualUpdate = elevenLabsCoach.sendContextualUpdate;

  const sendContextualUpdate = useCallback((text: string) => {
    if (elevenLabsAgentEnabled && supportsNativeLiveMode) {
      elevenLabsSendContextualUpdate(text);
    }
  }, [elevenLabsAgentEnabled, elevenLabsSendContextualUpdate, supportsNativeLiveMode]);

  const disconnect = useCallback(() => {
    elevenLabsDisconnect();
    webrtcDisconnect();
    realtimeDisconnect();
  }, [elevenLabsDisconnect, realtimeDisconnect, webrtcDisconnect]);

  const activeAssistantTranscript = elevenLabsAgentEnabled && supportsNativeLiveMode
    ? elevenLabsCoach.assistantTranscript
    : liveAudioTransportReady
      ? webrtcAssistantTranscript
      : '';

  const activeLastError = elevenLabsAgentEnabled && supportsNativeLiveMode
    ? elevenLabsCoach.lastError
    : webrtcLastError ?? realtimeLastError;

  // Expose connection + speaking state for UI indicators (e.g. Active Workout Panel).
  const activeIsSpeaking = elevenLabsAgentEnabled && supportsNativeLiveMode
    ? elevenLabsCoach.isSpeaking
    : false;

  const activeIsConnected = elevenLabsAgentEnabled && supportsNativeLiveMode
    ? elevenLabsCoach.connected
    : liveAudioTransportReady
      ? webrtcCoach.supported
      : false;

  const elevenLabsIsConnecting = elevenLabsCoach.connecting;

  return useMemo(() => ({
    ...realtimeCoach,
    assistantTranscript: activeAssistantTranscript,
    connectWorkoutCoach,
    elevenLabsAgentEnabled,
    isConnected: activeIsConnected,
    isConnecting: elevenLabsIsConnecting,
    isSpeaking: activeIsSpeaking,
    liveAudioTransportReady,
    preferredTransport,
    preferredAndroidVadMode,
    proxyStatus,
    sendContextualUpdate,
    speechToSpeechEnabled,
    supportsNativeLiveMode,
    transportPhase,
    transportSummary,
    liveDebugSummary,
    disconnect,
    lastError: activeLastError,
    webrtcSupported,
  }), [
    activeAssistantTranscript,
    activeIsConnected,
    activeIsSpeaking,
    activeLastError,
    connectWorkoutCoach,
    disconnect,
    elevenLabsAgentEnabled,
    elevenLabsIsConnecting,
    liveAudioTransportReady,
    liveDebugSummary,
    preferredAndroidVadMode,
    preferredTransport,
    proxyStatus,
    realtimeCoach,
    sendContextualUpdate,
    speechToSpeechEnabled,
    supportsNativeLiveMode,
    transportPhase,
    transportSummary,
    webrtcSupported,
  ]);
}
