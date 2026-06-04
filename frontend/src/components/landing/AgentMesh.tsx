import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

/**
 * AgentMesh — the landing hero's WebGL centerpiece.
 *
 * The motion *is* the explanation. A network of agent nodes continuously
 * hires one another; you should read the product from the animation alone:
 *
 *   • nodes              = agents
 *   • cream/gold packet → = an agent posts an (encrypted) task to another
 *   • cream/gold pulse    = the worker receives & does the work
 *   • ink packet      →  = settlement flowing back (black on light, white on dark)
 *   • ink pulse           = the first agent gets paid
 *
 * Many out-and-back exchanges at once = a *marketplace* of agents transacting.
 *
 * THEME-AWARE: the brand palette only has two accents — cream/gold
 * (--bb-cream) and ink (--bb-ink) — so the whole scene is drawn in those.
 * Crucially, blending switches with the theme: additive on dark (glow), but
 * normal on light, because additive blending washes out to nothing on a
 * white background (white + anything = white) — which is why links and nodes
 * were invisible in light mode.
 *
 * Built on raw three.js (single dependency). Good citizen: honours
 * prefers-reduced-motion, pauses offscreen / when hidden, caps DPR at 2,
 * resizes via ResizeObserver, disposes everything on unmount.
 */
export function AgentMesh({ className = '' }: { className?: string }) {
  const mountRef = useRef<HTMLDivElement>(null);
  // Bumped whenever the theme flips, so the scene rebuilds with the new
  // palette/blending instead of staying stuck at its mount-time theme.
  const [themeTick, setThemeTick] = useState(0);

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeTick((n) => n + 1));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    // ── Theme resolution ────────────────────────────────────────────
    const css = (name: string, fb: string) =>
      getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fb;
    const bgStr = css('--bb-bg', '#09090b');
    const isDark = hexLuminance(bgStr) < 0.5;

    const cream = new THREE.Color(css('--bb-cream', isDark ? '#f5efe0' : '#b8860b')); // task / work (the accent)
    const ink = new THREE.Color(css('--bb-ink', isDark ? '#fafaf9' : '#09090b'));     // globe dots + settlement

    // Blending + per-theme weights. Additive glows on dark; on light it would
    // wash to white, so we use normal blending — but soft translucent dots
    // then read as muddy smudges, so light mode gets crisper, smaller, more
    // opaque dots, a touch stronger wireframe, and almost no dust.
    const blending = isDark ? THREE.AdditiveBlending : THREE.NormalBlending;
    const linkColor = ink.clone();                       // faint great-circle net
    const linkBaseOpacity = isDark ? 0.09 : 0.13;
    const linkSwing = isDark ? 0.05 : 0.05;
    const nodeOpacity = isDark ? 0.7 : 0.9;              // crisp, defined dots on light
    const nodeSize = isDark ? 0.34 : 0.22;              // smaller on light → no smudgy blobs
    const dustOpacity = isDark ? 0.22 : 0.04;           // dust reads as dirt on white — almost hide it

    // ── Scene / camera / renderer ───────────────────────────────────
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(hexToInt(bgStr, 0x09090b), 0.03);

    // Pulled back so the entire globe (radius ~6.8) fits within the viewport
    // height with margin — poles included, not clipped at top/bottom.
    const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 100);
    camera.position.z = 16.5;

    // WebGL can be unavailable: Brave/Firefox fingerprint shields, hardware
    // acceleration switched off, locked-down or headless browsers, old GPUs.
    // The WebGLRenderer constructor THROWS in that case — and with no error
    // boundary above this component, that throw unmounts the entire React tree
    // and blanks the whole landing page. Degrade gracefully instead: skip the
    // globe and let the page render on its plain background.
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    } catch (err) {
      console.warn('[AgentMesh] WebGL unavailable — skipping globe background.', err);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0); // transparent — page bg shows through
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';
    renderer.domElement.style.width = '100%';
    renderer.domElement.style.height = '100%';

    // ── Textures (single white dot/ring; tint via material.color) ───
    const dot = makeDotTexture();
    const ringTex = makeRingTexture();

    // ── Agent nodes — even points on the sphere SURFACE (fibonacci), so
    //    the silhouette reads as a clean rotating globe rather than a
    //    volumetric cloud. A tiny radial jitter keeps it from feeling
    //    mechanical. ─────────────────────────────────────────────────
    const NODE_COUNT = 150;
    const RADIUS = 6.8;
    const LINK_DIST = 2.2;
    const GOLDEN = Math.PI * (1 + Math.sqrt(5));

    const nodes: THREE.Vector3[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      const y = 1 - (i / (NODE_COUNT - 1)) * 2; // 1 → -1
      const rxy = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = GOLDEN * i;
      const rr = RADIUS * (0.98 + 0.04 * pseudoRandom(i));
      nodes.push(new THREE.Vector3(Math.cos(theta) * rxy * rr, y * rr, Math.sin(theta) * rxy * rr));
    }

    const group = new THREE.Group();
    scene.add(group);

    const nodePositions = new Float32Array(NODE_COUNT * 3);
    nodes.forEach((n, i) => { nodePositions.set([n.x, n.y, n.z], i * 3); });
    const nodeGeo = new THREE.BufferGeometry();
    nodeGeo.setAttribute('position', new THREE.BufferAttribute(nodePositions, 3));
    const nodeMat = new THREE.PointsMaterial({
      size: nodeSize, map: dot, transparent: true, depthWrite: false,
      blending, color: ink, opacity: nodeOpacity,
    });
    group.add(new THREE.Points(nodeGeo, nodeMat));

    // ── Links + edge list (the "wires" packets travel along) ────────
    const edges: Array<[number, number]> = [];
    const linkVerts: number[] = [];
    for (let i = 0; i < NODE_COUNT; i++) {
      for (let j = i + 1; j < NODE_COUNT; j++) {
        if (nodes[i].distanceTo(nodes[j]) < LINK_DIST) {
          edges.push([i, j]);
          linkVerts.push(nodes[i].x, nodes[i].y, nodes[i].z, nodes[j].x, nodes[j].y, nodes[j].z);
        }
      }
    }
    const linkGeo = new THREE.BufferGeometry();
    linkGeo.setAttribute('position', new THREE.Float32BufferAttribute(linkVerts, 3));
    const linkMat = new THREE.LineBasicMaterial({
      color: linkColor, transparent: true, opacity: linkBaseOpacity,
      blending, depthWrite: false,
    });
    group.add(new THREE.LineSegments(linkGeo, linkMat));

    // ── Outer dust shell (depth) ────────────────────────────────────
    const DUST = 260;
    const dustPos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const t = i / DUST;
      const phi = Math.acos(1 - 2 * t);
      const theta = Math.PI * (1 + Math.sqrt(5)) * i;
      const r = RADIUS * (1.15 + 0.5 * pseudoRandom(i + 7.3));
      dustPos.set([
        r * Math.sin(phi) * Math.cos(theta),
        r * Math.sin(phi) * Math.sin(theta),
        r * Math.cos(phi),
      ], i * 3);
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
    const dustMat = new THREE.PointsMaterial({
      size: 0.11, map: dot, transparent: true, depthWrite: false,
      blending, color: ink, opacity: dustOpacity,
    });
    const dustGroup = new THREE.Group();
    dustGroup.add(new THREE.Points(dustGeo, dustMat));
    scene.add(dustGroup);

    // ── Packet pool — traveling task (cream) / settlement (ink) ─────
    const taskMat = new THREE.SpriteMaterial({
      map: dot, color: cream, transparent: true, depthWrite: false, blending,
    });
    const settleMat = new THREE.SpriteMaterial({
      map: dot, color: ink, transparent: true, depthWrite: false, blending,
    });

    interface Packet { sprite: THREE.Sprite; from: THREE.Vector3; to: THREE.Vector3; t: number; dur: number; kind: 'task' | 'settle'; active: boolean; }
    const MAX_PACKETS = 18;
    const packets: Packet[] = [];
    for (let i = 0; i < MAX_PACKETS; i++) {
      const sprite = new THREE.Sprite(taskMat);
      sprite.visible = false;
      group.add(sprite);
      packets.push({ sprite, from: new THREE.Vector3(), to: new THREE.Vector3(), t: 0, dur: 1, kind: 'task', active: false });
    }

    // ── Ring-pulse pool — arrival flashes at receiving agents ───────
    interface Pulse { sprite: THREE.Sprite; mat: THREE.SpriteMaterial; age: number; life: number; active: boolean; }
    const MAX_PULSES = 14;
    const pulses: Pulse[] = [];
    for (let i = 0; i < MAX_PULSES; i++) {
      const mat = new THREE.SpriteMaterial({
        map: ringTex, color: cream, transparent: true, depthWrite: false, blending, opacity: 0,
      });
      const sprite = new THREE.Sprite(mat);
      sprite.visible = false;
      group.add(sprite);
      pulses.push({ sprite, mat, age: 0, life: 0.7, active: false });
    }
    const pulseOpacity = isDark ? 0.5 : 0.4;

    const firePulse = (pos: THREE.Vector3, color: THREE.Color) => {
      const p = pulses.find((x) => !x.active);
      if (!p) return;
      p.active = true;
      p.age = 0;
      p.mat.color.copy(color);
      p.sprite.position.copy(pos);
      p.sprite.visible = true;
    };

    const spawnPacket = (from: THREE.Vector3, to: THREE.Vector3, kind: 'task' | 'settle') => {
      const p = packets.find((x) => !x.active);
      if (!p) return;
      p.active = true;
      p.t = 0;
      p.dur = 1.4 + Math.random() * 0.8;
      p.kind = kind;
      p.from.copy(from);
      p.to.copy(to);
      p.sprite.material = kind === 'task' ? taskMat : settleMat;
      p.sprite.visible = true;
    };

    const startExchange = () => {
      if (!edges.length) return;
      const [a, b] = edges[(Math.random() * edges.length) | 0];
      const [from, to] = Math.random() < 0.5 ? [a, b] : [b, a];
      spawnPacket(nodes[from], nodes[to], 'task');
    };

    // ── Pointer parallax ────────────────────────────────────────────
    const pointer = { x: 0, y: 0 };
    const targetP = { x: 0, y: 0 };
    const onPointerMove = (e: PointerEvent) => {
      const rect = mount.getBoundingClientRect();
      targetP.x = ((e.clientX - rect.left) / rect.width - 0.5) * 2;
      targetP.y = ((e.clientY - rect.top) / rect.height - 0.5) * 2;
    };
    window.addEventListener('pointermove', onPointerMove, { passive: true });

    // ── Sizing ──────────────────────────────────────────────────────
    const resize = () => {
      const w = mount.clientWidth || 1;
      const h = mount.clientHeight || 1;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    // ── Loop ────────────────────────────────────────────────────────
    let raf = 0;
    let running = false;
    let visible = true;
    let t = 0;
    let spawnTimer = 0;
    const tmp = new THREE.Vector3();

    const updateTraffic = (dt: number) => {
      spawnTimer -= dt;
      if (spawnTimer <= 0) {
        startExchange();
        spawnTimer = 0.5 + Math.random() * 0.45;
      }

      for (const p of packets) {
        if (!p.active) continue;
        p.t += dt / p.dur;
        if (p.t >= 1) {
          firePulse(p.to, p.kind === 'task' ? cream : ink);
          if (p.kind === 'task') spawnPacket(p.to, p.from, 'settle');
          p.active = false;
          p.sprite.visible = false;
          continue;
        }
        const e = easeInOut(p.t);
        tmp.lerpVectors(p.from, p.to, e);
        p.sprite.position.copy(tmp);
        const s = (0.34 + 0.22 * Math.sin(p.t * Math.PI)) * (p.kind === 'task' ? 1 : 0.85);
        p.sprite.scale.setScalar(s);
      }

      for (const p of pulses) {
        if (!p.active) continue;
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) { p.active = false; p.sprite.visible = false; continue; }
        p.sprite.scale.setScalar(0.4 + k * 2.4);
        p.mat.opacity = (1 - k) * pulseOpacity;
      }
    };

    const renderFrame = (dt: number) => {
      group.rotation.y = t * 0.06;
      group.rotation.x = 0.34; // fixed axial tilt — reads as a spinning globe, not a wobble
      dustGroup.rotation.y = -t * 0.02;

      pointer.x += (targetP.x - pointer.x) * 0.04;
      pointer.y += (targetP.y - pointer.y) * 0.04;
      group.rotation.y += pointer.x * 0.22;
      group.rotation.x += pointer.y * 0.16;

      linkMat.opacity = linkBaseOpacity + linkSwing * (0.5 + 0.5 * Math.sin(t * 0.8));

      if (!reduceMotion) updateTraffic(dt);

      renderer.render(scene, camera);
    };

    const loop = () => {
      raf = requestAnimationFrame(loop);
      const dt = 1 / 60;
      t += dt;
      renderFrame(dt);
    };

    const start = () => {
      if (running || reduceMotion || !visible) return;
      running = true;
      raf = requestAnimationFrame(loop);
    };
    const stop = () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    };

    const io = new IntersectionObserver(
      ([entry]) => { entry.isIntersecting ? start() : stop(); },
      { threshold: 0.01 },
    );
    io.observe(mount);

    const onVisibility = () => {
      visible = document.visibilityState === 'visible';
      visible ? start() : stop();
    };
    document.addEventListener('visibilitychange', onVisibility);

    if (!reduceMotion) for (let i = 0; i < 4; i++) startExchange();
    renderFrame(0);
    start();

    // ── Teardown ────────────────────────────────────────────────────
    return () => {
      stop();
      io.disconnect();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pointermove', onPointerMove);
      nodeGeo.dispose();
      nodeMat.dispose();
      linkGeo.dispose();
      linkMat.dispose();
      dustGeo.dispose();
      dustMat.dispose();
      taskMat.dispose();
      settleMat.dispose();
      pulses.forEach((p) => p.mat.dispose());
      dot.dispose();
      ringTex.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [themeTick]);

  return <div ref={mountRef} aria-hidden className={className} />;
}

