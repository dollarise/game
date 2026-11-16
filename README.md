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

## Browser limitation

The Rekam view uses an iframe when the target site permits embedding. Some sites prohibit framing with `X-Frame-Options` or Content Security Policy; the app then offers to open the target in a normal browser tab. It does not bypass those site security controls.
