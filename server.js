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

// Security Middleware
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

app.use(cors({
  origin: true,
  credentials: true
}));

app.use(express.json({ limit: '50kb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Rate Limiter on API calls
const apiLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 120, // 120 requests per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Too many requests, please slow down.' }
});
app.use('/api/', apiLimiter);

// In-Memory Caches (Storing ONLY metadata: IDs, titles, artists, cover URLs. No audio files stored.)
const metadataCache = new Map(); // key -> { timestamp, data }
const CACHE_TTL_MS = 15 * 60 * 1000; // 15 minutes

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
  // Prune cache if overly large
  if (metadataCache.size > 2000) {
    const oldestKey = metadataCache.keys().next().value;
    metadataCache.delete(oldestKey);
  }
  metadataCache.set(key, { timestamp: Date.now(), data });
}

// Predefined Curated Genres & Charts
const GENRE_DEFINITIONS = [
  { id: 'chart-0', name: 'Global Top Hits', type: 'chart', target: '0' },
  { id: 'genre-132', name: 'Pop Anthems', type: 'genre', target: '132' },
  { id: 'genre-152', name: 'Rock Legends', type: 'genre', target: '152' },
  { id: 'genre-116', name: 'Hip-Hop & Rap', type: 'genre', target: '116' },
  { id: 'genre-113', name: 'Dance & Electronic', type: 'genre', target: '113' },
  { id: 'genre-165', name: 'R&B & Soul', type: 'genre', target: '165' },
  { id: 'search-80s', name: '80s & 90s Classics', type: 'search', target: '80s 90s greatest hits' },
  { id: 'search-indie', name: 'Indie & Alternative', type: 'search', target: 'indie alternative greatest hits' }
];

// Active Game Sessions
const gameSessions = new Map();
const SESSION_TTL_MS = 60 * 60 * 1000; // 1 hour

// Clean up stale sessions periodically
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

// Fetch tracks from Deezer based on category
async function fetchTracksForCategory(genreObj) {
  const cacheKey = `tracks:${genreObj.id}`;
  const cached = getCached(cacheKey);
  if (cached && cached.length >= 10) return cached;

  let url;
  if (genreObj.type === 'chart') {
    url = `https://api.deezer.com/chart/${genreObj.target}/tracks?limit=60`;
  } else if (genreObj.type === 'genre') {
    url = `https://api.deezer.com/chart/${genreObj.target}/tracks?limit=60`;
  } else {
    url = `https://api.deezer.com/search?q=${encodeURIComponent(genreObj.target)}&limit=60`;
  }

  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Deezer API returned ${res.status}`);
    const json = await res.json();
    const list = json.data || [];

    // Filter valid tracks that contain playable previews and album art
    const tracks = list
      .filter(t => t.preview && t.title && t.artist && t.artist.name)
      .map(t => ({
        id: t.id,
        title: t.title_short || t.title,
        fullTitle: t.title,
        artist: t.artist.name,
        cover: t.album?.cover_medium || t.album?.cover_big || t.artist?.picture_medium || '',
        preview: t.preview
      }));

    if (tracks.length > 0) {
      setCached(cacheKey, tracks);
      return tracks;
    }
  } catch (err) {
    console.error(`Error fetching category ${genreObj.id}:`, err);
  }

  // Fallback to general chart
  if (genreObj.id !== 'chart-0') {
    return fetchTracksForCategory(GENRE_DEFINITIONS[0]);
  }
  return [];
}

// Title normalization for fuzzy matching
function normalizeTrackTitle(str) {
  if (!str) return '';
  return str
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '') // remove accents
    .replace(/\(.*?\)/g, '') // remove parenthesized info like (Remastered) or (feat. X)
    .replace(/\[.*?\]/g, '') // remove bracketed info
    .replace(/-.*$/g, '') // remove dash subtitles like - 2011 Remaster
    .replace(/[^a-z0-9]/g, '') // keep only alphanumeric
    .trim();
}

// ================= API ROUTES =================

// GET /api/genres
app.get('/api/genres', (req, res) => {
  res.json({
    genres: GENRE_DEFINITIONS.map(g => ({ id: g.id, name: g.name }))
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
    const deezerUrl = `https://api.deezer.com/search?q=${encodeURIComponent(query)}&limit=10`;
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

// POST /api/game/new (Start a new 5-round game)
app.post('/api/game/new', async (req, res) => {
  const { genreId } = req.body;
  const selectedGenre = GENRE_DEFINITIONS.find(g => g.id === genreId) || GENRE_DEFINITIONS[0];

  const pool = await fetchTracksForCategory(selectedGenre);
  if (!pool || pool.length < 5) {
    return res.status(500).json({ error: 'Could not fetch enough tracks for this category.' });
  }

  // Pick 5 random unique tracks
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

// POST /api/game/guess (Submit a guess for the active round)
app.post('/api/game/guess', (req, res) => {
  const { gameId, trackId, guessTitle } = req.body;
  if (!gameId || (!trackId && !guessTitle)) {
    return res.status(400).json({ error: 'Invalid guess parameters' });
  }

  const session = gameSessions.get(gameId);
  if (!session || session.completed) {
    return res.status(404).json({ error: 'Game session not found or already completed.' });
  }

  const currentTrack = session.rounds[session.currentRoundIndex];
  const attemptIndex = session.currentAttemptIndex;

  // Check if guess is correct
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

  // Guess was incorrect
  const nextAttempt = attemptIndex + 1;
  session.currentAttemptIndex = nextAttempt;

  if (nextAttempt >= CLIP_LENGTHS.length) {
    // Out of attempts: round lost
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

  // More attempts remaining
  res.json({
    correct: false,
    roundOver: false,
    nextAttemptIndex: nextAttempt,
    nextDuration: CLIP_LENGTHS[nextAttempt]
  });
});

// POST /api/game/skip (Skip current clip to unlock longer duration)
app.post('/api/game/skip', (req, res) => {
  const { gameId } = req.body;
  if (!gameId) {
    return res.status(400).json({ error: 'Missing gameId' });
  }

  const session = gameSessions.get(gameId);
  if (!session || session.completed) {
    return res.status(404).json({ error: 'Game session not found.' });
  }

  const currentTrack = session.rounds[session.currentRoundIndex];
  const attemptIndex = session.currentAttemptIndex;

  session.guessesThisRound.push({
    text: 'Skipped',
    correct: false,
    attempt: attemptIndex + 1
  });

  const nextAttempt = attemptIndex + 1;
  session.currentAttemptIndex = nextAttempt;

  if (nextAttempt >= CLIP_LENGTHS.length) {
    // Forfeited / All skips used
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

// POST /api/game/next-round (Advance to subsequent round or complete game)
app.post('/api/game/next-round', (req, res) => {
  const { gameId } = req.body;
  const session = gameSessions.get(gameId);
  if (!session) {
    return res.status(404).json({ error: 'Game session not found.' });
  }

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
  console.log(`SongSpot server running at http://localhost:${PORT}`);
});
