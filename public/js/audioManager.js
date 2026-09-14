// Audio Manager for SongSpot
// Precision HTML5 playback, Web Audio synthesis, and dynamic spectrum hooks

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
    this.isMuted = false;

    // Web Audio Context & Node Graph
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

          const durationMs = this.targetDuration * 1000;
          this.timeoutId = setTimeout(() => {
            this.stop();
          }, durationMs);

          this.startProgressTracker();
        })
        .catch(err => {
          console.warn('Audio play failed:', err);
          this.stop();
        });
    }
  }

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
        console.warn('Full preview failed:', err);
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

  setMuted(muted) {
    this.isMuted = muted;
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    return this.isMuted;
  }

  // Tactile Web Audio sound effects
  playSfx(type) {
    if (this.isMuted) return;

    try {
      const ctx = this.getAudioContext();
      if (!ctx) return;
      const now = ctx.currentTime;

      if (type === 'correct') {
        // Shimmering harmonic victory arpeggio
        const chord = [523.25, 659.25, 783.99, 1046.50, 1318.51];
        chord.forEach((freq, i) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + i * 0.07);

          gain.gain.setValueAtTime(0, now + i * 0.07);
          gain.gain.linearRampToValueAtTime(0.16, now + i * 0.07 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.07 + 0.5);

          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + i * 0.07);
          osc.stop(now + i * 0.07 + 0.55);
        });
      } else if (type === 'wrong') {
        // Low analog wobble
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sawtooth';
        osc.frequency.setValueAtTime(120, now);
        osc.frequency.exponentialRampToValueAtTime(60, now + 0.28);

        gain.gain.setValueAtTime(0.18, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.29);
      } else if (type === 'skip') {
        // Mechanical switch click
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(800, now);
        osc.frequency.exponentialRampToValueAtTime(200, now + 0.08);

        gain.gain.setValueAtTime(0.12, now);
        gain.gain.exponentialRampToValueAtTime(0.001, now + 0.08);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(now);
        osc.stop(now + 0.09);
      } else if (type === 'needle') {
        // Vinyl needle touch / static burst
        const bufferSize = ctx.sampleRate * 0.05;
        const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) {
          data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (bufferSize * 0.2));
        }
        const noise = ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = ctx.createGain();
        gain.gain.setValueAtTime(0.08, now);
        noise.connect(gain);
        gain.connect(ctx.destination);
        noise.start(now);
      }
    } catch (e) {
      // Ignore audio context errors
    }
  }
}

export const audioManager = new AudioManager();
