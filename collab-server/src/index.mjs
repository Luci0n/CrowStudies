/*
 * CrowStudies collaboration service
 *
 * The browser never writes rich-note HTML while a note is collaborative.
 * Tiptap edits a Yjs document; this one authenticated server merges it and is
 * the only process that persists its binary snapshot in Firestore. That
 * prevents last-writer-wins body replacements between collaborators.
 */
import { Server } from '@hocuspocus/server';
import admin from 'firebase-admin';
import * as Y from 'yjs';
import { generateJSON } from '@tiptap/html';
import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { prosemirrorToYXmlFragment } from 'y-prosemirror';

const port = Number(process.env.PORT || 1234);
const host = process.env.HOST || '127.0.0.1';
const snapshotDelayMs = 900;
const maxDocumentBytes = 850 * 1024; // safely under Firestore's 1 MiB limit
const allowedOrigin = process.env.ALLOWED_ORIGIN || '';

function serviceCredential() {
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    return admin.credential.cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON));
  }
  return admin.credential.applicationDefault();
}

admin.initializeApp({ credential: serviceCredential() });
const db = admin.firestore();

const extensions = [
  StarterKit.configure({ history: false }),
  Link.configure({ openOnClick: false }),
  Table.configure({ resizable: true }),
  TableRow,
  TableHeader,
  TableCell,
];
const schema = getSchema(extensions);

function parseDocumentName(name) {
  const match = /^project:([^:]+):block:([^:]+)$/.exec(String(name || ''));
  if (!match) throw new Error('Invalid collaboration document name.');
  return { projectId: match[1], blockId: match[2] };
}

async function authorize(token, documentName) {
  if (!token) throw new Error('Sign in is required for collaboration.');
  const decoded = await admin.auth().verifyIdToken(token, true);
  const { projectId, blockId } = parseDocumentName(documentName);
  const project = await db.collection('projects').doc(projectId).get();
  const role = project.exists ? (project.get('members') || {})[decoded.uid] : null;
  if (!['owner', 'editor', 'viewer'].includes(role)) throw new Error('You no longer have access to this project.');
  const block = await db.collection('projects').doc(projectId).collection('blocks').doc(blockId).get();
  if (!block.exists || block.get('type') !== 'note') throw new Error('This collaborative note no longer exists.');
  return { uid: decoded.uid, role, projectId, blockId };
}

function snapshotRef(projectId, blockId) {
  return db.collection('projects').doc(projectId).collection('collabDocuments').doc(blockId);
}

async function initialDocument(projectId, blockId) {
  const snapshot = await snapshotRef(projectId, blockId).get();
  if (snapshot.exists && snapshot.get('update')) {
    const doc = new Y.Doc();
    Y.applyUpdate(doc, snapshot.get('update').toUint8Array());
    return doc;
  }

  // One-time, server-owned migration of the existing safe HTML. It happens
  // before clients synchronize, so two people opening an old note cannot
  // independently seed and duplicate its contents.
  const legacy = await db.collection('projects').doc(projectId).collection('blocks').doc(blockId).get();
  const html = legacy.exists ? String(legacy.get('body') || '') : '';
  const doc = seedDocument(html);
  // Stored at once. A note nobody has edited yet is not a change, so Hocuspocus
  // unloads it without storing when the last person leaves; the next open then
  // seeded it again, and anyone still holding the first seed merged the two,
  // so every line appeared twice. Studio closes and reopens notes on every
  // redraw, so this was not rare.
  await writeSnapshot(projectId, blockId, doc);
  return doc;
}

/* The same HTML always becomes the same Yjs history: the seed is written under
   a client id taken from the text itself. Should a note ever be seeded twice
   from unchanged text, the two copies are the same items and merge into one
   instead of doubling. Different text gives a different id, so two seeds can
   never be mistaken for one another. */
function seedClientId(html) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < html.length; i++) hash = Math.imul(hash ^ html.charCodeAt(i), 0x01000193) >>> 0;
  return hash || 1;
}

function seedDocument(html) {
  const doc = new Y.Doc();
  doc.clientID = seedClientId(html);
  const json = generateJSON(html || '<p></p>', extensions);
  prosemirrorToYXmlFragment(schema.nodeFromJSON(json), doc.getXmlFragment('default'));
  return doc;
}

async function writeSnapshot(projectId, blockId, document) {
  const update = Y.encodeStateAsUpdate(document);
  if (update.byteLength > maxDocumentBytes) {
    throw new Error('This note is too large to save. Split it into smaller notes.');
  }
  await snapshotRef(projectId, blockId).set({
    update: Buffer.from(update),
    schemaVersion: 1,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

async function storeSnapshot(documentName, document) {
  const { projectId, blockId } = parseDocumentName(documentName);
  // A block can be deleted while a browser still has its document open. Do
  // not revive it as an orphan collaboration snapshot on disconnect.
  const block = await db.collection('projects').doc(projectId).collection('blocks').doc(blockId).get();
  if (!block.exists || block.get('type') !== 'note') return;
  await writeSnapshot(projectId, blockId, document);
}

const server = new Server({
  address: host,
  port,
  // Storing goes through Hocuspocus, which runs a pending store before it lets
  // a document go from memory. The timers this replaced were its own, so a
  // document could be unloaded and opened again while a store was still on
  // its way, and the reopen read the older copy.
  debounce: snapshotDelayMs,
  maxDebounce: 5000,
  async onAuthenticate({ token, documentName, connectionConfig, requestHeaders }) {
    const origin = requestHeaders && (typeof requestHeaders.get === 'function'
      ? requestHeaders.get('origin') : requestHeaders.origin);
    if (allowedOrigin && origin && origin !== allowedOrigin) throw new Error('This origin is not allowed.');
    const access = await authorize(token, documentName);
    // Hocuspocus rejects update messages at the protocol layer for read-only
    // connections. This is enforcement, not merely a disabled UI control.
    // Hocuspocus 3 hands this hook `connectionConfig`; there is no
    // `connection` here, and setting a field on it threw for every person.
    connectionConfig.readOnly = access.role === 'viewer';
    return access;
  },
  async onLoadDocument({ documentName }) {
    const { projectId, blockId } = parseDocumentName(documentName);
    return initialDocument(projectId, blockId);
  },
  async onStoreDocument({ documentName, document }) {
    await storeSnapshot(documentName, document);
  },
});

server.listen();
console.log(`CrowStudies collaboration listening on ws://${host}:${port}`);
