/**
 * typewriter.js - a polished, believable typewriter animation.
 *
 * Zero dependencies. Works in any framework.
 *
 * @example
 *   import { typewriter } from './typewriter.js';
 *   const tw = typewriter('#hero', "Hello, world.");
 *   await tw.done;
 *
 * @example with options
 *   typewriter(el, text, {
 *     baseDelay: 60,
 *     typos: true,
 *     onDone: () => console.log('typed!'),
 *   });
 */

const ADJACENT_KEYS = {
    a: 'sq', b: 'vn', c: 'xv', d: 'sf', e: 'wr', f: 'dg', g: 'fh', h: 'gj',
    i: 'uo', j: 'hk', k: 'jl', l: 'k',  m: 'n',  n: 'bm', o: 'ip', p: 'o',
    q: 'wa', r: 'et', s: 'ad', t: 'ry', u: 'yi', v: 'cb', w: 'qe', x: 'zc',
    y: 'tu', z: 'x',
};

/** @type {Required<Omit<TypewriterOptions, 'onChar' | 'onDone' | 'signal'>>} */
const DEFAULTS = {
    baseDelay: 52,
    variableTiming: true,
    punctuationPauses: true,
    thinkingPauses: true,
    thinkingChance: 0.014,
    typos: false,
    typoChance: 0.018,
    cursor: true,
    cursorIdleDelay: 500,
    respectReducedMotion: true,
    accessible: true,
    autoStart: true,
};

const STYLE_ID = 'typewriter-module-styles';
const STYLES = `
.typewriter { position: relative; }
.typewriter__cursor {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  background: currentColor;
  margin-left: 1px;
  vertical-align: -0.12em;
  animation: typewriter-blink 1.06s steps(2) infinite;
}
.typewriter--typing .typewriter__cursor {
  animation: none;
  opacity: 1;
}
.typewriter__sr {
  position: absolute;
  width: 1px; height: 1px;
  padding: 0; margin: -1px;
  overflow: hidden; clip: rect(0,0,0,0);
  white-space: nowrap; border: 0;
}
@keyframes typewriter-blink { 50% { opacity: 0; } }
`;

