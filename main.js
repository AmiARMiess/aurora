/* =============================================================
   Aurora — main.js
   Three.js hero scene + page interactions.

   Scene contents
   - noise-displaced iridescent core (custom GLSL)
   - wireframe shell + 3 orbiting rings
   - particle starfield + constellation lines
   - UnrealBloom post-processing

   Interaction
   - pointer parallax + raycast hover on the core
   - scroll-driven camera dolly / rotation
   - perf: pixel-ratio cap, visibility pause, reduced-motion
   ============================================================= */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/* ---------- helpers ---------- */
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);

/** Frame-rate independent easing factor for exponential smoothing. */
const damp = (rate, dt) => 1 - Math.pow(rate, dt);

const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const FINE_POINTER = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
const isMobile = window.matchMedia('(max-width: 820px)').matches;
const isLowEnd = isMobile || (navigator.hardwareConcurrency || 8) <= 4;

/* ---------- shared state ---------- */
const timer = new THREE.Timer();
timer.connect(document); // also resets deltas across tab switches

const pointer = new THREE.Vector2(0, 0);        // raw target, -1..1
const pointerSmooth = new THREE.Vector2(0, 0);  // smoothed
const scroll = { target: 0, current: 0 };

const PALETTE = {
  violet: new THREE.Color('#6d8cff'),
  magenta: new THREE.Color('#c471ed'),
  cyan: new THREE.Color('#35e0d4'),
  peach: new THREE.Color('#ffb066'),
  white: new THREE.Color('#ffffff'),
};

/* =============================================================
   1. UI — preloader, nav, reveal, counters, tilt
   ============================================================= */
const ui = {
  preloader: document.getElementById('preloader'),
  bar: document.getElementById('loader-bar'),
  pct: document.getElementById('loader-pct'),
  nav: document.getElementById('nav'),
  menu: document.getElementById('nav-menu'),
  toggle: document.getElementById('nav-toggle'),
  year: document.getElementById('year'),
};

/* ---- preloader ---- */
let loadProgress = 0;

function setProgress(value) {
  loadProgress = Math.max(loadProgress, value);
  const pct = Math.round(loadProgress * 100);
  if (ui.bar) ui.bar.style.width = pct + '%';
  if (ui.pct) ui.pct.textContent = String(pct);
}

function hidePreloader() {
  if (!document.body.classList.contains('is-loading')) return;
  // The module booted, so the inline failsafe timer is no longer needed.
  clearTimeout(window.__auroraFailsafe);
  document.body.classList.remove('is-loading');
  document.body.classList.add('scene-ready');
  setProgress(1);
  setTimeout(() => {
    ui.preloader?.classList.add('is-done');
    // stagger the above-the-fold reveals for a deliberate entrance
    document
      .querySelectorAll('#hero [data-reveal]')
      .forEach((el, i) => revealNow(el, 700 + i * 90));
  }, 240);
}

/* ---- scroll reveal ---- */
function revealNow(el, extra = 0) {
  const base = parseInt(el.getAttribute('data-reveal-delay') || '0', 10);
  el.style.setProperty('--reveal-delay', base + extra + 'ms');
  el.classList.add('is-visible');
}

const revealObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      revealNow(entry.target);
      revealObserver.unobserve(entry.target);
    });
  },
  { rootMargin: '0px 0px -12% 0px', threshold: 0.15 }
);
document.querySelectorAll('[data-reveal]').forEach((el) => revealObserver.observe(el));

/* ---- animated counters ---- */
const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

function animateCount(el) {
  const target = parseFloat(el.dataset.count || '0');
  const suffix = el.dataset.suffix || '';

  if (REDUCED_MOTION || target === 0) {
    el.textContent = target.toLocaleString() + suffix;
    return;
  }

  const duration = 1500;
  const start = performance.now();

  const tick = (now) => {
    const t = clamp((now - start) / duration, 0, 1);
    el.textContent = Math.round(easeOutExpo(t) * target).toLocaleString() + suffix;
    if (t < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

const countObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCount(entry.target);
      countObserver.unobserve(entry.target);
    });
  },
  { threshold: 0.5 }
);
document.querySelectorAll('[data-count]').forEach((el) => countObserver.observe(el));

