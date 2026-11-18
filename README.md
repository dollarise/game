# GAME Desktop

GAME is a Windows desktop workspace built with **Electron + Chromium**, React, TypeScript, and Supabase.

## Preserved account features

- Email/password sign-in and password reset through Supabase Auth
- Accounts remain managed by the Super Admin; public self-registration is not enabled
- Per-user settings and saved recordings remain stored in Supabase with Row Level Security
- Browser, Buka Data, and Manajemen Pengguna screens remain part of the workspace

## Desktop architecture

- Electron owns the desktop window and embeds a Chromium `WebContentsView`
- The target website is rendered inside the GAME window; it does not launch the user's external Chrome
- The renderer communicates with Electron through a restricted preload bridge
- Context isolation is enabled and Node integration is disabled
- Chromium DevTools Protocol is used to install input capture in the game page and its child frames
- The web deployment remains a Vite/React site and uses its web browser frame; the Electron browser is desktop-only

## Recording controls

- Clicking Solitaire **Play / Start Game** starts recording automatically
- The sidebar **Rekam** button remains available as a manual fallback
- **Rekam** starts a GAME-owned recording session when automatic start is not used
- **Jeda** suspends event capture and pauses the timer
- **Lanjutkan** resumes capture and timing
- **Stop** ends the session and saves it to Buka Data
- Solitaire's Give up action is treated as an incomplete session

Recording accuracy must be validated against the live Solitaire page, including click, drag, board changes, pause/resume, and auto-stop behavior. A successful installer build alone is not proof that event capture is correct.

## Local development

Install Node.js 22 or newer, then run:

```bash
npm install
npm run desktop:dev
```

For the web interface only:

```bash
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local` when running locally.

## Windows installer

```bash
npm run desktop:build
```

The NSIS installer is written to `release/`. GitHub Actions also builds and uploads the Windows installer artifact.