function injectStyles() {
    if (typeof document === 'undefined') return;
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = STYLES;
    document.head.appendChild(style);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function adjacentKey(c) {
    const l = c.toLowerCase();
    const opts = ADJACENT_KEYS[l];
    if (!opts) return null;
    const pick = opts[Math.floor(Math.random() * opts.length)];
    return c === l ? pick : pick.toUpperCase();
}

function delayFor(ch, opts) {
    let d = opts.baseDelay;
    if (opts.variableTiming) {
        // Triangular-ish distribution (sum of three uniforms) - clusters
        // around the mean with a natural spread, feels more human than flat random.
        const r = (Math.random() + Math.random() + Math.random()) / 3;
        d = opts.baseDelay * (0.55 + r * 1.3);
    }
    if (opts.punctuationPauses) {
        if ('.!?'.includes(ch))       d += 380 + Math.random() * 180;
        else if (',;:'.includes(ch))  d += 160 + Math.random() * 120;
        else if (ch === ' ')          d +=  12 + Math.random() *  35;
        else if (ch === '-' || ch === '-') d += 220 + Math.random() * 150;
    }
    if (opts.thinkingPauses && Math.random() < opts.thinkingChance) {
        d += 380 + Math.random() * 600;
    }
    return d;
}

/**
 * Animate text into an element, character by character, with humanized timing.
 *
 * @param {Element | string} target   Element or CSS selector
 * @param {string}           text     Text to type
 * @param {TypewriterOptions} [options]
 * @returns {TypewriterController}
 */
export function typewriter(target, text, options = {}) {
    const el = typeof target === 'string' ? document.querySelector(target) : target;
    if (!el) throw new Error(`typewriter: target not found (${target})`);

    const opts = { ...DEFAULTS, ...options };

    // --- Build the DOM ---
    el.classList.add('typewriter');
    el.textContent = '';

    const textEl = document.createElement('span');
    textEl.className = 'typewriter__text';
    if (opts.accessible) textEl.setAttribute('aria-hidden', 'true');
    el.appendChild(textEl);

    let cursorEl = null;
    if (opts.cursor) {
        injectStyles();
        cursorEl = document.createElement('span');
        cursorEl.className = 'typewriter__cursor';
        cursorEl.setAttribute('aria-hidden', 'true');
        el.appendChild(cursorEl);
    }

    /** Screen-reader copy so assistive tech reads the full text, not partial. */
    let srEl = null;
    if (opts.accessible) {
        injectStyles();
        srEl = document.createElement('span');
        srEl.className = 'typewriter__sr';
        srEl.textContent = text;
        el.appendChild(srEl);
    }

    // --- State ---
    let runId = 0;
    let state = /** @type {TypewriterState} */ ('idle');
    let skipRequested = false;
    let idleTimeout = null;

    let doneResolve = () => {};
    let donePromise = new Promise((r) => (doneResolve = r));

    const prefersReduced =
        opts.respectReducedMotion &&
        typeof matchMedia !== 'undefined' &&
        matchMedia('(prefers-reduced-motion: reduce)').matches;

    function markTyping() {
        el.classList.add('typewriter--typing');
        clearTimeout(idleTimeout);
        idleTimeout = setTimeout(() => {
            el.classList.remove('typewriter--typing');
        }, opts.cursorIdleDelay);
    }

    function finish(id) {
        if (id !== runId) return;
        state = 'done';
        clearTimeout(idleTimeout);
        el.classList.remove('typewriter--typing');
        try { opts.onDone?.(); } catch (e) { /* swallow */ }
        doneResolve();
    }

    async function run() {
        const id = ++runId;
        skipRequested = false;
        state = 'typing';
        textEl.textContent = '';

        if (prefersReduced) {
            textEl.textContent = text;
            finish(id);
            return;
        }

        let shown = '';
        let i = 0;
        let lastWasTypo = false;

        while (i < text.length) {
            if (id !== runId) return;
            if (skipRequested) {
                shown = text;
                textEl.textContent = shown;
                break;
            }

            const ch = text[i];

            // Occasional typo-and-correct
            if (opts.typos && !lastWasTypo && /[a-z]/i.test(ch) && Math.random() < opts.typoChance) {
                const wrong = adjacentKey(ch);
                if (wrong) {
                    shown += wrong;
                    textEl.textContent = shown;
                    try { opts.onChar?.(wrong, shown.length - 1); } catch (e) {}
                    markTyping();
                    await sleep(delayFor(wrong, opts));
                    if (id !== runId || skipRequested) continue;
                    await sleep(180 + Math.random() * 180); // realize
                    if (id !== runId || skipRequested) continue;
                    shown = shown.slice(0, -1);
                    textEl.textContent = shown;
                    markTyping();
                    await sleep(90);
                    lastWasTypo = true;
                    continue; // don't advance i - retype correctly next iteration
                }
            }
            lastWasTypo = false;

            shown += ch;
            textEl.textContent = shown;
            try { opts.onChar?.(ch, i); } catch (e) {}
            markTyping();
            await sleep(delayFor(ch, opts));
            i++;
        }

        finish(id);
    }

    // Optional AbortSignal support
    if (opts.signal) {
        if (opts.signal.aborted) {
            state = 'cancelled';
        } else {
            opts.signal.addEventListener('abort', () => controller.cancel(), { once: true });
        }
    }

    /** @type {TypewriterController} */
    const controller = {
        start() {
            if (state === 'typing') return donePromise;
            donePromise = new Promise((r) => (doneResolve = r));
            run();
            return donePromise;
        },
        skip() {
            skipRequested = true;
        },
        cancel() {
            runId++;
            state = 'cancelled';
            clearTimeout(idleTimeout);
            el.classList.remove('typewriter--typing');
        },
        restart() {
            this.cancel();
            donePromise = new Promise((r) => (doneResolve = r));
            run();
            return donePromise;
        },
        get done() { return donePromise; },
        get state() { return state; },
    };

    if (opts.autoStart && state !== 'cancelled') {
        run();
    }

    return controller;
}

/**
 * @typedef {Object} TypewriterOptions
 * @property {number}  [baseDelay=52]            Base ms between keystrokes.
 * @property {boolean} [variableTiming=true]     Humanize per-key timing.
 * @property {boolean} [punctuationPauses=true]  Longer pauses after . , ; etc.
 * @property {boolean} [thinkingPauses=true]     Rare mid-sentence pauses.
 * @property {number}  [thinkingChance=0.014]    Probability per character.
 * @property {boolean} [typos=false]             Occasionally type a wrong key and correct it.
 * @property {number}  [typoChance=0.018]        Probability per letter character.
 * @property {boolean} [cursor=true]             Auto-render a blinking cursor.
 * @property {number}  [cursorIdleDelay=500]     Ms after typing before cursor starts blinking.
 * @property {boolean} [respectReducedMotion=true] Skip animation under prefers-reduced-motion.
 * @property {boolean} [accessible=true]         Render an sr-only copy of full text.
 * @property {boolean} [autoStart=true]          Start typing immediately.
 * @property {AbortSignal} [signal]              Cancel animation via AbortSignal.
 * @property {(ch: string, i: number) => void} [onChar]  Called for each character typed.
 * @property {() => void} [onDone]               Called when typing completes.
 */

/**
 * @typedef {'idle' | 'typing' | 'done' | 'cancelled'} TypewriterState
 */

/**
 * @typedef {Object} TypewriterController
 * @property {() => Promise<void>} start    Start (or restart) typing.
 * @property {() => void}          skip     Instantly complete typing.
 * @property {() => void}          cancel   Abort typing.
 * @property {() => Promise<void>} restart  Cancel and type from the beginning.
 * @property {Promise<void>}       done     Resolves when typing completes.
 * @property {TypewriterState}     state    Current state.
 */