/**
 * @typedef {Object} Nation
 * @property {string} id
 * @property {string} name
 * @property {string} color
 * @property {string} icon
 *
 * @typedef {Object} Backlink
 * @property {string} date ISO string
 * @property {('capture'|'review')} type
 * @property {string} detail
 *
 * @typedef {Object} Hex
 * @property {string} id
 * @property {string|null} nationId
 * @property {string} name
 * @property {string} content
 * @property {number|null} x
 * @property {number|null} y
 * @property {number} current_interval
 * @property {string|null} last_review_date
 * @property {string} next_review_date
 * @property {Backlink[]} backlinks
 *
 * @typedef {Object} Journal
 * @property {string} id
 * @property {string} entry_date ISO date (YYYY-MM-DD)
 * @property {string} raw_text
 */

const STORAGE_KEY = 'hexidian-state-v1';

/**
 * @returns {{nations:Nation[], hexes:Hex[], journals:Journal[]}}
 */
function createEmptyState() {
  return {
    nations: [],
    hexes: [],
    journals: [],
  };
}

let state = loadState();
const listeners = new Set();

function loadState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyState();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') {
      return createEmptyState();
    }
    ensureState(parsed);
    return parsed;
  } catch (err) {
    console.warn('Failed to load state, starting empty', err);
    return createEmptyState();
  }
}

function ensureState(candidate) {
  if (!Array.isArray(candidate.nations)) candidate.nations = [];
  if (!Array.isArray(candidate.hexes)) candidate.hexes = [];
  if (!Array.isArray(candidate.journals)) candidate.journals = [];
}

function persist() {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.warn('Persist failed', err);
  }
}

function notify() {
  for (const listener of listeners) {
    listener(state);
  }
}

export function subscribe(listener) {
  listeners.add(listener);
  listener(state);
  return () => listeners.delete(listener);
}

export function getState() {
  return state;
}

function commit(next) {
  state = next;
  persist();
  notify();
}

function cloneState() {
  return JSON.parse(JSON.stringify(state));
}

export function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function createId(prefix) {
  return `${prefix}-${Math.random().toString(36).slice(2, 8)}-${Date.now().toString(
    36,
  )}`;
}

function normalizeTag(tag) {
  return tag.trim().replace(/^#/, '').toLowerCase();
}

export function parseTags(text) {
  const tags = [];
  const regex = /#([\p{L}\p{N}_-]+)/giu;
  let match;
  while ((match = regex.exec(text))) {
    tags.push(normalizeTag(match[1]));
  }
  return tags;
}

export function addJournalEntry(rawText) {
  const trimmed = rawText.trim();
  if (!trimmed) {
    return { created: [] };
  }
  const next = cloneState();
  const entry = {
    id: createId('journal'),
    entry_date: todayISO(),
    raw_text: trimmed,
  };
  next.journals.unshift(entry);

  const tags = parseTags(trimmed);
  const created = [];
  for (const tag of tags) {
    const exists = next.hexes.find((hex) => hex.name.toLowerCase() === tag);
    if (!exists) {
      const hex = createHexFromTag(tag, entry);
      next.hexes.push(hex);
      created.push(hex);
    } else {
      exists.backlinks.unshift({
        date: entry.entry_date,
        type: 'capture',
        detail: `Referenced via journal ${entry.entry_date}`,
      });
    }
  }

  commit(next);
  return { created };
}

function createHexFromTag(tag, entry) {
  return {
    id: createId('hex'),
    nationId: null,
    name: tag,
    content: '',
    x: null,
    y: null,
    current_interval: 1,
    last_review_date: null,
    next_review_date: todayISO(),
    backlinks: [
      {
        date: entry.entry_date,
        type: 'capture',
        detail: `Captured from journal ${entry.entry_date}`,
      },
    ],
  };
}

export function addNation({ name, color, icon }) {
  if (!name.trim()) return;
  const next = cloneState();
  next.nations.push({
    id: createId('nation'),
    name: name.trim(),
    color: color || '#3f51b5',
    icon: icon || '',
  });
  commit(next);
}

export function deleteNation(id) {
  const next = cloneState();
  next.nations = next.nations.filter((nation) => nation.id !== id);
  next.hexes = next.hexes.map((hex) =>
    hex.nationId === id ? { ...hex, nationId: null } : hex,
  );
  commit(next);
}

export function updateHex(id, updates) {
  const next = cloneState();
  next.hexes = next.hexes.map((hex) => {
    if (hex.id !== id) return hex;
    const nextHex = { ...hex, ...updates };
    if (
      typeof nextHex.content === 'string' &&
      nextHex.content.length > 4096
    ) {
      nextHex.content = nextHex.content.slice(0, 4096);
    }
    return nextHex;
  });
  commit(next);
}

export function deleteHex(id) {
  const next = cloneState();
  next.hexes = next.hexes.filter((hex) => hex.id !== id);
  commit(next);
}

const DIRECTIONS = {
  north: { x: 0, y: -1 },
  northeast: { x: 1, y: -1 },
  southeast: { x: 1, y: 0 },
  south: { x: 0, y: 1 },
  southwest: { x: -1, y: 1 },
  northwest: { x: -1, y: 0 },
};

export const directionOptions = Object.keys(DIRECTIONS);

export function placeHexAdjacent({ targetId, anchorId, direction }) {
  const vector = DIRECTIONS[direction];
  if (!vector) return false;
  const next = cloneState();
  const anchor = next.hexes.find((hex) => hex.id === anchorId);
  if (!anchor || typeof anchor.x !== 'number' || typeof anchor.y !== 'number') {
    return false;
  }
  next.hexes = next.hexes.map((hex) =>
    hex.id === targetId
      ? {
          ...hex,
          x: anchor.x + vector.x,
          y: anchor.y + vector.y,
        }
      : hex,
  );
  commit(next);
  return true;
}

export function recordReview(hexId, outcome) {
  const next = cloneState();
  next.hexes = next.hexes.map((hex) => {
    if (hex.id !== hexId) return hex;
    const today = todayISO();
    const updated = { ...hex };
    const pass = outcome === 'pass';
    updated.current_interval = pass ? Math.min(hex.current_interval * 2, 120) : 1;
    updated.last_review_date = today;
    updated.next_review_date = addDays(today, updated.current_interval);
    updated.backlinks.unshift({
      date: today,
      type: 'review',
      detail: pass
        ? `Passed review (+${updated.current_interval}d)`
        : 'Failed review (reset to 1d)',
    });
    return updated;
  });
  commit(next);
}

function addDays(isoDate, days) {
  const d = new Date(isoDate);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

export function exportState() {
  return JSON.stringify(state, null, 2);
}

export function importState(jsonText) {
  try {
    const parsed = JSON.parse(jsonText);
    ensureState(parsed);
    commit(parsed);
    return true;
  } catch (err) {
    console.error('Import failed', err);
    return false;
  }
}

export function resetState() {
  commit(createEmptyState());
}
