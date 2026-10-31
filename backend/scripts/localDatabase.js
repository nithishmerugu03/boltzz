import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { MongoMemoryServer } from 'mongodb-memory-server';

// Despite the library name, an explicit WiredTiger path persists across restarts.
const dbPath = fileURLToPath(new URL('../.local/mongodb/', import.meta.url));
const downloadDir = fileURLToPath(new URL('../node_modules/.cache/mongodb-memory-server/', import.meta.url));
await mkdir(dbPath, { recursive: true });
const database = await MongoMemoryServer.create({
  binary: { version: '8.2.6', downloadDir },
  instance: { ip: '127.0.0.1', port: 27017, portGeneration: false, dbPath, storageEngine: 'wiredTiger' }
});
console.log('Local development MongoDB ready on 127.0.0.1:27017; data persists in backend/.local/mongodb.');
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await database.stop({ doCleanup: false });
  process.exit(0);
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
