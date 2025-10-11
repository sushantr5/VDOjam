# VDOjam

VDOjam is a lightweight self-hosted web app that lets any group build a collaborative YouTube queue for their party. Hosts can create a party, share a QR code for guests to join, and control a dedicated player screen that automatically advances through the most upvoted tracks.

## Features

- Create parties with a single click – the creator becomes the admin.
- Shareable join link and QR code for guests.
- Local session storage keeps users signed in until they log out.
- Guests can submit up to three active YouTube links; metadata is fetched automatically.
- Upvote or downvote tracks to shape the queue. Admins can promote, mark played, or remove tracks.
- Dedicated player page protected by an access code for projecting the final playlist.
- Simple JSON persistence using the filesystem – perfect for small self-hosted deployments.

## Getting started

```bash
npm install # no dependencies, but this will create package-lock.json
npm run dev
```

The server starts on [http://localhost:3000](http://localhost:3000).

> **Note:** The first `npm install` only generates `package-lock.json`; the application does not require third-party packages.

### Project structure

- `server.js` – minimal Node.js server that serves static assets and exposes JSON APIs.
- `public/` – static frontend assets (HTML, CSS, and ES modules).
- `data/db.json` – JSON database created on first run.

### API overview

| Endpoint | Method | Description |
| --- | --- | --- |
| `/api/parties` | POST | Create a new party and admin session. |
| `/api/parties/:id` | GET | Fetch party details, queue, and user info. |
| `/api/parties/:id/join` | POST | Join a party as a guest. |
| `/api/parties/:id/videos` | POST | Submit a YouTube link (authenticated). |
| `/api/parties/:id/videos/:vid/vote` | POST | Cast or clear a vote on a track. |
| `/api/parties/:id/videos/:vid` | DELETE | Remove a track (admin or owner). |
| `/api/parties/:id/videos/:vid/promote` | POST | Admin boost to play next. |
| `/api/parties/:id/videos/:vid/mark-played` | POST | Admin marks a track as played. |
| `/api/parties/:id/player/state` | POST | Player heartbeat (needs access code). |
| `/api/parties/:id/player/advance` | POST | Player marks current track as played. |
| `/api/parties/:id/player/reset` | POST | Player resets all tracks to unplayed. |

### Deployment

VDOjam is designed to run wherever Node.js is available. Copy the repository to your server or container, run `npm install` once, and launch with `npm start`.

Persisting the `data/` folder between deployments keeps party state intact.
