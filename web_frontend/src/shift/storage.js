const STORAGE_KEY = 'block_shift_proto_v4';
const LEGACY_STORAGE_KEYS = ['block_shift_proto_v3', 'block_shift_proto_v2'];
const SAVE_SCHEMA_VERSION = 9;
const ENDLESS_STARTER_RESOURCE_FLOOR = Object.freeze({
  coins: 2400,
  inventory: Object.freeze({
    masterKey: 8,
    lubricant: 8,
    goldFinger: 5,
  }),
});

function isObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function applyEndlessStarterFloor(saveData) {
  return {
    ...saveData,
    coins: Math.max(0, Math.max(saveData.coins || 0, ENDLESS_STARTER_RESOURCE_FLOOR.coins)),
    inventory: {
      ...saveData.inventory,
      masterKey: Math.max(0, Math.max(saveData.inventory?.masterKey || 0, ENDLESS_STARTER_RESOURCE_FLOOR.inventory.masterKey)),
      lubricant: Math.max(0, Math.max(saveData.inventory?.lubricant || 0, ENDLESS_STARTER_RESOURCE_FLOOR.inventory.lubricant)),
      goldFinger: Math.max(0, Math.max(saveData.inventory?.goldFinger || 0, ENDLESS_STARTER_RESOURCE_FLOOR.inventory.goldFinger)),
    },
  };
}

function normalizeRun(run) {
  if (!isObject(run)) {
    return null;
  }
  const rawDifficultyId = typeof run.difficultyId === 'string' ? run.difficultyId : 'brain';
  const difficultyId = rawDifficultyId === 'relax' || rawDifficultyId === 'standard' ? 'brain' : rawDifficultyId;
  const baseSeed = Number.isFinite(run.baseSeed) ? (run.baseSeed >>> 0) : 0;
  return {
    difficultyId,
    baseSeed,
    round: Number.isFinite(run.round) ? Math.max(1, Math.floor(run.round)) : 1,
    streak: Number.isFinite(run.streak) ? Math.max(0, Math.floor(run.streak)) : 0,
    totalEarned: Number.isFinite(run.totalEarned) ? Math.max(0, Math.floor(run.totalEarned)) : 0,
  };
}

function normalizeCompletedEntry(entry) {
  if (entry === true) {
    return {
      cleared: true,
      perfect: false,
      clearedAt: null,
    };
  }
  if (!isObject(entry)) {
    return null;
  }
  return {
    cleared: !!entry.cleared,
    perfect: !!entry.perfect,
    clearedAt: typeof entry.clearedAt === 'string' ? entry.clearedAt : null,
  };
}

function normalizeCompletedMap(completed) {
  if (!isObject(completed)) {
    return {};
  }
  const next = {};
  Object.entries(completed).forEach(([levelId, entry]) => {
    const safe = normalizeCompletedEntry(entry);
    if (safe && (safe.cleared || safe.perfect || safe.clearedAt)) {
      next[levelId] = safe;
    }
  });
  return next;
}

function normalizeCampaignResume(resume) {
  if (!isObject(resume) || typeof resume.levelId !== 'string') {
    return null;
  }
  return {
    mode: 'campaign',
    levelId: resume.levelId,
    levelIndex: Number.isFinite(resume.levelIndex) ? Math.max(0, Math.floor(resume.levelIndex)) : 0,
    blocks: Array.isArray(resume.blocks) ? clone(resume.blocks) : [],
    completed: !!resume.completed,
    rewardGranted: !!resume.rewardGranted,
    gates: Array.isArray(resume.gates) ? clone(resume.gates) : [],
    logicState: isObject(resume.logicState) ? clone(resume.logicState) : null,
    usedTools: !!resume.usedTools,
  };
}

function normalizeEndlessResume(resume) {
  if (!isObject(resume) || typeof resume.levelId !== 'string') {
    return null;
  }
  const run = normalizeRun(resume);
  if (!run) {
    return null;
  }
  return {
    mode: 'endless',
    levelId: resume.levelId,
    blocks: Array.isArray(resume.blocks) ? clone(resume.blocks) : [],
    completed: !!resume.completed,
    rewardGranted: !!resume.rewardGranted,
    gates: Array.isArray(resume.gates) ? clone(resume.gates) : [],
    logicState: isObject(resume.logicState) ? clone(resume.logicState) : null,
    usedTools: !!resume.usedTools,
    ...run,
  };
}

export function defaultSaveData() {
  return {
    version: SAVE_SCHEMA_VERSION,
    coins: ENDLESS_STARTER_RESOURCE_FLOOR.coins,
    inventory: {
      masterKey: ENDLESS_STARTER_RESOURCE_FLOOR.inventory.masterKey,
      lubricant: ENDLESS_STARTER_RESOURCE_FLOOR.inventory.lubricant,
      goldFinger: ENDLESS_STARTER_RESOURCE_FLOOR.inventory.goldFinger,
    },
    progression: {
      unlockedLevelIndex: 0,
      completed: {},
      lastLevelIndex: 0,
    },
    session: {
      lastMode: 'endless',
    },
    settings: {
      volume: 0.7,
      musicEnabled: true,
      sfxEnabled: true,
      vibrationEnabled: true,
    },
    endless: {
      lastDifficulty: 'brain',
      bestStreak: 0,
      activeRun: null,
    },
    resume: {
      campaign: null,
      endless: null,
    },
  };
}

