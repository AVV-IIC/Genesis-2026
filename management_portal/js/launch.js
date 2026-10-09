// Inauguration: the full-screen stage behind the dashboard's Start button (made for the projector),
// and the shorter celebration every open team and judge screen plays when the 24-hour clock starts.
import { $, html, setHTML, icon } from './core.js';
import { phaseText } from './dial.js';

const REDUCED = matchMedia('(prefers-reduced-motion: reduce)').matches;
const COLORS = ['#00d9ea', '#6fd18f', '#20a090', '#0070a0', '#e9fff8', '#ffd166'];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- confetti (one canvas, logo colours) ------------------------------------------------
function confetti(canvas) {
  const ctx = canvas.getContext('2d');
  let w = 0;
  let h = 0;
  const size = () => {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  };
  size();
  addEventListener('resize', size);
  const parts = [];
  const shoot = (x, y, n, angle, spread, speed) => {
    for (let i = 0; i < n; i++) {
      const a = angle + (Math.random() - 0.5) * spread;
      const v = speed * (0.45 + Math.random() * 0.75);
      parts.push({
        x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
        r: 5 + Math.random() * 7, rot: Math.random() * 6.3, vr: (Math.random() - 0.5) * 0.32,
        tilt: Math.random() * 6.3, c: COLORS[i % COLORS.length], round: Math.random() < 0.28,
      });
    }
  };
  const burst = () => shoot(w / 2, h * 0.4, 160, -Math.PI / 2, Math.PI * 2, 13);
  const cannons = () => {
    shoot(0, h, 90, -Math.PI / 3, 0.5, 24);
    shoot(w, h, 90, (-2 * Math.PI) / 3, 0.5, 24);
  };
  burst();
  const timers = [setTimeout(cannons, 250), setTimeout(cannons, 1100), setTimeout(burst, 1900)];
  let raf = 0;
  let stopped = false;
  const frame = () => {
    ctx.clearRect(0, 0, w, h);
    for (let i = parts.length - 1; i >= 0; i--) {
      const p = parts[i];
      p.vx *= 0.986;
      p.vy = p.vy * 0.986 + 0.24;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      p.tilt += 0.09;
      if (p.y > h + 40 || p.x < -60 || p.x > w + 60) {
        parts.splice(i, 1);
        continue;
      }
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.scale(1, Math.cos(p.tilt));
      ctx.fillStyle = p.c;
      if (p.round) {
        ctx.beginPath();
        ctx.arc(0, 0, p.r / 2.4, 0, Math.PI * 2);
        ctx.fill();
      } else ctx.fillRect(-p.r / 2, -p.r / 4, p.r, p.r / 2);
      ctx.restore();
    }
    if (!stopped && (parts.length || timers.length)) raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  setTimeout(() => (timers.length = 0), 2000);
  return () => {
    stopped = true;
    timers.forEach(clearTimeout);
    cancelAnimationFrame(raf);
    removeEventListener('resize', size);
  };
}

const backdrop = () => html`
  <div class="launch-aurora" aria-hidden="true"><i></i><i></i><i></i></div>
  <div class="launch-rays" aria-hidden="true"></div>
  <div class="launch-flash" aria-hidden="true"></div>
  <canvas class="launch-confetti" aria-hidden="true"></canvas>`;

function mount(cls, content) {
  const el = document.createElement('div');
  el.className = `launch ${cls}`;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  setHTML(el, html`${backdrop()}${content}`);
  document.body.append(el);
  document.body.classList.add('launch-open');
  requestAnimationFrame(() => el.classList.add('is-open'));
  return el;
}

function unmount(el, stopConfetti) {
  stopConfetti?.();
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  el.classList.remove('is-open');
  setTimeout(() => {
    el.remove();
    if (!$('.launch')) document.body.classList.remove('launch-open');
  }, 450);
}

/**
 * The inauguration stage. Pressing its big button counts down 3-2-1, then calls onStart()
 * (which starts the clock on the server) and lights everything up. Resolves true once started.
 */
export function openStage({ eventName, label, onStart }) {
  return new Promise((resolve) => {
    const el = mount('launch-stage', html`
      <button type="button" class="launch-close" data-close>${icon('x')}Not yet</button>
      <div class="launch-center">
        <div class="launch-bulb"><span class="launch-glow" aria-hidden="true"></span><img src="img/logo.png" alt="" width="352" height="568"></div>
        <p class="launch-eyebrow" data-eyebrow>Inauguration</p>
        <h1 class="launch-title" id="launch-title">${eventName}</h1>
        <p class="launch-sub" data-sub>The 24 hours begin the moment this button is pressed.</p>
        <div class="launch-action"><button type="button" class="launch-btn" data-go><span>Start</span></button></div>
        <div class="launch-count" data-count aria-live="assertive"></div>
        <div class="launch-clock" data-clock hidden><span data-clock-label></span><b data-clock-time></b><small data-clock-sub></small></div>
        <p class="launch-error" data-error role="alert" hidden></p>
        <button type="button" class="launch-done" data-done hidden>Go to the dashboard${icon('arrow')}</button>
      </div>`);
    el.setAttribute('aria-labelledby', 'launch-title');
    // Fill the projector: the Start button that opened this was a click, so fullscreen is allowed.
    el.requestFullscreen?.().catch(() => {});
    $('[data-go]', el).focus();

    let stopConfetti = null;
    let clockTimer = null;
    let started = false;
    const close = () => {
      clearInterval(clockTimer);
      removeEventListener('keydown', onKey);
      unmount(el, stopConfetti);
      resolve(started);
    };
    const onKey = (e) => {
      if (e.key === 'Escape' && !el.classList.contains('is-counting')) close();
    };
    addEventListener('keydown', onKey);
    $('[data-close]', el).addEventListener('click', close);
    $('[data-done]', el).addEventListener('click', close);

    $('[data-go]', el).addEventListener('click', async (e) => {
      e.currentTarget.disabled = true;
      $('[data-error]', el).hidden = true;
      el.classList.add('is-counting');
      const count = $('[data-count]', el);
      if (!REDUCED) {
        for (const n of [3, 2, 1]) {
          count.textContent = n;
          count.classList.remove('tick');
          void count.offsetWidth; // restart the animation
          count.classList.add('tick');
          el.style.setProperty('--charge', String((4 - n) / 3));
          await sleep(1000);
        }
      }
      count.textContent = '';
      try {
        await onStart();
      } catch (err) {
        el.classList.remove('is-counting');
        el.style.removeProperty('--charge');
        $('[data-go]', el).disabled = false;
        const box = $('[data-error]', el);
        box.textContent = `Couldn’t start the clock: ${err.message || 'check the connection'}. Press Start to try again.`;
        box.hidden = false;
        return;
      }
      started = true;
      el.classList.remove('is-counting');
      el.classList.add('is-live');
      $('[data-eyebrow]', el).textContent = 'We’re live';
      $('[data-sub]', el).textContent = `The ${label} has begun. Every team’s 24 hours start now.`;
      if (!REDUCED) stopConfetti = confetti($('.launch-confetti', el));
      const clock = $('[data-clock]', el);
      clock.hidden = false;
      const paint = () => {
        const t = phaseText();
        $('[data-clock-label]', el).textContent = t.label;
        $('[data-clock-time]', el).textContent = t.time;
        $('[data-clock-sub]', el).textContent = t.sub;
      };
      paint();
      clockTimer = setInterval(paint, 250);
      const done = $('[data-done]', el);
      done.hidden = false;
      setTimeout(() => done.focus(), 1600);
    });
  });
}

/** The short version for team and judge screens: plays when the clock starts while the page is open. */
export function celebrate({ eventName, label }) {
  if ($('.launch')) return;
  const el = mount('launch-mini is-live', html`
    <div class="launch-center">
      <div class="launch-bulb"><span class="launch-glow" aria-hidden="true"></span><img src="img/logo.png" alt="" width="352" height="568"></div>
      <p class="launch-eyebrow">We’re live</p>
      <h1 class="launch-title">${eventName}</h1>
      <p class="launch-sub">The ${label} has begun. Your 24 hours start now. Good luck!</p>
      <button type="button" class="launch-done" data-done>Let’s go${icon('arrow')}</button>
    </div>`);
  el.setAttribute('aria-label', `${eventName} has begun`);
  const stopConfetti = REDUCED ? null : confetti($('.launch-confetti', el));
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    unmount(el, stopConfetti);
  };
  $('[data-done]', el).addEventListener('click', close);
  el.addEventListener('click', (e) => { if (e.target === el) close(); });
  setTimeout(close, 9000);
}
