// Main Game Engine for SongSpot — 2026 Edition
import { audioManager } from './audioManager.js';
import { Autocomplete } from './autocomplete.js';
import { Confetti } from './confetti.js';

class SongSpotGame {
  constructor() {
    this.gameId = null;
    this.currentGenre = 'rap-all';
    this.roundIndex = 0;
    this.totalRounds = 5;
    this.attemptIndex = 0;
    this.clipLengths = [0.1, 0.5, 2.0, 8.0, 15.0];
    this.clipDuration = 0.1;
    this.previewUrl = null;
    this.totalScore = 0;
    this.roundScores = [0, 0, 0, 0, 0];
    this.roundWon = [false, false, false, false, false];
    this.guesses = [];
    this.selectedTrack = null;

    // Spectrum Animation
    this.spectrumIntervalId = null;

    // DOM Elements
    this.confettiCanvas = document.getElementById('confetti-canvas');
    this.confetti = new Confetti(this.confettiCanvas);

    this.genrePillsContainer = document.getElementById('genre-pills');
    this.newGameBtn = document.getElementById('new-game-btn');
    this.sfxToggleBtn = document.getElementById('sfx-toggle-btn');
    this.sfxIconOn = document.getElementById('sfx-icon-on');
    this.sfxIconOff = document.getElementById('sfx-icon-off');

    this.scoreValueEl = document.getElementById('score-value');
    this.roundIndicatorContainer = document.getElementById('round-indicators');
    this.timelineSegmentsEl = document.getElementById('timeline-segments');

    this.turntableVinyl = document.getElementById('turntable-vinyl');
    this.turntableTonearm = document.getElementById('turntable-tonearm');
    this.spectrumBars = document.querySelectorAll('.spectrum-bar .bar-level');

    this.playBtn = document.getElementById('play-btn');
    this.playBtnLabel = document.getElementById('play-btn-label');
    this.playBtnIcon = document.getElementById('play-btn-icon');

    this.searchInputEl = document.getElementById('search-input');
    this.dropdownEl = document.getElementById('autocomplete-dropdown');
    this.submitGuessBtn = document.getElementById('submit-guess-btn');
    this.skipBtn = document.getElementById('skip-btn');
    this.skipBtnLabel = document.getElementById('skip-btn-label');
    this.guessHistoryEl = document.getElementById('guess-history');

    // Modals
    this.roundModalEl = document.getElementById('round-modal');
    this.roundResultTitle = document.getElementById('round-result-title');
    this.roundScoreBadge = document.getElementById('round-score-badge');
    this.roundCoverImg = document.getElementById('round-cover-img');
    this.roundTrackTitle = document.getElementById('round-track-title');
    this.roundArtistName = document.getElementById('round-artist-name');
    this.roundPlayFullBtn = document.getElementById('round-play-full-btn');
    this.roundNextBtn = document.getElementById('round-next-btn');

    this.gameOverModalEl = document.getElementById('game-over-modal');
    this.finalScoreEl = document.getElementById('final-score');
    this.finalRankBadgeEl = document.getElementById('final-rank-badge');
    this.finalRecapListEl = document.getElementById('final-recap-list');
    this.playAgainBtn = document.getElementById('play-again-btn');

    this.init();
  }

  init() {
    this.initAutocomplete();
    this.initEventListeners();
    this.startNewGame();
  }

  initAutocomplete() {
    this.autocomplete = new Autocomplete({
      inputEl: this.searchInputEl,
      dropdownEl: this.dropdownEl,
      onSelect: (track) => {
        this.selectedTrack = track;
        this.submitGuessBtn.disabled = false;
        this.submitGuess();
      }
    });
  }

