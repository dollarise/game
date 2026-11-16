# Game — Website Workspace

A browser workspace with two sections: **Rekam** and **Buka Data**. Each user signs in with email and password, and their target website setting and saved records are isolated from other users by Supabase Row Level Security.

## Features

- Email/password sign-in, account registration, password reset, and sign-out
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

Enable Email provider in Supabase Authentication. If email confirmation is enabled, a new user must confirm their email before signing in. Add the local and deployed app URLs to Supabase Auth URL Configuration (Site URL and Redirect URLs) so password reset links can return to the app.

## Browser limitation

The Rekam view uses an iframe when the target site permits embedding. Some sites prohibit framing with `X-Frame-Options` or Content Security Policy; the app then offers to open the target in a normal browser tab. It does not bypass those site security controls.
