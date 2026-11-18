# Electron desktop migration — implementation notes

This directory contains the Electron desktop shell for the GAME migration.

- `main.cjs` owns the BrowserWindow, Chromium WebContentsView, URL validation, frame injection, and a narrow IPC allowlist.
- `preload.cjs` exposes only the desktop operations and event subscriptions used by the React UI.
- `browser-preload.cjs` relays approved mouse/board events from the game browser to the main process; it does not expose Node.js.
- `browser-recorder.js` ports the existing Solitaire pointer, drag, and board-snapshot capture logic and is injected into each Chromium frame.
- `security.cjs` centralizes URL validation and is covered by Node's built-in test runner.

The React UI now uses `src/lib/desktop.ts` instead of importing Tauri APIs. The Windows preview workflow packages the app as an Electron NSIS installer with a separate preview app identity, so it does not replace the existing Tauri installation.

The preview is **not yet a release**. A real Windows build and live-site test are still required to verify Chromium navigation, cross-origin frame capture, pause/resume behavior, Stop/save, Supabase persistence, and reopening records in Buka Data. Keep the old Tauri installation until all those checks pass.
