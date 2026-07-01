// Hardware-feel feedback for a significant anomaly. Both are best-effort and
// silently no-op where unsupported (e.g. Vibration API is absent on iOS Safari).

export function hapticTap(): void {
  try {
    navigator.vibrate?.(18);
  } catch {
    /* unsupported — ignore */
  }
}

let tickCtx: AudioContext | null = null;

/** A quiet, short instrument "tick" — a soft filtered blip, not an alarm. */
export function soundTick(): void {
  try {
    tickCtx = tickCtx ?? new AudioContext();
    const ctx = tickCtx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = 1180;
    osc.connect(gain);
    gain.connect(ctx.destination);
    const t = ctx.currentTime;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.05, t + 0.005);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.start(t);
    osc.stop(t + 0.1);
  } catch {
    /* audio unavailable — ignore */
  }
}
