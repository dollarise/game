# Electron desktop migration — implementation notes

This directory is the first isolated Electron shell layer for the GAME desktop migration.

- `main.cjs` owns the BrowserWindow, Chromium WebContentsView, URL checks, and a narrow IPC allowlist.
- `preload.cjs` exposes only the desktop operations and event subscriptions needed by the React UI.
- `browser-preload.cjs` exposes a limited recording-event transport to the isolated game browser; it does not expose Node.js.

The existing React UI still imports Tauri APIs and the existing Windows workflow still builds Tauri. These files are therefore **not yet an installable migration** and must not be used as a release. The next integration work must replace the Tauri calls in `src/App.tsx`, port the recording script/event lifecycle, add Electron dependencies and NSIS packaging, update CI, then run Windows build and recording tests before release.
