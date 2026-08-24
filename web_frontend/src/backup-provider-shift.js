'use strict';

import { STORAGE_KEY, normalizeSaveData } from './shift/storage.js';

const SHIFT_STORAGE_KEYS = [
  STORAGE_KEY,
  'block_shift_proto_v3',
  'block_shift_proto_v2',
];

function safeGetItem(key) {
  try {
    return window.localStorage.getItem(key);
  } catch (_err) {
    return null;
  }
}

function safeSetItem(key, value) {
  try {
    if (typeof value === 'string') {
      window.localStorage.setItem(key, value);
    } else {
      window.localStorage.removeItem(key);
    }
  } catch (_err) {
    // ignore storage failures
  }
}

async function readShiftData() {
  const storage = {};
  for (const key of SHIFT_STORAGE_KEYS) {
    storage[key] = safeGetItem(key);
  }
  return { storage };
}

async function clearShiftData() {
  for (const key of SHIFT_STORAGE_KEYS) {
    safeSetItem(key, null);
  }
}

async function writeShiftData(input, mode = 'merge') {
  const incoming = input && typeof input === 'object' ? input : {};
  const storage = incoming.storage && typeof incoming.storage === 'object' ? incoming.storage : {};
  const bestRaw = SHIFT_STORAGE_KEYS
    .map((key) => storage[key])
    .find((value) => typeof value === 'string' && value.length > 0);

  if (mode === 'overwrite') {
    await clearShiftData();
  }

  for (const key of SHIFT_STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(storage, key)) {
      continue;
    }
    safeSetItem(key, storage[key]);
  }

  if (!Object.prototype.hasOwnProperty.call(storage, STORAGE_KEY) && typeof bestRaw === 'string') {
    try {
      const normalized = normalizeSaveData(JSON.parse(bestRaw));
      safeSetItem(STORAGE_KEY, JSON.stringify(normalized));
    } catch (_err) {
      // ignore malformed legacy backups
    }
  }
}

function registerWhenReady() {
  const hub = window.mygameBackupHub;
  if (!hub || typeof hub.registerProvider !== 'function') {
    return false;
  }
  hub.registerProvider({
    id: 'shift',
    label: '方块挪一挪',
    version: 1,
    exportData: async () => readShiftData(),
    importData: async ({ data, mode }) => writeShiftData(data, mode),
    clearData: async () => clearShiftData(),
  });
  return true;
}

if (!registerWhenReady()) {
  window.addEventListener('mygame:backup-hub-ready', () => {
    registerWhenReady();
  }, { once: true });
}
