// ---------------------------------------------------------------------------
// environment.js — sky, lighting, terrain, vegetation and props.
// Everything is procedural: canvas textures, primitive-based models and one
// InstancedMesh for the grass with a wind-sway vertex shader injection.
// ---------------------------------------------------------------------------
import * as THREE from 'three';
import { rand, randInt, pick } from './utils.js';

const GROUND_RADIUS = 70;

/** Minimal indexed-geometry merge (position/normal/uv) for simple plane parts. */
function mergeGeoms(geos) {
  let vCount = 0, iCount = 0;
  for (const g of geos) { vCount += g.attributes.position.count; iCount += g.index.count; }
  const pos = new Float32Array(vCount * 3);
  const norm = new Float32Array(vCount * 3);
  const uv = new Float32Array(vCount * 2);
  const idx = new Uint16Array(iCount);
  let vo = 0, io = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, vo * 3);
    norm.set(g.attributes.normal.array, vo * 3);
    uv.set(g.attributes.uv.array, vo * 2);
    const gi = g.index.array;
    for (let i = 0; i < gi.length; i++) idx[io + i] = gi[i] + vo;
    vo += g.attributes.position.count;
    io += gi.length;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

export class Environment {
  /**
   * @param {THREE.Scene} scene
   * @param {THREE.Vector3[]} holePositions world positions of the bunny holes
   */
  constructor(scene, holePositions) {
    this.scene = scene;
    // Shared uniforms — ambient systems (gusts) also drive uWind.
    this.uniforms = {
      uTime: { value: 0 },
      uWind: { value: 1.0 },
    };
    // Meshes bullets can hit, tagged with userData.impactType.
    this.raycastTargets = [];
    // Tree canopy world positions, used by the falling-leaves system.
    this.canopies = [];
    this.clouds = [];

    this._buildSky();
    this._buildLights();
    this._buildGround(holePositions);
    this._buildGrass(holePositions);
    this._buildFlowers(holePositions);
    this._buildTrees();
    this._buildTreeline();
    this._buildFences();
    this._buildRocks();
    this._buildClouds();
  }

