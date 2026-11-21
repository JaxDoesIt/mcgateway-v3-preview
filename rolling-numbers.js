/* Digit-reel implementation copied unchanged from the current MCGateway website
   (MCGateway-Website/main/public/app-core.js).
   V3-only adapter below connects existing public API snapshots to those reels. */
(() => {
  'use strict';
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const formatNumber = (value) => new Intl.NumberFormat('en-US').format(Math.round(Number(value) || 0));
  const counterStates = new WeakMap();

function digitCharacters(value) { return formatNumber(value).split(''); }
function makeStaticChar(char) { const span = document.createElement('span'); span.className = char === ',' ? 'rolling-separator' : 'rolling-digit static'; span.textContent = char; return span; }
function makeRollingDigit(oldDigit, targetDigit, options = {}) {
  const slot = document.createElement('span'); slot.className = 'rolling-digit slot';
  const oldN = Number(oldDigit); const targetN = Number(targetDigit); let steps = (targetN - oldN + 10) % 10;
  if (steps === 0 && options.forceSpin) steps = 10; if (options.extraLoop) steps += 10;
  const track = document.createElement('span'); track.className = 'digit-track';
  for (let i = 0; i <= steps; i += 1) { const cell = document.createElement('span'); cell.textContent = String((oldN + i) % 10); track.appendChild(cell); }
  slot.appendChild(track);
  const duration = Math.min(3900, 2050 + steps * 145 + (options.placeFromRight || 0) * 48);
  if (steps >= 5 || options.extraLoop) { slot.classList.add('blur-spin'); slot.style.animationDuration = `${duration}ms`; }
  requestAnimationFrame(() => requestAnimationFrame(() => { track.style.transitionDuration = `${duration}ms`; track.style.transform = `translateY(-${steps}em)`; }));
  return { slot, duration };
}

function renderRollingNumber(element, newValue, oldValue = null, initial = false) {
  if (!element) return 0; const normalized = Math.max(0, Math.round(Number(newValue) || 0));
  if (element.hasAttribute('data-stat-static') || reduceMotion) { element.textContent = formatNumber(normalized); element.dataset.value = String(normalized); element.dataset.liveInitialized = 'true'; return 0; }
  const current = oldValue ?? Number(element.dataset.value || 0); const targetChars = digitCharacters(normalized); const oldDigitsRaw = String(Math.max(0, Math.round(Number(current) || 0))); const targetDigitsRaw = String(normalized); const oldDigits = oldDigitsRaw.padStart(targetDigitsRaw.length, '0'); let digitIndex = 0; let longestDuration = 0;
  element.replaceChildren();
  targetChars.forEach((char) => { if (char === ',') { element.appendChild(makeStaticChar(',')); return; } const oldDigit = oldDigits[digitIndex] ?? '0'; const placeFromRight = targetDigitsRaw.length - digitIndex - 1; const changed = oldDigit !== char; if (changed || initial) { const reel = makeRollingDigit(oldDigit, char, { forceSpin: initial && oldDigit === char, extraLoop: initial && placeFromRight < 2, placeFromRight }); longestDuration = Math.max(longestDuration, reel.duration); element.appendChild(reel.slot); } else element.appendChild(makeStaticChar(char)); digitIndex += 1; });
  element.dataset.value = String(normalized); element.dataset.liveInitialized = 'true'; return longestDuration;
}

function getCounterState(element) { if (!counterStates.has(element)) counterStates.set(element, { displayed: null, target: null, animating: false, timer: null }); return counterStates.get(element); }
function startCounterAnimation(element) { const state = getCounterState(element); if (state.animating || state.target === null || state.target === state.displayed) return; const from = state.displayed ?? 0; const to = state.target; const duration = renderRollingNumber(element, to, from, state.displayed === null); state.displayed = to; if (duration <= 0) { state.animating = false; if (state.target !== state.displayed) startCounterAnimation(element); return; } state.animating = true; clearTimeout(state.timer); state.timer = setTimeout(() => { state.animating = false; state.timer = null; if (state.target !== state.displayed) startCounterAnimation(element); }, duration + 30); }

  function set(element, value) {
    if (!element || !Number.isSafeInteger(value) || value < 0) return;
    // The initialization and update flow is the same as production applyHeadlineValue.
    element.classList.add('mcg-rolling-number');
    const state = getCounterState(element);
    state.target = value;
    if (state.displayed === null) {
      const duration = renderRollingNumber(element, value, 0, true);
      state.displayed = value;
      if (duration > 0) {
        state.animating = true;
        state.timer = setTimeout(() => {
          state.animating = false;
          state.timer = null;
          if (state.target !== state.displayed) startCounterAnimation(element);
        }, duration + 30);
      }
    } else if (!state.animating && state.target !== state.displayed) {
      startCounterAnimation(element);
    }
    // The reels contain intermediate digits while rolling. The final value is
    // announced as a single number to assistive technology.
    element.setAttribute('aria-label', formatNumber(value));
  }

  function clear(element, label) {
    if (!element) return;
    const state = counterStates.get(element);
    if (state?.timer) clearTimeout(state.timer);
    counterStates.delete(element);
    delete element.dataset.value;
    delete element.dataset.liveInitialized;
    element.removeAttribute('aria-label');
    element.classList.remove('mcg-rolling-number');
    element.textContent = String(label);
  }

  window.MCGatewayRoll = Object.freeze({ set, clear });
})();
