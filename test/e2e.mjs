// E2E smoke test: drives real headless Chrome through the full game loop.
// Usage: node test/e2e.mjs   (requires the local server on :8123)
import puppeteer from 'puppeteer-core';

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const URL = 'http://localhost:8123/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let failures = 0;
const check = (name, cond) => {
  console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`);
  if (!cond) failures++;
};

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: 'new',
  args: ['--window-size=1600,900', '--mute-audio'],
});

const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

// --- 1. Menu loads ----------------------------------------------------------
await page.goto(URL, { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__game && window.__game.state === 'idle', { timeout: 20000 });
await sleep(800);
check('boot reaches main menu', true);
await page.screenshot({ path: 'test/shots/01-menu.png' });

// --- 2. Navigate menus -------------------------------------------------------
await page.click('#btn-play');
await sleep(500);
check('difficulty screen visible', await page.$eval('#screen-difficulty', (el) => el.classList.contains('active')));
await page.screenshot({ path: 'test/shots/02-difficulty.png' });

// --- 3. Start a game (easy) --------------------------------------------------
await page.click('.diff-card[data-diff="easy"]');
await page.waitForFunction(() => window.__game.state === 'countdown' || window.__game.state === 'playing');
check('game starts countdown', true);
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 8000 });
check('countdown leads to playing', true);

// --- 4. Wait for a bunny, aim and shoot it -----------------------------------
await page.waitForFunction(() => window.__manager.hitTargets().length > 0, { timeout: 15000 });
await page.screenshot({ path: 'test/shots/03-gameplay.png' });

const before = await page.evaluate(() => ({ score: window.__game.score, hits: window.__game.hits }));
// Aim at a fully-risen bunny and shoot in the same tick; retry as bunnies cycle.
for (let attempt = 0; attempt < 8; attempt++) {
  const result = await page.evaluate(() => {
    const g = window.__game;
    const candidates = window.__manager.bunnies.filter((x) => x.isHittable && x.state === 'visible');
    if (!candidates.length) return 'none';
    candidates.sort((a, b) => (b.visibleFor - b.stateT) - (a.visibleFor - a.stateT));
    const b = candidates[0];
    const target = b.root.position.clone();
    target.y = b.model.position.y + 0.55; // world-space head height
    const dx = target.x, dy = target.y - 1.72, dz = target.z;
    g.yaw = Math.atan2(-dx, -dz);
    g.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    // Apply to the rig immediately (game.update does this once per frame).
    g.yawObj.rotation.y = g.yaw;
    g.pitchObj.rotation.x = g.pitch;
    g.yawObj.updateMatrixWorld(true);
    g.shoot();
    return g.hits > 0 ? 'hit' : 'miss';
  });
  if (result === 'hit') break;
  await sleep(500);
}
await sleep(300);
const after = await page.evaluate(() => ({ score: window.__game.score, hits: window.__game.hits, shots: window.__game.shots }));
check(`bunny hit scores +100 (score ${before.score} -> ${after.score})`, after.score === before.score + 100 && after.hits === before.hits + 1);
await page.screenshot({ path: 'test/shots/04-hit.png' });

// --- 5. Pause / resume ---------------------------------------------------------
await page.evaluate(() => window.__game.pause());
await sleep(400);
check('pause screen visible', await page.$eval('#screen-pause', (el) => el.classList.contains('active')));
await page.screenshot({ path: 'test/shots/05-pause.png' });
await page.click('#btn-resume');
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 3000 });
check('resume works', true);

// --- 6. Fast-forward to results ------------------------------------------------
await page.evaluate(() => { window.__game.timeLeft = 1.2; });
await page.waitForFunction(() => window.__game.state === 'over', { timeout: 5000 });
await sleep(700);
check('results screen visible', await page.$eval('#screen-results', (el) => el.classList.contains('active')));
await page.screenshot({ path: 'test/shots/06-results.png' });

// --- 7. Save score -> leaderboard ----------------------------------------------
await page.type('#res-name', 'TestPlayer');
await page.click('#btn-save-score');
await sleep(700);
check('leaderboard shown after save', await page.$eval('#screen-leaderboard', (el) => el.classList.contains('active')));
const lbText = await page.$eval('#leaderboard-body', (el) => el.textContent);
check('leaderboard contains saved entry', lbText.includes('TestPlayer'));
check('new entry highlighted', await page.$eval('#leaderboard-body tr', (el) => el.classList.contains('highlight')));
await page.screenshot({ path: 'test/shots/07-leaderboard.png' });

// --- 8. Settings screen ----------------------------------------------------------
await page.click('#btn-lb-back');
await sleep(300);
await page.click('#btn-settings');
await sleep(400);
check('settings screen visible', await page.$eval('#screen-settings', (el) => el.classList.contains('active')));
await page.screenshot({ path: 'test/shots/08-settings.png' });

// --- Console errors -----------------------------------------------------------
check(`no page errors (${errors.length})`, errors.length === 0);
if (errors.length) console.log(errors.slice(0, 8));

await browser.close();
console.log(failures === 0 ? '\nALL CHECKS PASSED' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
