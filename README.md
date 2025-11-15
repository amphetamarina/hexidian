# Hexidian

Local-first knowledge cartographer inspired by spatial memory palaces and SRS review loops. Everything runs in the browser with no backend requirements.

## Features
- Bottom-docked journal capture with automatic `#tag` detection that spawns new hexes ready for placement.
- Immersive SVG hex map with smooth pan + zoom gestures so you can roam large worlds and tap tiles to drop or move the active hex.
- Lightweight overlay editor for each hex with nation assignment, coordinates, backlinks, and SRS controls (pass/fail directly from the sheet).
- Tag filter bar and datalist suggestions to focus the tray/map on a specific concept instantly.
- Nations overlay for quick color/icon management without leaving the map.
- Local storage persistence plus JSON import/export and reset controls.

## Usage
1. Open `index.html` directly in a modern browser or serve the folder with any static HTTP server (e.g., `python3 -m http.server`).
2. Capture thoughts from the journal dock (press Enter). Each new `#tag` becomes a hex that shows up in the unplaced tray.
3. Select a hex (from the tray or map), tap a grid tile to position it, then edit its definition and metadata via the overlay.
4. Use the overlay’s Pass/Fail buttons during review sessions to advance or reset the SRS interval.
5. Export your state JSON periodically for backups; import restores everything on another device.

All data stays on-device; no network calls or external services are required.
