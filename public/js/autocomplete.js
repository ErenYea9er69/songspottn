// Autocomplete component for SongSpot
// Provides debounced, cached track search suggestions from Deezer API

export class Autocomplete {
  constructor({ inputEl, dropdownEl, onSelect }) {
    this.inputEl = inputEl;
    this.dropdownEl = dropdownEl;
    this.onSelect = onSelect;

    this.debounceTimer = null;
    this.results = [];
    this.selectedIndex = -1;
    this.cache = new Map();
    this.selectedTrack = null;

    this.init();
  }

  init() {
    this.inputEl.setAttribute('autocomplete', 'off');
    this.inputEl.setAttribute('role', 'combobox');
    this.inputEl.setAttribute('aria-autocomplete', 'list');
    this.inputEl.setAttribute('aria-expanded', 'false');

    this.inputEl.addEventListener('input', (e) => this.handleInput(e));
    this.inputEl.addEventListener('keydown', (e) => this.handleKeydown(e));
    this.inputEl.addEventListener('focus', () => {
      if (this.results.length > 0) {
        this.open();
      }
    });

    // Close when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.inputEl.contains(e.target) && !this.dropdownEl.contains(e.target)) {
        this.close();
      }
    });
  }

  handleInput(e) {
    const val = this.inputEl.value.trim();
    this.selectedTrack = null;

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }

    if (val.length < 1) {
      this.close();
      this.results = [];
      return;
    }

    // Check client cache first
    const cacheKey = val.toLowerCase();
    if (this.cache.has(cacheKey)) {
      this.renderResults(this.cache.get(cacheKey));
      return;
    }

    this.debounceTimer = setTimeout(() => {
      this.fetchSuggestions(val);
    }, 200);
  }

  async fetchSuggestions(query) {
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
      if (!res.ok) return;
      const data = await res.json();
      const results = data.results || [];

      this.cache.set(query.toLowerCase(), results);
      this.renderResults(results);
    } catch (err) {
      console.warn('Autocomplete fetch error:', err);
    }
  }

  renderResults(results) {
    this.results = results;
    this.selectedIndex = -1;
    this.dropdownEl.innerHTML = '';

    if (results.length === 0) {
      this.close();
      return;
    }

    const currentQuery = this.inputEl.value.trim().toLowerCase();

    results.forEach((track, index) => {
      const item = document.createElement('div');
      item.className = 'suggestion-item';
      item.id = `suggestion-opt-${index}`;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', 'false');

      // Cover thumbnail
      const img = document.createElement('img');
      img.className = 'suggestion-thumb';
      img.src = track.cover || 'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 24 24" fill="%2364748b"><path d="M12 3v10.55c-.59-.34-1.27-.55-2-.55-2.21 0-4 1.79-4 4s1.79 4 4 4 4-1.79 4-4V7h4V3h-6z"/></svg>';
      img.alt = track.title;
      img.loading = 'lazy';

      // Text container
      const textDiv = document.createElement('div');
      textDiv.className = 'suggestion-details';

      const titleSpan = document.createElement('span');
      titleSpan.className = 'suggestion-title';
      titleSpan.textContent = track.title;

      const artistSpan = document.createElement('span');
      artistSpan.className = 'suggestion-artist';
      artistSpan.textContent = track.artist;

      textDiv.appendChild(titleSpan);
      textDiv.appendChild(artistSpan);

      item.appendChild(img);
      item.appendChild(textDiv);

      item.addEventListener('click', () => {
        this.selectItem(track);
      });

      this.dropdownEl.appendChild(item);
    });

    this.open();
  }

  open() {
    this.dropdownEl.classList.add('is-open');
    this.inputEl.setAttribute('aria-expanded', 'true');
  }

  close() {
    this.dropdownEl.classList.remove('is-open');
    this.inputEl.setAttribute('aria-expanded', 'false');
    this.selectedIndex = -1;
  }

  handleKeydown(e) {
    if (!this.dropdownEl.classList.contains('is-open') || this.results.length === 0) {
      if (e.key === 'Enter') {
        // Submit what was typed if no dropdown is open
        if (this.onSelect) {
          this.onSelect(this.selectedTrack || { title: this.inputEl.value.trim() });
        }
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex + 1) % this.results.length;
      this.updateHighlight();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.selectedIndex = (this.selectedIndex - 1 + this.results.length) % this.results.length;
      this.updateHighlight();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (this.selectedIndex >= 0 && this.results[this.selectedIndex]) {
        this.selectItem(this.results[this.selectedIndex]);
      } else {
        this.selectItem(this.selectedTrack || { title: this.inputEl.value.trim() });
      }
    } else if (e.key === 'Escape') {
      this.close();
    }
  }

  updateHighlight() {
    const items = this.dropdownEl.querySelectorAll('.suggestion-item');
    items.forEach((item, index) => {
      if (index === this.selectedIndex) {
        item.classList.add('is-highlighted');
        item.setAttribute('aria-selected', 'true');
        item.scrollIntoView({ block: 'nearest' });
      } else {
        item.classList.remove('is-highlighted');
        item.setAttribute('aria-selected', 'false');
      }
    });
  }

  selectItem(track) {
    this.selectedTrack = track;
    this.inputEl.value = `${track.title} - ${track.artist || ''}`.trim();
    this.close();
    if (this.onSelect) {
      this.onSelect(track);
    }
  }

  clear() {
    this.inputEl.value = '';
    this.selectedTrack = null;
    this.results = [];
    this.close();
  }

  getSelectedTrack() {
    return this.selectedTrack;
  }
}