  initEventListeners() {
    // Play button
    this.playBtn.addEventListener('click', () => this.togglePlayback());

    // Skip button
    this.skipBtn.addEventListener('click', () => this.skipClip());

    // Submit Guess button
    this.submitGuessBtn.addEventListener('click', () => this.submitGuess());

    // Input changes
    this.searchInputEl.addEventListener('input', (e) => {
      this.selectedTrack = null;
      this.submitGuessBtn.disabled = e.target.value.trim().length === 0;
    });

    // Sound FX Toggle
    this.sfxToggleBtn.addEventListener('click', () => {
      const isMuted = audioManager.toggleMute();
      this.sfxIconOn.style.display = isMuted ? 'none' : 'block';
      this.sfxIconOff.style.display = isMuted ? 'block' : 'none';
      if (!isMuted) audioManager.playSfx('skip');
    });

    // Header restart button
    this.newGameBtn.addEventListener('click', () => {
      audioManager.playSfx('skip');
      this.startNewGame();
    });

    // Genre pill shelf click events
    this.genrePillsContainer.addEventListener('click', (e) => {
      const pill = e.target.closest('.genre-pill');
      if (!pill) return;
      const genre = pill.dataset.genre;
      if (genre === this.currentGenre) return;

      this.genrePillsContainer.querySelectorAll('.genre-pill').forEach(p => p.classList.remove('is-active'));
      pill.classList.add('is-active');
      this.currentGenre = genre;
      audioManager.playSfx('skip');
      this.startNewGame();
    });

    // Round modal full preview button
    this.roundPlayFullBtn.addEventListener('click', () => {
      if (audioManager.isPlaying) {
        audioManager.stop();
        this.roundPlayFullBtn.innerHTML = `
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          Listen to Full Preview (30s)
        `;
      } else {
        audioManager.playFull(
          this.previewUrl,
          () => {
            this.roundPlayFullBtn.innerHTML = `
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>
              Stop Preview
            `;
          },
          null,
          () => {
            this.roundPlayFullBtn.innerHTML = `
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
              Listen to Full Preview (30s)
            `;
          }
        );
      }
    });

    // Round modal advance button
    this.roundNextBtn.addEventListener('click', () => this.advanceNextRound());

    // Game Over modal play again
    this.playAgainBtn.addEventListener('click', () => {
      this.closeModal(this.gameOverModalEl);
      this.startNewGame();
    });

    // Keyboard shortcut: Spacebar to play/pause clip
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement !== this.searchInputEl) {
        e.preventDefault();
        this.togglePlayback();
      }
    });
  }

  async startNewGame() {
    audioManager.stop();
    this.closeModal(this.roundModalEl);
    this.closeModal(this.gameOverModalEl);

    this.setControlsLoading(true);
    this.guesses = [];
    this.renderGuesses();
    this.autocomplete.clear();

    try {
      const res = await fetch('/api/game/new', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ genreId: this.currentGenre })
      });

      if (!res.ok) throw new Error('Failed to create new game session');
      const data = await res.json();

      this.gameId = data.gameId;
      this.roundIndex = data.roundIndex;
      this.totalRounds = data.totalRounds;
      this.attemptIndex = data.currentAttemptIndex;
      this.clipLengths = data.clipLengths || [0.1, 0.5, 2.0, 8.0, 15.0];
      this.clipDuration = data.clipDuration;
      this.previewUrl = data.previewUrl;
      this.totalScore = data.totalScore || 0;
      this.roundScores = [0, 0, 0, 0, 0];
      this.roundWon = [false, false, false, false, false];

      this.updateScoreDisplay();
      this.renderRoundIndicators();
      this.renderTimeline();
      this.updateControls();
    } catch (err) {
      console.error('New game error:', err);
    } finally {
      this.setControlsLoading(false);
    }
  }

  togglePlayback() {
    if (audioManager.isPlaying) {
      audioManager.stop();
      this.setPlayingUI(false);
    } else {
      if (!this.previewUrl) return;

      audioManager.playSfx('needle');
      audioManager.playClip(
        this.previewUrl,
        this.clipDuration,
        () => this.setPlayingUI(true),
        (progress) => this.updatePlaybackProgress(progress),
        () => this.setPlayingUI(false)
      );
    }
  }

  setPlayingUI(isPlaying) {
    if (isPlaying) {
      this.playBtn.classList.add('is-playing');
      this.playBtnIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
          <rect x="6" y="4" width="4" height="16"/>
          <rect x="14" y="4" width="4" height="16"/>
        </svg>
      `;
      this.playBtnLabel.textContent = `Playing (${this.clipDuration}s)`;

      // Animate Turntable
      this.turntableVinyl.classList.add('is-spinning');
      this.turntableTonearm.classList.add('is-docked');

      // Animate Spectrum
      this.startSpectrumAnimation();
    } else {
      this.playBtn.classList.remove('is-playing');
      this.playBtnIcon.innerHTML = `
        <svg viewBox="0 0 24 24" width="34" height="34" fill="currentColor">
          <polygon points="6 3 20 12 6 21 6 3"/>
        </svg>
      `;
      this.playBtnLabel.textContent = `Play (${this.clipDuration}s)`;

      // Stop Turntable
      this.turntableVinyl.classList.remove('is-spinning');
      this.turntableTonearm.classList.remove('is-docked');

      // Reset Spectrum
      this.stopSpectrumAnimation();
      this.resetTimelineProgress();
    }
  }

  startSpectrumAnimation() {
    this.stopSpectrumAnimation();
    this.spectrumIntervalId = setInterval(() => {
      this.spectrumBars.forEach((bar) => {
        const height = Math.floor(Math.random() * 85) + 12;
        bar.style.height = `${height}%`;
      });
    }, 80);
  }

  stopSpectrumAnimation() {
    if (this.spectrumIntervalId) {
      clearInterval(this.spectrumIntervalId);
      this.spectrumIntervalId = null;
    }
    this.spectrumBars.forEach((bar) => {
      bar.style.height = '8%';
    });
  }

  updatePlaybackProgress(progress) {
    const activeSeg = this.timelineSegmentsEl.querySelector(`.channel-cell[data-index="${this.attemptIndex}"]`);
    if (activeSeg) {
      const fillEl = activeSeg.querySelector('.channel-fill');
      if (fillEl) {
        fillEl.style.width = `${progress * 100}%`;
      }
    }
  }

  resetTimelineProgress() {
    const fills = this.timelineSegmentsEl.querySelectorAll('.channel-fill');
    fills.forEach(f => f.style.width = '0%');
  }

  async submitGuess() {
    const text = this.searchInputEl.value.trim();
    if (!text && !this.selectedTrack) return;

    audioManager.stop();
    this.submitGuessBtn.disabled = true;

    try {
      const payload = {
        gameId: this.gameId,
        trackId: this.selectedTrack ? this.selectedTrack.id : null,
        guessTitle: text
      };

      const res = await fetch('/api/game/guess', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!res.ok) throw new Error('Guess failed');
      const data = await res.json();

      if (data.correct) {
        audioManager.playSfx('correct');
        this.confetti.burst();

        this.guesses.push({
          text: `${data.track.title} - ${data.track.artist}`,
          status: 'correct',
          duration: `${this.clipDuration}s`
        });
        this.renderGuesses();

        this.totalScore = data.totalScore;
        this.roundScores[this.roundIndex] = data.scoreEarned;
        this.roundWon[this.roundIndex] = true;

        this.updateScoreDisplay();
        this.renderRoundIndicators();
        this.showRoundReveal(true, data.scoreEarned, data.track);
      } else {
        audioManager.playSfx('wrong');
        this.guesses.push({
          text: text,
          status: 'wrong',
          duration: `${this.clipDuration}s`
        });
        this.renderGuesses();
        this.autocomplete.clear();

        if (data.roundOver) {
          this.totalScore = data.totalScore;
          this.roundScores[this.roundIndex] = 0;
          this.roundWon[this.roundIndex] = false;

          this.updateScoreDisplay();
          this.renderRoundIndicators();
          this.showRoundReveal(false, 0, data.track);
        } else {
          this.attemptIndex = data.nextAttemptIndex;
          this.clipDuration = data.nextDuration;
          this.renderTimeline();
          this.updateControls();
        }
      }
    } catch (err) {
      console.error('Submit guess error:', err);
    } finally {
      this.submitGuessBtn.disabled = false;
    }
  }

  async skipClip() {
    audioManager.stop();
    audioManager.playSfx('skip');
    this.skipBtn.disabled = true;

    try {
      const res = await fetch('/api/game/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: this.gameId })
      });

      if (!res.ok) throw new Error('Skip failed');
      const data = await res.json();

      this.guesses.push({
        text: 'Skipped snippet',
        status: 'skipped',
        duration: `${this.clipDuration}s`
      });
      this.renderGuesses();

      if (data.roundOver) {
        this.totalScore = data.totalScore;
        this.roundScores[this.roundIndex] = 0;
        this.roundWon[this.roundIndex] = false;

        this.updateScoreDisplay();
        this.renderRoundIndicators();
        this.showRoundReveal(false, 0, data.track);
      } else {
        this.attemptIndex = data.nextAttemptIndex;
        this.clipDuration = data.nextDuration;
        this.renderTimeline();
        this.updateControls();
      }
    } catch (err) {
      console.error('Skip error:', err);
    } finally {
      this.skipBtn.disabled = false;
    }
  }

  showRoundReveal(isWon, scoreEarned, track) {
    this.roundResultTitle.textContent = isWon ? 'SPOT ON!' : 'MISSED TRACK';
    this.roundResultTitle.className = isWon ? 'status-won' : 'status-lost';

    this.roundScoreBadge.textContent = isWon ? `+${scoreEarned} PTS` : '+0 PTS';
    this.roundScoreBadge.className = isWon ? 'score-pill score-won' : 'score-pill score-lost';

    this.roundCoverImg.src = track.cover || '';
    this.roundTrackTitle.textContent = track.title;
    this.roundArtistName.textContent = track.artist;

    this.roundNextBtn.textContent = this.roundIndex === 4 ? 'View Final Results →' : 'Next Round →';

    this.openModal(this.roundModalEl);
  }

  async advanceNextRound() {
    audioManager.stop();
    this.closeModal(this.roundModalEl);
    this.setControlsLoading(true);

    try {
      const res = await fetch('/api/game/next-round', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ gameId: this.gameId })
      });

      if (!res.ok) throw new Error('Next round failed');
      const data = await res.json();

      if (data.gameOver) {
        this.showGameOver(data);
      } else {
        this.roundIndex = data.roundIndex;
        this.attemptIndex = 0;
        this.clipDuration = data.clipDuration;
        this.clipLengths = data.clipLengths;
        this.previewUrl = data.previewUrl;
        this.guesses = [];
        this.autocomplete.clear();
        this.renderGuesses();
        this.renderRoundIndicators();
        this.renderTimeline();
        this.updateControls();
      }
    } catch (err) {
      console.error('Advance round error:', err);
    } finally {
      this.setControlsLoading(false);
    }
  }

  showGameOver(data) {
    this.finalScoreEl.textContent = `${data.totalScore} / 5000`;

    let rank = 'Radio Rookie';
    let rankClass = 'rank-bronze';
    if (data.totalScore >= 4500) {
      rank = 'Audiophile Maestro 🏆';
      rankClass = 'rank-gold';
      this.confetti.burst();
    } else if (data.totalScore >= 3500) {
      rank = 'Vinyl Virtuoso ⭐';
      rankClass = 'rank-gold';
    } else if (data.totalScore >= 2500) {
      rank = 'Track Spotter 🎵';
      rankClass = 'rank-silver';
    } else if (data.totalScore >= 1000) {
      rank = 'Casual Listener 🎧';
      rankClass = 'rank-bronze';
    }

    this.finalRankBadgeEl.textContent = rank;
    this.finalRankBadgeEl.className = `rank-trophy-badge ${rankClass}`;

    this.finalRecapListEl.innerHTML = '';
    data.tracks.forEach((track, idx) => {
      const item = document.createElement('div');
      item.className = 'recap-item';

      const won = data.roundWon[idx];
      const score = data.roundScores[idx];
      const attempts = data.roundAttemptsUsed[idx];

      item.innerHTML = `
        <div class="recap-round-num">R${idx + 1}</div>
        <img class="recap-thumb" src="${track.cover}" alt="${track.title}"/>
        <div class="recap-details">
          <span class="recap-title">${track.title}</span>
          <span class="recap-artist">${track.artist}</span>
        </div>
        <div class="recap-score ${won ? 'is-won' : 'is-lost'}">
          ${won ? `+${score} pts (${attempts} tries)` : 'Missed (0 pts)'}
        </div>
      `;
      this.finalRecapListEl.appendChild(item);
    });

    this.openModal(this.gameOverModalEl);
  }

  renderTimeline() {
    this.timelineSegmentsEl.innerHTML = '';

    this.clipLengths.forEach((duration, index) => {
      const cell = document.createElement('div');
      cell.className = 'channel-cell';
      cell.dataset.index = index;

      if (index < this.attemptIndex) {
        cell.classList.add('is-spent');
      } else if (index === this.attemptIndex) {
        cell.classList.add('is-active');
      } else {
        cell.classList.add('is-locked');
      }

      cell.innerHTML = `
        <div class="channel-fill"></div>
        <span class="channel-tag">${duration}s</span>
      `;

      this.timelineSegmentsEl.appendChild(cell);
    });
  }

  renderRoundIndicators() {
    this.roundIndicatorContainer.innerHTML = '';

    for (let i = 0; i < this.totalRounds; i++) {
      const cell = document.createElement('div');
      cell.className = 'round-cell';

      if (i < this.roundIndex) {
        cell.classList.add(this.roundWon[i] ? 'is-won' : 'is-lost');
        cell.textContent = this.roundWon[i] ? '✓' : '✕';
      } else if (i === this.roundIndex) {
        cell.classList.add('is-current');
        cell.textContent = `${i + 1}`;
      } else {
        cell.classList.add('is-upcoming');
        cell.textContent = `${i + 1}`;
      }

      this.roundIndicatorContainer.appendChild(cell);
    }
  }

  renderGuesses() {
    this.guessHistoryEl.innerHTML = '';
    if (this.guesses.length === 0) {
      this.guessHistoryEl.innerHTML = `
        <div class="feed-empty-hint">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/>
            <polyline points="12 6 12 12 16 14"/>
          </svg>
          <span>Play the clip and search for the track name</span>
        </div>
      `;
      return;
    }

    this.guesses.forEach((g) => {
      const row = document.createElement('div');
      row.className = `feed-entry is-${g.status}`;

      let icon = '✕';
      if (g.status === 'correct') icon = '✓';
      if (g.status === 'skipped') icon = '↷';

      row.innerHTML = `
        <span class="feed-badge">${icon}</span>
        <span class="feed-text">${g.text}</span>
        <span class="feed-duration">${g.duration}</span>
      `;
      this.guessHistoryEl.appendChild(row);
    });
  }

  updateControls() {
    this.playBtnLabel.textContent = `Play (${this.clipDuration}s)`;

    if (this.attemptIndex < this.clipLengths.length - 1) {
      const nextDuration = this.clipLengths[this.attemptIndex + 1];
      this.skipBtnLabel.textContent = `Skip (+${(nextDuration - this.clipDuration).toFixed(1)}s to ${nextDuration}s)`;
    } else {
      this.skipBtnLabel.textContent = 'Give Up / Reveal';
    }
  }

  updateScoreDisplay() {
    this.scoreValueEl.textContent = this.totalScore.toLocaleString();
  }

  setControlsLoading(loading) {
    this.playBtn.disabled = loading;
    this.skipBtn.disabled = loading;
    this.searchInputEl.disabled = loading;
    this.submitGuessBtn.disabled = loading;
  }

  openModal(modalEl) {
    modalEl.classList.add('is-visible');
  }

  closeModal(modalEl) {
    modalEl.classList.remove('is-visible');
  }
}

document.addEventListener('DOMContentLoaded', () => {
  new SongSpotGame();
});
