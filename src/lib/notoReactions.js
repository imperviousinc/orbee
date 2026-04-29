/*
 * noto-reactions - emoji reactions + picker, particles-only.
 *
 *   import { EmojiPicker, playReaction } from './notoReactions.js';
 *   const picker = new EmojiPicker({ onPick: ({code, emoji}) => {...} });
 *   picker.open(anchorEl);
 *   await playReaction(targetEl, { code: '1f525' });
 */

const API = 'https://googlefonts.github.io/noto-emoji-animation/data/api.json';

let _catalogPromise;
export function getCatalog() {
  if (_catalogPromise) return _catalogPromise;
  _catalogPromise = fetch(API).then(r => r.json()).then(d => d.icons);
  return _catalogPromise;
}

/** Convert a Noto codepoint string (e.g. "1f468_200d_1f4bb") to the emoji glyph. */
export function codepointToEmoji(cp) {
  return cp.split('_').map(h => String.fromCodePoint(parseInt(h, 16))).join('');
}

const RECENTS_KEY = 'noto-reactions:recents';
const MAX_RECENTS = 24;

export function getRecents() {
  try { return JSON.parse(localStorage.getItem(RECENTS_KEY) || '[]'); }
  catch { return []; }
}
export function addRecent(code) {
  const cur = getRecents().filter(c => c !== code);
  cur.unshift(code);
  try { localStorage.setItem(RECENTS_KEY, JSON.stringify(cur.slice(0, MAX_RECENTS))); } catch {}
}

// Per-emoji particle palettes; codes not listed fall back to neutral.
const COLORS = {
  '2764':  ['#e8395a', '#f472b6', '#ff6b9d'],   // ❤️
  '2764_fe0f': ['#e8395a', '#f472b6', '#ff6b9d'],
  '1f525': ['#fd7e14', '#f59e0b', '#fbbf24'],   // 🔥
  '26a1':  ['#f7931a', '#fbbf24', '#fde68a'],   // ⚡
  '1f680': ['#6c5ce7', '#a78bfa', '#c4b5fd'],   // 🚀
  '1f44d': ['#fbbf24', '#f59e0b', '#fde68a'],   // 👍
  '1f44e': ['#a78bfa', '#8b5cf6', '#7c3aed'],   // 👎
  '1f602': ['#fbbf24', '#f59e0b', '#fde68a'],   // 😂
  '1f60d': ['#e8395a', '#f472b6', '#ffd60a'],   // 😍
  '1f622': ['#60a5fa', '#93c5fd', '#bfdbfe'],   // 😢
  '1f389': ['#f472b6', '#fbbf24', '#34d399'],   // 🎉
  '1f4af': ['#fbbf24', '#f59e0b', '#e8395a'],   // 💯
  '1fae1': ['#34d399', '#6ee7b7', '#a7f3d0'],   // 🫡
  '1f440': ['#a78bfa', '#8b5cf6', '#c4b5fd'],   // 👀
  '1f919': ['#22d3ee', '#06b6d4', '#67e8f9'],   // 🤙
  '1f44b': ['#fbbf24', '#f59e0b', '#fde68a'],   // 👋
  '1f64f': ['#f472b6', '#fbbf24', '#fde68a'],   // 🙏
};

function colorsFor(code) {
  return COLORS[code] || ['#ffffff', '#e2e2e8', '#a1a1aa'];
}

function spawnParticles(target, code, opts = {}) {
  const colors = colorsFor(code);
  const layer = document.createElement('div');
  layer.className = 'nr-particle-layer';
  const cs = getComputedStyle(target);
  if (cs.position === 'static') target.style.position = 'relative';
  target.appendChild(layer);

  const n = opts.count ?? 8;
  const dist = opts.distance ?? 22;
  let maxDur = 0;

  for (let i = 0; i < n; i++) {
    const p = document.createElement('span');
    p.className = 'nr-particle';
    const angle = (360 / n) * i + (Math.random() * 24 - 12);
    const d = dist + Math.random() * 14;
    const rad = (angle * Math.PI) / 180;
    const tx = Math.cos(rad) * d;
    const ty = Math.sin(rad) * d;
    const size = 3 + Math.random() * 3;
    const color = colors[Math.floor(Math.random() * colors.length)];
    p.style.cssText = `background:${color};width:${size}px;height:${size}px`;
    const dur = 360 + Math.random() * 220;
    if (dur > maxDur) maxDur = dur;
    p.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
        { transform: `translate(calc(-50% + ${tx}px), calc(-50% + ${ty}px)) scale(0.2)`, opacity: 0 },
      ],
      { duration: dur, easing: 'cubic-bezier(0.22, 1, 0.36, 1)', fill: 'forwards' },
    );
    layer.appendChild(p);
  }

  setTimeout(() => layer.remove(), maxDur + 80);
}

