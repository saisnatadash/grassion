// ─── GRASSION GLOBAL JS ───────────────────────────────────────
// TypeScript-style strict JS with JSDoc types

'use strict';

const API_BASE = '/api';

// ─── THEME ────────────────────────────────────────────────────
const ThemeManager = {
  key: 'grassion-theme',
  /** @returns {string} */
  get() { return localStorage.getItem(this.key) || 'light'; },
  /** @param {string} t */
  set(t) {
    localStorage.setItem(this.key, t);
    document.documentElement.setAttribute('data-theme', t);
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.classList.toggle('on', t === 'dark');
      const icon = btn.querySelector('.theme-icon');
      if (icon) icon.textContent = t === 'dark' ? '☀️' : '🌙';
    });
  },
  toggle() { this.set(this.get() === 'dark' ? 'light' : 'dark'); },
  init() {
    this.set(this.get());
    document.querySelectorAll('.theme-toggle').forEach(btn => {
      btn.addEventListener('click', () => this.toggle());
    });
  }
};

// ─── API HELPER ───────────────────────────────────────────────
/** @type {string|null} */
let _authToken = localStorage.getItem('grassion-token');

const API = {
  /**
   * @param {string} endpoint
   * @param {{method?:string, body?:unknown}} [opts]
   */
  async request(endpoint, opts = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (_authToken) headers['Authorization'] = `Bearer ${_authToken}`;
    const res = await fetch(API_BASE + endpoint, {
      method: opts.method || 'GET',
      headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');
    return data;
  },

  /** @param {string} email @param {string} password @param {string} name */
  async register(email, password, name) {
    const data = await this.request('/auth/register', { method: 'POST', body: { email, password, name } });
    _authToken = data.token;
    localStorage.setItem('grassion-token', data.token);
    localStorage.setItem('grassion-user', JSON.stringify(data.user));
    return data;
  },

  /** @param {string} email @param {string} password */
  async login(email, password) {
    const data = await this.request('/auth/login', { method: 'POST', body: { email, password } });
    _authToken = data.token;
    localStorage.setItem('grassion-token', data.token);
    localStorage.setItem('grassion-user', JSON.stringify(data.user));
    return data;
  },

  logout() {
    _authToken = null;
    localStorage.removeItem('grassion-token');
    localStorage.removeItem('grassion-user');
    window.location.href = '/';
  },

  isLoggedIn() { return !!_authToken; },

  getUser() {
    try { return JSON.parse(localStorage.getItem('grassion-user') || 'null'); } catch { return null; }
  },

  /** @param {string} email @param {string} [name] @param {string} [company] */
  async joinEarlyAccess(email, name, company) {
    return this.request('/early-access', { method: 'POST', body: { email, name, company } });
  },

  /** @param {string} name @param {string} email @param {string} message @param {string} [subject] */
  async sendContact(name, email, message, subject) {
    return this.request('/contact', { method: 'POST', body: { name, email, message, subject } });
  },

  async getDashboardStats() {
    return this.request('/dashboard/stats');
  },

  async getMe() {
    return this.request('/dashboard/me');
  },

  async getRepos() {
    return this.request('/github/repos');
  },

  /** @param {string} plan */
  async createOrder(plan) {
    return this.request('/billing/order', { method: 'POST', body: { plan } });
  },
};

// ─── TOAST ────────────────────────────────────────────────────
const Toast = {
  container: null,
  init() {
    if (this.container) return;
    this.container = document.createElement('div');
    this.container.className = 'toast-container';
    const target = document.body || document.documentElement;
    target.appendChild(this.container);
  },
  /**
   * @param {string} message
   * @param {'success'|'error'|'info'} [type]
   */
  show(message, type = 'info') {
    if (!this.container) this.init();
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.innerHTML = `<span>${type === 'success' ? '✓' : type === 'error' ? '✕' : 'ℹ'}</span><span>${message}</span>`;
    this.container.appendChild(t);
    requestAnimationFrame(() => { requestAnimationFrame(() => t.classList.add('show')); });
    setTimeout(() => {
      t.classList.remove('show');
      setTimeout(() => t.remove(), 400);
    }, 3500);
  }
};

// ─── MODAL MANAGER ───────────────────────────────────────────
const Modal = {
  /**
   * @param {string} id
   */
  open(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.add('open'); document.body.style.overflow = 'hidden'; }
  },
  close(id) {
    const el = document.getElementById(id);
    if (el) { el.classList.remove('open'); document.body.style.overflow = ''; }
  },
  closeAll() {
    document.querySelectorAll('.modal-overlay.open').forEach(el => {
      el.classList.remove('open');
    });
    document.body.style.overflow = '';
  },
  init() {
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) this.closeAll();
      });
    });
    document.querySelectorAll('[data-modal-close]').forEach(btn => {
      btn.addEventListener('click', () => this.closeAll());
    });
    document.querySelectorAll('[data-modal-open]').forEach(btn => {
      btn.addEventListener('click', () => this.open(btn.dataset.modalOpen));
    });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') this.closeAll(); });
  }
};

