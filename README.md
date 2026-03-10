# Heardle

Heardle-style web app where players guess songs from short SoundCloud clips.

## Features

- Daily mode with a UTC date-based puzzle
- Random mode for unlimited practice
- 6 rounds with clip lengths: 1s, 2s, 4s, 7s, 11s, 16s
- Server-validated guesses with signed puzzle tokens
- SoundCloud embed with hidden metadata until game result
- Local-only stats (played, wins, streak)

## Getting Started

1. Install dependencies:

```bash
npm install
```

1. Configure environment variables:

```bash
copy .env.example .env.local
```

1. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

- `HEARDLE_TOKEN_SECRET` (required in production): secret used to sign puzzle tokens.
- `HEARDLE_SONG_PROVIDER` (optional): `static` (default), `soundcloud`, or `spotify`.
- `HEARDLE_SOUNDCLOUD_CLIENT_ID` (required when provider is `soundcloud`): SoundCloud API client id.
- `HEARDLE_SOUNDCLOUD_CLIENT_SECRET` (required when provider is `soundcloud`): SoundCloud API client secret used for client-credentials token exchange.
- `HEARDLE_TOKEN_STORE_DATABASE_URL` (optional, recommended in production): shared Postgres/Neon connection string for persisting SoundCloud token state across instances.
- `HEARDLE_ENABLE_ADMIN_CACHE_CLEAR` (optional): set to `true` to allow `/api/admin/clear-cache` in production; non-production allows it by default.
- `HEARDLE_SOUNDCLOUD_CACHE_TTL_MS` (optional): server cache duration for fetched SoundCloud tracks.
- `HEARDLE_SOUNDCLOUD_ARTIST_CACHE_TTL_MS` (optional): persisted artist-track refresh window in milliseconds (default 24h) to reduce `/tracks` API calls.
- `HEARDLE_SOUNDCLOUD_*_PERMALINK` (optional): fallback override if automatic artist-name resolution picks the wrong SoundCloud account.

## Song Catalog Notes

The curated song list is in `src/lib/songs.ts`.

API routes now read songs through `src/lib/song-provider.ts`, which currently defaults to the static catalog and is ready for a Spotify-backed provider implementation.

When `HEARDLE_SONG_PROVIDER=soundcloud`, the app authenticates with SoundCloud Client Credentials flow, auto-resolves artists by name, fetches public tracks (via API pagination), and falls back to static catalog data if SoundCloud is unavailable or an artist account has no public tracks available via the API. If `HEARDLE_TOKEN_STORE_DATABASE_URL` is set, token/cooldown state and artist-track cache are shared via Postgres (recommended for multi-instance production), so artist track lists are refreshed on the configured cadence instead of every request.

For fast cache invalidation while debugging, use `/api/admin/clear-cache?run=1` (or the one-click button on `/debug`). This clears in-memory provider cache and persisted artist-track cache rows.

- Replace or tune `soundcloudUrl` entries with confirmed playable tracks.
- Adjust `previewStartMs` to pick better snippets.

## Deployment (Vercel)

Deploy with Vercel CLI:

```bash
npx vercel
npx vercel --prod
```

Set `HEARDLE_TOKEN_SECRET` in Vercel project environment variables.