/* ---- sticky nav + scroll progress + active section ---- */
const navLinks = [...document.querySelectorAll('.nav__menu a')];
const sections = navLinks.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);

function onScroll() {
  const y = window.scrollY;
  ui.nav?.classList.toggle('is-stuck', y > 24);

  const total = document.documentElement.scrollHeight - window.innerHeight;
  scroll.target = total > 0 ? clamp(y / total, 0, 1) : 0;
}

let scrollTicking = false;
window.addEventListener(
  'scroll',
  () => {
    if (scrollTicking) return;
    scrollTicking = true;
    requestAnimationFrame(() => {
      onScroll();
      scrollTicking = false;
    });
  },
  { passive: true }
);
onScroll();

const spyObserver = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      const id = '#' + entry.target.id;
      navLinks.forEach((a) => {
        const active = a.getAttribute('href') === id;
        if (active) a.setAttribute('aria-current', 'true');
        else a.removeAttribute('aria-current');
        a.style.color = active ? 'var(--text)' : '';
      });
    });
  },
  { rootMargin: '-45% 0px -50% 0px' }
);
sections.forEach((s) => spyObserver.observe(s));

/* ---- mobile menu ---- */
function closeMenu() {
  if (!ui.menu?.classList.contains('is-open')) return;
  ui.menu.classList.remove('is-open');
  ui.toggle?.setAttribute('aria-expanded', 'false');
  ui.toggle?.setAttribute('aria-label', 'Open menu');
  document.body.classList.remove('nav-open');
}

ui.toggle?.addEventListener('click', () => {
  const open = ui.menu.classList.toggle('is-open');
  ui.toggle.setAttribute('aria-expanded', String(open));
  ui.toggle.setAttribute('aria-label', open ? 'Close menu' : 'Open menu');
  document.body.classList.toggle('nav-open', open);
});

ui.menu?.querySelectorAll('a').forEach((a) => a.addEventListener('click', closeMenu));
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') closeMenu();
});
window.addEventListener('resize', () => {
  if (window.innerWidth > 820) closeMenu();
});

/* ---- pointer-tracked glow + 3D tilt ---- */
if (FINE_POINTER && !REDUCED_MOTION) {
  document.querySelectorAll('[data-tilt]').forEach((el) => {
    const MAX_TILT = 7;

    el.addEventListener('pointermove', (e) => {
      const r = el.getBoundingClientRect();
      const px = (e.clientX - r.left) / r.width;
      const py = (e.clientY - r.top) / r.height;

      // the glow follows the cursor, on the card itself or its wrapper
      const glowHost = el.classList.contains('card') ? el : el.querySelector('.card') || el;
      glowHost.style.setProperty('--mx', px * 100 + '%');
      glowHost.style.setProperty('--my', py * 100 + '%');

      el.style.transform =
        'perspective(900px) rotateX(' +
        (0.5 - py) * MAX_TILT +
        'deg) rotateY(' +
        (px - 0.5) * MAX_TILT +
        'deg) translateZ(14px)';
    });

    el.addEventListener('pointerleave', () => {
      el.style.transform = '';
    });
  });
}

/* ---- global pointer tracking for the scene ---- */
if (FINE_POINTER) {
  window.addEventListener(
    'pointermove',
    (e) => {
      pointer.x = (e.clientX / window.innerWidth) * 2 - 1;
      pointer.y = -((e.clientY / window.innerHeight) * 2 - 1);
    },
    { passive: true }
  );
}

if (ui.year) ui.year.textContent = String(new Date().getFullYear());

/* =============================================================
   2. Three.js scene
   ============================================================= */
const canvas = document.getElementById('scene');

