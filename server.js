import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

// Security Middleware with CSP for Deezer CDNs
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      mediaSrc: ["'self'", "https://*.dzcdn.net", "https://cdnt-preview.dzcdn.net", "https://*.deezer.com", "blob:", "data:"],
      imgSrc: ["'self'", "https://*.dzcdn.net", "https://cdn-images.dzcdn.net", "https://*.deezer.com", "data:"],
      connectSrc: ["'self'", "https://api.deezer.com"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
      scriptSrc: ["'self'"],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: []
    }
  },
  crossOriginEmbedderPolicy: false
}));

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiter on API calls
const apiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', apiLimiter);

// In-Memory Caches (Storing ONLY metadata: IDs, titles, artists, cover URLs - NO audio files stored)
const metadataCache = new Map();
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes

function getCached(key) {
  const cached = metadataCache.get(key);
  if (!cached) return null;
  if (Date.now() - cached.timestamp > CACHE_TTL_MS) {
    metadataCache.delete(key);
    return null;
  }
  return cached.data;
}

function setCached(key, data) {
  if (metadataCache.size > 2000) {
    const oldestKey = metadataCache.keys().next().value;
    metadataCache.delete(oldestKey);
  }
  metadataCache.set(key, { timestamp: Date.now(), data });
}

// ================= TUNISIAN MUSIC CATALOG DEFINITIONS =================
const TUNISIAN_GENRES = [
  {
    id: 'rap-all',
    name: 'Rap Tunisien (Top Hits)',
    icon: '🎤',
    playlists: ['10241820882', '13708724361', '14321559721'],
    artists: ['Balti', 'Sanfara', 'Samara', 'JenJoon', 'Nordo', 'Kaso', 'A.L.A', 'Kafon', 'Klay BBj']
  },
  {
    id: 'rap-drill',
    name: 'Samara, Sanfara & Kaso',
    icon: '⚡',
    playlists: ['13708724361', '10241820882'],
    artists: ['Samara', 'Sanfara', 'Kaso', 'JenJoon']
  },
  {
    id: 'rap-legends',
    name: 'Balti, Kafon & Klay',
    icon: '👑',
    playlists: ['10241820882'],
    artists: ['Balti', 'Kafon', 'Klay BBj', 'A.L.A']
  },
  {
    id: 'mezwed-tounsi',
    name: 'Mezwed & Rboukh',
    icon: '🪘',
    playlists: ['10478191822', '12900886523'],
    artists: ['Fatma Bousseha', 'Nour Chiba', 'Zaza Show', 'Rubokh Tunisi', 'DJ Nabil']
  },
  {
    id: 'classics-tounsi',
    name: 'Classiques & Tarab',
    icon: '📻',
    playlists: ['12900886523'],
    artists: ['Lotfi Bouchnak', 'Saber Rebai', 'Hedi Jouini', 'Ali Riahi', 'Fatma Bou Saha']
  },
  {
    id: 'random-tounsi',
    name: '100% Tounsi Mix',
    icon: '🎲',
    playlists: ['10241820882', '13708724361', '12900886523', '10478191822'],
    artists: ['Balti', 'Samara', 'Sanfara', 'JenJoon', 'Nordo', 'Kaso', 'A.L.A', 'Kafon', 'Saber Rebai', 'Lotfi Bouchnak', 'Nour Chiba']
  }
];

// Active Game Sessions
const gameSessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

setInterval(() => {
  const now = Date.now();
  for (const [id, session] of gameSessions.entries()) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      gameSessions.delete(id);
    }
  }
}, 5 * 60 * 1000);

const CLIP_LENGTHS = [0.1, 0.5, 2.0, 8.0, 15.0];
const ATTEMPT_SCORES = [1000, 800, 600, 400, 200];

