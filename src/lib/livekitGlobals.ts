import '@/../shims/globals';

let registered = false;

export function ensureLivekitGlobals() {
  if (registered) return;

  const { registerGlobals } = require('@livekit/react-native') as {
    registerGlobals: () => void;
  };

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
