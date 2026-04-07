/**
 * Phone Audio Service — Web Audio API
 *
 * Synthesises all call-progress tones and DTMF digits locally.
 * No audio files required — everything is generated via oscillators.
 *
 * South African / ITU-T / CEPT standard tones
 * ─────────────────────────────────────────────
 *  Ringback   : 400 Hz + 450 Hz  0.4 s on · 0.2 s off · 0.4 s on · 2.0 s off
 *  Busy       : 400 Hz            0.5 s on · 0.5 s off
 *  Congestion : 400 Hz            0.25 s on · 0.25 s off  (fast busy / SIT follow-up)
 *  DTMF       : standard ITU-T dual-frequency pairs (80 ms burst)
 *  Connected  : short ascending A-major triad chime
 *  Ended      : short descending two-tone drop
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
  private activeOscs: OscillatorNode[] = [];
  private activeGains: GainNode[] = [];
  private cadenceTimer: ReturnType<typeof setTimeout> | null = null;
  private cadenceStopped = false;
  private autoStopTimer: ReturnType<typeof setTimeout> | null = null;

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

    tick();
    return g;
  }

  stopAll(): void {
    this.stopCadenced();
  }

  /**
   * South African ringback tone (heard by the CALLER while the remote side rings):
   * 400 Hz + 450 Hz — 0.4 s on · 0.2 s off · 0.4 s on · 2.0 s off  (double ring pattern)
   */
  startRingback(): void {
    this.stopCadenced();
    this.startCadencedTone([400, 450], [400, 200, 400, 2000], 0.25);
  }

  /**
   * Dialling / connecting tone (heard by the CALLER before ringback starts):
   * A very soft, slow pulse at 350 Hz — subtle indicator that the call is being set up.
   * 0.6 s on · 0.4 s off
   */
  startDialTone(): void {
    this.stopCadenced();
    this.startCadencedTone([350], [600, 400], 0.10);
  }

  /**
   * Incoming ringtone (heard by the RECEIVER on their own device):
   * 800 Hz + 1050 Hz — 0.8 s on · 0.4 s off · 0.8 s on · 2.0 s off  (double ring)
   * Higher pitch than ringback so it's clearly a local ring, not a remote cue.
   */
  startRingtone(): void {
    this.stopCadenced();
    this.startCadencedTone([800, 1050], [800, 400, 800, 2000], 0.30);
  }

  /**
   * Busy tone: 400 Hz — 0.5 s on / 0.5 s off (plays for 4 seconds then stops)
   */
  playBusy(durationMs = 4500): void {
    this.stopCadenced();
    this.startCadencedTone([400], [500, 500], 0.22);
    this.autoStopTimer = setTimeout(() => this.stopCadenced(), durationMs);
  }

  /**
   * Congestion / fast-busy (number doesn't exist, unavailable):
   * 400 Hz — 0.25 s on / 0.25 s off (plays for 3 seconds then stops)
   */
  playCongestion(durationMs = 3000): void {
    this.stopCadenced();
    this.startCadencedTone([400], [250, 250], 0.22);
    this.autoStopTimer = setTimeout(() => this.stopCadenced(), durationMs);
  }

  /**
   * ITU-T DTMF tone — dual frequency, 80 ms burst with 10 ms fade-out.
   * Deliberately uses its own AudioContext nodes so it never interferes
   * with cadenced tones and is not affected by stopAll().
   */
  playDtmf(digit: string): void {
    const pair = DTMF_FREQS[digit];
    if (!pair) return;
    try {
      const ctx = this.getCtx();
      const g = ctx.createGain();
      g.connect(ctx.destination);

      const t = ctx.currentTime;
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.22, t + 0.005);
      g.gain.setValueAtTime(0.22, t + 0.07);
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
   * Call connected chime — ascending A major triad (A4·C#5·E5), three quick taps.
   */
  playConnected(): void {
    try {
      const ctx = this.getCtx();
      const notes = [440, 554, 659];
      notes.forEach((freq, i) => {
        const g = ctx.createGain();
        g.connect(ctx.destination);
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        const t = ctx.currentTime + i * 0.075;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.16, t + 0.015);
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
        const g = ctx.createGain();
        g.connect(ctx.destination);
        const o = ctx.createOscillator();
        o.type = "sine";
        o.frequency.value = freq;
        o.connect(g);
        const t = ctx.currentTime + delay;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.14, t + 0.015);
        g.gain.exponentialRampToValueAtTime(0.001, t + 0.22);
        o.start(t);
        o.stop(t + 0.24);
      });
    } catch {}
  }

  destroy(): void {
    this.stopCadenced();
    if (this.ctx) {
      try { this.ctx.close(); } catch {}
      this.ctx = null;
      this.masterGain = null;
    }
  }
}

export const phoneAudio = new PhoneAudio();