let renderer = null;
try {
  renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: !isLowEnd,
    alpha: true,
    powerPreference: 'high-performance',
  });
} catch (err) {
  console.warn('[aurora] WebGL unavailable — falling back to the CSS backdrop.', err);
}

/* Ashima-style 3D simplex noise, injected into the shaders that need it. */
const NOISE_GLSL = /* glsl */ `
  vec3 mod289(vec3 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x){ return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x){ return mod289(((x * 34.0) + 1.0) * x); }
  vec4 taylorInvSqrt(vec4 r){ return 1.79284291400159 - 0.85373472095314 * r; }

  float snoise(vec3 v){
    const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);

    vec3 i  = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);

    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);

    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;

    i = mod289(i);
    vec4 p = permute(permute(permute(
               i.z + vec4(0.0, i1.z, i2.z, 1.0))
             + i.y + vec4(0.0, i1.y, i2.y, 1.0))
             + i.x + vec4(0.0, i1.x, i2.x, 1.0));

    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;

    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);

    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);

    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);

    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);

    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));

    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;

    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);

    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;

    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
  }
`;

/* Boot after every module-level const is initialised, so the shaders that
   reference NOISE_GLSL are safe to compile. */
if (renderer) {
  initScene();
} else {
  document.body.classList.add('no-webgl');
  hidePreloader();
}

