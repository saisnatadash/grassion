// Grassion — Shared JS Utilities

// TOAST NOTIFICATIONS
function showToast(message, type = 'default') {
  let toast = document.getElementById('globalToast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'globalToast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.className = `toast ${type}`;
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// MODAL HELPERS
function openModal(id) {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeModal(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.modal-overlay').forEach(m => {
    m.addEventListener('click', e => { if (e.target === m) closeModal(m.id); });
  });
  document.querySelectorAll('[data-modal]').forEach(btn => {
    btn.addEventListener('click', () => openModal(btn.dataset.modal));
  });
});

// SCROLL REVEAL
document.addEventListener('DOMContentLoaded', () => {
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => { if (e.isIntersecting) e.target.classList.add('visible'); });
  }, { threshold: 0.1 });
  document.querySelectorAll('.reveal').forEach(el => observer.observe(el));
});

// ANALYTICS — track page views and time spent
(function() {
  const page = window.location.pathname;
  fetch('/api/analytics/pageview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ page }) }).catch(() => {});
  let startTime = Date.now();
  window.addEventListener('beforeunload', () => {
    const seconds = Math.round((Date.now() - startTime) / 1000);
    if (seconds > 2) {
      navigator.sendBeacon('/api/analytics/time', JSON.stringify({ seconds }));
    }
  });
})();

// COPY TO CLIPBOARD
async function copyToClipboard(text, successMsg = 'Copied!') {
  try {
    await navigator.clipboard.writeText(text);
    showToast(successMsg, 'success');
  } catch {
    showToast('Copy failed', 'error');
  }
}

// FORMAT DATE
function formatDate(dateStr) {
  return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

// FORMAT CURRENCY
function formatINR(amount) {
  return '₹' + Number(amount).toLocaleString('en-IN');
}

// DEBOUNCE
function debounce(fn, delay = 300) {
  let timeout;
  return (...args) => { clearTimeout(timeout); timeout = setTimeout(() => fn(...args), delay); };
}
