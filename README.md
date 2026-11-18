# Game — Website Workspace

A browser workspace with two sections: **Rekam** and **Buka Data**. Users sign in with email and password. Only the Super Admin creates accounts manually in Supabase Auth; public self-registration is not part of the app. Each user's target website setting and saved records are isolated by Supabase Row Level Security.

## Features

- Email/password sign-in, password reset, and sign-out; accounts are created manually by the Super Admin
- Configurable target website URL (default: https://1xlite-6487.com/)
- Record and manage saved website addresses
- Per-user settings and records protected by Supabase RLS
- Responsive Vite + React + TypeScript interface

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Supabase publishable/anon key) in `.env.local`.

## Supabase Auth configuration

Enable the Email provider in Supabase Authentication and disable public sign-ups (Authentication → Settings → User Signups → turn off “Allow new users to sign up”). The Super Admin creates users manually from Authentication → Users using the Supabase dashboard. Add the local and deployed app URLs to Supabase Auth URL Configuration (Site URL and Redirect URLs) so password reset links can return to the app. Add the local and deployed app URLs to Supabase Auth URL Configuration (Site URL and Redirect URLs) so password reset links can return to the app.

## Desktop application — Electron migration preview

The desktop migration is in progress on branch `migration/electron-chromium`.

- The preview shell uses Electron `WebContentsView`, which runs the bundled Chromium engine.
- The Electron main process and preload use context isolation, disabled Node integration, sandboxed browser contents, and an allowlisted IPC surface.
- The preview installer uses a separate Windows app identity (`com.dollarise.game.electron-preview`) so it can be installed alongside the existing Tauri GAME application without replacing it.
- Windows preview builds are produced by the `GAME Electron Preview — Windows Installer` workflow and uploaded as a GitHub Actions artifact.
- Run the URL policy tests with `npm run test:desktop`.

**Not a release yet:** the existing React app and recording lifecycle still need full end-to-end verification. The Electron main process now injects the existing Solitaire mouse and board-snapshot recorder into Chromium frames, including cross-origin game frames, and relays events through the isolated preload. This port still needs live-site verification on Windows. Do not remove the existing Tauri application or use the preview as a replacement until the installer, browser, recording, pause/resume, stop/save, and Buka Data flows all pass Windows tests.

### Electron preview development

```bash
npm install
npm run test:desktop
npm run desktop:dev
```

Build the Windows preview installer on Windows:

```bash
npm run build
npx electron-builder --win nsis
```
