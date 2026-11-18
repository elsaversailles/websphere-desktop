/** A distinct, bounded incoming-call ring. Cleanup also removes autoplay retries. */
export function startIncomingRingtone(): () => void {
  let context: AudioContext | null = null;
  let stopped = false;
  const ring = () => {
    if (stopped) return;
    try {
      context ??= new AudioContext();
      void context.resume().catch(() => undefined);
      if (context.state !== 'running') return;
      for (const frequency of [440, 480]) {
        const oscillator = context.createOscillator();
        const gain = context.createGain();
        oscillator.frequency.value = frequency;
        gain.gain.setValueAtTime(0, context.currentTime);
        gain.gain.linearRampToValueAtTime(0.08, context.currentTime + 0.03);
        gain.gain.setValueAtTime(0.08, context.currentTime + 0.9);
        gain.gain.linearRampToValueAtTime(0, context.currentTime + 1);
        oscillator.connect(gain); gain.connect(context.destination);
        oscillator.start(); oscillator.stop(context.currentTime + 1.05);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    } catch { /* The visual invite remains available when audio is unsupported. */ }
  };
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(interval); clearTimeout(timeout);
    document.removeEventListener('pointerdown', ring);
    document.removeEventListener('keydown', ring);
    if (context) void context.close().catch(() => undefined);
  };
  const interval = setInterval(ring, 3000);
  const timeout = setTimeout(stop, 30000);
  document.addEventListener('pointerdown', ring);
  document.addEventListener('keydown', ring);
  ring();
  return stop;
}