/** Play a reaction effect (bounce + particle burst) on `target`. Resolves after ~600ms. */
export async function playReaction(target, opts = {}) {
  const code = opts.code;
  if (!code) throw new Error('playReaction: code required');
  const nativeSel = opts.nativeSel || '.native';
  const native = target.querySelector(nativeSel) || target;

  injectCSS();

  // Force reflow so chained reactions on the same element re-trigger the keyframe.
  native.classList.remove('nr-bounce');
  void native.offsetWidth;
  native.classList.add('nr-bounce');

  spawnParticles(target, code);

  return new Promise((resolve) => setTimeout(resolve, 600));
}

const CAT_ORDER = [
  'Smileys and emotions',
  'People',
  'Animals and nature',
  'Food and drink',
  'Travel and places',
  'Activities and events',
  'Objects',
  'Symbols',
  'Flags',
];

export class EmojiPicker {
  constructor(opts = {}) {
    this.onPick = opts.onPick || (() => {});
    this._root = null;
    this._isOpen = false;
    this._anchor = null;
    this._q = '';
    this._groups = null;
  }

  /** Open the picker. Pass `{ container }` to embed (skips floating positioning + outside-click). */
  open(anchor, options = {}) {
    if (this._isOpen) return;
    injectCSS();
    this._anchor = anchor;
    this._embedded = !!options.container;
    this._build(options.container);
    if (!this._embedded) this._position();
    this._isOpen = true;
    requestAnimationFrame(() => this._root.classList.add('nr-open'));
    if (!this._embedded) {
      setTimeout(() => {
        document.addEventListener('mousedown', this._outside, true);
        document.addEventListener('keydown', this._keys);
      }, 0);
    }
    this._render();
  }

  close() {
    if (!this._isOpen) return;
    this._isOpen = false;
    this._root.classList.remove('nr-open');
    const root = this._root;
    if (this._embedded) {
      root?.remove();
    } else {
      setTimeout(() => { root?.remove(); }, 200);
    }
    this._root = null;
    if (!this._embedded) {
      document.removeEventListener('mousedown', this._outside, true);
      document.removeEventListener('keydown', this._keys);
    }
    this._embedded = false;
  }

  toggle(anchor) { this._isOpen ? this.close() : this.open(anchor); }

  _outside = (e) => {
    if (!this._root) return;
    if (this._root.contains(e.target)) return;
    if (this._anchor && this._anchor.contains(e.target)) return;
    this.close();
  };
  _keys = (e) => {
    if (e.key === 'Escape') this.close();
  };

  _build(container) {
    const root = document.createElement('div');
    root.className = 'nr-picker nr-dark';
    if (container) root.classList.add('nr-embedded');
    root.innerHTML = `
      <div class="nr-search">
        <svg class="nr-search-ico" viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
          <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" stroke-width="1.6"/>
          <path d="M10.5 10.5L14 14" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
        <input type="text" class="nr-search-input" placeholder="Search emoji"/>
      </div>
      <div class="nr-grid-wrap"><div class="nr-grid"></div></div>
    `;
    (container || document.body).appendChild(root);
    this._root = root;

    root.querySelector('.nr-search-input').addEventListener('input', (e) => {
      this._q = e.target.value.toLowerCase().trim();
      this._renderGrid();
    });
  }

  _position() {
    const rect = this._anchor.getBoundingClientRect();
    const w = 300, h = 340, pad = 8;
    let top = rect.bottom + pad;
    let left = rect.left;
    if (top + h > window.innerHeight - pad) top = Math.max(pad, rect.top - h - pad);
    if (left + w > window.innerWidth - pad) left = Math.max(pad, window.innerWidth - w - pad);
    this._root.style.top = `${top}px`;
    this._root.style.left = `${left}px`;
  }

  async _render() {
    try {
      const catalog = await getCatalog();
      this._groups = this._group(catalog);
      this._renderGrid();
    } catch {
      this._root.querySelector('.nr-grid').innerHTML = `<div class="nr-empty">Couldn't load emoji catalog.</div>`;
    }
  }

