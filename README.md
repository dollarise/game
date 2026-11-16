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

## Desktop application (Windows)

The Windows desktop build uses Tauri 2 with the system Microsoft Edge WebView2 runtime. The Rekam panel is a native child WebView2 surface, so sites that block iframe embedding can still open inside the GAME desktop window. The Cloudflare Pages build remains the web version and uses an iframe, subject to the target site's frame policy.

Low-memory design:

- The desktop shell uses the Windows WebView2 runtime instead of bundling a separate Chromium browser.
- The target-site browser is created lazily and reuses one WebView instance.
- The browser view is hidden when the user leaves Rekam or opens settings.
- The installer downloads the small WebView2 bootstrapper only when the runtime is missing; it does not bundle a second browser runtime.

To build on Windows with Rust and the Microsoft C++ Build Tools installed:

```bash
npm install
npm run desktop:dev
npm run desktop:build
```

GitHub Actions also builds a Windows NSIS installer and uploads it as the `GAME-Windows-Installer` workflow artifact.
