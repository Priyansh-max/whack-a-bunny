// ---------------------------------------------------------------------------
// leaderboard.js — localStorage-backed score table.
// ---------------------------------------------------------------------------
import { STORAGE_KEYS } from './config.js';

const MAX_ENTRIES = 50;

export function loadScores() {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.leaderboard);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function saveScores(list) {
  try { localStorage.setItem(STORAGE_KEYS.leaderboard, JSON.stringify(list)); } catch { /* storage full/blocked */ }
}

/**
 * Add a score. Returns { entry, rank, isNewHigh } — rank is 1-based,
 * isNewHigh means it is the best score ever recorded.
 */
export function addScore({ name, score, difficulty, accuracy }) {
  const list = loadScores();
  const entry = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: (name || 'Anonymous').slice(0, 16),
    score,
    difficulty,
    accuracy: Math.round(accuracy),
    date: new Date().toISOString(),
  };
  list.push(entry);
  list.sort((a, b) => b.score - a.score || new Date(a.date) - new Date(b.date));
  const trimmed = list.slice(0, MAX_ENTRIES);
  saveScores(trimmed);
  const rank = trimmed.indexOf(entry) + 1;
  return { entry, rank, isNewHigh: rank === 1 && score > 0, saved: rank > 0 };
}

export function loadHighScores() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEYS.highscores)) || {};
  } catch {
    return {};
  }
}

/** Returns the (possibly updated) high score for a difficulty. */
export function recordHighScore(difficultyId, score) {
  const highs = loadHighScores();
  if (score > (highs[difficultyId] || 0)) {
    highs[difficultyId] = score;
    try { localStorage.setItem(STORAGE_KEYS.highscores, JSON.stringify(highs)); } catch { /* ignore */ }
  }
  return highs[difficultyId] || 0;
}