  _group(catalog) {
    const byCat = new Map();
    for (const cat of CAT_ORDER) byCat.set(cat, []);
    for (const icon of catalog) {
      const cat = CAT_ORDER.includes(icon.categories[0]) ? icon.categories[0] : 'Symbols';
      byCat.get(cat).push(icon);
    }
    for (const arr of byCat.values()) arr.sort((a, b) => b.popularity - a.popularity);
    return byCat;
  }

  _renderGrid() {
    if (!this._groups) return;
    const grid = this._root.querySelector('.nr-grid');
    grid.innerHTML = '';

    const q = this._q;
    const matches = (icon) => {
      if (!q) return true;
      if (icon.codepoint.includes(q)) return true;
      for (const t of (icon.tags || [])) if (t.toLowerCase().includes(q)) return true;
      if ((icon.name || '').toLowerCase().includes(q)) return true;
      return false;
    };

    let any = false;

    if (!q) {
      const recents = getRecents();
      if (recents.length) {
        const icons = recents.map(code => {
          for (const arr of this._groups.values()) {
            const f = arr.find(i => i.codepoint === code);
            if (f) return f;
          }
          return null;
        }).filter(Boolean);
        if (icons.length) {
          grid.appendChild(this._renderGroup('Recent', icons));
          any = true;
        }
      }
    }

    for (const cat of CAT_ORDER) {
      const all = this._groups.get(cat);
      const filtered = all.filter(matches);
      if (filtered.length) {
        grid.appendChild(this._renderGroup(cat, filtered.slice(0, q ? 60 : 40)));
        any = true;
      }
    }

    if (!any) {
      grid.innerHTML = `<div class="nr-empty">No matches.</div>`;
    }
  }

  _renderGroup(name, icons) {
    const g = document.createElement('div');
    g.className = 'nr-group';
    g.dataset.cat = name;
    const head = document.createElement('div');
    head.className = 'nr-group-head';
    head.textContent = name;
    const grid = document.createElement('div');
    grid.className = 'nr-group-grid';
    g.append(head, grid);
    for (const icon of icons) grid.appendChild(this._cell(icon));
    return g;
  }

  _cell(icon) {
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'nr-cell';
    cell.dataset.code = icon.codepoint;
    const n = document.createElement('span');
    n.className = 'native';
    n.textContent = codepointToEmoji(icon.codepoint);
    cell.appendChild(n);

    // 60ms hover debounce so a fast sweep across the grid doesn't spawn dozens of bursts.
    let hoverTimer = null;
    cell.addEventListener('mouseenter', () => {
      hoverTimer = setTimeout(() => {
        playReaction(cell, { code: icon.codepoint }).catch(() => {});
      }, 60);
    });
    cell.addEventListener('mouseleave', () => {
      if (hoverTimer) { clearTimeout(hoverTimer); hoverTimer = null; }
    });

    cell.addEventListener('click', () => {
      addRecent(icon.codepoint);
      this.onPick({
        code: icon.codepoint,
        emoji: codepointToEmoji(icon.codepoint),
        name: icon.name,
        tags: icon.tags,
      });
      this.close();
    });
    return cell;
  }
}

let _cssInjected = false;
function injectCSS() {
  if (_cssInjected) return;
  _cssInjected = true;
  const style = document.createElement('style');
  style.setAttribute('data-noto-reactions', '');
  style.textContent = CSS;
  document.head.appendChild(style);
}