// Fetch and aggregate genuine Tunisian tracks
async function fetchTunisianTracks(categoryObj) {
  const cacheKey = `tn_tracks:${categoryObj.id}`;
  const cached = getCached(cacheKey);
  if (cached && cached.length >= 10) return cached;

  const trackMap = new Map();

  // 1. Fetch from curated Tunisian playlists
  for (const plId of categoryObj.playlists) {
    try {
      const res = await fetch(`https://api.deezer.com/playlist/${plId}/tracks?limit=40`);
      if (res.ok) {
        const json = await res.json();
        for (const t of (json.data || [])) {
          if (t.id && t.preview && t.title && t.artist && t.artist.name) {
            trackMap.set(t.id, {
              id: t.id,
              title: t.title_short || t.title,
              fullTitle: t.title,
              artist: t.artist.name,
              cover: t.album?.cover_medium || t.album?.cover_big || t.artist?.picture_medium || '',
              preview: t.preview
            });
          }
        }
      }
    } catch (e) {
      console.warn(`Error fetching playlist ${plId}:`, e.message);
    }
  }

  // 2. Fetch from specific top Tunisian artists
  for (const artist of categoryObj.artists) {
    try {
      const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(artist)}&limit=15`);
      if (res.ok) {
        const json = await res.json();
        for (const t of (json.data || [])) {
          // Check if track artist or title matches artist name
          const artistMatch = t.artist?.name?.toLowerCase().includes(artist.toLowerCase());
          const titleMatch = t.title?.toLowerCase().includes(artist.toLowerCase());
          if ((artistMatch || titleMatch) && t.preview && t.title && t.artist) {
            trackMap.set(t.id, {
              id: t.id,
              title: t.title_short || t.title,
              fullTitle: t.title,
              artist: t.artist.name,
              cover: t.album?.cover_medium || t.album?.cover_big || t.artist?.picture_medium || '',
              preview: t.preview
            });
          }
        }
      }
    } catch (e) {
      console.warn(`Error fetching artist ${artist}:`, e.message);
    }
  }

  const tracks = Array.from(trackMap.values());
  if (tracks.length >= 5) {
    setCached(cacheKey, tracks);
    return tracks;
  }

  // Fallback to general rap-all if too few tracks
  if (categoryObj.id !== 'rap-all') {
    return fetchTunisianTracks(TUNISIAN_GENRES[0]);
  }

  return tracks;
}

// Title normalization for Arabizi and French/English titles
function normalizeTrackTitle(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\(.*?\)/g, '') // remove parenthesized info
    .replace(/\[.*?\]/g, '')
    .replace(/-.*$/g, '')
    .replace(/[^a-z0-9]/g, '') // keep alphanumeric (handles Arabizi like 7oumani, 3arbouch)
    .trim();
}

// ================= API ROUTES =================

// GET /api/genres (Tunisian Music Categories)
app.get('/api/genres', (req, res) => {
  res.json({
    genres: TUNISIAN_GENRES.map(g => ({
      id: g.id,
      name: g.name,
      icon: g.icon
    }))
  });
});

// GET /api/search?q=... (Autocomplete)
app.get('/api/search', async (req, res) => {
  const query = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 80) : '';
  if (!query || query.length < 1) {
    return res.json({ results: [] });
  }

  const cacheKey = `search:${query.toLowerCase()}`;
  const cached = getCached(cacheKey);
  if (cached) {
    return res.json({ results: cached });
  }

  try {
    const deezerUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=12`;
    const response = await fetch(deezerUrl);
    if (!response.ok) throw new Error(`Deezer API error: ${response.status}`);
    const data = await response.json();

    const results = (data.data || [])
      .filter(t => t.id && t.title && t.artist)
      .map(t => ({
        id: t.id,
        title: t.title_short || t.title,
        artist: t.artist.name,
        cover: t.album?.cover_small || t.album?.cover_medium || ''
      }));

    setCached(cacheKey, results);
    res.json({ results });
  } catch (err) {
    console.error('Search error:', err);
    res.status(500).json({ error: 'Failed to search songs' });
  }
});

// POST /api/game/new (Start a new 5-round Tunisian game)
app.post('/api/game/new', async (req, res) => {
  const { genreId } = req.body;
  const selectedGenre = TUNISIAN_GENRES.find(g => g.id === genreId) || TUNISIAN_GENRES[0];

  const pool = await fetchTunisianTracks(selectedGenre);
  if (!pool || pool.length < 5) {
    return res.status(500).json({ error: 'Could not fetch enough Tunisian tracks.' });
  }

  // Shuffle and pick 5 unique tracks
  const shuffled = [...pool].sort(() => 0.5 - Math.random());
  const selectedTracks = shuffled.slice(0, 5);

  const gameId = crypto.randomUUID();
  const session = {
    gameId,
    genre: selectedGenre.name,
    createdAt: Date.now(),
    rounds: selectedTracks,
    currentRoundIndex: 0,
    currentAttemptIndex: 0,
    roundScores: [0, 0, 0, 0, 0],
    roundAttemptsUsed: [0, 0, 0, 0, 0],
    roundWon: [false, false, false, false, false],
    guessesThisRound: [],
    completed: false
  };

  gameSessions.set(gameId, session);

  const currentTrack = selectedTracks[0];
  res.json({
    gameId,
    genre: selectedGenre.name,
    roundIndex: 0,
    totalRounds: 5,
    currentAttemptIndex: 0,
    clipDuration: CLIP_LENGTHS[0],
    clipLengths: CLIP_LENGTHS,
    previewUrl: currentTrack.preview,
    totalScore: 0
  });
});

