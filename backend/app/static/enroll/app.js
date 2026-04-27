'use strict';

// ── Config ─────────────────────────────────────────────────────
const MIN_CAPTURES = 3;
const MAX_CAPTURES = 6;
const MIN_QUALITY  = 0.65;

const ANGLE_PROMPTS = [
  { text: 'Look straight ahead',      icon: '😐' },
  { text: 'Turn head slightly LEFT',  icon: '⬅' },
  { text: 'Turn head slightly RIGHT', icon: '➡' },
  { text: 'Look slightly DOWN',       icon: '⬇' },
  { text: 'Straight again',           icon: '😐' },
  { text: 'Tilt head slightly LEFT',  icon: '↺'  },
];

// ── State ──────────────────────────────────────────────────────
let jwt           = sessionStorage.getItem('jwt');
let currentSenior = null;
let allSeniors    = [];
let captures      = [];   // [{cropB64, quality, label}]
let stream        = null;
let capturing     = false;
let guideRafId    = null;
let feedbackTimer = null;

// ── Boot ───────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  checkHealth();
  document.getElementById('login-password')
    .addEventListener('keydown', e => { if (e.key === 'Enter') doLogin(); });
  document.getElementById('login-email')
    .addEventListener('keydown', e => { if (e.key === 'Enter') document.getElementById('login-password').focus(); });

  if (jwt) { showView('seniors'); loadSeniors(); }
  else      { showView('login'); }
});

// ── Views ──────────────────────────────────────────────────────
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.add('hidden'));
  document.getElementById('view-' + name).classList.remove('hidden');
}

// ── Health check / banner ──────────────────────────────────────
async function checkHealth() {
  try {
    const r = await fetch('/api/health', { signal: AbortSignal.timeout(5000) });
    document.getElementById('server-banner').classList.toggle('hidden', r.ok);
  } catch {
    document.getElementById('server-banner').classList.remove('hidden');
  }
}

// ── API helper ─────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (jwt) headers['Authorization'] = 'Bearer ' + jwt;
  const res = await fetch(path, { ...opts, headers });
  if (res.status === 401) { doLogout(); throw new Error('Session expired — please sign in again'); }
  return res;
}

// ── Auth ───────────────────────────────────────────────────────
async function doLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const btn      = document.getElementById('login-btn');
  const errEl    = document.getElementById('login-error');

  errEl.classList.add('hidden');
  if (!email || !password) { showLoginError('Email and password are required'); return; }

  btn.disabled    = true;
  btn.textContent = 'Signing in…';

  try {
    const res  = await fetch('/api/auth/login', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ email, password }),
    });
    const data = await res.json();
    if (res.ok && data.token) {
      jwt = data.token;
      sessionStorage.setItem('jwt', jwt);
      showView('seniors');
      loadSeniors();
    } else {
      showLoginError(data.error || 'Invalid credentials');
    }
  } catch {
    showLoginError('Cannot reach server — check network');
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Sign In';
  }
}

function showLoginError(msg) {
  const el = document.getElementById('login-error');
  el.textContent = msg;
  el.classList.remove('hidden');
}

function doLogout() {
  jwt = null;
  sessionStorage.removeItem('jwt');
  stopCamera();
  captures      = [];
  currentSenior = null;
  showView('login');
}

// ── Seniors ────────────────────────────────────────────────────
async function loadSeniors() {
  const list = document.getElementById('senior-list');
  list.innerHTML = '<div class="list-placeholder">Loading seniors…</div>';
  try {
    const res = await apiFetch('/api/seniors');
    allSeniors  = await res.json();
    renderSeniors(allSeniors);
  } catch (e) {
    list.innerHTML = `<div class="list-placeholder" style="color:#EF5350">${e.message}</div>`;
  }
}

function filterSeniors() {
  const q = document.getElementById('senior-search').value.toLowerCase();
  renderSeniors(
    allSeniors.filter(s =>
      s.name.toLowerCase().includes(q) || (s.nric_last4 || '').includes(q)
    )
  );
}

function renderSeniors(list) {
  const el = document.getElementById('senior-list');
  if (!list.length) { el.innerHTML = '<div class="list-placeholder">No seniors found</div>'; return; }
  el.innerHTML = '';
  list.forEach(s => {
    const card = document.createElement('div');
    card.className = 'senior-card';
    card.innerHTML = `
      <div class="senior-avatar">${initials(s.name)}</div>
      <div class="senior-info">
        <div class="senior-name">${esc(s.name)}</div>
        <div class="senior-nric">NRIC ****${esc(s.nric_last4 || '----')}</div>
      </div>
      <div class="senior-arrow">›</div>`;
    card.addEventListener('click', () => selectSenior(s));
    el.appendChild(card);
  });
}

function selectSenior(s) {
  currentSenior = s;
  captures      = [];
  document.getElementById('enroll-name').textContent = s.name;
  document.getElementById('enroll-nric').textContent = 'NRIC ****' + (s.nric_last4 || '----');
  showView('enroll');
  startCamera();
  updateEnrollUI();
}

