// Main Game Engine for SongSpot
import { audioManager } from './audioManager.js';
import { Autocomplete } from './autocomplete.js';

class SongSpotGame {
  constructor() {
    this.gameId = null;
    this.currentGenre = 'chart-0';
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

    // DOM Elements
    this.genreSelectEl = document.getElementById('genre-select');
    this.newGameBtn = document.getElementById('new-game-btn');
    this.scoreValueEl = document.getElementById('score-value');
    this.roundIndicatorContainer = document.getElementById('round-indicators');
    this.timelineSegmentsEl = document.getElementById('timeline-segments');
    this.playBtn = document.getElementById('play-btn');
    this.playBtnLabel = document.getElementById('play-btn-label');
    this.playBtnIcon = document.getElementById('play-btn-icon');
    this.waveformEl = document.getElementById('waveform-anim');
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

  async init() {
    this.initAutocomplete();
    this.initEventListeners();
    await this.loadGenres();
    this.startNewGame();
  }

  initAutocomplete() {
    this.autocomplete = new Autocomplete({
      inputEl: this.searchInputEl,
      dropdownEl: this.dropdownEl,
      onSelect: (track) => {
        this.selectedTrack = track;
        this.submitGuessBtn.disabled = false;
        // If track is selected from dropdown, focus the submit button or submit directly
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

    // Genre selector change
    this.genreSelectEl.addEventListener('change', (e) => {
      this.currentGenre = e.target.value;
      this.startNewGame();
    });

    // Header new game button
    this.newGameBtn.addEventListener('click', () => {
      this.startNewGame();
    });

    // Round modal controls
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

    this.roundNextBtn.addEventListener('click', () => this.advanceNextRound());

    // Game Over modal play again
    this.playAgainBtn.addEventListener('click', () => {
      this.closeModal(this.gameOverModalEl);
      this.startNewGame();
    });

    // Spacebar to play/pause clip
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Space' && document.activeElement !== this.searchInputEl) {
        e.preventDefault();
        this.togglePlayback();
      }
    });
  }

  async loadGenres() {
    try {
      const res = await fetch('/api/genres');
      if (!res.ok) return;
      const data = await res.json();
      const genres = data.genres || [];

      this.genreSelectEl.innerHTML = '';
      genres.forEach(g => {
        const opt = document.createElement('option');
        opt.value = g.id;
        opt.textContent = g.name;
        this.genreSelectEl.appendChild(opt);
      });

      this.genreSelectEl.value = this.currentGenre;
    } catch (err) {
      console.warn('Failed to load genres:', err);
    }
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
      alert('Could not start game. Please check connection and try again.');
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
        <rect x="6" y="4" width="4" height="16" fill="currentColor"/>
        <rect x="14" y="4" width="4" height="16" fill="currentColor"/>
      `;
      this.playBtnLabel.textContent = `Playing (${this.clipDuration}s)`;
      this.waveformEl.classList.add('is-active');
    } else {
      this.playBtn.classList.remove('is-playing');
      this.playBtnIcon.innerHTML = `
        <polygon points="5 3 19 12 5 21 5 3" fill="currentColor"/>
      `;
      this.playBtnLabel.textContent = `Play (${this.clipDuration}s)`;
      this.waveformEl.classList.remove('is-active');
      this.resetTimelineProgress();
    }
  }

  updatePlaybackProgress(progress) {
    const activeSeg = this.timelineSegmentsEl.querySelector(`.segment[data-index="${this.attemptIndex}"]`);
    if (activeSeg) {
      const fillEl = activeSeg.querySelector('.segment-fill');
      if (fillEl) {
        fillEl.style.width = `${progress * 100}%`;
      }
    }
  }

  resetTimelineProgress() {
    const fills = this.timelineSegmentsEl.querySelectorAll('.segment-fill');
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
          // Out of attempts
          this.totalScore = data.totalScore;
          this.roundScores[this.roundIndex] = 0;
          this.roundWon[this.roundIndex] = false;

          this.updateScoreDisplay();
          this.renderRoundIndicators();
          this.showRoundReveal(false, 0, data.track);
        } else {
          // Advance to next duration
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
        text: 'Skipped attempt',
        status: 'skipped',
        duration: `${this.clipDuration}s`
      });
      this.renderGuesses();

      if (data.roundOver) {
        // Round exhausted
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
    this.roundResultTitle.className = isWon ? 'result-won' : 'result-lost';

    this.roundScoreBadge.textContent = isWon ? `+${scoreEarned} PTS` : '+0 PTS';
    this.roundScoreBadge.className = isWon ? 'score-won' : 'score-lost';

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

    // Dynamic Rank Badges
    let rank = 'Radio Rookie';
    let rankClass = 'rank-bronze';
    if (data.totalScore >= 4500) {
      rank = 'Audiophile Maestro 🏆';
      rankClass = 'rank-gold';
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
    this.finalRankBadgeEl.className = `rank-badge ${rankClass}`;

    // Recap list
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
      const seg = document.createElement('div');
      seg.className = 'segment';
      seg.dataset.index = index;

      if (index < this.attemptIndex) {
        seg.classList.add('is-spent');
      } else if (index === this.attemptIndex) {
        seg.classList.add('is-active');
      } else {
        seg.classList.add('is-locked');
      }

      seg.innerHTML = `
        <div class="segment-fill"></div>
        <span class="segment-label">${duration}s</span>
      `;

      this.timelineSegmentsEl.appendChild(seg);
    });
  }

  renderRoundIndicators() {
    this.roundIndicatorContainer.innerHTML = '';

    for (let i = 0; i < this.totalRounds; i++) {
      const pill = document.createElement('div');
      pill.className = 'round-pill';

      if (i < this.roundIndex) {
        pill.classList.add(this.roundWon[i] ? 'is-won' : 'is-lost');
        pill.textContent = this.roundWon[i] ? `R${i + 1} ✓` : `R${i + 1} ✕`;
      } else if (i === this.roundIndex) {
        pill.classList.add('is-current');
        pill.textContent = `Round ${i + 1}`;
      } else {
        pill.classList.add('is-upcoming');
        pill.textContent = `R${i + 1}`;
      }

      this.roundIndicatorContainer.appendChild(pill);
    }
  }

  renderGuesses() {
    this.guessHistoryEl.innerHTML = '';
    if (this.guesses.length === 0) {
      this.guessHistoryEl.classList.add('is-empty');
      this.guessHistoryEl.innerHTML = `
        <div class="guess-placeholder">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2a10 10 0 1 0 10 10A10 10 0 0 0 12 2zm0 18a8 8 0 1 1 8-8 8 8 0 0 1-8 8z"/><path d="M12 6v6l4 2"/></svg>
          Listen to the clip and type your guess below
        </div>
      `;
      return;
    }

    this.guessHistoryEl.classList.remove('is-empty');
    this.guesses.forEach((g, idx) => {
      const row = document.createElement('div');
      row.className = `guess-row is-${g.status}`;

      let icon = '✕';
      if (g.status === 'correct') icon = '✓';
      if (g.status === 'skipped') icon = '↷';

      row.innerHTML = `
        <span class="guess-badge">${icon}</span>
        <span class="guess-text">${g.text}</span>
        <span class="guess-duration">${g.duration}</span>
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

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  new SongSpotGame();
});
