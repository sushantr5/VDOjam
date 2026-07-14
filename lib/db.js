import { readFile, writeFile, rename, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.DATA_DIR || join(__dirname, '..', 'data');
const dbPath = join(dataDir, 'db.json');

let db = null;
let writeChain = Promise.resolve();
let dirty = false;
let writing = false;

export async function initDb() {
  await mkdir(dataDir, { recursive: true });
  try {
    const raw = await readFile(dbPath, 'utf-8');
    db = JSON.parse(raw);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      console.error(`Could not parse ${dbPath}, starting with an empty database.`, error.message);
    }
    db = { parties: {} };
  }
  if (!db.parties || typeof db.parties !== 'object') {
    db.parties = {};
  }
  return db;
}

export function getDb() {
  if (!db) {
    throw new Error('Database not initialised. Call initDb() first.');
  }
  return db;
}

async function flush() {
  writing = true;
  while (dirty) {
    dirty = false;
    const snapshot = JSON.stringify(db, null, 2);
    const tmpPath = `${dbPath}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    try {
      await writeFile(tmpPath, snapshot, 'utf-8');
      await rename(tmpPath, dbPath);
    } catch (error) {
      console.error('Failed to persist database:', error.message);
    }
  }
  writing = false;
}

/**
 * Queue an atomic write of the current in-memory state. Concurrent calls are
 * coalesced so at most one write is in flight at any moment and the last
 * state always wins.
 */
export function persist() {
  dirty = true;
  if (!writing) {
    writeChain = writeChain.then(flush);
  }
  return writeChain;
}

export function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomBytes(8).toString('hex')}`;
}

export function generateAccessCode() {
  return crypto.randomBytes(3).toString('hex');
}
