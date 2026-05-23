/**
 * Phone Audio Service — Web Audio API
 *
 * Synthesises all call-progress tones and DTMF digits locally.
 * No audio files required — everything is generated via oscillators.
 *
 * South African / ITU-T / CEPT standard tones
 * ─────────────────────────────────────────────
 *  Ringback   : 400 Hz + 450 Hz  0.4 s on · 0.2 s off · 0.4 s on · 2.0 s off
 *  Busy       : 400 Hz + 450 Hz  0.5 s on · 0.5 s off
 *  Congestion : 400 Hz + 450 Hz  0.25 s on · 0.25 s off  (fast busy / reorder)
 *  SIT        : 985.2 Hz · 1370.6 Hz · 1776.7 Hz  (three ascending tones, once)
 *  DTMF       : standard ITU-T dual-frequency pairs (80 ms burst)
 *  Connected  : short ascending A-major triad chime
 *  Ended      : short descending two-tone drop
 *  No-answer  : soft descending two-note ding
 *
 * ALL tones (cadenced and one-shot) route through masterGain so volume is
 * consistent across all sound types and stopAll() reliably silences everything.
 */

const DTMF_FREQS: Record<string, [number, number]> = {
  "1": [697, 1209], "2": [697, 1336], "3": [697, 1477],
  "4": [770, 1209], "5": [770, 1336], "6": [770, 1477],
  "7": [852, 1209], "8": [852, 1336], "9": [852, 1477],
  "*": [941, 1209], "0": [941, 1336], "#": [941, 1477],
};

class PhoneAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;

  // ── Cadenced-tone state ──────────────────────────────────────────────────────
  private activeOscs: OscillatorNode[] = [];
  private activeGains: GainNode[] = [];
  private cadenceTimer: ReturnType<typeof setTimeout> | null = null;
  private cadenceStopped = false;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

  // ── One-shot tone state (SIT, no-answer, connected, ended, DTMF) ─────────────
  // We track every gain node created for one-shot tones so stopAll() can
  // immediately silence them even if their oscillators are still scheduled.
  private oneShotGains: GainNode[] = [];

  // ────────────────────────────────────────────────────────────────────────────

  private getCtx(): AudioContext {
    if (!this.ctx || this.ctx.state === "closed") {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.5;
      this.masterGain.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  /** Create a gain node that routes through masterGain and is tracked for stopAll(). */
  private makeOneShotGain(): GainNode {
    const ctx = this.getCtx();
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.masterGain!);
    this.oneShotGains.push(g);
    return g;
  }

  private stopCadenced(): void {
    this.cadenceStopped = true;
    if (this.cadenceTimer) {
      clearTimeout(this.cadenceTimer);
      this.cadenceTimer = null;
    }
    if (this.autoStopTimer) {
      clearTimeout(this.autoStopTimer);
      this.autoStopTimer = null;
    }
    const t = this.ctx?.currentTime ?? 0;
    this.activeGains.forEach((g) => {
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0, t);
        g.disconnect();
      } catch {}
    });
    this.activeOscs.forEach((o) => {
      try { o.stop(); } catch {}
      try { o.disconnect(); } catch {}
    });
    this.activeGains = [];
    this.activeOscs = [];
  }

  private stopOneShots(): void {
    const t = this.ctx?.currentTime ?? 0;
    this.oneShotGains.forEach((g) => {
      try {
        g.gain.cancelScheduledValues(t);
        g.gain.setValueAtTime(0, t);
        g.disconnect();
      } catch {}
    });
    this.oneShotGains = [];
  }

  private startCadencedTone(
    freqs: number[],
    pattern: number[],
    gainVal: number,
  ): GainNode {
    const ctx = this.getCtx();

    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.masterGain!);

    freqs.forEach((f) => {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = f;
      o.connect(g);
      o.start();
      this.activeOscs.push(o);
    });

    this.activeGains.push(g);

    this.cadenceStopped = false;
    let phase = 0;

    const tick = () => {
      if (this.cadenceStopped) return;
      const isOn = phase % 2 === 0;
      try {
        g.gain.value = isOn ? gainVal : 0;
      } catch {
        this.cadenceStopped = true;
        return;
      }
      const duration = pattern[phase % pattern.length];
      phase++;
      this.cadenceTimer = setTimeout(tick, duration);
    };

    // If the AudioContext is suspended (no prior user gesture yet), wait for it
    // to resume before starting the cadence. Once running, tick() drives it.
    if (ctx.state === "running") {
      tick();
    } else {
      ctx.resume().catch(() => {});
      const onStateChange = () => {
        if (ctx.state === "running") {
          ctx.removeEventListener("statechange", onStateChange);
          if (!this.cadenceStopped) tick();
        }
      };
      ctx.addEventListener("statechange", onStateChange);
    }

    return g;
  }

  /** Stop all audio — cadenced tones AND any in-progress one-shot tones. */
  stopAll(): void {
    this.stopCadenced();
    this.stopOneShots();
  }

  // ── Cadenced tones ───────────────────────────────────────────────────────────

  /**
   * South African ringback tone (heard by the CALLER while the remote side rings):
   * 400 Hz + 450 Hz — 0.4 s on · 0.2 s off · 0.4 s on · 2.0 s off  (double ring)
   */
  startRingback(): void {
    this.stopCadenced();
    this.startCadencedTone([400, 450], [400, 200, 400, 2000], 0.25);
  }

  /**
   * Dialling / connecting tone — soft slow pulse at 350 Hz while the call is
   * being set up.  0.6 s on · 0.4 s off
   */
  startDialTone(): void {
    this.stopCadenced();
    this.startCadencedTone([350], [600, 400], 0.10);
  }

  /**
   * Incoming ringtone (heard by the RECEIVER on their own device):
   * 800 Hz + 1050 Hz — 0.8 s on · 0.4 s off · 0.8 s on · 2.0 s off  (double ring)
   */
  startRingtone(): void {
    this.stopCadenced();
    this.startCadencedTone([800, 1050], [800, 400, 800, 2000], 0.30);
  }

  /**
   * Busy tone: 400 Hz + 450 Hz — 0.5 s on / 0.5 s off (South African dual-tone)
   * Plays for 5 seconds then stops automatically.
   */
  playBusy(durationMs = 5000): void {
    this.stopCadenced();
    this.startCadencedTone([400, 450], [500, 500], 0.20);
    this.autoStopTimer = setTimeout(() => this.stopCadenced(), durationMs);
  }

  /**
   * Reorder / congestion tone (network failure, call cannot be routed):
   * 400 Hz + 450 Hz — 0.25 s on / 0.25 s off  (double-speed busy = congestion)
   * Plays for 3 seconds then stops.
   */
  playCongestion(durationMs = 3000): void {
    this.stopCadenced();
    this.startCadencedTone([400, 450], [250, 250], 0.20);
    this.autoStopTimer = setTimeout(() => this.stopCadenced(), durationMs);
  }

  // ── One-shot tones ───────────────────────────────────────────────────────────

  /**
   * SIT — Special Information Tone (heard before "number not in service").
   * Three ascending pure tones per ITU-T / Bell system SIT frequencies:
   *   985.2 Hz  ·  1370.6 Hz  ·  1776.7 Hz
   * Each tone is ~380 ms with a 40 ms silent gap.  Plays once then stops.
   */
  playSIT(): void {
    this.stopCadenced();
    try {
      const ctx = this.getCtx();
      const tones   = [985.2, 1370.6, 1776.7];
      const toneDur = 0.38;
      const gapDur  = 0.04;
      const ramp    = 0.012;

      tones.forEach((freq, i) => {
        const start = ctx.currentTime + i * (toneDur + gapDur);
        const g = this.makeOneShotGain();

        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(0.44, start + ramp);        // ×2 because masterGain is 0.5
        g.gain.setValueAtTime(0.44, start + toneDur - ramp);
        g.gain.linearRampToValueAtTime(0, start + toneDur);

        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        o.start(start);
        o.stop(start + toneDur + 0.01);
      });
    } catch {}
  }

  /**
   * No-answer tone — soft descending two-note "ding-dong" drop.
   * Signals the call was not answered (no fault, no network error).
   */
  playNoAnswer(): void {
    try {
      const ctx = this.getCtx();
      [[659, 0], [494, 0.18]].forEach(([freq, delay]) => {
        const g = this.makeOneShotGain();
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        const t = ctx.currentTime + delay;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.26, t + 0.012);           // ×2 for masterGain
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.30);
        o.start(t);
        o.stop(t + 0.32);
      });
    } catch {}
  }

  /**
   * ITU-T DTMF tone — dual frequency, 80 ms burst with 10 ms fade-out.
   * Routes through masterGain so volume matches all other tones.
   */
  playDtmf(digit: string): void {
    const pair = DTMF_FREQS[digit];
    if (!pair) return;
    try {
      const ctx = this.getCtx();
      const g = this.makeOneShotGain();

      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.44, t + 0.005);             // ×2 for masterGain
      g.gain.setValueAtTime(0.44, t + 0.07);
      g.gain.linearRampToValueAtTime(0, t + 0.08);

      pair.forEach((freq) => {
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        o.start(t);
        o.stop(t + 0.09);
      });
    } catch {}
  }

  /**
   * Call connected chime — ascending A major triad (A4 · C#5 · E5).
   */
  playConnected(): void {
    try {
      const ctx = this.getCtx();
      [440, 554, 659].forEach((freq, i) => {
        const g = this.makeOneShotGain();
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        const t = ctx.currentTime + i * 0.075;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.32, t + 0.015);           // ×2 for masterGain
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.28);
        o.start(t);
        o.stop(t + 0.30);
      });
    } catch {}
  }

  /**
   * Call ended tone — descending two-note drop (A4 → E4), soft.
   */
  playEnded(): void {
    try {
      const ctx = this.getCtx();
      [[440, 0], [330, 0.16]].forEach(([freq, delay]) => {
        const g = this.makeOneShotGain();
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        const t = ctx.currentTime + delay;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.28, t + 0.015);           // ×2 for masterGain
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o.start(t);
        o.stop(t + 0.24);
      });
    } catch {}
  }

  /**
   * Unlock the AudioContext from a user-gesture event handler.
   * Call once on first user interaction so subsequent autoplay is not blocked.
   */
  unlock(): void {
    try {
      const ctx = this.getCtx();
      const g = this.makeOneShotGain();
      const o = ctx.createOscillator();
      o.connect(g);
      o.start(ctx.currentTime);
      o.stop(ctx.currentTime + 0.001);
    } catch {}
  }

  destroy(): void {
    this.stopAll();
    if (this.ctx) {
      try { this.ctx.close(); } catch {}
      this.ctx = null;
      this.masterGain = null;
    }
  }
}

export const phoneAudio = new PhoneAudio();
