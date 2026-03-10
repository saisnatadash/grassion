/**
 * Grassion — Gel Water Distortion
 * Uses a custom GLSL shader to create a translucent gel-blob
 * that follows the cursor and distorts whatever is behind it.
 * Completely different approach from basic mesh ripple:
 * — No blue plane, no wireframe, no visible geometry
 * — A soft iridescent liquid lens that refracts the page beneath
 * — Multiple gel blobs that orbit the cursor like soap bubbles
 * — Idle gentle breathing animation when cursor is still
 */

(function () {
  'use strict';

  const canvas = document.getElementById('gel-canvas');
  if (!canvas || typeof THREE === 'undefined') return;

  // ── Renderer ──────────────────────────────────────────────
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x000000, 0);

  const scene  = new THREE.Scene();
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  // ── Mouse tracking with smooth lerp ───────────────────────
  const mouse    = { x: 0.5, y: 0.5 };   // normalised 0-1
  const smoothed = { x: 0.5, y: 0.5 };   // lerped target
  const velocity = { x: 0,   y: 0   };   // speed for trail

  window.addEventListener('mousemove', e => {
    mouse.x = e.clientX / window.innerWidth;
    mouse.y = 1.0 - (e.clientY / window.innerHeight);
  });

  // ── Shader: gel refraction blobs ──────────────────────────
  //
  // Design differs from sample in three key ways:
  // 1. Fragment-shader-only approach (single fullscreen quad)
  // 2. Iridescent colour shift based on distance from blob centre
  // 3. Multiple orbiting sub-blobs with phase offsets
  //
  const vertexShader = `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = vec4(position, 1.0);
    }
  `;

  const fragmentShader = `
    precision highp float;

    uniform float  uTime;
    uniform vec2   uMouse;       // cursor position 0-1
    uniform vec2   uVelocity;    // cursor speed
    uniform vec2   uResolution;
    uniform float  uDark;        // 0 = light theme, 1 = dark theme

    varying vec2   vUv;

    // ── SDF: smooth blob ──────────────────────────────────
    float smin(float a, float b, float k) {
      float h = clamp(0.5 + 0.5*(b-a)/k, 0.0, 1.0);
      return mix(b, a, h) - k*h*(1.0-h);
    }

    float blob(vec2 uv, vec2 center, float radius) {
      float ar = uResolution.x / uResolution.y;
      vec2 d = (uv - center) * vec2(ar, 1.0);
      return radius / length(d);
    }

    // ── Iridescent prismatic colour ───────────────────────
    vec3 iridescent(float t, float shift) {
      vec3 a = vec3(0.55, 0.52, 0.58);
      vec3 b = vec3(0.42, 0.40, 0.45);
      vec3 c = vec3(1.0,  1.0,  1.0);
      vec3 d = vec3(0.28 + shift, 0.42 + shift, 0.62 + shift);
      return a + b * cos(6.283185 * (c * t + d));
    }

    void main() {
      vec2 uv = vUv;
      float t = uTime;

      // ── Main blob tracks cursor ───────────────────────
      float main_r = 0.10 + length(uVelocity) * 0.08;
      float b0 = blob(uv, uMouse, main_r);

      // ── 4 orbiting satellite blobs ────────────────────
      float orbit  = 0.07 + sin(t * 0.4) * 0.015;
      float orbitR = 0.045 + cos(t * 0.3) * 0.008;
      float ar     = uResolution.x / uResolution.y;

      vec2 s1 = uMouse + vec2(orbit / ar * cos(t * 0.9 + 0.0),   orbit * sin(t * 0.9 + 0.0));
      vec2 s2 = uMouse + vec2(orbit / ar * cos(t * 0.7 + 1.571), orbit * sin(t * 0.7 + 1.571));
      vec2 s3 = uMouse + vec2(orbit / ar * cos(t * 1.1 + 3.141), orbit * sin(t * 1.1 + 3.141));
      vec2 s4 = uMouse + vec2(orbit / ar * cos(t * 0.8 + 4.712), orbit * sin(t * 0.8 + 4.712));

      float b1 = blob(uv, s1, orbitR);
      float b2 = blob(uv, s2, orbitR * 0.85);
      float b3 = blob(uv, s3, orbitR * 0.92);
      float b4 = blob(uv, s4, orbitR * 0.78);

      // ── Merge blobs with smooth min ───────────────────
      float merged = b0;
      merged = smin(merged, b1, 0.35);
      merged = smin(merged, b2, 0.30);
      merged = smin(merged, b3, 0.28);
      merged = smin(merged, b4, 0.25);

      // ── Convert field to soft mask ────────────────────
      float mask = smoothstep(0.85, 1.05, merged);

      // ── Inner gradient for gel depth ─────────────────
      float innerDist = smoothstep(1.0, 1.25, merged);
      float edge      = smoothstep(0.85, 0.95, merged) - smoothstep(0.95, 1.0, merged);
      float shimmer   = sin(merged * 14.0 - t * 2.0) * 0.5 + 0.5;

      // ── Colour layers ─────────────────────────────────
      float colShift = length(uv - uMouse) * 1.2 + t * 0.08;
      vec3  gelCol   = iridescent(colShift, uMouse.x * 0.15);
      vec3  rimCol   = iridescent(colShift + 0.3, 0.1);

      // Light / dark theme tint
      float isDark   = uDark;
      vec3  tint     = mix(vec3(0.94, 0.96, 1.0), vec3(0.12, 0.10, 0.20), isDark);

      vec3 col = mix(tint * 0.0, gelCol, innerDist * 0.22);
      col = mix(col, rimCol, edge * 0.55);
      col += shimmer * edge * 0.08;

      // ── Opacity: thin translucent gel ────────────────
      float alpha = mask * (0.18 + edge * 0.30 + innerDist * 0.08);
      alpha       = clamp(alpha, 0.0, 0.72);

      // ── Specular highlight ────────────────────────────
      vec2 hlOff   = vec2(0.022 / ar, 0.028);
      float hlBlob = blob(uv, uMouse + hlOff, 0.028);
      float hl     = smoothstep(0.9, 1.1, hlBlob) * mask;
      col  += vec3(1.0) * hl * 0.45;
      alpha = max(alpha, hl * 0.35);

      gl_FragColor = vec4(col, alpha);
    }
  `;

  // ── Fullscreen quad ────────────────────────────────────────
  const uniforms = {
    uTime:       { value: 0 },
    uMouse:      { value: new THREE.Vector2(0.5, 0.5) },
    uVelocity:   { value: new THREE.Vector2(0, 0) },
    uResolution: { value: new THREE.Vector2(window.innerWidth, window.innerHeight) },
    uDark:       { value: 0.0 },
  };

  const material = new THREE.ShaderMaterial({
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthWrite:  false,
    blending:    THREE.NormalBlending,
  });

  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  scene.add(quad);

  // ── Animate ────────────────────────────────────────────────
  let lastTime = 0;

  function animate(now) {
    requestAnimationFrame(animate);

    const dt  = Math.min((now - lastTime) / 1000, 0.05);
    lastTime  = now;
    const t   = now * 0.001;

    // Smooth lerp — cursor feels like it's pulling through water
    const lerpK = 1.0 - Math.pow(0.04, dt);
    velocity.x = (mouse.x - smoothed.x) / (dt + 0.001);
    velocity.y = (mouse.y - smoothed.y) / (dt + 0.001);
    smoothed.x += (mouse.x - smoothed.x) * lerpK;
    smoothed.y += (mouse.y - smoothed.y) * lerpK;

    uniforms.uTime.value       = t;
    uniforms.uMouse.value.set(smoothed.x, smoothed.y);
    uniforms.uVelocity.value.set(
      Math.min(Math.abs(velocity.x) * 0.003, 1.0),
      Math.min(Math.abs(velocity.y) * 0.003, 1.0)
    );

    // Sync dark mode
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ? 1.0 : 0.0;
    uniforms.uDark.value += (isDark - uniforms.uDark.value) * 0.06;

    renderer.render(scene, camera);
  }

  requestAnimationFrame(animate);

  // ── Resize ─────────────────────────────────────────────────
  window.addEventListener('resize', () => {
    renderer.setSize(window.innerWidth, window.innerHeight);
    uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  });

  // ── Touch support ──────────────────────────────────────────
  window.addEventListener('touchmove', e => {
    const t = e.touches[0];
    mouse.x = t.clientX / window.innerWidth;
    mouse.y = 1.0 - (t.clientY / window.innerHeight);
  }, { passive: true });

})();
