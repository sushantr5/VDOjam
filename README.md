# VDOjam

VDOjam is a self-hosted web app for parties where the crowd builds the playlist. Guests submit YouTube links and vote on them; a dedicated big-screen player plays through the queue automatically.

What makes it different: **every song is classified as Indian or Western when it is added** (by an LLM when configured, with a built-in heuristic fallback), and the player **alternates between the two buckets** — one Indian song, one Western song — always picking the top-ranked track of each bucket. Nobody's music gets buried.

## Features

- **AI two-bucket mixing** — songs are classified into Indian / Western buckets on submission and playback strictly alternates between buckets while both have songs.
- **Crowd ranking** — guests upvote/downvote tracks; each bucket is ranked by admin boost, then vote score, then submission time.
- **Party hosting** — one click to create a party; the creator becomes the admin. Shareable join link and QR code for guests.
- **Admin controls** — boost a song to the front of its bucket, move a song to the other bucket if the AI got it wrong, mark played, remove tracks, remote-control the player (previous / restart / pause / next), and end the party.
- **Big-screen player** — a code-protected player page auto-advances through the mix, skips unplayable videos, and shows the upcoming alternating order.
- **Zero dependencies** — plain Node.js backend, vanilla JS frontend, atomic JSON-file persistence. No build step, no database server.

## Getting started

Requires Node.js 18+.

```bash
npm start        # production
npm run dev      # development
npm test         # unit tests for the queue engine and classifier
```

The server starts on [http://localhost:3000](http://localhost:3000).

### Enabling LLM classification

Without configuration, songs are classified by a built-in heuristic (Indic script detection plus an extensive keyword/artist/label list). To use an LLM instead, set:

| Variable | Required | Description |
| --- | --- | --- |
| `LLM_API_KEY` (or `OPENAI_API_KEY`) | yes | Bearer token for any OpenAI-compatible chat-completions API. |
| `LLM_API_URL` | no | Endpoint URL. Defaults to `https://api.openai.com/v1/chat/completions`. Works with Groq, OpenRouter, Together, Ollama, etc. |
| `LLM_MODEL` | no | Model name. Defaults to `gpt-4o-mini`. |
| `LLM_TIMEOUT_MS` | no | Classification timeout. Defaults to `8000`. |

If the LLM call fails or times out, the heuristic fallback is used automatically — adding songs never breaks.

Other environment variables: `PORT` (default `3000`), `HOST` (default `0.0.0.0`), `DATA_DIR` (default `./data`).

## How the alternating queue works

1. Each unplayed song belongs to a bucket: `indian` or `western`.
2. Within a bucket, songs are ranked by admin boost (Play next), then vote score (upvotes − downvotes), then first-come-first-served.
3. The player takes the top song from one bucket, then the top song from the other, and keeps alternating. If one bucket is empty, the other plays through until new songs arrive.
4. When a song ends (or is skipped / marked played), its bucket is recorded so the next pick always comes from the opposite bucket.
5. Admins can override a song's bucket at any time from the party room.

## Project structure

- `server.js` — HTTP server, REST API, static file serving.
- `lib/queue.js` — bucket ranking and the alternating playback engine.
- `lib/classifier.js` — LLM classification with heuristic fallback.
- `lib/youtube.js` — YouTube URL parsing and oEmbed metadata (with noembed fallback).
- `lib/db.js` — in-memory store with atomic, coalesced JSON persistence.
- `lib/http.js` — request parsing, validation and response helpers.
- `public/` — static frontend (HTML, CSS, ES modules); pages: landing, party room, player.
- `test/queue.test.js` — unit tests (`node --test`).
- `data/db.json` — JSON database created on first run.

## API overview

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/health` | GET | Health check + which classifier mode is active. |
| `/api/parties` | POST | Create a new party and admin session. |
| `/api/parties/:id` | GET | Party details, bucket stats, alternating queue, now playing, history. |
| `/api/parties/:id/join` | POST | Join a party as a guest. |
| `/api/parties/:id/videos` | POST | Submit a YouTube link — classified into a bucket on the spot (authenticated). |
| `/api/parties/:id/videos/:vid` | DELETE | Remove a track (admin or owner). |
| `/api/parties/:id/videos/:vid/vote` | POST | Cast or clear a vote on a track. |
| `/api/parties/:id/videos/:vid/category` | POST | Admin override: move a track to the other bucket. |
| `/api/parties/:id/videos/:vid/promote` | POST | Admin boost to the front of the track's bucket. |
| `/api/parties/:id/videos/:vid/mark-played` | POST | Admin marks a track as played. |
| `/api/parties/:id/end` | POST | Admin ends the party. |
| `/api/parties/:id/player/state` | POST | Player heartbeat (needs access code). |
| `/api/parties/:id/player/control` | POST | Send restart/pause/play to the player (admin). |
| `/api/parties/:id/player/advance` | POST | Player marks the current track as played. |
| `/api/parties/:id/player/previous` | POST | Replay the previously played track. |
| `/api/parties/:id/player/reset` | POST | Reset all tracks to unplayed. |

## Deployment

VDOjam runs wherever Node.js 18+ is available. Copy the repository to your server or container and launch with `npm start`. Persist the `data/` directory (or point `DATA_DIR` at a mounted volume) to keep party state across restarts. The server honours `x-forwarded-proto`, so it works behind a reverse proxy.
