'use strict';

const GAME_STORAGE_KEYS = [
  'traffic_clear_max_unlocked',
  'traffic_clear_profile_v1',
  'traffic_clear_runtime_v1',
  'traffic_clear_audio_prefs_v1',
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

async function readGameData() {
  const storage = {};
  for (const key of GAME_STORAGE_KEYS) {
    storage[key] = safeGetItem(key);
  }
  return { storage };
}

async function clearGameData() {
  for (const key of GAME_STORAGE_KEYS) {
    safeSetItem(key, null);
  }
}

async function writeGameData(input, mode = 'merge') {
  const incoming = input && typeof input === 'object' ? input : {};
  const storage = incoming.storage && typeof incoming.storage === 'object' ? incoming.storage : {};

  if (mode === 'overwrite') {
    await clearGameData();
  }

  for (const key of GAME_STORAGE_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(storage, key)) {
      continue;
    }
    safeSetItem(key, storage[key]);
  }
}

function registerWhenReady() {
  const hub = window.mygameBackupHub;
  if (!hub || typeof hub.registerProvider !== 'function') {
    return false;
  }
  hub.registerProvider({
    id: 'game',
    label: '小游戏存档',
    version: 1,
    exportData: async () => readGameData(),
    importData: async ({ data, mode }) => writeGameData(data, mode),
    clearData: async () => clearGameData(),
  });
  return true;
}

if (!registerWhenReady()) {
  window.addEventListener('mygame:backup-hub-ready', () => {
    registerWhenReady();
  }, { once: true });
}
