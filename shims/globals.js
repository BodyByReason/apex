// All missing browser globals patched in one place.
// This file must be the FIRST import in index.ts so Metro require()s it
// before @livekit/react-native or @elevenlabs/react-native are loaded.
// (ES module `import` statements are hoisted by Babel/Metro, so inline
//  polyfill code above import lines executes TOO LATE — a separate shim
//  file is the only reliable way to guarantee execution order.)

if (typeof global.DOMException === 'undefined') {
  global.DOMException = class DOMException extends Error {
    constructor(message = '', name = 'DOMException') {
      super(message);
      this.name = name;
    }
  };
}

// EventTarget — base class for Event dispatch; livekit-client extends it
// in several internal classes. Must come before Event so subclasses work.
if (typeof global.EventTarget === 'undefined') {
  global.EventTarget = class EventTarget {
    constructor() {
      this._listeners = {};
    }
    addEventListener(type, listener) {
      if (!this._listeners[type]) this._listeners[type] = [];
      this._listeners[type].push(listener);
    }
    removeEventListener(type, listener) {
      if (!this._listeners[type]) return;
      this._listeners[type] = this._listeners[type].filter(l => l !== listener);
    }
    dispatchEvent(event) {
      const listeners = this._listeners[event.type] || [];
      listeners.forEach(l => l(event));
      return true;
    }
  };
}

if (typeof global.Event === 'undefined') {
  global.Event = class Event {
    constructor(type, init = {}) {
      this.type = type;
      Object.assign(this, init);
    }
  };
}

if (typeof global.CloseEvent === 'undefined') {
  global.CloseEvent = class CloseEvent extends global.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.code = init.code ?? 0;
      this.reason = init.reason ?? '';
      this.wasClean = init.wasClean ?? false;
    }
  };
}

if (typeof global.MessageEvent === 'undefined') {
  global.MessageEvent = class MessageEvent extends global.Event {
    constructor(type, init = {}) {
      super(type, init);
      this.data = init.data ?? null;
      this.origin = init.origin ?? '';
      this.lastEventId = init.lastEventId ?? '';
    }
  };
}
