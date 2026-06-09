import '@/../shims/globals';

let registered = false;

function patchLiveKitAudioSessionCompatibility(AudioSession: any) {
  if (!AudioSession || (AudioSession as any).__apexCompatibilityPatched) return;

  let Platform: any = null;
  let NativeModules: Record<string, any> = {};
  try {
    ({ Platform, NativeModules } = require('react-native'));
  } catch {
    // Native modules are only available on device.
  }

  const nativeModule = NativeModules?.LivekitReactNativeModule;
  const originalConfigureAudio = AudioSession.configureAudio;
  const originalStartAudioSession = AudioSession.startAudioSession;
  const originalStopAudioSession = AudioSession.stopAudioSession;
  const originalSetAppleAudioConfiguration = AudioSession.setAppleAudioConfiguration;

  const nativeMethod = (name: string) =>
    typeof nativeModule?.[name] === 'function' ? nativeModule[name] : null;

  const applyAppleAudioConfiguration = async (config: Record<string, any>) => {
    if (Platform?.OS !== 'ios') return undefined;
    if (nativeMethod('setAppleAudioConfiguration')) {
      return originalSetAppleAudioConfiguration?.(config);
    }
    return undefined;
  };

  AudioSession.configureAudio = async (config: Record<string, any>) => {
    if (nativeMethod('configureAudio')) {
      return originalConfigureAudio?.(config);
    }

    // Older TestFlight binaries were built before @livekit/react-native exposed
    // configureAudio on the native iOS module. The ElevenLabs RN SDK calls the
    // JS wrapper unconditionally, so bridge older binaries through the older
    // iOS-specific API instead of crashing with "undefined is not a function".
    if (
      Platform?.OS === 'ios' &&
      (nativeMethod('setAppleAudioConfiguration') || !nativeMethod('configureAudio'))
    ) {
      const defaultOutput = config?.ios?.defaultOutput ?? 'speaker';
      return applyAppleAudioConfiguration({
        audioCategory: 'playAndRecord',
        audioCategoryOptions:
          defaultOutput === 'earpiece'
            ? ['allowAirPlay', 'allowBluetooth', 'allowBluetoothA2DP']
            : ['allowAirPlay', 'allowBluetooth', 'allowBluetoothA2DP', 'defaultToSpeaker'],
        audioMode: defaultOutput === 'earpiece' ? 'voiceChat' : 'videoChat',
      });
    }

    // If the app binary lacks both methods, let LiveKit's default WebRTC audio
    // configuration stand. That keeps OTA builds from crashing while a native
    // rebuild catches up.
    return undefined;
  };

  AudioSession.startAudioSession = async () => {
    if (nativeMethod('startAudioSession')) {
      return originalStartAudioSession?.();
    }
    return undefined;
  };

  AudioSession.stopAudioSession = async () => {
    if (nativeMethod('stopAudioSession')) {
      return originalStopAudioSession?.();
    }
    return undefined;
  };

  AudioSession.setAppleAudioConfiguration = applyAppleAudioConfiguration;

  (AudioSession as any).__apexCompatibilityPatched = true;
}

export function ensureLivekitGlobals() {
  if (registered) return;

  const { AudioSession, registerGlobals } = require('@livekit/react-native') as {
    AudioSession?: any;
    registerGlobals: () => void;
  };

  patchLiveKitAudioSessionCompatibility(AudioSession);
  registerGlobals();

  if (
    (global as any).navigator?.mediaDevices &&
    typeof (global as any).navigator.mediaDevices.getSupportedConstraints === 'undefined'
  ) {
    (global as any).navigator.mediaDevices.getSupportedConstraints = () => ({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: true,
      deviceId: true,
      facingMode: true,
      frameRate: true,
      height: true,
      width: true,
    });
  }

  registered = true;
}

ensureLivekitGlobals();