  /** Lambert material with a wind-sway vertex displacement injected. */
  _windMaterial(params, maxHeight) {
    const mat = new THREE.MeshLambertMaterial(params);
    const uniforms = this.uniforms;
    const h2 = (maxHeight * maxHeight).toFixed(5);
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = uniforms.uTime;
      shader.uniforms.uWind = uniforms.uWind;
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>
          uniform float uTime;
          uniform float uWind;`)
        .replace('#include <begin_vertex>', `#include <begin_vertex>
          #ifdef USE_INSTANCING
          {
            vec3 iPos = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
            float ph = iPos.x * 0.35 + iPos.z * 0.55;
            float sway = sin(uTime * 1.9 + ph) + 0.45 * sin(uTime * 3.3 + ph * 1.7);
            float bend = clamp((transformed.y * transformed.y) / ${h2}, 0.0, 1.0);
            transformed.x += sway * uWind * 0.09 * bend;
            transformed.z += cos(uTime * 1.4 + ph) * uWind * 0.05 * bend;
          }
          #endif`);
    };
    mat.customProgramCacheKey = () => `wind-${h2}`;
    return mat;
  }

  // ------------------------------------------------------------------ sky --
  _buildSky() {
    const geo = new THREE.SphereGeometry(320, 32, 20);
    this.skyUniforms = {
      uTop: { value: new THREE.Color(0x3d7ec9) },
      uHorizon: { value: new THREE.Color(0xcfe5ee) },
      uSunDir: { value: new THREE.Vector3(-0.45, 0.62, 0.64).normalize() },
      uSunColor: { value: new THREE.Color(0xfff3d6) },
      uTime: this.uniforms.uTime,
    };
    const mat = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: this.skyUniforms,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }`,
      fragmentShader: /* glsl */`
        varying vec3 vDir;
        uniform vec3 uTop, uHorizon, uSunColor, uSunDir;
        uniform float uTime;
        void main() {
          float h = clamp(vDir.y, 0.0, 1.0);
          vec3 col = mix(uHorizon, uTop, pow(h, 0.62));
          float sun = max(dot(normalize(vDir), normalize(uSunDir)), 0.0);
          col += uSunColor * (pow(sun, 220.0) * 0.9 + pow(sun, 10.0) * 0.16);
          // Very subtle warm breathing of the light over time.
          col *= 1.0 + 0.02 * sin(uTime * 0.05);
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.scene.add(new THREE.Mesh(geo, mat));
    this.scene.fog = new THREE.Fog(0xcfe5ee, 55, 240);
  }

  // --------------------------------------------------------------- lights --
  _buildLights() {
    const hemi = new THREE.HemisphereLight(0xbfd9ff, 0x6a8f52, 0.45);
    this.scene.add(hemi);

    const sun = new THREE.DirectionalLight(0xfff2dd, 2.2);
    sun.position.set(-32, 52, 42);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -40;
    sun.shadow.camera.right = 40;
    sun.shadow.camera.top = 40;
    sun.shadow.camera.bottom = -40;
    sun.shadow.camera.near = 5;
    sun.shadow.camera.far = 140;
    sun.shadow.bias = -0.0004;
    sun.shadow.normalBias = 0.02;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this.sun = sun;
  }

  // --------------------------------------------------------------- ground --
  _buildGround(holePositions) {
    const size = 1024;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d');

    // Base grass green with large soft patches.
    ctx.fillStyle = '#5d8f3e';
    ctx.fillRect(0, 0, size, size);
    for (let i = 0; i < 260; i++) {
      const x = Math.random() * size, y = Math.random() * size;
      const r = rand(20, 90);
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      const tone = pick(['#558539', '#679a45', '#507f35', '#6da048', '#5a8c3c']);
      g.addColorStop(0, tone + 'cc');
      g.addColorStop(1, tone + '00');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill();
    }
    // Fine speckle.
    for (let i = 0; i < 9000; i++) {
      ctx.fillStyle = `rgba(${randInt(40, 110)}, ${randInt(90, 150)}, ${randInt(30, 70)}, 0.25)`;
      ctx.fillRect(Math.random() * size, Math.random() * size, 2, 2);
    }
    // Worn dirt path in front of the player.
    ctx.save();
    ctx.translate(size / 2, size / 2);
    ctx.fillStyle = 'rgba(139, 110, 72, 0.5)';
    ctx.beginPath();
    ctx.ellipse(0, -size * 0.06, size * 0.045, size * 0.2, 0, 0, 7);
    ctx.fill();
    ctx.restore();

    // Dirt rings baked under every hole.
    const toPx = (wx, wz) => [
      (wx / GROUND_RADIUS + 1) * 0.5 * size,
      (wz / GROUND_RADIUS + 1) * 0.5 * size,
    ];
    for (const p of holePositions) {
      const [px, py] = toPx(p.x, p.z);
      const r = size * (1.15 / GROUND_RADIUS); // ~1.15 world units radius
      const g = ctx.createRadialGradient(px, py, r * 0.2, px, py, r);
      g.addColorStop(0, '#4d3a24');
      g.addColorStop(0.55, '#6b5233');
      g.addColorStop(1, 'rgba(107, 82, 51, 0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill();
    }

    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 4;

    const geo = new THREE.CircleGeometry(GROUND_RADIUS, 64);
    const mat = new THREE.MeshLambertMaterial({ map: tex });
    const ground = new THREE.Mesh(geo, mat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    ground.userData.impactType = 'dirt';
    this.scene.add(ground);
    this.raycastTargets.push(ground);
  }

  // ---------------------------------------------------------------- grass --
  _buildGrass(holePositions) {
    const blade = new THREE.BufferGeometry();
    // Two crossed triangles per blade for a bit of volume.
    const h = 0.42, w = 0.055;
    const verts = new Float32Array([
      -w, 0, 0,  w, 0, 0,  0, h, 0,
      0, 0, -w,  0, 0, w,  0, h * 0.85, 0,
    ]);
    blade.setAttribute('position', new THREE.BufferAttribute(verts, 3));
    blade.computeVertexNormals();

    const mat = this._windMaterial({ color: 0xffffff, side: THREE.DoubleSide }, h);

    const COUNT = 3400;
    const mesh = new THREE.InstancedMesh(blade, mat, COUNT);
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    let placed = 0;
    let guard = 0;
    while (placed < COUNT && guard++ < COUNT * 20) {
      const a = Math.random() * Math.PI * 2;
      const r = 2.2 + Math.pow(Math.random(), 0.7) * 46;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      // Keep blades off the hole mounds.
      if (holePositions.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.9)) continue;
      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI;
      const s = rand(0.7, 1.5);
      dummy.scale.set(s, s * rand(0.8, 1.3), s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      color.setHSL(0.26 + Math.random() * 0.05, rand(0.45, 0.65), rand(0.28, 0.42));
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
  }

  // -------------------------------------------------------------- flowers --
  _buildFlowers(holePositions) {
    // Stem + two crossed petal quads, one instanced draw call.
    const stem = new THREE.PlaneGeometry(0.02, 0.26);
    stem.translate(0, 0.13, 0);
    const headA = new THREE.PlaneGeometry(0.11, 0.08);
    headA.translate(0, 0.27, 0);
    const headB = headA.clone();
    headB.rotateY(Math.PI / 2);
    const geo = mergeGeoms([stem, headA, headB]);

    const mat = this._windMaterial({ color: 0xffffff, side: THREE.DoubleSide }, 0.28);
    const COUNT = 240;
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    const dummy = new THREE.Object3D();
    const color = new THREE.Color();
    const petals = [0xffffff, 0xffd166, 0xf4a7c3, 0xc39bd3, 0xfff3a0];
    let placed = 0, guard = 0;
    while (placed < COUNT && guard++ < COUNT * 30) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.pow(Math.random(), 0.8) * 40;
      const x = Math.sin(a) * r;
      const z = -Math.cos(a) * r;
      if (holePositions.some((p) => (p.x - x) ** 2 + (p.z - z) ** 2 < 2.9)) continue;
      dummy.position.set(x, 0, z);
      dummy.rotation.y = Math.random() * Math.PI;
      const s = rand(0.7, 1.3);
      dummy.scale.setScalar(s);
      dummy.updateMatrix();
      mesh.setMatrixAt(placed, dummy.matrix);
      color.set(pick(petals));
      mesh.setColorAt(placed, color);
      placed++;
    }
    mesh.count = placed;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.scene.add(mesh);
  }

  // ---------------------------------------------------------------- trees --
  _makeTree(scale = 1) {
    const tree = new THREE.Group();
    const trunkMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2f });
    const trunkH = rand(2.0, 2.8) * scale;
    const trunk = new THREE.Mesh(
      new THREE.CylinderGeometry(0.16 * scale, 0.3 * scale, trunkH, 7),
      trunkMat
    );
    trunk.position.y = trunkH / 2;
    trunk.castShadow = true;
    trunk.userData.impactType = 'wood';
    tree.add(trunk);
    this.raycastTargets.push(trunk);

    const greens = [0x3e6b2f, 0x4a7d36, 0x55873c, 0x447336, 0x5d9240];
    const blobs = randInt(4, 6);
    for (let i = 0; i < blobs; i++) {
      const r = rand(0.9, 1.5) * scale;
      const geo = new THREE.IcosahedronGeometry(r, 1);
      // Jitter vertices for an organic silhouette.
      const pos = geo.attributes.position;
      for (let v = 0; v < pos.count; v++) {
        pos.setXYZ(
          v,
          pos.getX(v) * rand(0.9, 1.1),
          pos.getY(v) * rand(0.82, 1.05),
          pos.getZ(v) * rand(0.9, 1.1)
        );
      }
      geo.computeVertexNormals();
      const mat = new THREE.MeshLambertMaterial({ color: pick(greens), flatShading: true });
      const blob = new THREE.Mesh(geo, mat);
      blob.position.set(
        rand(-0.7, 0.7) * scale,
        trunkH + rand(-0.2, 1.1) * scale,
        rand(-0.7, 0.7) * scale
      );
      blob.castShadow = true;
      tree.add(blob);
    }
    return tree;
  }

  _buildTrees() {
    // A loose forest ring around the meadow, plus two feature trees closer in.
    const spots = [];
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + rand(-0.18, 0.18);
      const r = rand(36, 62);
      spots.push([Math.sin(a) * r, -Math.cos(a) * r, rand(0.9, 1.7)]);
    }
    spots.push([-24, -20, 1.25], [26, -26, 1.4]);
    for (const [x, z, s] of spots) {
      const tree = this._makeTree(s);
      tree.position.set(x, 0, z);
      tree.rotation.y = Math.random() * Math.PI * 2;
      this.scene.add(tree);
      this.canopies.push(new THREE.Vector3(x, rand(2.4, 4.2) * s, z));
    }
  }

  // ------------------------------------------------- distant treeline ring --
  _buildTreeline() {
    // Silhouetted conifers far out — cheap depth cue, swallowed by the fog.
    const geo = new THREE.ConeGeometry(1, 1, 6);
    const mat = new THREE.MeshLambertMaterial({ color: 0x2e4d28 });
    const COUNT = 26;
    const mesh = new THREE.InstancedMesh(geo, mat, COUNT);
    const dummy = new THREE.Object3D();
    for (let i = 0; i < COUNT; i++) {
      const a = (i / COUNT) * Math.PI * 2 + rand(-0.1, 0.1);
      const r = rand(95, 135);
      const h = rand(16, 30);
      dummy.position.set(Math.sin(a) * r, h / 2 - 0.5, -Math.cos(a) * r);
      dummy.scale.set(rand(5, 9), h, rand(5, 9));
      dummy.rotation.y = Math.random() * Math.PI;
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
  }

  // --------------------------------------------------------------- fences --
  _buildFences() {
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x8a6844 });
    const woodMat2 = new THREE.MeshLambertMaterial({ color: 0x77573a });
    const group = new THREE.Group();

    // Arc of rustic fence behind the shooting lane.
    const radius = 33;
    const from = -1.25, to = 1.25; // radians
    const arcLen = (to - from) * radius;
    const segments = Math.floor(arcLen / 2.4);
    for (let i = 0; i <= segments; i++) {
      const a = from + (i / segments) * (to - from);
      const x = Math.sin(a) * radius;
      const z = -Math.cos(a) * radius;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 1.15, 0.16), woodMat2);
      post.position.set(x, 0.55 + rand(-0.03, 0.03), z);
      post.rotation.y = a + rand(-0.05, 0.05);
      post.castShadow = true;
      post.userData.impactType = 'wood';
      group.add(post);
      this.raycastTargets.push(post);
    }
    for (let i = 0; i < segments; i++) {
      const a0 = from + (i / segments) * (to - from);
      const a1 = from + ((i + 1) / segments) * (to - from);
      const am = (a0 + a1) / 2;
      const x = Math.sin(am) * radius;
      const z = -Math.cos(am) * radius;
      const len = (a1 - a0) * radius + 0.12;
      for (const y of [0.45, 0.86]) {
        const rail = new THREE.Mesh(new THREE.BoxGeometry(0.07, 0.14, len), woodMat);
        rail.position.set(x, y + rand(-0.015, 0.015), z);
        rail.rotation.y = am;
        rail.castShadow = true;
        rail.userData.impactType = 'wood';
        group.add(rail);
        this.raycastTargets.push(rail);
      }
    }
    this.scene.add(group);
  }

  // ---------------------------------------------------------------- rocks --
  _buildRocks() {
    const mat = new THREE.MeshLambertMaterial({ color: 0x8d8d90, flatShading: true });
    for (let i = 0; i < 9; i++) {
      const a = rand(-Math.PI, Math.PI);
      const r = rand(11, 42);
      const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(rand(0.35, 1.0), 0), mat);
      rock.position.set(Math.sin(a) * r, rand(0.05, 0.2), -Math.cos(a) * r);
      rock.scale.y = rand(0.55, 0.8);
      rock.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      rock.castShadow = true;
      rock.receiveShadow = true;
      rock.userData.impactType = 'rock';
      this.scene.add(rock);
      this.raycastTargets.push(rock);
    }
  }

  // --------------------------------------------------------------- clouds --
  _buildClouds() {
    const mat = new THREE.MeshLambertMaterial({
      color: 0xffffff, transparent: true, opacity: 0.88, fog: false,
    });
    for (let i = 0; i < 7; i++) {
      const cloud = new THREE.Group();
      const blobs = randInt(4, 6);
      for (let b = 0; b < blobs; b++) {
        const m = new THREE.Mesh(new THREE.SphereGeometry(rand(2.2, 4.5), 10, 8), mat);
        m.position.set(rand(-4, 4), rand(-0.6, 0.9), rand(-2, 2));
        m.scale.y = 0.45;
        cloud.add(m);
      }
      cloud.position.set(rand(-140, 140), rand(28, 52), rand(-140, 60));
      cloud.userData.speed = rand(0.6, 1.6);
      this.scene.add(cloud);
      this.clouds.push(cloud);
    }
  }

  // --------------------------------------------------------------- update --
  update(dt, t) {
    this.uniforms.uTime.value = t;
    for (const cloud of this.clouds) {
      cloud.position.x += cloud.userData.speed * dt;
      if (cloud.position.x > 160) cloud.position.x = -160;
    }
  }
}
