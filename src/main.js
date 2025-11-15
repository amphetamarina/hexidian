import {
  subscribe,
  addJournalEntry,
  addNation,
  deleteNation,
  updateHex,
  deleteHex,
  recordReview,
  exportState,
  importState,
  resetState,
  todayISO,
} from './state.js';

const elements = {
  exportBtn: document.getElementById('export-state'),
  importInput: document.getElementById('import-state'),
  resetBtn: document.getElementById('reset-state'),
  journalForm: document.getElementById('journal-dock'),
  journalText: document.getElementById('journal-text'),
  mapStatus: document.getElementById('map-status'),
  hexMap: document.getElementById('hex-map'),
  unplacedList: document.getElementById('unplaced-list'),
  unplacedCount: document.getElementById('unplaced-count'),
  tagFilterInput: document.getElementById('tag-filter'),
  tagFilterClear: document.getElementById('tag-filter-clear'),
  tagFilterOptions: document.getElementById('tag-filter-options'),
  hexOverlay: document.getElementById('hex-overlay'),
  overlayClose: document.getElementById('hex-overlay-close'),
  overlayTitle: document.getElementById('overlay-title'),
  overlayName: document.getElementById('overlay-name'),
  overlayNation: document.getElementById('overlay-nation'),
  overlayContent: document.getElementById('overlay-content'),
  overlayX: document.getElementById('overlay-x'),
  overlayY: document.getElementById('overlay-y'),
  overlayBacklinks: document.getElementById('overlay-backlinks'),
  overlayInterval: document.getElementById('overlay-interval'),
  overlayNextReview: document.getElementById('overlay-next-review'),
  overlayDelete: document.getElementById('overlay-delete'),
  overlayReviewPass: document.getElementById('overlay-review-pass'),
  overlayReviewFail: document.getElementById('overlay-review-fail'),
  overlayOpenNations: document.getElementById('overlay-open-nations'),
  nationsToggle: document.getElementById('nations-toggle'),
  nationsOverlay: document.getElementById('nations-overlay'),
  nationsOverlayClose: document.getElementById('nations-overlay-close'),
  nationForm: document.getElementById('nation-form'),
  nationName: document.getElementById('nation-name'),
  nationColor: document.getElementById('nation-color'),
  nationIcon: document.getElementById('nation-icon'),
  nationList: document.getElementById('nation-list'),
};

let selectedHexId = null;
let latestState = null;
let mapStatusTimeout = null;
let isHexOverlayOpen = false;
let isNationsOverlayOpen = false;
let activeTagFilter = '';
let lastTagFilter = '';
let mapViewport = null;
let baseViewBox = null;
let mapSvgEl = null;
let isPointerDown = false;
let pointerId = null;
let panStart = null;
let panOrigin = null;
let skipNextMapClick = false;
let mapDidPan = false;

function init() {
  elements.exportBtn?.addEventListener('click', handleExport);
  elements.importInput?.addEventListener('change', handleImport);
  elements.resetBtn?.addEventListener('click', handleReset);
  elements.journalForm?.addEventListener('submit', handleJournalSubmit);
  elements.hexMap?.addEventListener('click', handleMapClick);
  elements.hexMap?.addEventListener('pointerdown', handleMapPointerDown);
  elements.hexMap?.addEventListener('pointermove', handleMapPointerMove);
  elements.hexMap?.addEventListener('pointerup', handleMapPointerUp);
  elements.hexMap?.addEventListener('pointercancel', handleMapPointerUp);
  elements.hexMap?.addEventListener('wheel', handleMapWheel, { passive: false });
  elements.unplacedList?.addEventListener('click', handleUnplacedClick);
  elements.tagFilterInput?.addEventListener('input', handleTagFilterInput);
  elements.tagFilterClear?.addEventListener('click', handleTagFilterClear);

  elements.overlayClose?.addEventListener('click', closeHexOverlay);
  elements.overlayDelete?.addEventListener('click', handleDeleteHex);
  elements.overlayReviewPass?.addEventListener('click', handleOverlayReview);
  elements.overlayReviewFail?.addEventListener('click', handleOverlayReview);
  elements.hexOverlay?.addEventListener('input', handleOverlayInput);
  elements.hexOverlay?.addEventListener('change', handleOverlayChange);
  elements.overlayOpenNations?.addEventListener('click', openNationsOverlay);

  elements.nationsToggle?.addEventListener('click', openNationsOverlay);
  elements.nationsOverlayClose?.addEventListener('click', closeNationsOverlay);
  elements.nationForm?.addEventListener('submit', handleNationSubmit);
  elements.nationList?.addEventListener('click', handleNationListClick);

  subscribe((state) => {
    latestState = state;
    if (selectedHexId && !state.hexes.find((hex) => hex.id === selectedHexId)) {
      selectedHexId = null;
      isHexOverlayOpen = false;
    }
    render(state);
  });
}

