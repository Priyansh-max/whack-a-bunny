// ---------------------------------------------------------------------------
// config.js — difficulty presets, world layout and storage keys.
// ---------------------------------------------------------------------------

export const STORAGE_KEYS = {
  leaderboard: 'wab_leaderboard_v1',
  settings: 'wab_settings_v1',
  highscores: 'wab_highscores_v1',
  playerName: 'wab_player_name',
};

export const SCORE_PER_BUNNY = 100;

export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: 'Easy',
    description: 'Relaxed pace · big targets · 90 seconds',
    gameTime: 90,
    spawnInterval: [1.3, 1.9],   // seconds between spawns (min,max)
    visibleTime: [2.2, 3.2],     // how long a bunny stays up
    hitboxScale: 1.6,
    maxConcurrent: 2,
    fakeChance: 0,
  },
  medium: {
    id: 'medium',
    label: 'Medium',
    description: 'Brisk pace · standard targets · 60 seconds',
    gameTime: 60,
    spawnInterval: [0.85, 1.35],
    visibleTime: [1.6, 2.4],
    hitboxScale: 1.15,
    maxConcurrent: 3,
    fakeChance: 0,
  },
  hard: {
    id: 'hard',
    label: 'Hard',
    description: 'Frantic pace · small targets · fake-outs · 45 seconds',
    gameTime: 45,
    spawnInterval: [0.5, 0.9],
    visibleTime: [1.0, 1.6],
    hitboxScale: 0.8,
    maxConcurrent: 4,
    fakeChance: 0.18,
  },
};

export const DEFAULT_SETTINGS = {
  sound: 0.8,
  music: 0.6,
  sensitivity: 1.0,
};

// Player stands at the origin looking down -Z. Holes are laid out in arcs
// ahead of the player. [angleDeg, distance]
export const HOLE_LAYOUT = [
  [-42, 9.5], [0, 8.5], [40, 10],
  [-26, 14], [12, 15], [46, 16],
  [-48, 20], [-8, 21], [28, 22],
  [8, 27],
];

export const PLAYER_HEIGHT = 1.72;

// Bunny tuning shared by all difficulties.
export const BUNNY = {
  riseTime: 0.32,
  hideTime: 0.26,
  fakeVisibleTime: [0.35, 0.6],
  fakeHeight: 0.45,      // fraction of full pop height
  deathTime: 0.5,
};
