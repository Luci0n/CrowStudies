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
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Table from '@tiptap/extension-table';
import TableRow from '@tiptap/extension-table-row';
import TableHeader from '@tiptap/extension-table-header';
import TableCell from '@tiptap/extension-table-cell';
import { prosemirrorJSONToYDoc } from 'y-prosemirror';

const port = Number(process.env.PORT || 1234);
const host = process.env.HOST || '127.0.0.1';
const snapshotDelayMs = 900;
const maxDocumentBytes = 850 * 1024; // safely under Firestore's 1 MiB limit
const timers = new Map();
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
  const json = generateJSON(html || '<p></p>', extensions);
  return prosemirrorJSONToYDoc(json, 'default');
}

async function storeSnapshot(documentName, document) {
  const { projectId, blockId } = parseDocumentName(documentName);
  // A block can be deleted while a browser still has its document open. Do
  // not revive it as an orphan collaboration snapshot on disconnect.
  const block = await db.collection('projects').doc(projectId).collection('blocks').doc(blockId).get();
  if (!block.exists || block.get('type') !== 'note') return;
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

function scheduleStore(documentName, document) {
  clearTimeout(timers.get(documentName));
  timers.set(documentName, setTimeout(async () => {
    timers.delete(documentName);
    try { await storeSnapshot(documentName, document); }
    catch (error) { console.error('Could not save', documentName, error); }
  }, snapshotDelayMs));
}

const server = new Server({
  address: host,
  port,
  async onAuthenticate({ token, documentName, connection, requestHeaders }) {
    const origin = requestHeaders && (typeof requestHeaders.get === 'function'
      ? requestHeaders.get('origin') : requestHeaders.origin);
    if (allowedOrigin && origin && origin !== allowedOrigin) throw new Error('This origin is not allowed.');
    const access = await authorize(token, documentName);
    // Hocuspocus rejects update messages at the protocol layer for read-only
    // connections. This is enforcement, not merely a disabled UI control.
    connection.readOnly = access.role === 'viewer';
    return access;
  },
  async onLoadDocument({ documentName }) {
    const { projectId, blockId } = parseDocumentName(documentName);
    return initialDocument(projectId, blockId);
  },
  async onChange({ documentName, document }) {
    scheduleStore(documentName, document);
  },
  async onDisconnect({ documentName, document }) {
    clearTimeout(timers.get(documentName));
    timers.delete(documentName);
    await storeSnapshot(documentName, document);
  },
});

server.listen();
console.log(`CrowStudies collaboration listening on ws://${host}:${port}`);
