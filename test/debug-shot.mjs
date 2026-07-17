import puppeteer from 'puppeteer-core';
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const browser = await puppeteer.launch({ executablePath: CHROME, headless: 'new', args: ['--window-size=1600,900', '--mute-audio'] });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 900 });
page.on('pageerror', (e) => console.log('PAGEERROR:', e.message));

await page.goto('http://localhost:8123/', { waitUntil: 'networkidle0' });
await page.waitForFunction(() => window.__game && window.__game.state === 'idle', { timeout: 20000 });
await page.click('#btn-play');
await sleep(400);
await page.click('.diff-card[data-diff="easy"]');
await page.waitForFunction(() => window.__game.state === 'playing', { timeout: 8000 });
await page.waitForFunction(() => window.__manager.hitTargets().length > 0, { timeout: 15000 });
console.log('pointerLockElement:', await page.evaluate(() => String(document.pointerLockElement)));

const res = await page.evaluate(async () => {
  const g = window.__game;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const candidates = window.__manager.bunnies.filter((x) => x.isHittable);
  candidates.sort((a, b) => (b.visibleFor - b.stateT) - (a.visibleFor - a.stateT));
  const b = candidates[0];
  if (!b) return { error: 'no candidates' };

  const aim = () => {
    const target = b.root.position.clone();
    target.y = b.model.position.y + 0.55;
    const dx = target.x, dy = target.y - 1.72, dz = target.z;
    g.yaw = Math.atan2(-dx, -dz);
    g.pitch = Math.atan2(dy, Math.hypot(dx, dz));
    return target.toArray();
  };
  const targetAtAim = aim();
  const modelYAtAim = b.model.position.y;
  await sleep(120); // let frames render & matrices update
  aim(); // re-aim at current position

  // Manual raycast BEFORE shooting.
  g.camera.updateMatrixWorld(true);
  g.raycaster.setFromCamera(g._center, g.camera);
  const targets = window.__manager.hitTargets();
  const hits = g.raycaster.intersectObjects(targets, false);
  const hitWorld = new g.camera.position.constructor();
  b.hitMesh.getWorldPosition(hitWorld);
  const before = { shots: g.shots, hits: g.hits, score: g.score };
  g.shoot();
  const after = { shots: g.shots, hits: g.hits, score: g.score };
  return {
    targetAtAim, modelYAtAim,
    modelYAtShot: b.model.position.y,
    bunnyState: b.state,
    hitMeshWorld: hitWorld.toArray(),
    hitScale: b.hitMesh.scale.x,
    manualHitDist: hits[0]?.distance ?? null,
    nTargets: targets.length,
    yaw: g.yaw, pitch: g.pitch,
    yawObjRot: g.yawObj.rotation.y, pitchObjRot: g.pitchObj.rotation.x,
    camWorld: g.camera.getWorldPosition(new g.camera.position.constructor()).toArray(),
    before, after,
  };
});
console.log(JSON.stringify(res, null, 1));
await browser.close();
