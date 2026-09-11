# CrowStudies collaboration server

This is the authoritative rich-text sync server for Studio. GitHub Pages hosts
the web UI but cannot host WebSockets, so run this Node service on the Oracle
VM behind HTTPS/WSS.

## What it guarantees

- A user authenticates with their Firebase ID token before they can open a
  document.
- Project membership is checked server-side for every document connection.
- Rich notes are Yjs/Tiptap documents, not competing HTML strings.
- The server is the only writer of `collabDocuments`; clients never race by
  overwriting a Firestore `body` field.
- Existing note HTML is converted once by the server before a client receives
  the document.

## Deploy on the Oracle VM

1. Install Node 20 or newer and copy this `collab-server` directory to the VM.
2. Put the Firebase Admin JSON outside the repository, readable only by the
   service account that runs Node (for example `/srv/crowstudies/firebase-admin.json`).
3. Copy `.env.example` to `.env`, set `GOOGLE_APPLICATION_CREDENTIALS`, then
   run `npm install --omit=dev` and `npm start` once to verify it starts.
4. Put Nginx or Caddy in front of port `1234` and expose it as
   `https://collab.your-domain` with WebSocket upgrade support. The browser
   must connect as `wss://collab.your-domain`.
5. Set `url` in `assets/collab-config.js` to that WSS address and deploy the
   website. Until that is set, Studio keeps the stable non-collaborative editor.

Run this as one small instance for the current capped beta. If it is later
scaled to multiple instances, add Redis (or a Hocuspocus-compatible shared
backend) before doing so; two isolated Yjs server memories must not accept the
same document independently.

## Backup and history

`collabDocuments/{blockId}` contains the compact latest Yjs snapshot. Version
history should be created by copying that binary snapshot into a revision
document from this server. Restoring a revision should create a new current
snapshot, never overwrite a live document blindly.
