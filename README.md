# Conan Gray Heardle

Heardle-style web app where players guess Conan Gray songs from short SoundCloud clips.

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

2. Configure environment variables:

```bash
copy .env.example .env.local
```

3. Start the app:

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Environment Variables

- `HEARDLE_TOKEN_SECRET` (required in production): secret used to sign puzzle tokens.
- `HEARDLE_SONG_PROVIDER` (optional): `static` (default), `soundcloud`, or `spotify`.
- `HEARDLE_SOUNDCLOUD_CLIENT_ID` (required when provider is `soundcloud`): SoundCloud API client id.
- `HEARDLE_SOUNDCLOUD_CACHE_TTL_MS` (optional): server cache duration for fetched SoundCloud tracks.
- `HEARDLE_SOUNDCLOUD_*_PERMALINK` (optional): override artist profile permalink used for track discovery.

## Song Catalog Notes

The curated song list is in `src/lib/songs.ts`.

API routes now read songs through `src/lib/song-provider.ts`, which currently defaults to the static catalog and is ready for a Spotify-backed provider implementation.

When `HEARDLE_SONG_PROVIDER=soundcloud`, the app fetches all public tracks from each configured artist profile (via SoundCloud API pagination) and falls back to the static catalog if SoundCloud is unavailable.

- Replace or tune `soundcloudUrl` entries with confirmed playable Conan Gray tracks.
- Adjust `previewStartMs` to pick better snippets.

## Deployment (Vercel)

Deploy with Vercel CLI:

```bash
npx vercel
npx vercel --prod
```

Set `HEARDLE_TOKEN_SECRET` in Vercel project environment variables.