function goBack() {
  stopCamera();
  captures      = [];
  currentSenior = null;
  showView('seniors');
}

// ── Camera ─────────────────────────────────────────────────────
async function startCamera(deviceId) {
  stopCamera();
  const constraints = {
    video: deviceId
      ? { deviceId: { exact: deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } }
      : { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 720 } },
  };
  const video = document.getElementById('camera-video');
  try {
    stream = await navigator.mediaDevices.getUserMedia(constraints);
    video.srcObject = stream;
    await video.play();
    await populateCameraSelect(deviceId);
    startGuideLoop();
  } catch (e) {
    showFeedback('Camera error: ' + e.message, false);
  }
}

function stopCamera() {
  if (stream) { stream.getTracks().forEach(t => t.stop()); stream = null; }
  if (guideRafId) { cancelAnimationFrame(guideRafId); guideRafId = null; }
  const canvas = document.getElementById('guide-canvas');
  if (canvas) canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
}

async function populateCameraSelect(selectedId) {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos  = devices.filter(d => d.kind === 'videoinput');
    const sel     = document.getElementById('camera-select');
    sel.innerHTML = videos.map(d =>
      `<option value="${esc(d.deviceId)}" ${d.deviceId === selectedId ? 'selected' : ''}>${esc(d.label || 'Camera')}</option>`
    ).join('');
    sel.style.display = videos.length <= 1 ? 'none' : '';
  } catch { /* permissions not yet granted — hide selector */ }
}

function switchCamera(deviceId) {
  startCamera(deviceId);
}

// ── Guide overlay ──────────────────────────────────────────────
function startGuideLoop() {
  const canvas = document.getElementById('guide-canvas');

  function frame() {
    if (!stream) return;
    const rect = canvas.parentElement.getBoundingClientRect();
    if (canvas.width !== rect.width || canvas.height !== rect.height) {
      canvas.width  = rect.width;
      canvas.height = rect.height;
    }
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    drawGuide(ctx, canvas.width, canvas.height);
    guideRafId = requestAnimationFrame(frame);
  }
  frame();
}

function drawGuide(ctx, w, h) {
  const cx = w / 2;
  const cy = h * 0.47;
  const rx = w * 0.22;
  const ry = h * 0.36;
  const lw = Math.max(2, w * 0.004);

  // Oval
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
  ctx.strokeStyle = '#00D4FF';
  ctx.lineWidth   = lw;
  ctx.stroke();

  // Corner brackets
  const pad = Math.min(w, h) * 0.055;
  const bx1 = cx - rx - pad, by1 = cy - ry - pad;
  const bx2 = cx + rx + pad, by2 = cy + ry + pad;
  const bl  = Math.min(w, h) * 0.065;
  ctx.strokeStyle = '#00A878';
  ctx.lineWidth   = lw * 1.2;
  ctx.lineCap     = 'square';

  [
    [[bx1, by1 + bl], [bx1, by1], [bx1 + bl, by1]],         // TL
    [[bx2 - bl, by1], [bx2, by1], [bx2, by1 + bl]],         // TR
    [[bx1, by2 - bl], [bx1, by2], [bx1 + bl, by2]],         // BL
    [[bx2 - bl, by2], [bx2, by2], [bx2, by2 - bl]],         // BR
  ].forEach(pts => {
    ctx.beginPath();
    ctx.moveTo(...pts[0]);
    ctx.lineTo(...pts[1]);
    ctx.lineTo(...pts[2]);
    ctx.stroke();
  });
}

// ── Capture ────────────────────────────────────────────────────
async function doCapture() {
  if (capturing || !stream) return;
  if (captures.length >= MAX_CAPTURES) return;

  capturing = true;
  const btn = document.getElementById('capture-btn');
  btn.disabled    = true;
  btn.textContent = '⏳ Processing…';

  try {
    const video  = document.getElementById('camera-video');
    const canvas = document.createElement('canvas');
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);

    const blob = await new Promise(res => canvas.toBlob(res, 'image/jpeg', 0.92));

    const fd = new FormData();
    fd.append('photo', blob, 'capture.jpg');

    const res  = await apiFetch('/api/enroll/analyze', { method: 'POST', body: fd });
    const data = await res.json();

    if (data.error) {
      showFeedback(data.error, false);
    } else {
      const q = parseFloat(data.quality);
      if (q < MIN_QUALITY) {
        showFeedback(`Quality too low (${Math.round(q * 100)}%) — try better lighting`, false);
      } else {
        const idx   = captures.length;
        const label = idx < ANGLE_PROMPTS.length ? ANGLE_PROMPTS[idx].text : 'Extra';
        captures.push({ cropB64: data.crop_b64, quality: q, label });
        updateEnrollUI();
        showFeedback(`Captured ${captures.length} / ${MAX_CAPTURES} ✓`, true);
      }
    }
  } catch (e) {
    showFeedback('Error: ' + e.message, false);
  } finally {
    capturing       = false;
    btn.disabled    = false;
    btn.textContent = '⊙ Capture';
  }
}