/** Smooth, symmetric ease for a "considered handoff" feel. */
function easeInOut(x: number): number {
  return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2;
}

/** Deterministic per-index pseudo-random — stable node layout across remounts. */
function pseudoRandom(seed: number): number {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Relative luminance of a #hex colour (0 dark … 1 light). */
function hexLuminance(hex: string): number {
  const h = hex.replace('#', '').trim();
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  if (f.length < 6) return 0; // unparseable → assume dark
  const r = parseInt(f.slice(0, 2), 16) / 255;
  const g = parseInt(f.slice(2, 4), 16) / 255;
  const b = parseInt(f.slice(4, 6), 16) / 255;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** #hex → 0xRRGGBB int, with fallback. */
function hexToInt(hex: string, fallback: number): number {
  const h = hex.replace('#', '').trim();
  const f = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  const n = parseInt(f, 16);
  return Number.isFinite(n) && f.length >= 6 ? n : fallback;
}

/** Soft white radial dot — tinted per material via material.color. */
function makeDotTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  // Mostly-solid core with a tight soft edge — crisp dots, not gaussian smudges.
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.5, '#ffffff');
  g.addColorStop(0.8, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

/** Soft white ring — the expanding "received / paid" arrival pulse. */
function makeRingTexture(): THREE.Texture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.translate(size / 2, size / 2);
  ctx.lineWidth = 7;
  ctx.strokeStyle = '#ffffff';
  ctx.shadowColor = '#ffffff';
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(0, 0, size / 2 - 14, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}