const CSS = `
.nr-picker {
  --nr-bg: var(--overlay-bg, rgba(19,19,24,0.88));
  --nr-border: var(--overlay-edge-light, rgba(255,255,255,0.08));
  --nr-text: var(--text-primary, #e8e6f0);
  --nr-text2: var(--text-secondary, rgba(232,230,240,0.55));
  --nr-text3: var(--text-muted, rgba(232,230,240,0.32));
  --nr-hover: var(--ui-active-bg, rgba(255,255,255,0.07));
  --nr-active: var(--accent-dim, rgba(167,139,250,0.18));
  --nr-accent: var(--accent, #a78bfa);
  position: fixed;
  width: 300px;
  max-width: calc(100vw - 16px);
  height: 340px;
  max-height: calc(100vh - 16px);
  background: var(--nr-bg);
  backdrop-filter: blur(24px) saturate(160%);
  -webkit-backdrop-filter: blur(24px) saturate(160%);
  border: 1px solid var(--nr-border);
  border-radius: 16px;
  box-shadow: 0 24px 64px rgba(0,0,0,0.55), 0 2px 6px rgba(0,0,0,0.3);
  color: var(--nr-text);
  font-family: -apple-system, BlinkMacSystemFont, 'Geist', 'Segoe UI', sans-serif;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  z-index: 10000;
  opacity: 0;
  transform: translateY(6px) scale(0.97);
  transition: opacity 160ms ease-out, transform 220ms cubic-bezier(0.34,1.56,0.64,1);
  transform-origin: top left;
}
.nr-picker.nr-open { opacity: 1; transform: translateY(0) scale(1); }

.nr-picker.nr-embedded {
  position: static;
  width: 100%;
  height: 280px;
  max-width: none;
  max-height: none;
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
  border: none;
  border-radius: 0;
  box-shadow: none;
  z-index: auto;
  transform: none;
}
.nr-picker.nr-embedded .nr-group-head {
  background: transparent;
  backdrop-filter: none;
  -webkit-backdrop-filter: none;
}

.nr-search {
  position: relative;
  padding: 10px 12px 8px;
  border-bottom: 1px solid var(--nr-border);
}
.nr-search-ico {
  position: absolute;
  left: 22px;
  top: 50%;
  transform: translateY(-50%);
  color: var(--nr-text3);
  pointer-events: none;
}
.nr-search-input {
  width: 100%;
  /* Use --border (not --nr-border) - the panel-edge highlight disappears on the input fill in light mode. */
  background: var(--bg-input, rgba(255,255,255,0.05));
  border: 1px solid var(--border, rgba(255,255,255,0.06));
  color: inherit;
  font: inherit;
  font-size: 13px;
  padding: 8px 12px 8px 32px;
  border-radius: 10px;
  outline: none;
  transition: border-color 120ms, background 120ms;
}
.nr-search-input:focus {
  border-color: var(--nr-accent);
}
.nr-search-input::placeholder { color: var(--nr-text3); }

.nr-grid-wrap {
  flex: 1;
  overflow-y: auto;
  padding: 0 6px 8px;
  scrollbar-width: thin;
  scrollbar-color: var(--nr-border) transparent;
}
.nr-grid-wrap::-webkit-scrollbar { width: 8px; }
.nr-grid-wrap::-webkit-scrollbar-thumb {
  background: var(--nr-border);
  border-radius: 4px;
  border: 2px solid transparent;
  background-clip: padding-box;
}
.nr-grid-wrap::-webkit-scrollbar-thumb:hover { background: var(--nr-text3); background-clip: padding-box; }

.nr-group { margin-bottom: 4px; }
.nr-group-head {
  font-size: 10.5px;
  font-weight: 600;
  color: var(--nr-text2);
  padding: 10px 8px 6px;
  text-transform: uppercase;
  letter-spacing: 1px;
  position: sticky;
  top: 0;
  background: linear-gradient(to bottom, var(--nr-bg) 70%, transparent);
  backdrop-filter: blur(8px);
  -webkit-backdrop-filter: blur(8px);
  z-index: 1;
}

.nr-group-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 2px;
}

.nr-cell {
  position: relative;
  aspect-ratio: 1 / 1;
  background: transparent;
  border: none;
  color: inherit;
  border-radius: 8px;
  cursor: pointer;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  transition: background 100ms ease-out, transform 120ms ease-out;
}
.nr-cell:hover { background: var(--nr-hover); }
.nr-cell:active { transform: scale(0.9); }
.nr-cell .native {
  font-size: 24px;
  line-height: 1;
  user-select: none;
}

.nr-empty {
  padding: 48px 0;
  text-align: center;
  color: var(--nr-text3);
  font-size: 13px;
}

.native {
  transform-origin: center;
  display: inline-block;
  transition: transform 140ms cubic-bezier(0.34, 1.56, 0.64, 1);
}
.nr-cell:hover .native,
.shelf-emoji:hover .native,
.shelf-emoji:hover .shelf-emoji-native {
  transform: scale(1.35);
}
@keyframes nr-bounce {
  0%   { transform: scale(1); }
  40%  { transform: scale(1.5) rotate(-6deg); }
  70%  { transform: scale(1.2) rotate(4deg); }
  100% { transform: scale(1.35) rotate(0); }
}
/* Keyframe ends at scale(1.35) so it hands off cleanly to the :hover rule (no fill-mode). */
.nr-bounce { animation: nr-bounce 280ms cubic-bezier(0.34,1.56,0.64,1); }

.nr-particle-layer {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: visible;
  z-index: 5;
}
.nr-particle {
  position: absolute;
  top: 50%;
  left: 50%;
  border-radius: 50%;
  transform: translate(-50%, -50%);
  pointer-events: none;
  will-change: transform, opacity;
}
`;