// ── Save ───────────────────────────────────────────────────────
async function doSave() {
  if (captures.length < MIN_CAPTURES || !currentSenior) return;

  const btn = document.getElementById('save-btn');
  btn.disabled    = true;
  btn.textContent = '⏳ Saving…';

  try {
    const res  = await apiFetch('/api/enroll/save', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        name:  currentSenior.name,
        crops: captures.map(c => c.cropB64),
      }),
    });
    const data = await res.json();

    if (data.error) {
      showFeedback(data.error, false);
      btn.disabled    = captures.length < MIN_CAPTURES;
      btn.textContent = '⇩ Save';
    } else {
      showSuccessOverlay(data);
    }
  } catch (e) {
    showFeedback('Save failed: ' + e.message, false);
    btn.disabled    = captures.length < MIN_CAPTURES;
    btn.textContent = '⇩ Save';
  }
}

function showSuccessOverlay(data) {
  stopCamera();
  const overlay = document.createElement('div');
  overlay.className = 'success-overlay';
  overlay.innerHTML = `
    <div class="success-card">
      <div class="success-icon">✅</div>
      <h2>Enrollment Saved</h2>
      <p><strong>${esc(currentSenior.name)}</strong></p>
      <p>${captures.length} photo${captures.length !== 1 ? 's' : ''} enrolled</p>
      ${data.embeddings ? `<p style="font-size:12px;color:var(--text-muted);margin-top:4px">${data.embeddings} total embeddings loaded</p>` : ''}
      <button class="btn-primary" id="done-btn">Done</button>
    </div>`;
  document.body.appendChild(overlay);
  overlay.querySelector('#done-btn').addEventListener('click', () => {
    overlay.remove();
    captures      = [];
    currentSenior = null;
    showView('seniors');
  });
}

// ── UI state ───────────────────────────────────────────────────
function updateEnrollUI() {
  const n = captures.length;

  // Angle prompt
  const idx = Math.min(n, ANGLE_PROMPTS.length - 1);
  if (n < MAX_CAPTURES) {
    document.getElementById('prompt-text').textContent = ANGLE_PROMPTS[idx].text;
    document.getElementById('prompt-icon').textContent = ANGLE_PROMPTS[idx].icon;
    document.getElementById('angle-chip').style.display = '';
  } else {
    document.getElementById('angle-chip').style.display = 'none';
  }

  // Progress dots
  const dots = document.getElementById('progress-dots');
  dots.innerHTML = Array.from({ length: MAX_CAPTURES }, (_, i) =>
    `<div class="progress-dot ${i < n ? 'filled' : ''}"></div>`
  ).join('');

  // Captures label
  document.getElementById('captures-label').textContent =
    `${n} / ${MAX_CAPTURES}  ·  min ${MIN_CAPTURES} to save`;

  // Thumbnail grid
  const grid = document.getElementById('captures-grid');
  grid.innerHTML = '';
  captures.forEach((c, i) => {
    const qPct   = Math.round(c.quality * 100);
    const qColor = c.quality >= 0.85 ? '#00A878' : c.quality >= MIN_QUALITY ? '#FFB347' : '#EF5350';
    const wrap   = document.createElement('div');
    wrap.className = 'capture-thumb';
    wrap.innerHTML = `
      <img src="data:image/jpeg;base64,${c.cropB64}" alt="${esc(c.label)}">
      <div class="quality-badge" style="color:${qColor}">${qPct}%</div>
      <div class="remove-btn" title="Remove">✕</div>`;
    wrap.querySelector('.remove-btn').addEventListener('click', () => {
      captures.splice(i, 1);
      updateEnrollUI();
    });
    grid.appendChild(wrap);
  });

  // Capture button
  document.getElementById('capture-btn').disabled = n >= MAX_CAPTURES;

  // Save button
  const saveBtn = document.getElementById('save-btn');
  saveBtn.disabled    = n < MIN_CAPTURES;
  saveBtn.textContent = `⇩ Save${n >= MIN_CAPTURES ? ' (' + n + ')' : ''}`;
}

// ── Feedback toast ─────────────────────────────────────────────
function showFeedback(msg, ok) {
  const el = document.getElementById('feedback');
  el.textContent = msg;
  el.className   = 'feedback ' + (ok ? 'ok' : 'err');
  if (feedbackTimer) clearTimeout(feedbackTimer);
  feedbackTimer = setTimeout(() => el.classList.add('hidden'), 3000);
}

// ── Utilities ──────────────────────────────────────────────────
function initials(name) {
  const parts = (name || '').trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (name[0] || '?').toUpperCase();
}

function esc(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
