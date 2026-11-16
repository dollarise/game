# Game — Website Workspace

A lightweight browser workspace with two sections: **Rekam** and **Buka Data**. The target website URL is configurable in Settings and stored in Supabase.

## Stack

- Vite + React + TypeScript
- Supabase for the shared target URL and saved browsing records
- Cloudflare Pages deployment is intentionally deferred until the repository and database are ready.

## Local development

```bash
npm install
npm run dev
```

Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in `.env.local`. Without them, the app uses browser local storage for the target URL and records.

## Important browser limitation

The Rekam view uses an iframe when the target site permits embedding. Some sites prohibit framing with `X-Frame-Options` or Content Security Policy; the app then offers to open the target in a normal browser tab. It does not bypass those site security controls.