function handleExport() {
  const blob = new Blob([exportState()], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `hexidian-${todayISO()}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function handleImport(event) {
  const file = event.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (loadEvent) => {
    const text = loadEvent.target?.result;
    if (typeof text === 'string') {
      const success = importState(text);
      alert(success ? 'State imported successfully.' : 'Import failed.');
    }
    event.target.value = '';
  };
  reader.readAsText(file);
}

function handleReset() {
  if (confirm('Reset all stored data? This cannot be undone.')) {
    resetState();
  }
}

function handleJournalSubmit(event) {
  event.preventDefault();
  const text = elements.journalText.value.trim();
  if (!text) return;
  const { created } = addJournalEntry(text);
  elements.journalText.value = '';
  if (created.length) {
    selectedHexId = created[0].id;
    isHexOverlayOpen = true;
    flashMapStatus(
      `Created ${created
        .map((hex) => `#${hex.name}`)
        .join(', ')} — tap a tile to place.`,
    );
  } else {
    flashMapStatus('Entry saved. No new tags were detected.');
  }
}

function handleMapClick(event) {
  if (skipNextMapClick) {
    skipNextMapClick = false;
    return;
  }
  const targetHex = event.target.closest('[data-hex-id]');
  if (targetHex) {
    openHexOverlay(targetHex.dataset.hexId);
    return;
  }
  const cell = event.target.closest('[data-q][data-r]');
  if (!cell) return;
  if (!selectedHexId) {
    flashMapStatus('Select or create a hex before placing it.');
    return;
  }
  updateHex(selectedHexId, {
    x: Number(cell.dataset.q),
    y: Number(cell.dataset.r),
  });
}

function handleUnplacedClick(event) {
  const button = event.target.closest('button[data-hex-id]');
  if (!button) return;
  selectedHexId = button.dataset.hexId;
  isHexOverlayOpen = true;
  render(latestState);
}

function handleTagFilterInput(event) {
  const raw = event.target.value.trim();
  const normalized = raw.replace(/^#/, '').toLowerCase();
  activeTagFilter = normalized;
  mapViewport = null;
  render(latestState);
}

function handleTagFilterClear() {
  if (!activeTagFilter) return;
  activeTagFilter = '';
  if (elements.tagFilterInput) {
    elements.tagFilterInput.value = '';
  }
  mapViewport = null;
  render(latestState);
}

function handleOverlayInput(event) {
  if (!isHexOverlayOpen || !selectedHexId) return;
  const field = event.target;
  const value = field.value;
  if (field.id === 'overlay-name') {
    updateHex(selectedHexId, { name: value });
  } else if (field.id === 'overlay-content') {
    updateHex(selectedHexId, { content: value });
  } else if (field.id === 'overlay-x') {
    updateHex(selectedHexId, { x: value === '' ? null : Number(value) });
  } else if (field.id === 'overlay-y') {
    updateHex(selectedHexId, { y: value === '' ? null : Number(value) });
  }
}

function handleMapPointerDown(event) {
  if (!mapViewport || !elements.hexMap) return;
  isPointerDown = true;
  pointerId = event.pointerId;
  panStart = { x: event.clientX, y: event.clientY };
  panOrigin = { x: mapViewport.x, y: mapViewport.y };
  mapDidPan = false;
  elements.hexMap.setPointerCapture?.(pointerId);
  event.preventDefault();
}

function handleMapPointerMove(event) {
  if (!isPointerDown || event.pointerId !== pointerId || !mapViewport) return;
  const dx = event.clientX - panStart.x;
  const dy = event.clientY - panStart.y;
  if (!mapDidPan && Math.hypot(dx, dy) > 4) {
    mapDidPan = true;
  }
  if (!mapDidPan) return;
  const rect = elements.hexMap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const unitsX = mapViewport.width / rect.width;
  const unitsY = mapViewport.height / rect.height;
  mapViewport.x = panOrigin.x - dx * unitsX;
  mapViewport.y = panOrigin.y - dy * unitsY;
  applyMapViewBox();
}

function handleMapPointerUp(event) {
  if (event.pointerId !== pointerId) return;
  elements.hexMap.releasePointerCapture?.(pointerId);
  isPointerDown = false;
  pointerId = null;
  panStart = null;
  panOrigin = null;
  if (mapDidPan) {
    skipNextMapClick = true;
    mapDidPan = false;
  }
}

function handleMapWheel(event) {
  if (!mapViewport || !baseViewBox || !elements.hexMap) return;
  event.preventDefault();
  const rect = elements.hexMap.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const direction = event.deltaY < 0 ? 0.9 : 1.1;
  const aspect =
    baseViewBox.height === 0
      ? 1
      : Math.max(baseViewBox.width / baseViewBox.height, 0.0001);
  const minWidth = baseViewBox.width / 8;
  const maxWidth = baseViewBox.width * 5;
  const nextWidth = clamp(mapViewport.width * direction, minWidth, maxWidth);
  const nextHeight = nextWidth / aspect;
  const px = (event.clientX - rect.left) / rect.width;
  const py = (event.clientY - rect.top) / rect.height;
  const focusX = mapViewport.x + mapViewport.width * px;
  const focusY = mapViewport.y + mapViewport.height * py;
  mapViewport = {
    x: focusX - nextWidth * px,
    y: focusY - nextHeight * py,
    width: nextWidth,
    height: nextHeight,
  };
  applyMapViewBox();
}

function handleOverlayChange(event) {
  if (!isHexOverlayOpen || !selectedHexId) return;
  if (event.target.id === 'overlay-nation') {
    const value = event.target.value || null;
    updateHex(selectedHexId, { nationId: value || null });
  }
}

function handleDeleteHex() {
  if (!selectedHexId) return;
  if (confirm('Delete this hex?')) {
    deleteHex(selectedHexId);
    isHexOverlayOpen = false;
  }
}

function handleOverlayReview(event) {
  const outcome = event.currentTarget.dataset.reviewOutcome;
  if (!selectedHexId || !outcome) return;
  recordReview(selectedHexId, outcome);
}

function handleNationSubmit(event) {
  event.preventDefault();
  addNation({
    name: elements.nationName.value,
    color: elements.nationColor.value,
    icon: elements.nationIcon.value,
  });
  elements.nationName.value = '';
  elements.nationIcon.value = '';
}

function handleNationListClick(event) {
  const button = event.target.closest('[data-action="delete-nation"]');
  if (!button) return;
  if (confirm('Delete this nation? Assigned hexes will become unassigned.')) {
    deleteNation(button.dataset.nationId);
  }
}

function openHexOverlay(hexId) {
  selectedHexId = hexId;
  isHexOverlayOpen = true;
  render(latestState);
}

function closeHexOverlay() {
  isHexOverlayOpen = false;
  render(latestState);
}

function openNationsOverlay() {
  isNationsOverlayOpen = true;
  render(latestState);
}

function closeNationsOverlay() {
  isNationsOverlayOpen = false;
  render(latestState);
}

function render(state) {
  if (!state) return;
  if (activeTagFilter && selectedHexId) {
    const currentHex = state.hexes.find((hex) => hex.id === selectedHexId);
    if (currentHex && !matchesFilter(currentHex)) {
      selectedHexId = null;
      isHexOverlayOpen = false;
    }
  }
  renderUnplacedTray(state);
  renderMap(state);
  renderHexOverlay(state);
  renderNationsOverlay(state);
  renderTagFilterOptions(state);
}

function renderUnplacedTray(state) {
  if (!elements.unplacedList) return;
  const totalUnplaced = state.hexes.filter((hex) => !hex.nationId).length;
  const unplaced = state.hexes.filter(
    (hex) => !hex.nationId && matchesFilter(hex),
  );
  elements.unplacedCount.textContent = activeTagFilter
    ? `${unplaced.length}/${totalUnplaced}`
    : totalUnplaced.toString();
  if (!unplaced.length) {
    elements.unplacedList.innerHTML =
      activeTagFilter && totalUnplaced
        ? '<div class="empty-state">No unassigned hex matches this filter.</div>'
        : '<div class="empty-state">All hexes are assigned.</div>';
    return;
  }
  elements.unplacedList.innerHTML = unplaced
    .map(
      (hex) => `
        <button type="button" class="tag-pill ${
          hex.id === selectedHexId ? 'is-active' : ''
        }" data-hex-id="${hex.id}">
          #${escapeHTML(hex.name)}
        </button>
      `,
    )
    .join('');
}

function renderMap(state) {
  if (!elements.hexMap) return;
  updateMapStatus(state);
  const size = 36;
  const filteredHexes = state.hexes.filter(matchesFilter);
  if (!filteredHexes.length) {
    elements.hexMap.innerHTML = activeTagFilter
      ? '<div class="empty-state">No hex matches this tag filter.</div>'
      : '<div class="empty-state">Add or place hexes to see them here.</div>';
    mapSvgEl = null;
    baseViewBox = null;
    mapViewport = null;
    return;
  }
  const placed = filteredHexes.filter(
    (hex) => typeof hex.x === 'number' && typeof hex.y === 'number',
  );
  const boundsSource = placed.length ? placed : [{ x: 0, y: 0 }];
  const bounds = getGridBounds(boundsSource);
  const cells = [];
  for (let q = bounds.minQ; q <= bounds.maxQ; q++) {
    for (let r = bounds.minR; r <= bounds.maxR; r++) {
      cells.push({ q, r });
    }
  }
  const cellPositions = cells.map((cell) => ({
    ...cell,
    ...axialToPixel(cell.q, cell.r, size),
  }));
  const xs = cellPositions.map((p) => p.x);
  const ys = cellPositions.map((p) => p.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const margin = size * 2;
  const width = Math.max(10, maxX - minX + margin * 2);
  const height = Math.max(10, maxY - minY + margin * 2);
  const newBaseViewBox = {
    x: minX - margin,
    y: minY - margin,
    width,
    height,
  };
  baseViewBox = newBaseViewBox;
  if (!mapViewport) {
    mapViewport = { ...baseViewBox };
  } else {
    const aspect =
      baseViewBox.height === 0
        ? 1
        : Math.max(baseViewBox.width / baseViewBox.height, 0.0001);
    const minWidth = baseViewBox.width / 8;
    const maxWidth = baseViewBox.width * 5;
    mapViewport.width = clamp(mapViewport.width, minWidth, maxWidth);
    mapViewport.height = mapViewport.width / aspect;
  }

  const cellMarkup = cellPositions
    .map(({ q, r, x, y }) => {
      const points = hexPoints(x, y, size * 0.92);
      const occupyingHex = placed.find((hex) => hex.x === q && hex.y === r);
      const isSelectedTarget =
        occupyingHex && occupyingHex.id === selectedHexId;
      const classes = [
        'hex-grid-cell',
        selectedHexId ? 'is-interactive' : '',
        isSelectedTarget ? 'is-target' : '',
        occupyingHex ? 'is-occupied' : '',
      ]
        .filter(Boolean)
        .join(' ');
      return `
        <g class="${classes}" data-q="${q}" data-r="${r}">
          <polygon points="${points}"></polygon>
          <text class="hex-grid-coords" x="${x}" y="${
        y + 3
      }" text-anchor="middle">${q},${r}</text>
        </g>
      `;
    })
    .join('');

  const tileMarkup = placed
    .map((hex) => {
      const { x, y } = axialToPixel(hex.x, hex.y, size);
      const points = hexPoints(x, y, size * 0.7);
      const nation =
        hex.nationId &&
        state.nations.find((candidate) => candidate.id === hex.nationId);
      const fill = escapeHTML(nation ? nation.color : '#2f3554');
      const stroke = hex.id === selectedHexId ? '#ffffff' : 'rgba(0,0,0,0.4)';
      return `
        <g data-hex-id="${hex.id}" class="hex-tile">
          <polygon points="${points}" fill="${fill}" stroke="${stroke}" stroke-width="2" />
          <text x="${x}" y="${y}" fill="#fff" font-size="10" text-anchor="middle" dominant-baseline="middle">
            ${escapeHTML(hex.name.slice(0, 8))}
          </text>
        </g>
      `;
    })
    .join('');

  elements.hexMap.innerHTML = `<svg class="hex-svg" xmlns="http://www.w3.org/2000/svg">${cellMarkup}${tileMarkup}</svg>`;
  mapSvgEl = elements.hexMap.querySelector('svg');
  applyMapViewBox();
}

function renderHexOverlay(state) {
  if (!elements.hexOverlay) return;
  if (!isHexOverlayOpen || !selectedHexId) {
    elements.hexOverlay.classList.add('hidden');
    elements.hexOverlay.setAttribute('aria-hidden', 'true');
    return;
  }
  const hex = state.hexes.find((item) => item.id === selectedHexId);
  if (!hex) {
    elements.hexOverlay.classList.add('hidden');
    elements.hexOverlay.setAttribute('aria-hidden', 'true');
    return;
  }
  elements.hexOverlay.classList.remove('hidden');
  elements.hexOverlay.setAttribute('aria-hidden', 'false');
  elements.overlayTitle.textContent = `Editing ${hex.name}`;
  elements.overlayName.value = hex.name;
  elements.overlayContent.value = hex.content;
  elements.overlayX.value = hex.x ?? '';
  elements.overlayY.value = hex.y ?? '';
  elements.overlayNation.innerHTML = buildNationOptions(state, hex.nationId);
  elements.overlayInterval.textContent = `${hex.current_interval} day${
    hex.current_interval === 1 ? '' : 's'
  }`;
  elements.overlayNextReview.textContent = hex.next_review_date;
  elements.overlayDelete.dataset.hexId = hex.id;
  elements.overlayReviewPass.dataset.hexId = hex.id;
  elements.overlayReviewFail.dataset.hexId = hex.id;

  const backlinks = hex.backlinks.slice(0, 8);
  if (!backlinks.length) {
    elements.overlayBacklinks.innerHTML = '<li>No backlinks yet.</li>';
  } else {
    elements.overlayBacklinks.innerHTML = backlinks
      .map(
        (link) =>
          `<li>[${link.type}] ${link.date} — ${escapeHTML(link.detail)}</li>`,
      )
      .join('');
  }
}

function renderNationsOverlay(state) {
  if (!elements.nationsOverlay) return;
  if (!isNationsOverlayOpen) {
    elements.nationsOverlay.classList.add('hidden');
    elements.nationsOverlay.setAttribute('aria-hidden', 'true');
    return;
  }
  elements.nationsOverlay.classList.remove('hidden');
  elements.nationsOverlay.setAttribute('aria-hidden', 'false');
  if (!state.nations.length) {
    elements.nationList.innerHTML =
      '<div class="empty-state">No nations yet. Add one above.</div>';
    return;
  }
  elements.nationList.innerHTML = state.nations
    .map((nation) => {
      const hexCount = state.hexes.filter(
        (hex) => hex.nationId === nation.id,
      ).length;
      return `
        <div class="nation-card">
          <div class="nation-meta">
            <span class="nation-swatch" style="background:${escapeHTML(
              nation.color || '#3f51b5',
            )}"></span>
            <div>
              <div><strong>${escapeHTML(nation.name)}</strong></div>
              <div class="tagline">${escapeHTML(nation.icon || '')}</div>
            </div>
          </div>
          <div class="hex-meta">
            <span>${hexCount} hex${hexCount === 1 ? '' : 'es'}</span>
            <button
              type="button"
              class="danger"
              data-action="delete-nation"
              data-nation-id="${nation.id}"
            >
              Delete
            </button>
          </div>
        </div>
      `;
    })
    .join('');
}

function renderTagFilterOptions(state) {
  if (!elements.tagFilterOptions) return;
  const nameMap = new Map();
  state.hexes.forEach((hex) => {
    const key = hex.name.toLowerCase();
    if (!nameMap.has(key)) {
      nameMap.set(key, hex.name);
    }
  });
  const names = Array.from(nameMap.values())
    .sort((a, b) => a.localeCompare(b))
    .map((name) => `<option value="${escapeHTML(name)}">`);
  elements.tagFilterOptions.innerHTML = names.join('');
}

function buildNationOptions(state, selectedId) {
  const options = [
    `<option value="" ${selectedId ? '' : 'selected'}>Unassigned</option>`,
    ...state.nations.map(
      (nation) =>
        `<option value="${nation.id}" ${
          nation.id === selectedId ? 'selected' : ''
        }>${escapeHTML(nation.name)}</option>`,
    ),
  ];
  return options.join('');
}

function updateMapStatus(state) {
  if (!elements.mapStatus) return;
  elements.mapStatus.classList.remove('is-warning');
  const filteredCount = state.hexes.filter(matchesFilter).length;
  if (!state.hexes.length) {
    elements.mapStatus.textContent =
      'Capture a journal entry with #tags to generate your first hex.';
    return;
  }
  if (activeTagFilter && !filteredCount) {
    elements.mapStatus.textContent = `Filter #${activeTagFilter} — no matching hexes. Clear the filter to view all.`;
    return;
  }
  if (!selectedHexId) {
    const filterNote = activeTagFilter
      ? `Filter #${activeTagFilter} (${filteredCount}). `
      : '';
    elements.mapStatus.textContent = `${filterNote}Select a hex from the tray or tap one on the map to edit/move it.`;
    return;
  }
  const hex = state.hexes.find((item) => item.id === selectedHexId);
  if (!hex) {
    elements.mapStatus.textContent = 'Select a hex to begin.';
    return;
  }
  const location =
    typeof hex.x === 'number' && typeof hex.y === 'number'
      ? `Currently at (${hex.x}, ${hex.y}). Click another tile to move.`
      : 'Not placed yet. Click a tile to drop it.';
  const filterNote = activeTagFilter ? `Filter #${activeTagFilter}. ` : '';
  elements.mapStatus.textContent = `${filterNote}Editing ${hex.name}. ${location}`;
}

