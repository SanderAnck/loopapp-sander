// Local storage layer: a tiny promise wrapper around IndexedDB.
// All data stays on this device. Stores follow the technical design.

const DB_NAME = 'pace';
const DB_VERSION = 1;

// Store name -> key path. `profile` holds a single record with key 'me'.
export const STORES = {
  profile: 'id',
  plan: 'id',
  workouts: 'id',
  runs: 'id',
  checkins: 'id',
  adjustments: 'id',
};

let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) {
          const store = db.createObjectStore(name, { keyPath });
          if (name !== 'profile') store.createIndex('date', 'date');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function run(storeName, mode, fn) {
  return open().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(storeName, mode);
        const store = tx.objectStore(storeName);
        const result = fn(store);
        tx.oncomplete = () => resolve(result && 'result' in result ? result.result : result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      })
  );
}

export const db = {
  get: (store, key) => run(store, 'readonly', (s) => s.get(key)),
  getAll: (store) => run(store, 'readonly', (s) => s.getAll()),
  put: (store, value) => run(store, 'readwrite', (s) => s.put(value)),
  delete: (store, key) => run(store, 'readwrite', (s) => s.delete(key)),
  clear: (store) => run(store, 'readwrite', (s) => s.clear()),

  /** Dump every store into one plain object (used for JSON backup). */
  async exportAll() {
    const data = {};
    for (const name of Object.keys(STORES)) data[name] = await db.getAll(name);
    return { app: 'pace', version: self.PACE_VERSION, exportedAt: new Date().toISOString(), data };
  },

  /** Replace all stores with the contents of a backup made by exportAll(). */
  async importAll(backup) {
    if (!backup || backup.app !== 'pace' || typeof backup.data !== 'object') {
      throw new Error('Dit is geen geldig Pace-back-upbestand.');
    }
    for (const name of Object.keys(STORES)) {
      await db.clear(name);
      for (const row of backup.data[name] || []) await db.put(name, row);
    }
  },
};

/** Ask the browser not to evict our data when storage runs low. */
export async function requestPersistentStorage() {
  if (navigator.storage && navigator.storage.persist) {
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
  return false;
}
