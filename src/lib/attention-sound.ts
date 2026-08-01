let audioContext: AudioContext | null = null;

export function unlockAttentionSound() {
  if (typeof window === "undefined") return;
  try {
    const AudioContextClass = window.AudioContext || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) return;
    audioContext ??= new AudioContextClass();
    if (audioContext.state === "suspended") void audioContext.resume();
  } catch {
    // Sound is an enhancement; the visual notification remains available.
  }
}

export function playAttentionSound() {
  unlockAttentionSound();
  const ctx = audioContext;
  if (!ctx || ctx.state === "suspended") return;
  const start = ctx.currentTime;
  [0, 0.22, 0.44].forEach((offset, index) => {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = index === 1 ? 1046 : 784;
    gain.gain.setValueAtTime(0.0001, start + offset);
    gain.gain.exponentialRampToValueAtTime(0.35, start + offset + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + offset + 0.18);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + offset);
    oscillator.stop(start + offset + 0.2);
  });
}