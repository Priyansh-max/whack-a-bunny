// ---------------------------------------------------------------------------
// ui.js — DOM layer: screen manager with animated transitions, HUD, crosshair
// feedback, score popups, countdown, results, settings and leaderboard.
// ---------------------------------------------------------------------------
import { clamp, damp } from './utils.js';
import { DIFFICULTIES, STORAGE_KEYS, DEFAULT_SETTINGS } from './config.js';
import { AMMO_PER_MAG } from './weapon.js';
import { audio } from './audio.js';
import { loadScores, loadHighScores } from './leaderboard.js';

const $ = (id) => document.getElementById(id);

export class UI {
  /**
   * callbacks: { onPlay(diffId), onResume(), onRestart(), onQuitToMenu(),
   *              onSaveScore(name), onSensitivity(v) }
   */
  constructor(callbacks) {
    this.cb = callbacks;
    this.currentScreen = 'loading';
    this.displayedScore = 0;
    this.scoreTarget = 0;
    this.settings = this._loadSettings();

    this._bindMenus();
    this._bindSettings();
    this._applySettingsToInputs();
    this._applySettings();
    this._buildAmmo();
  }

  // -------------------------------------------------------------- settings --
  _loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(STORAGE_KEYS.settings)) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  _saveSettings() {
    try { localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(this.settings)); } catch { /* ignore */ }
  }

  _applySettings() {
    audio.setSoundVolume(this.settings.sound);
    audio.setMusicVolume(this.settings.music);
    this.cb.onSensitivity(this.settings.sensitivity);
  }

  _applySettingsToInputs() {
    $('set-sound').value = this.settings.sound;
    $('set-music').value = this.settings.music;
    $('set-sensitivity').value = this.settings.sensitivity;
    this._updateSettingLabels();
  }

  _updateSettingLabels() {
    $('set-sound-val').textContent = `${Math.round(this.settings.sound * 100)}%`;
    $('set-music-val').textContent = `${Math.round(this.settings.music * 100)}%`;
    $('set-sensitivity-val').textContent = `${this.settings.sensitivity.toFixed(2)}×`;
  }

  _bindSettings() {
    const bind = (id, key, parse = parseFloat) => {
      $(id).addEventListener('input', (e) => {
        this.settings[key] = clamp(parse(e.target.value), 0, key === 'sensitivity' ? 3 : 1);
        if (key === 'sensitivity') this.settings[key] = Math.max(0.2, this.settings[key]);
        this._updateSettingLabels();
        this._applySettings();
        this._saveSettings();
      });
    };
    bind('set-sound', 'sound');
    bind('set-music', 'music');
    bind('set-sensitivity', 'sensitivity');
  }

  // ----------------------------------------------------------------- menus --
  _bindMenus() {
    // Hover blips on every button.
    document.querySelectorAll('.btn').forEach((btn) => {
      btn.addEventListener('mouseenter', () => audio.uiHover());
      btn.addEventListener('click', () => audio.uiClick());
    });

    $('btn-play').addEventListener('click', () => this.showScreen('difficulty'));
    $('btn-leaderboard').addEventListener('click', () => this.showLeaderboard());
    $('btn-settings').addEventListener('click', () => this.showScreen('settings'));
    $('btn-exit').addEventListener('click', () => this.showScreen('exit'));

    document.querySelectorAll('.diff-card').forEach((card) => {
      card.addEventListener('click', () => this.cb.onPlay(card.dataset.diff));
    });
    $('btn-diff-back').addEventListener('click', () => this.showScreen('menu'));
    $('btn-lb-back').addEventListener('click', () => this.showScreen('menu'));
    $('btn-set-back').addEventListener('click', () => this.showScreen('menu'));
    $('btn-exit-back').addEventListener('click', () => this.showScreen('menu'));

    $('btn-resume').addEventListener('click', () => this.cb.onResume());
    $('btn-restart').addEventListener('click', () => this.cb.onRestart());
    $('btn-quit').addEventListener('click', () => this.cb.onQuitToMenu());

    $('btn-save-score').addEventListener('click', () => {
      const name = $('res-name').value.trim() || 'Anonymous';
      try { localStorage.setItem(STORAGE_KEYS.playerName, name); } catch { /* ignore */ }
      const result = this.cb.onSaveScore(name);
      if (result) this.showLeaderboard(result.entry.id);
    });
    $('btn-again').addEventListener('click', () => this.cb.onRestart());
    $('btn-menu').addEventListener('click', () => this.cb.onQuitToMenu());
  }

  /** Show one screen (or none, for pure HUD). Animated via CSS classes. */
  showScreen(id) {
    this.currentScreen = id;
    document.querySelectorAll('.screen').forEach((s) => {
      const active = s.id === `screen-${id}`;
      s.classList.toggle('active', active);
    });
    $('hud').classList.toggle('visible', id === null || id === 'pause');
    $('crosshair').classList.toggle('visible', id === null);
  }

  // --------------------------------------------------------------- loading --
  setLoadProgress(p) {
    $('load-bar').style.width = `${Math.round(p * 100)}%`;
    $('load-label').textContent = `${Math.round(p * 100)}%`;
  }

  // ------------------------------------------------------------------- HUD --
  resetHUD(difficulty) {
    this.scoreTarget = 0;
    this.displayedScore = 0;
    $('hud-score').textContent = '0';
    this.setShots(0);
    this.setHits(0);
    this.setAccuracy(100);
    this.setTime(difficulty.gameTime);
    this.setAmmo(AMMO_PER_MAG);
    $('hud-difficulty').textContent = difficulty.label;
    $('hud').classList.add('visible');
    $('crosshair').classList.add('visible');
    $('hud-time').classList.remove('warning');
  }

  setHighScore(v) { $('hud-high').textContent = String(v); }

  setScore(v) {
    this.scoreTarget = v;
    $('hud-score').classList.remove('pop');
    void $('hud-score').offsetWidth; // restart animation
    $('hud-score').classList.add('pop');
  }

  setTime(seconds) {
    const s = Math.ceil(seconds);
    const m = Math.floor(s / 60);
    $('hud-time').textContent = `${m}:${String(s % 60).padStart(2, '0')}`;
    $('hud-time').classList.toggle('warning', s <= 5 && s > 0);
  }

  setAccuracy(v) { $('hud-accuracy').textContent = `${Math.round(v)}%`; }
  setShots(v) { $('hud-shots').textContent = String(v); }
  setHits(v) { $('hud-hits').textContent = String(v); }
  setFPS(v) { $('hud-fps').textContent = `${v} FPS`; }

  _buildAmmo() {
    const wrap = $('hud-ammo');
    wrap.innerHTML = '';
    for (let i = 0; i < AMMO_PER_MAG; i++) {
      const pip = document.createElement('span');
      pip.className = 'pip';
      wrap.appendChild(pip);
    }
  }

  setAmmo(v) {
    [...$('hud-ammo').children].forEach((pip, i) => {
      pip.classList.toggle('spent', i >= v);
    });
  }

  // ------------------------------------------------------------ crosshair --
  pulseCrosshair() {
    const c = $('crosshair');
    c.classList.remove('fire');
    void c.offsetWidth;
    c.classList.add('fire');
  }

  hitmarker() {
    const h = $('hitmarker');
    h.classList.remove('show');
    void h.offsetWidth;
    h.classList.add('show');
  }

  scorePopup(pos, text) {
    const layer = $('popup-layer');
    const el = document.createElement('div');
    el.className = 'score-popup';
    el.textContent = text;
    el.style.left = `${pos.x}px`;
    el.style.top = `${pos.y}px`;
    layer.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
    // Cap nodes just in case.
    while (layer.children.length > 12) layer.firstChild.remove();
  }

  // ------------------------------------------------------------- countdown --
  setCountdown(text) {
    const overlay = $('countdown-overlay');
    overlay.classList.add('visible');
    const num = $('countdown-number');
    num.textContent = text;
    num.classList.remove('zoom');
    void num.offsetWidth;
    num.classList.add('zoom');
  }

  hideCountdown() {
    $('countdown-overlay').classList.remove('visible');
  }

  // --------------------------------------------------------------- results --
  showResults({ score, hits, shots, accuracy, difficulty, highScore }) {
    $('res-score').textContent = String(score);
    $('res-accuracy').textContent = `${Math.round(accuracy)}%`;
    $('res-hits').textContent = String(hits);
    $('res-shots').textContent = String(shots);
    $('res-difficulty').textContent = difficulty.label;
    $('res-high').textContent = String(highScore);
    $('res-name').value = localStorage.getItem(STORAGE_KEYS.playerName) || '';
    this._pendingResult = { score, hits, shots, accuracy, difficulty };
    this.showScreen('results');
    // Stagger stat rows in.
    document.querySelectorAll('#screen-results .stat-row').forEach((row, i) => {
      row.style.animationDelay = `${0.15 + i * 0.08}s`;
      row.classList.remove('slide-in');
      void row.offsetWidth;
      row.classList.add('slide-in');
    });
  }

  getPendingResult() { return this._pendingResult; }

  // ------------------------------------------------------------ leaderboard --
  showLeaderboard(highlightId = null) {
    const scores = loadScores();
    const body = $('leaderboard-body');
    body.innerHTML = '';
    if (!scores.length) {
      body.innerHTML = '<tr><td colspan="6" class="lb-empty">No scores yet — be the first!</td></tr>';
    }
    scores.forEach((s, i) => {
      const tr = document.createElement('tr');
      if (s.id === highlightId) tr.className = 'highlight';
      const diff = DIFFICULTIES[s.difficulty];
      const date = new Date(s.date);
      tr.innerHTML = `
        <td>${i + 1}</td>
        <td>${escapeHtml(s.name)}</td>
        <td>${s.score}</td>
        <td>${diff ? diff.label : s.difficulty}</td>
        <td>${s.accuracy}%</td>
        <td>${date.toLocaleDateString()}</td>`;
      body.appendChild(tr);
    });
    this.showScreen('leaderboard');
  }

  refreshMenuHighScores() {
    const highs = loadHighScores();
    document.querySelectorAll('.diff-card').forEach((card) => {
      const el = card.querySelector('.diff-best');
      if (el) el.textContent = `Best: ${highs[card.dataset.diff] || 0}`;
    });
  }

  // ---------------------------------------------------------------- update --
  update(dt) {
    // Animated score count-up.
    if (this.displayedScore !== this.scoreTarget) {
      this.displayedScore = damp(this.displayedScore, this.scoreTarget, 14, dt);
      if (Math.abs(this.scoreTarget - this.displayedScore) < 1) this.displayedScore = this.scoreTarget;
      $('hud-score').textContent = String(Math.round(this.displayedScore));
    }
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