export function loadSaveData() {
  try {
    const keys = [STORAGE_KEY, ...LEGACY_STORAGE_KEYS];
    const raw = keys
      .map((key) => window.localStorage.getItem(key))
      .find((entry) => typeof entry === 'string' && entry.length > 0);
    if (!raw) {
      return defaultSaveData();
    }
    return normalizeSaveData(JSON.parse(raw));
  } catch (_err) {
    return defaultSaveData();
  }
}

export function saveSaveData(data) {
  const safe = normalizeSaveData(data);
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
  return safe;
}

export function clearResume(data, mode = 'all') {
  const next = normalizeSaveData(data);
  if (mode === 'all' || mode === 'campaign') {
    next.resume.campaign = null;
  }
  if (mode === 'all' || mode === 'endless') {
    next.resume.endless = null;
  }
  return next;
}

export function normalizeSaveData(input) {
  const base = defaultSaveData();
  if (!isObject(input)) {
    return base;
  }
  const sourceVersion = Number.isFinite(input.version) ? Math.max(0, Math.floor(input.version)) : 0;
  const progression = isObject(input.progression) ? input.progression : {};
  const inventory = isObject(input.inventory) ? input.inventory : {};
  const session = isObject(input.session) ? input.session : {};
  const settings = isObject(input.settings) ? input.settings : {};
  const endless = isObject(input.endless) ? input.endless : {};

  const legacyResume = isObject(input.resume) && typeof input.resume.levelId === 'string'
    ? normalizeCampaignResume(input.resume)
    : null;
  const resumeRoot = isObject(input.resume) && !legacyResume ? input.resume : {};
  const campaignResume = normalizeCampaignResume(resumeRoot.campaign) || legacyResume;
  const endlessResume = normalizeEndlessResume(resumeRoot.endless);
  const activeRun = normalizeRun(endless.activeRun) || (endlessResume ? normalizeRun(endlessResume) : null);

  const normalized = {
    version: SAVE_SCHEMA_VERSION,
    coins: Number.isFinite(input.coins) ? Math.max(0, Math.floor(input.coins)) : base.coins,
    inventory: {
      masterKey: Number.isFinite(inventory.masterKey)
        ? Math.max(0, Math.floor(inventory.masterKey))
        : base.inventory.masterKey,
      lubricant: Number.isFinite(inventory.lubricant)
        ? Math.max(0, Math.floor(inventory.lubricant))
        : base.inventory.lubricant,
      goldFinger: Number.isFinite(inventory.goldFinger)
        ? Math.max(0, Math.floor(inventory.goldFinger))
        : (Number.isFinite(inventory.hammer)
          ? Math.max(0, Math.floor(inventory.hammer))
          : base.inventory.goldFinger),
    },
    progression: {
      unlockedLevelIndex: Number.isFinite(progression.unlockedLevelIndex)
        ? Math.max(0, Math.floor(progression.unlockedLevelIndex))
        : base.progression.unlockedLevelIndex,
      lastLevelIndex: Number.isFinite(progression.lastLevelIndex)
        ? Math.max(0, Math.floor(progression.lastLevelIndex))
        : base.progression.lastLevelIndex,
      completed: normalizeCompletedMap(progression.completed),
    },
    session: {
      lastMode: session.lastMode === 'endless' ? 'endless' : 'campaign',
    },
    settings: {
      volume: Number.isFinite(settings.volume)
        ? Math.max(0, Math.min(1, Number(settings.volume)))
        : base.settings.volume,
      musicEnabled: typeof settings.musicEnabled === 'boolean' ? settings.musicEnabled : base.settings.musicEnabled,
      sfxEnabled: typeof settings.sfxEnabled === 'boolean' ? settings.sfxEnabled : base.settings.sfxEnabled,
      vibrationEnabled: typeof settings.vibrationEnabled === 'boolean'
        ? settings.vibrationEnabled
        : base.settings.vibrationEnabled,
    },
    endless: {
      lastDifficulty: typeof endless.lastDifficulty === 'string' ? endless.lastDifficulty : base.endless.lastDifficulty,
      bestStreak: Number.isFinite(endless.bestStreak) ? Math.max(0, Math.floor(endless.bestStreak)) : base.endless.bestStreak,
      activeRun,
    },
    resume: {
      campaign: campaignResume,
      endless: endlessResume,
    },
  };

  return sourceVersion < SAVE_SCHEMA_VERSION ? applyEndlessStarterFloor(normalized) : normalized;
}

export { STORAGE_KEY };
