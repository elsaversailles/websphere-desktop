import { afterEach, describe, expect, it, vi } from 'vitest';
import { startIncomingRingtone } from './ringtone';

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
it('rings on a cadence and releases audio and autoplay listeners on cleanup', () => {
  vi.useFakeTimers();
  const listeners = new Map<string, () => void>();
  const document = { addEventListener: vi.fn((name, fn) => listeners.set(name, fn)), removeEventListener: vi.fn((name) => listeners.delete(name)) };
  const start = vi.fn(); const close = vi.fn().mockResolvedValue(undefined);
  class Context {
    state = 'running'; currentTime = 0; destination = {}; close = close;
    resume = vi.fn().mockResolvedValue(undefined);
    createOscillator() { return { frequency: { value: 0 }, connect: vi.fn(), disconnect: vi.fn(), start, stop: vi.fn(), onended: null }; }
    createGain() { return { gain: { setValueAtTime: vi.fn(), linearRampToValueAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() }; }
  }
  vi.stubGlobal('document', document); vi.stubGlobal('AudioContext', Context);
  const stop = startIncomingRingtone();
  expect(start).toHaveBeenCalledTimes(2);
  vi.advanceTimersByTime(3000); expect(start).toHaveBeenCalledTimes(4);
  stop(); stop();
  expect(close).toHaveBeenCalledOnce(); expect(listeners.size).toBe(0);
  vi.advanceTimersByTime(60000); expect(start).toHaveBeenCalledTimes(4);
});