function flashMapStatus(message) {
  if (!elements.mapStatus) return;
  elements.mapStatus.textContent = message;
  elements.mapStatus.classList.add('is-warning');
  clearTimeout(mapStatusTimeout);
  mapStatusTimeout = window.setTimeout(() => {
    elements.mapStatus?.classList.remove('is-warning');
    updateMapStatus(latestState);
  }, 2200);
}

function getGridBounds(placed) {
  if (!placed.length) {
    return { minQ: -4, maxQ: 4, minR: -4, maxR: 4 };
  }
  const qs = placed.map((hex) => hex.x);
  const rs = placed.map((hex) => hex.y);
  return {
    minQ: Math.min(...qs) - 2,
    maxQ: Math.max(...qs) + 2,
    minR: Math.min(...rs) - 2,
    maxR: Math.max(...rs) + 2,
  };
}

function axialToPixel(q, r, size) {
  const x = size * Math.sqrt(3) * (q + r / 2);
  const y = size * 1.5 * r;
  return { x, y };
}

function hexPoints(cx, cy, size) {
  const points = [];
  for (let i = 0; i < 6; i++) {
    const angle = ((60 * i - 30) * Math.PI) / 180;
    const x = cx + size * Math.cos(angle);
    const y = cy + size * Math.sin(angle);
    points.push(`${x},${y}`);
  }
  return points.join(' ');
}

function applyMapViewBox() {
  if (!mapSvgEl || !mapViewport) return;
  mapSvgEl.setAttribute(
    'viewBox',
    `${mapViewport.x} ${mapViewport.y} ${mapViewport.width} ${mapViewport.height}`,
  );
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function matchesFilter(hex) {
  if (!activeTagFilter) return true;
  return hex.name.toLowerCase().includes(activeTagFilter);
}

function escapeHTML(value = '') {
  return value
    .toString()
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

init();
