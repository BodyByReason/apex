// React Native has no DOM, so browser event constructors are undefined.
// The ElevenLabs/LiveKit SDK uses Event, CloseEvent, and MessageEvent
// internally when building connection error and disconnect objects.
// These minimal polyfills satisfy those calls without pulling in a full DOM shim.

if (typeof global.Event === 'undefined') {
  global.Event = class Event {
    constructor(type, options = {}) {
      this.type = type;
      this.bubbles = options.bubbles ?? false;
      this.cancelable = options.cancelable ?? false;
      this.composed = options.composed ?? false;
    }
  };
}

if (typeof global.CloseEvent === 'undefined') {
  global.CloseEvent = class CloseEvent extends global.Event {
    constructor(type, options = {}) {
      super(type, options);
      this.code = options.code ?? 0;
      this.reason = options.reason ?? '';
      this.wasClean = options.wasClean ?? false;
    }
  };
}

if (typeof global.MessageEvent === 'undefined') {
  global.MessageEvent = class MessageEvent extends global.Event {
    constructor(type, options = {}) {
      super(type, options);
      this.data = options.data ?? null;
      this.origin = options.origin ?? '';
      this.lastEventId = options.lastEventId ?? '';
    }
  };
}