function initScene() {
  setProgress(0.2);

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEnd ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 120);
  camera.position.set(0, 0, 6.4);

  const world = new THREE.Group();
  scene.add(world);

  const core = new THREE.Group();
  world.add(core);

  /* ---------- 2a. Core: noise-displaced iridescent sphere ---------- */
  const coreUniforms = {
    uTime: { value: 0 },
    uHover: { value: 0 },
    uPointer: { value: new THREE.Vector3(0, 0, 1) },
    uColA: { value: PALETTE.violet.clone() },
    uColB: { value: PALETTE.magenta.clone() },
    uColC: { value: PALETTE.cyan.clone() },
  };

  const coreMaterial = new THREE.ShaderMaterial({
    uniforms: coreUniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uHover;
      uniform vec3  uPointer;

      ${NOISE_GLSL}

      varying vec3  vNormalV;
      varying vec3  vViewDir;
      varying float vNoise;

      void main() {
        vec3 p = normalize(position);

        // layered noise -> organic, breathing surface
        float n1 = snoise(p * 1.55 + vec3(0.0, 0.0, uTime * 0.22));
        float n2 = snoise(p * 3.10 + vec3(uTime * 0.16, uTime * 0.11, 0.0));
        float n  = n1 * 0.68 + n2 * 0.32;

        float amp = 0.26 + uHover * 0.16;
        vec3  pos = p * (1.16 + n * amp);

        // local magnetic pull toward the pointer
        vec3 toPointer = normalize(uPointer);
        float influence = smoothstep(1.1, 0.0, distance(p, toPointer));
        pos += toPointer * influence * (0.10 + uHover * 0.22);

        vNoise = n;

        vec4 mv = modelViewMatrix * vec4(pos, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);

        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3  uColA;
      uniform vec3  uColB;
      uniform vec3  uColC;
      uniform float uHover;

      varying vec3  vNormalV;
      varying vec3  vViewDir;
      varying float vNoise;

      void main() {
        vec3 N = normalize(vNormalV);
        vec3 V = normalize(vViewDir);

        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 2.6);

        // iridescent ramp driven by the surface noise
        float t = fract(vNoise * 0.9 + 0.5);
        vec3 base = mix(uColA, uColB, smoothstep(0.0, 0.62, t));
        base = mix(base, uColC, smoothstep(0.60, 1.0, t) * 0.8);

        // Blinn-style specular against a fixed key light
        vec3 L = normalize(vec3(0.55, 0.85, 0.75));
        vec3 H = normalize(L + V);
        float spec = pow(max(dot(N, H), 0.0), 46.0);

        // cool from above, warmer below
        float wrap = smoothstep(-0.75, 0.95, N.y) * 0.4 + 0.6;
        vec3 color = base * wrap;

        color += spec * vec3(1.0, 0.94, 0.86) * 0.85;
        color += fres * mix(uColB, uColC, 0.5) * (0.8 + uHover * 0.7);
        color *= 0.82 + uHover * 0.22;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });

  const coreMesh = new THREE.Mesh(new THREE.IcosahedronGeometry(1, isLowEnd ? 48 : 96), coreMaterial);
  core.add(coreMesh);

  /* ---------- 2b. Wireframe shell ---------- */
  const shellUniforms = {
    uTime: { value: 0 },
    uColor: { value: PALETTE.violet.clone() },
  };

  const shellMaterial = new THREE.ShaderMaterial({
    uniforms: shellUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying float vFade;
      void main() {
        vFade = 0.55 + 0.45 * sin(uTime * 1.6 + position.y * 3.0);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vFade;
      void main() { gl_FragColor = vec4(uColor, vFade * 0.16); }
    `,
  });

  const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.62, 3), shellMaterial);
  core.add(shell);

/* ---------- 2c. Orbiting rings ---------- */
  const ringSpecs = [
    { r: 2.05, tube: 0.013, color: PALETTE.cyan, speed: 0.42, tilt: [1.28, 0.15, 0.2] },
    { r: 2.45, tube: 0.010, color: PALETTE.magenta, speed: -0.3, tilt: [1.05, -0.5, 0.6] },
    { r: 2.9, tube: 0.008, color: PALETTE.violet, speed: 0.22, tilt: [1.62, 0.35, -0.3] },
  ];

  const rings = ringSpecs.map((spec) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(spec.r, spec.tube, 8, 220),
      new THREE.MeshBasicMaterial({
        color: spec.color,
        transparent: true,
        opacity: 0.42,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    ring.rotation.set(...spec.tilt);
    ring.userData.speed = spec.speed;
    core.add(ring);
    return ring;
  });

  /* ---------- 2d. Starfield ---------- */
  const STAR_COUNT = isLowEnd ? 700 : 1600;
  const starPos = new Float32Array(STAR_COUNT * 3);
  const starCol = new Float32Array(STAR_COUNT * 3);
  const starSize = new Float32Array(STAR_COUNT);
  const starPhase = new Float32Array(STAR_COUNT);

  const starPalette = [PALETTE.violet, PALETTE.cyan, PALETTE.magenta, PALETTE.peach, PALETTE.white];
  const tmpColor = new THREE.Color();

  for (let i = 0; i < STAR_COUNT; i++) {
    // shell distribution so the stars surround the core
    const radius = rand(5.5, 30);
    const theta = rand(0, Math.PI * 2);
    const phi = Math.acos(rand(-1, 1));

    starPos[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = radius * Math.cos(phi) * 0.72;
    starPos[i * 3 + 2] = radius * Math.sin(phi) * Math.sin(theta);

    tmpColor.copy(starPalette[(Math.random() * starPalette.length) | 0]);
    starCol[i * 3] = tmpColor.r;
    starCol[i * 3 + 1] = tmpColor.g;
    starCol[i * 3 + 2] = tmpColor.b;

    starSize[i] = rand(1.1, 4.4);
    starPhase[i] = rand(0, Math.PI * 2);
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('aColor', new THREE.BufferAttribute(starCol, 3));
  starGeo.setAttribute('aSize', new THREE.BufferAttribute(starSize, 1));
  starGeo.setAttribute('aPhase', new THREE.BufferAttribute(starPhase, 1));

  const starUniforms = {
    uTime: { value: 0 },
    uPixelRatio: { value: renderer.getPixelRatio() },
  };

  const starMaterial = new THREE.ShaderMaterial({
    uniforms: starUniforms,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      attribute vec3  aColor;
      attribute float aSize;
      attribute float aPhase;

      uniform float uTime;
      uniform float uPixelRatio;

      varying vec3  vColor;
      varying float vTwinkle;

      void main() {
        vColor = aColor;

        // gentle drift
        vec3 p = position;
        p.x += sin(uTime * 0.14 + aPhase) * 0.28;
        p.y += cos(uTime * 0.11 + aPhase * 1.7) * 0.28;

        vec4 mv = modelViewMatrix * vec4(p, 1.0);

        float twinkle = 0.55 + 0.45 * sin(uTime * 1.9 + aPhase * 3.1);
        vTwinkle = twinkle;

        gl_PointSize = aSize * uPixelRatio * twinkle * (34.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      varying vec3  vColor;
      varying float vTwinkle;

      void main() {
        // soft disc with a hot core
        float d = length(gl_PointCoord - vec2(0.5));
        float glow = smoothstep(0.5, 0.0, d);
        float core = smoothstep(0.22, 0.0, d);
        float alpha = glow * glow * 0.75 + core * 0.9;

        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor * (0.85 + core * 1.2), alpha * vTwinkle);
      }
    `,
  });

  const stars = new THREE.Points(starGeo, starMaterial);
  world.add(stars);

/* ---------- 2e. Constellation lines ---------- */
  const LINK_COUNT = isLowEnd ? 0 : 46;
  let links = null;

  if (LINK_COUNT > 0) {
    const linePositions = [];

    for (let i = 0; i < LINK_COUNT; i++) {
      const a = (Math.random() * STAR_COUNT) | 0;
      let best = -1;
      let bestDist = Infinity;

      // link each star to its nearest sampled neighbour, skipping long jumps
      for (let k = 0; k < 24; k++) {
        const c = (Math.random() * STAR_COUNT) | 0;
        if (c === a) continue;

        const dx = starPos[a * 3] - starPos[c * 3];
        const dy = starPos[a * 3 + 1] - starPos[c * 3 + 1];
        const dz = starPos[a * 3 + 2] - starPos[c * 3 + 2];
        const d = dx * dx + dy * dy + dz * dz;

        if (d > 1.5 && d < bestDist) {
          bestDist = d;
          best = c;
        }
      }

      if (best === -1) continue;

      linePositions.push(
        starPos[a * 3], starPos[a * 3 + 1], starPos[a * 3 + 2],
        starPos[best * 3], starPos[best * 3 + 1], starPos[best * 3 + 2]
      );
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

    links = new THREE.LineSegments(
      lineGeo,
      new THREE.LineBasicMaterial({
        color: PALETTE.violet,
        transparent: true,
        opacity: 0.2,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
    );
    world.add(links);
  }

  /* ---------- 2f. Post-processing ---------- */
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const BLOOM_STRENGTH = 0.4;
  const bloom = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM_STRENGTH,
    0.62, // radius
    0.55  // threshold
  );
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  /* ---------- 2g. Raycast hover ---------- */
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2(0, 0);
  let hover = 0;
  let hoverTarget = 0;

  function updateHover() {
    if (!FINE_POINTER) return;
    raycaster.setFromCamera(ndc.set(pointerSmooth.x, pointerSmooth.y), camera);
    hoverTarget = raycaster.intersectObject(coreMesh, false).length > 0 ? 1 : 0;
  }

  /* ---------- 2h. Resize ---------- */
  function resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;

    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isLowEnd ? 1.5 : 2));
    renderer.setSize(w, h);
    composer.setSize(w, h);
    bloom.setSize(w, h);
    starUniforms.uPixelRatio.value = renderer.getPixelRatio();
  }

  let resizeRaf = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(resize);
  });

  /* ---------- 2i. Visibility pause ---------- */
  let running = true;
  document.addEventListener('visibilitychange', () => {
    running = !document.hidden;
    if (running) {
      timer.reset();
      requestAnimationFrame(animate);
    }
  });

