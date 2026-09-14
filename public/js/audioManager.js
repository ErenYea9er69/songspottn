// Audio Manager for SongSpot
// Handles precision HTML5 audio playback and Web Audio sound effects

class AudioManager {
  constructor() {
    this.audio = new Audio();
    this.audio.preload = 'auto';
    this.audio.crossOrigin = 'anonymous';

    this.currentUrl = null;
    this.isPlaying = false;
    this.timeoutId = null;
    this.targetDuration = 0;
    this.onProgressCallback = null;
    this.onEndCallback = null;
    this.animationFrameId = null;
    this.playbackStartTime = 0;

    // Web Audio Context for UI sound effects
    this.audioCtx = null;

    this.setupListeners();
  }

  getAudioContext() {
    if (!this.audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        this.audioCtx = new AudioContextClass();
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume();
    }
    return this.audioCtx;
  }

  setupListeners() {
    // Failsafe timeupdate check in case setTimeout is jittered
    this.audio.addEventListener('timeupdate', () => {
      if (this.isPlaying && this.targetDuration > 0 && this.audio.currentTime >= this.targetDuration) {
        this.stop();
      }
    });

    this.audio.addEventListener('ended', () => {
      this.stop();
    });

    this.audio.addEventListener('error', (e) => {
      console.warn('Audio playback error:', e);
      this.stop();
    });
  }

  // Play a trimmed snippet (e.g. 0.1s, 0.5s, 2s, 8s, 15s)
  playClip(url, durationSeconds, onStart, onProgress, onEnd) {
    this.stop();

    if (!url) return;
    this.targetDuration = durationSeconds;
    this.onProgressCallback = onProgress;
    this.onEndCallback = onEnd;

    if (this.currentUrl !== url) {
      this.audio.src = url;
      this.currentUrl = url;
    }

    this.audio.currentTime = 0;

    const playPromise = this.audio.play();
    if (playPromise !== undefined) {
      playPromise
        .then(() => {
          this.isPlaying = true;
          this.playbackStartTime = performance.now();
          if (onStart) onStart(this.targetDuration);

          // Primary timer: stops playback precisely at the target duration
          const durationMs = this.targetDuration * 1000;
          this.timeoutId = setTimeout(() => {
            this.stop();
          }, durationMs);

          // Animation frame loop for buttery smooth UI progress bar
          this.startProgressTracker();
        })
        .catch(err => {
          console.warn('Failed to start audio playback:', err);
          this.stop();
        });
    }
  }

  // Play the full 30-second preview (e.g., in the reveal modal)
  playFull(url, onStart, onProgress, onEnd) {
    this.stop();
    if (!url) return;

    this.targetDuration = 30;
    this.onProgressCallback = onProgress;
    this.onEndCallback = onEnd;

    if (this.currentUrl !== url) {
      this.audio.src = url;
      this.currentUrl = url;
    }

    this.audio.currentTime = 0;
    this.audio.play()
      .then(() => {
        this.isPlaying = true;
        this.playbackStartTime = performance.now();
        if (onStart) onStart(30);
        this.startProgressTracker();
      })
      .catch(err => {
        console.warn('Full preview playback failed:', err);
        this.stop();
      });
  }

  startProgressTracker() {
    const update = () => {
      if (!this.isPlaying) return;

      const elapsed = (performance.now() - this.playbackStartTime) / 1000;
      const progress = Math.min(1, elapsed / this.targetDuration);

      if (this.onProgressCallback) {
        this.onProgressCallback(progress, elapsed, this.targetDuration);
      }

      if (elapsed < this.targetDuration) {
        this.animationFrameId = requestAnimationFrame(update);
      }
    };
    this.animationFrameId = requestAnimationFrame(update);
  }

  // Stop playback cleanly
  stop() {
    if (this.timeoutId) {
      clearTimeout(this.timeoutId);
      this.timeoutId = null;
    }
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    const wasPlaying = this.isPlaying;
    this.isPlaying = false;
    this.audio.pause();
    this.audio.currentTime = 0;

    if (wasPlaying && this.onEndCallback) {
      const cb = this.onEndCallback;
      this.onEndCallback = null;
      cb();
    }
  }

  toggle(url, duration, onStart, onProgress, onEnd) {
    if (this.isPlaying) {
      this.stop();
    } else {
      this.playClip(url, duration, onStart, onProgress, onEnd);
    }
  }

  // Web Audio synth sound cues
  playSfx(type) {
    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;

      const now = ctx.currentTime;

      if (type === 'correct') {
        // Sparkling victory chord (C5 -> E5 -> G5 -> C6)
        const notes = [523.25, 659.25, 783.99, 1046.5];
        notes.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.08);

          gain.gain.setValueAtTime(0, now + idx * 0.08);
          gain.gain.linearRampToValueAtTime(0.18, now + idx * 0.08 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.4);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + idx * 0.08);
          osc.stop(now + idx * 0.08 + 0.45);
        });
      } else if (type === 'wrong') {
        // Low soft thud
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(140, now);
        osc.frequency.exponentialRampToValueAtTime(70, now + 0.25);

        gain.gain.setValueAtTime(0.2, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.25);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.26);
      } else if (type === 'skip') {
        // High crisp tap
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(440, now);
        osc.frequency.exponentialRampToValueAtTime(220, now + 0.1);

        gain.gain.setValueAtTime(0.15, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.1);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.11);
      }
    } catch (e) {
      // Audio context silenced or blocked
    }
  }
}

export const audioManager = new AudioManager();