// ─── CURSOR (watery smooth) ───────────────────────────────────
const WateryCursor = {
  dot: null, ring: null,
  mouseX: 0, mouseY: 0,
  ringX: 0, ringY: 0,
  raf: null,

  init() {
    if (window.matchMedia('(pointer: coarse)').matches) return;
    this.dot = document.createElement('div');
    this.dot.className = 'cursor-dot';
    this.ring = document.createElement('div');
    this.ring.className = 'cursor-ring';
    document.body.append(this.dot, this.ring);

    document.addEventListener('mousemove', e => {
      this.mouseX = e.clientX;
      this.mouseY = e.clientY;
      this.dot.style.left = e.clientX + 'px';
      this.dot.style.top  = e.clientY + 'px';
    });

    document.querySelectorAll('a, button, [role="button"], input, textarea').forEach(el => {
      el.addEventListener('mouseenter', () => {
        this.dot.style.width  = '6px';
        this.dot.style.height = '6px';
        this.ring.style.width  = '52px';
        this.ring.style.height = '52px';
        this.ring.style.opacity = '0.6';
      });
      el.addEventListener('mouseleave', () => {
        this.dot.style.width  = '';
        this.dot.style.height = '';
        this.ring.style.width  = '';
        this.ring.style.height = '';
        this.ring.style.opacity = '';
      });
    });

    this.animate();
  },

  animate() {
    // Lerp the ring for buttery follow
    this.ringX += (this.mouseX - this.ringX) * 0.12;
    this.ringY += (this.mouseY - this.ringY) * 0.12;
    if (this.ring) {
      this.ring.style.left = this.ringX + 'px';
      this.ring.style.top  = this.ringY + 'px';
    }
    requestAnimationFrame(() => this.animate());
  }
};