/* ---------- 2j. Animation loop ---------- */
  const camBase = new THREE.Vector3(0, 0, 6.4);
  const camTarget = new THREE.Vector3();
  const pointerDir = new THREE.Vector3();
  let firstFrame = true;

  // Stage the core to the side of the copy on wide screens so the headline
  // always sits on a clean, dark background; centre it above the copy on mobile.
  const coreHome = new THREE.Vector3(
    isMobile ? 0 : 2.0,
    isMobile ? 1.15 : 0.05,
    0
  );
  core.scale.setScalar(isMobile ? 0.78 : 1);

  function animate() {
    if (!running) return;
    requestAnimationFrame(animate);

    timer.update();
    const dt = Math.min(timer.getDelta(), 0.05);
    const t = timer.getElapsed();

    // smooth all continuous inputs
    pointerSmooth.lerp(pointer, damp(0.0015, dt));
    scroll.current = lerp(scroll.current, scroll.target, damp(0.002, dt));
    hover = lerp(hover, hoverTarget, damp(0.006, dt));

    /* --- object animation --- */
    if (!REDUCED_MOTION) {
      coreMesh.rotation.y = t * 0.16;
      coreMesh.rotation.x = Math.sin(t * 0.24) * 0.16;

      shell.rotation.y = -t * 0.1;
      shell.rotation.z = t * 0.06;
      shell.scale.setScalar(1 + Math.sin(t * 0.9) * 0.012);

      rings.forEach((ring, i) => {
        ring.rotation.z += ring.userData.speed * dt * (i + 1) * 0.6;
        ring.rotation.x += ring.userData.speed * dt * 0.25;
      });

      stars.rotation.y = t * 0.012;
      if (links) links.rotation.y = stars.rotation.y;
    }

    /* --- shader uniforms --- */
    coreUniforms.uTime.value = t;
    coreUniforms.uHover.value = hover;
    shellUniforms.uTime.value = t;
    starUniforms.uTime.value = t;

    // pointer direction in the core's local space, for the magnetic pull
    pointerDir
      .set(pointerSmooth.x * 1.3, pointerSmooth.y * 1.3, 1.0)
      .applyQuaternion(core.quaternion)
      .normalize();
    coreUniforms.uPointer.value.lerp(pointerDir, damp(0.01, dt));

    /* --- scroll-driven staging --- */
    const s = scroll.current;

    // as the page scrolls, the core drifts left and up, revealing the starfield
    core.position.set(
      lerp(coreHome.x, isMobile ? 0 : -1.6, s),
      lerp(coreHome.y, 2.2, s),
      lerp(0, -1.6, s)
    );
    world.rotation.y = lerp(0, 0.55, s) + pointerSmooth.x * 0.12;

    camTarget.copy(camBase);
    camTarget.x = lerp(0, -1.4, s) + pointerSmooth.x * (0.85 - s * 0.45);
    camTarget.y = lerp(0, 0.9, s) - pointerSmooth.y * (0.6 - s * 0.3);
    camTarget.z = camBase.z + s * 2.6;
    camera.position.lerp(camTarget, damp(0.004, dt));

    camera.lookAt(core.position.x * 0.3, core.position.y * 0.3, 0);

    // bloom eases off deeper into the page
    bloom.strength = lerp(BLOOM_STRENGTH, 0.26, s);

    updateHover();
    composer.render();

    // Reveal the page as soon as we have actually drawn a frame.
    if (firstFrame) {
      firstFrame = false;
      hidePreloader();
    }
  }

  /* ---------- 2k. Start ---------- */
  setProgress(0.55);
  resize();

  // Compile shaders up-front so the first visible frame is already correct.
  if (renderer.compileAsync) {
    renderer.compileAsync(scene, camera).catch((err) => console.warn('[aurora] compile', err));
  } else {
    renderer.compile(scene, camera);
  }
  composer.render();
  setProgress(0.85);

  requestAnimationFrame(animate);

  // Safety net: requestAnimationFrame is paused in background tabs and on
  // low-power devices. Never strand the visitor behind the preloader.
  setTimeout(hidePreloader, 2500);
}

/* Never leave the preloader stuck if something unexpected fails. */
window.addEventListener('error', () => {
  if (document.body.classList.contains('is-loading')) hidePreloader();
});