// POST /api/game/guess (Submit a guess for active round)
app.post('/api/game/guess', (req, res) => {
  const { gameId, trackId, guessTitle } = req.body;
  if (!gameId || (!trackId && !guessTitle)) {
    return res.status(400).json({ error: 'Invalid guess parameters' });
  }

  const session = gameSessions.get(gameId);
  if (!session || session.completed) {
    return res.status(404).json({ error: 'Game session not found.' });
  }

  const currentTrack = session.rounds[session.currentRoundIndex];
  const attemptIndex = session.currentAttemptIndex;

  let isCorrect = false;
  if (trackId && String(trackId) === String(currentTrack.id)) {
    isCorrect = true;
  } else if (guessTitle) {
    const normGuess = normalizeTrackTitle(guessTitle);
    const normSecretShort = normalizeTrackTitle(currentTrack.title);
    const normSecretFull = normalizeTrackTitle(currentTrack.fullTitle);
    if (normGuess && (normGuess === normSecretShort || normGuess === normSecretFull)) {
      isCorrect = true;
    }
  }

  session.guessesThisRound.push({
    text: guessTitle || String(trackId),
    correct: isCorrect,
    attempt: attemptIndex + 1
  });

  if (isCorrect) {
    const score = ATTEMPT_SCORES[attemptIndex] || 0;
    session.roundScores[session.currentRoundIndex] = score;
    session.roundAttemptsUsed[session.currentRoundIndex] = attemptIndex + 1;
    session.roundWon[session.currentRoundIndex] = true;

    const totalScore = session.roundScores.reduce((a, b) => a + b, 0);

    return res.json({
      correct: true,
      roundOver: true,
      scoreEarned: score,
      totalScore,
      attemptUsed: attemptIndex + 1,
      track: {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        cover: currentTrack.cover,
        preview: currentTrack.preview
      }
    });
  }

  // Wrong guess
  const nextAttempt = attemptIndex + 1;
  session.currentAttemptIndex = nextAttempt;

  if (nextAttempt >= CLIP_LENGTHS.length) {
    // All 5 attempts exhausted
    session.roundScores[session.currentRoundIndex] = 0;
    session.roundAttemptsUsed[session.currentRoundIndex] = 5;
    session.roundWon[session.currentRoundIndex] = false;

    const totalScore = session.roundScores.reduce((a, b) => a + b, 0);

    return res.json({
      correct: false,
      roundOver: true,
      scoreEarned: 0,
      totalScore,
      attemptUsed: 5,
      track: {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        cover: currentTrack.cover,
        preview: currentTrack.preview
      }
    });
  }

  res.json({
    correct: false,
    roundOver: false,
    nextAttemptIndex: nextAttempt,
    nextDuration: CLIP_LENGTHS[nextAttempt]
  });
});

// POST /api/game/skip
app.post('/api/game/skip', (req, res) => {
  const { gameId } = req.body;
  if (!gameId) return res.status(400).json({ error: 'Missing gameId' });

  const session = gameSessions.get(gameId);
  if (!session || session.completed) {
    return res.status(404).json({ error: 'Game session not found.' });
  }

  const currentTrack = session.rounds[session.currentRoundIndex];
  const attemptIndex = session.currentAttemptIndex;

  session.guessesThisRound.push({
    text: 'Skipped snippet',
    correct: false,
    attempt: attemptIndex + 1
  });

  const nextAttempt = attemptIndex + 1;
  session.currentAttemptIndex = nextAttempt;

  if (nextAttempt >= CLIP_LENGTHS.length) {
    session.roundScores[session.currentRoundIndex] = 0;
    session.roundAttemptsUsed[session.currentRoundIndex] = 5;
    session.roundWon[session.currentRoundIndex] = false;

    const totalScore = session.roundScores.reduce((a, b) => a + b, 0);

    return res.json({
      roundOver: true,
      scoreEarned: 0,
      totalScore,
      attemptUsed: 5,
      track: {
        id: currentTrack.id,
        title: currentTrack.title,
        artist: currentTrack.artist,
        cover: currentTrack.cover,
        preview: currentTrack.preview
      }
    });
  }

  res.json({
    roundOver: false,
    nextAttemptIndex: nextAttempt,
    nextDuration: CLIP_LENGTHS[nextAttempt]
  });
});

// POST /api/game/next-round
app.post('/api/game/next-round', (req, res) => {
  const { gameId } = req.body;
  const session = gameSessions.get(gameId);
  if (!session) return res.status(404).json({ error: 'Game session not found.' });

  const nextRound = session.currentRoundIndex + 1;
  if (nextRound >= 5) {
    session.completed = true;
    const totalScore = session.roundScores.reduce((a, b) => a + b, 0);

    return res.json({
      gameOver: true,
      totalScore,
      roundScores: session.roundScores,
      roundWon: session.roundWon,
      roundAttemptsUsed: session.roundAttemptsUsed,
      tracks: session.rounds.map(t => ({
        id: t.id,
        title: t.title,
        artist: t.artist,
        cover: t.cover,
        preview: t.preview
      }))
    });
  }

  session.currentRoundIndex = nextRound;
  session.currentAttemptIndex = 0;
  session.guessesThisRound = [];

  const nextTrack = session.rounds[nextRound];
  const totalScore = session.roundScores.reduce((a, b) => a + b, 0);

  res.json({
    gameOver: false,
    roundIndex: nextRound,
    totalRounds: 5,
    currentAttemptIndex: 0,
    clipDuration: CLIP_LENGTHS[0],
    clipLengths: CLIP_LENGTHS,
    previewUrl: nextTrack.preview,
    totalScore
  });
});

app.listen(PORT, () => {
  console.log(`SongSpot (Tunisian Edition) running at http://localhost:${PORT}`);
});