// ─── WATER DOTS CANVAS ────────────────────────────────────────
const WaterCanvas = {
  canvas: null, ctx: null,
  dots: [],
  W: 0, H: 0,

  init() {
    this.canvas = document.getElementById('water-canvas');
    if (!this.canvas) return;
    this.ctx = this.canvas.getContext('2d');
    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.createDots();
    this.animate();
  },

  resize() {
    this.W = this.canvas.width  = window.innerWidth;
    this.H = this.canvas.height = window.innerHeight;
  },

  createDots() {
    const count = Math.floor((this.W * this.H) / 12000);
    const colors = ['#6c63ff','#48cfad','#ff6b9d','#ffd166','#a78bfa','#34d399'];
    this.dots = Array.from({ length: count }, () => ({
      x: Math.random() * this.W,
      y: Math.random() * this.H,
      r: Math.random() * 3 + 1,
      color: colors[Math.floor(Math.random() * colors.length)],
      vx: (Math.random() - 0.5) * 0.35,
      vy: (Math.random() - 0.5) * 0.35,
      opacity: Math.random() * 0.5 + 0.1,
      pulse: Math.random() * Math.PI * 2,
      pulseSpeed: 0.008 + Math.random() * 0.012,
    }));
  },

  animate() {
    const { ctx, W, H } = this;
    ctx.clearRect(0, 0, W, H);

    this.dots.forEach(d => {
      d.pulse += d.pulseSpeed;
      const scale = 1 + Math.sin(d.pulse) * 0.3;
      const op = d.opacity * (0.85 + Math.sin(d.pulse * 1.3) * 0.15);

      ctx.save();
      ctx.globalAlpha = op;
      ctx.fillStyle = d.color;
      ctx.shadowBlur = 6;
      ctx.shadowColor = d.color;
      ctx.beginPath();
      ctx.arc(d.x, d.y, d.r * scale, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      d.x += d.vx; d.y += d.vy;
      if (d.x < -10) d.x = W + 10;
      if (d.x > W + 10) d.x = -10;
      if (d.y < -10) d.y = H + 10;
      if (d.y > H + 10) d.y = -10;
    });

    requestAnimationFrame(() => this.animate());
  }
};

// ─── WATER RIPPLE on click ────────────────────────────────────
function addWaterRipple(el) {
  el.addEventListener('click', function(e) {
    const rect = el.getBoundingClientRect();
    const drop = document.createElement('div');
    drop.className = 'water-drop';
    const size = Math.max(rect.width, rect.height);
    const colors = ['rgba(108,99,255,0.25)','rgba(72,207,173,0.2)','rgba(255,107,157,0.2)'];
    drop.style.cssText = `
      width:${size}px; height:${size}px;
      left:${e.clientX - rect.left - size/2}px;
      top:${e.clientY - rect.top - size/2}px;
      background:${colors[Math.floor(Math.random()*colors.length)]};
    `;
    el.appendChild(drop);
    setTimeout(() => drop.remove(), 900);
  });
}

// ─── 3D JELLY ORBS ───────────────────────────────────────────
const JellyOrbs = {
  scene: null,
  scrollY: 0,
  orbCount: 30,

  init() {
    this.scene = document.createElement('div');
    this.scene.className = 'jelly-scene';
    document.body.appendChild(this.scene);

    for (let i = 0; i < this.orbCount; i++) {
      const orb = document.createElement('div');
      orb.className = 'jelly-orb';
      const size = 6 + Math.random() * 12;
      orb.style.width  = size + 'px';
      orb.style.height = size + 'px';
      orb.style.animationDelay = (i * 0.05) + 's';
      this.scene.appendChild(orb);
    }

    window.addEventListener('scroll', () => {
      const progress = window.scrollY / (document.body.scrollHeight - window.innerHeight);
      this.scene.style.transform = `translateY(${-progress * 40}vh)`;
    }, { passive: true });
  }
};

// ─── SCROLL REVEAL ────────────────────────────────────────────
const ScrollReveal = {
  init() {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('visible'); } });
    }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

    document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
  }
};

// ─── BLOB LAYER ───────────────────────────────────────────────
function initBlobs() {
  const layer = document.createElement('div');
  layer.className = 'blob-layer';
  for (let i = 1; i <= 4; i++) {
    const b = document.createElement('div');
    b.className = `blob blob-${i}`;
    layer.appendChild(b);
  }
  document.body.prepend(layer);
}

// ─── WATER RIPPLE ON ALL BUTTONS ─────────────────────────────
function initRipples() {
  document.querySelectorAll('.btn, .glass').forEach(el => {
    el.classList.add('water-splash');
    addWaterRipple(el);
  });
}

// ─── HELPER: form submit handler ─────────────────────────────
/**
 * @param {string} formId
 * @param {function(FormData): Promise<void>} handler
 */
function bindForm(formId, handler) {
  const form = document.getElementById(formId);
  if (!form) return;
  form.addEventListener('submit', async e => {
    e.preventDefault();
    const btn = form.querySelector('button[type="submit"]');
    const origText = btn?.textContent;
    if (btn) { btn.disabled = true; btn.textContent = '...'; }
    try {
      const fd = new FormData(form);
      await handler(fd);
    } catch (err) {
      Toast.show(err.message || 'Something went wrong', 'error');
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = origText; }
    }
  });
}

// ─── INIT IMMEDIATELY (so Toast/Modal are ready for any page script) ─────────
ThemeManager.init();
Toast.init();

// ─── INIT ON DOM READY ────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  Modal.init();
  WateryCursor.init();
  WaterCanvas.init();
  JellyOrbs.init();
  ScrollReveal.init();
  initBlobs();
  initRipples();

  // Show dashboard link if already logged in
  if (API.isLoggedIn() && window.location.pathname === '/') {
    const user = API.getUser();
    if (user) {
      const nav = document.getElementById('nav-cta');
      if (nav) nav.innerHTML = `<a href="/dashboard.html" class="btn btn-primary btn-sm">Dashboard</a>`;
    }
  }
});
