'use strict';

const DB_NAME = 'mygame_toolbox_v1';
const DB_VERSION = 1;
const STORE_PERSONS = 'persons';
const STORE_RECORDS = 'records';
const STORE_PENDING = 'pending';
const STORE_AUDIT = 'audit';
const STORE_META = 'meta';
const HEALTH_STORES = [STORE_PERSONS, STORE_RECORDS, STORE_PENDING, STORE_AUDIT, STORE_META];

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('IndexedDB request failed'));
  });
}

function txToPromise(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_PERSONS)) {
        const persons = db.createObjectStore(STORE_PERSONS, { keyPath: 'id' });
        persons.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_RECORDS)) {
        const records = db.createObjectStore(STORE_RECORDS, { keyPath: 'id' });
        records.createIndex('personId', 'personId', { unique: false });
        records.createIndex('timestamp', 'timestamp', { unique: false });
        records.createIndex('personId_timestamp', ['personId', 'timestamp'], { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_PENDING)) {
        const pending = db.createObjectStore(STORE_PENDING, { keyPath: 'id' });
        pending.createIndex('personId', 'personId', { unique: false });
        pending.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_AUDIT)) {
        const audit = db.createObjectStore(STORE_AUDIT, { keyPath: 'id' });
        audit.createIndex('createdAt', 'createdAt', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error('Failed to open health DB'));
  });
}

function normalizeRows(rows) {
  return Array.isArray(rows) ? rows : [];
}

async function readHealthData() {
  const db = await openDb();
  try {
    const tx = db.transaction(HEALTH_STORES, 'readonly');
    const stores = HEALTH_STORES.reduce((acc, name) => {
      acc[name] = tx.objectStore(name);
      return acc;
    }, Object.create(null));
    const [persons, records, pending, audit, meta] = await Promise.all([
      reqToPromise(stores[STORE_PERSONS].getAll()),
      reqToPromise(stores[STORE_RECORDS].getAll()),
      reqToPromise(stores[STORE_PENDING].getAll()),
      reqToPromise(stores[STORE_AUDIT].getAll()),
      reqToPromise(stores[STORE_META].getAll()),
    ]);
    await txToPromise(tx);
    return { persons, records, pending, audit, meta };
  } finally {
    db.close();
  }
}

async function clearHealthData() {
  const db = await openDb();
  try {
    const tx = db.transaction(HEALTH_STORES, 'readwrite');
    for (const storeName of HEALTH_STORES) {
      await reqToPromise(tx.objectStore(storeName).clear());
    }
    await txToPromise(tx);
  } finally {
    db.close();
  }
}

async function writeHealthData(input, mode = 'merge') {
  const incoming = input && typeof input === 'object' ? input : {};
  const persons = normalizeRows(incoming.persons);
  const records = normalizeRows(incoming.records);
  const pending = normalizeRows(incoming.pending);
  const audit = normalizeRows(incoming.audit).slice(-5000);
  const meta = normalizeRows(incoming.meta);

  const db = await openDb();
  try {
    const tx = db.transaction(HEALTH_STORES, 'readwrite');
    const storePersons = tx.objectStore(STORE_PERSONS);
    const storeRecords = tx.objectStore(STORE_RECORDS);
    const storePending = tx.objectStore(STORE_PENDING);
    const storeAudit = tx.objectStore(STORE_AUDIT);
    const storeMeta = tx.objectStore(STORE_META);

    if (mode === 'overwrite') {
      await reqToPromise(storePersons.clear());
      await reqToPromise(storeRecords.clear());
      await reqToPromise(storePending.clear());
      await reqToPromise(storeAudit.clear());
      await reqToPromise(storeMeta.clear());
    }

    for (const row of persons) {
      await reqToPromise(storePersons.put(row));
    }
    for (const row of records) {
      await reqToPromise(storeRecords.put(row));
    }
    for (const row of pending) {
      await reqToPromise(storePending.put(row));
    }
    for (const row of audit) {
      await reqToPromise(storeAudit.put(row));
    }
    for (const row of meta) {
      if (row && typeof row.key === 'string') {
        await reqToPromise(storeMeta.put(row));
      }
    }

    await txToPromise(tx);
  } finally {
    db.close();
  }
}

function registerWhenReady() {
  const hub = window.mygameBackupHub;
  if (!hub || typeof hub.registerProvider !== 'function') {
    return false;
  }
  hub.registerProvider({
    id: 'health',
    label: '健康管理',
    version: 1,
    exportData: async () => readHealthData(),
    importData: async ({ data, mode }) => writeHealthData(data, mode),
    clearData: async () => clearHealthData(),
  });
  return true;
}

if (!registerWhenReady()) {
  window.addEventListener('mygame:backup-hub-ready', () => {
    registerWhenReady();
  }, { once: true });
}
