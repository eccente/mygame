'use strict';

const DB_NAME = 'mygame_toolbox_v1';
const DB_VERSION = 1;
const STORE_PERSONS = 'persons';
const STORE_RECORDS = 'records';
const STORE_PENDING = 'pending';
const STORE_AUDIT = 'audit';
const STORE_META = 'meta';

const ACTION_SCHEMA = 'health-actions/v1';
const MEMORY_SCHEMA = 'health-memory-pack/v1';
const BACKUP_SCHEMA = 'health-backup/v1';
const MAX_ACTIONS_IMPORT = 40;
const BACKUP_REMINDER_DAYS = 3;
const MAX_ADVICE_TEXT_LEN = 1800;
const MAX_COMPAT_TEXT_IMPORT_LEN = 50000;
const MANUAL_SUBMIT_DEBOUNCE_MS = 1200;
const TOAST_VISIBLE_MS = 1850;
const LONG_PRESS_MS = 520;
const TAP_MOVE_TOLERANCE_PX = 12;
const MANAGE_MODE_RELEASE_GUARD_MS = 360;

const META_KEY_ELDER_MODE = 'ui_elder_mode';
const META_KEY_IMPORT_MODE = 'ui_import_mode';
const META_KEY_ONBOARDING_SEEN = 'ui_onboarding_seen';
const META_KEY_FORM_PREFILL_PREFIX = 'form_prefill_';
const META_KEY_RECORD_FORM_TYPE = 'ui_record_form_type';
const META_KEY_ACTIVE_MODULE = 'ui_active_module';
const META_KEY_TREND_WINDOW = 'ui_trend_window';
const META_KEY_MED_TEMPLATES = 'med_templates_v1';
const META_KEY_MED_TEMPLATE_HIDDEN_KEYS = 'med_template_hidden_keys_v1';

const OP_ALLOW_LIST = ['add_bp', 'add_heart_rate', 'add_medication', 'add_symptom', 'add_sleep'];
const TIME_SLOT_OPTIONS = [
  { value: 'before_breakfast', label: '晨起' },
  { value: 'after_breakfast', label: '早饭后' },
  { value: 'before_lunch', label: '午饭前' },
  { value: 'after_lunch', label: '午饭后' },
  { value: 'before_dinner', label: '下午高峰' },
  { value: 'after_dinner', label: '晚饭后' },
  { value: 'before_sleep', label: '睡前' },
  { value: 'other', label: '其他' },
];
const TIME_SLOT_LABEL_MAP = TIME_SLOT_OPTIONS.reduce((map, item) => {
  map[item.value] = item.label;
  return map;
}, Object.create(null));
const CHART_COLORS = Object.freeze({
  grid: 'rgba(26,58,66,0.16)',
  baseline: 'rgba(26,58,66,0.24)',
  bpSys: '#d97a3c',
  bpSysHighlight: '#ef8b49',
  bpDia: '#3f8dc3',
  bpDiaHighlight: '#4da7e6',
  hr: '#7b57c8',
  hrHighlight: '#5f3dc4',
  sleepGood: '#3f9b72',
  sleepNormal: '#d39b3a',
  sleepPoor: '#c25d5d',
  sleepFallback: '#6c8d95',
  sleepZone: 'rgba(63,155,114,0.12)',
  sleepSelectStroke: '#1c5565',
});
const TIMELINE_PRIMARY_STAT_KEYS = Object.freeze([
  'total_records',
  'blood_pressure_count',
  'heart_rate_count',
  'symptom_count',
  'sleep_count',
  'medication_count',
]);

const state = {
  db: null,
  persons: [],
  records: [],
  pending: [],
  activePersonId: null,
  strictImport: true,
  elderMode: false,
  isListening: false,
  activeRecordFormType: 'vitals',
  activeTimeSlot: 'before_breakfast',
  activeModule: 'record',
  trendWindow: 'recent_days',
  timelineManageMode: false,
  medTemplateManageMode: false,
  timelineManageGuardUntil: 0,
  medTemplateManageGuardUntil: 0,
  timelineDateMode: 'day',
  timelineDateKey: '',
  timelineKeyword: '',
  timelineStatFocus: 'total_records',
  timelineStatLabel: '范围总记录',
  timelineStatsExpanded: false,
  medTemplates: [],
  medTemplateHiddenKeys: new Set(),
  chartData: {
    bp: [],
    sleep: [],
    heartRate: [],
  },
  chartSummary: {
    bp: '',
    sleep: '',
    heartRate: '',
  },
  chartInspect: {
    bp: '',
    sleep: '',
    heartRate: '',
  },
  chartSelectedIndex: {
    bp: -1,
    sleep: -1,
    heartRate: -1,
  },
  manualSubmit: {
    inFlight: Object.create(null),
    lastAt: Object.create(null),
  },
  toastTimer: null,
};

const els = {
  refresh: document.getElementById('btn-refresh'),
  btnElderMode: document.getElementById('btn-elder-mode'),
  onboardingPanel: document.getElementById('onboarding-panel'),
  btnOnboardingDone: document.getElementById('btn-onboarding-done'),

  personSelector: document.getElementById('person-selector'),
  personForm: document.getElementById('person-form'),
  personName: document.getElementById('person-name'),
  personRelation: document.getElementById('person-relation'),
  personHints: document.getElementById('person-hints'),
  moduleButtons: Array.from(document.querySelectorAll('.module-btn')),
  modulePanels: Array.from(document.querySelectorAll('.module-panel')),
  recordTypeButtons: Array.from(document.querySelectorAll('.record-type-btn')),
  timeSlotButtons: Array.from(document.querySelectorAll('[data-time-slot]')),

  formBp: document.getElementById('form-bp'),
  bpSys: document.getElementById('bp-sys'),
  bpDia: document.getElementById('bp-dia'),
  bpNote: document.getElementById('bp-note'),

  hrBpm: document.getElementById('hr-bpm'),
  hrNote: document.getElementById('hr-note'),

  formMed: document.getElementById('form-med'),
  medName: document.getElementById('med-name'),
  medDose: document.getElementById('med-dose'),
  medStatus: document.getElementById('med-status'),
  medTemplateList: document.getElementById('med-template-list'),
  btnMedTemplateAdd: document.getElementById('btn-med-template-add'),

  formSymptom: document.getElementById('form-symptom'),
  symptomName: document.getElementById('symptom-name'),
  symptomSeverity: document.getElementById('symptom-severity'),
  symptomNote: document.getElementById('symptom-note'),

  formSleep: document.getElementById('form-sleep'),
  sleepHours: document.getElementById('sleep-hours'),
  sleepQuality: document.getElementById('sleep-quality'),
  sleepNote: document.getElementById('sleep-note'),

  importMode: document.getElementById('import-mode'),
  templateButtons: Array.from(document.querySelectorAll('.template-btn')),
  aiResponse: document.getElementById('ai-response'),
  btnImportActions: document.getElementById('btn-import-actions'),
  btnClearAiResponse: document.getElementById('btn-clear-ai-response'),
  aiResult: document.getElementById('ai-result'),

  btnVoice: document.getElementById('btn-voice'),
  btnVoiceImport: document.getElementById('btn-voice-import'),
  voiceStatus: document.getElementById('voice-status'),
  voiceTranscript: document.getElementById('voice-transcript'),

  pendingCount: document.getElementById('pending-count'),
  pendingList: document.getElementById('pending-list'),
  btnTimelinePrevDay: document.getElementById('btn-timeline-prev-day'),
  btnTimelineNextDay: document.getElementById('btn-timeline-next-day'),
  btnTimelineAll: document.getElementById('btn-timeline-all'),
  timelineDateLabel: document.getElementById('timeline-date-label'),
  timelineDateInput: document.getElementById('timeline-date-input'),
  btnTimelinePickDate: document.getElementById('btn-timeline-pick-date'),
  timelineKeywordInput: document.getElementById('timeline-keyword-input'),
  btnTimelineKeywordSearch: document.getElementById('btn-timeline-keyword-search'),
  btnTimelineKeywordClear: document.getElementById('btn-timeline-keyword-clear'),
  btnTimelineStatsToggle: document.getElementById('btn-timeline-stats-toggle'),
  trendWindowButtons: Array.from(document.querySelectorAll('[data-trend-window]')),
  timelineStats: document.getElementById('timeline-stats'),
  bpChart: document.getElementById('bp-chart'),
  bpMeta: document.getElementById('bp-meta'),
  sleepChart: document.getElementById('sleep-chart'),
  sleepMeta: document.getElementById('sleep-meta'),
  hrChart: document.getElementById('hr-chart'),
  hrMeta: document.getElementById('hr-meta'),
  timelineList: document.getElementById('timeline-list'),

  btnExport: document.getElementById('btn-export'),
  importFile: document.getElementById('import-file'),
  backupHint: document.getElementById('backup-hint'),
  healthToast: document.getElementById('health-toast'),
};

function makeId(prefix) {
  if (window.crypto && typeof window.crypto.randomUUID === 'function') {
    return `${prefix}_${window.crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(16).slice(2)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function toNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function toTrimmedText(value, maxLen = 120) {
  if (typeof value !== 'string') {
    return '';
  }
  const trimmed = value.trim();
  if (!Number.isFinite(maxLen) || maxLen < 0) {
    return trimmed;
  }
  return trimmed.slice(0, maxLen);
}

function toRecordText(value) {
  return toTrimmedText(value, Number.POSITIVE_INFINITY);
}

function toIntString(value, fallback, min, max) {
  const n = Math.round(toNumber(value));
  if (!Number.isFinite(n)) {
    return String(fallback);
  }
  return String(Math.max(min, Math.min(max, n)));
}

function fillNumberSelect(selectEl, min, max, fallback) {
  if (!selectEl) {
    return;
  }
  const prev = selectEl.value;
  selectEl.innerHTML = '';
  for (let value = min; value <= max; value += 1) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = String(value);
    selectEl.appendChild(option);
  }
  const next = toIntString(prev || fallback, fallback, min, max);
  selectEl.value = next;
}

function initWheelSelectors() {
  fillNumberSelect(els.bpSys, 70, 260, 120);
  fillNumberSelect(els.bpDia, 40, 180, 80);
  fillNumberSelect(els.hrBpm, 30, 220, 72);
}

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
    req.onerror = () => reject(req.error || new Error('Failed to open DB'));
  });
}

async function withStores(names, mode, callback) {
  const tx = state.db.transaction(names, mode);
  const stores = {};
  for (const name of names) {
    stores[name] = tx.objectStore(name);
  }
  const result = await callback(stores);
  await txToPromise(tx);
  return result;
}

async function getAll(storeName) {
  return withStores([storeName], 'readonly', async (stores) => reqToPromise(stores[storeName].getAll()));
}

async function getMeta(key) {
  return withStores([STORE_META], 'readonly', async (stores) => {
    const value = await reqToPromise(stores[STORE_META].get(key));
    return value ? value.value : null;
  });
}

async function setMeta(key, value) {
  return withStores([STORE_META], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_META].put({ key, value }));
  });
}

function personById(id) {
  return state.persons.find((person) => person.id === id) || null;
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`).join(',')}}`;
}

function recordFingerprint(record) {
  const payload = stableStringify(record.payload || {});
  return `${record.personId}|${record.type}|${record.timestamp}|${payload}`;
}

function formatTime(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return isoString;
  }
  return date.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatDateInput(isoString) {
  const date = new Date(isoString);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function parseEditedDateWithOriginalTime(dateText, originalTimestamp) {
  const clean = toTrimmedText(String(dateText || ''), 32);
  if (!clean) {
    return { ok: true, timestamp: originalTimestamp };
  }

  const match = clean.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  if (!match) {
    return { ok: false, error: '日期格式无效，请使用 YYYY-MM-DD。' };
  }

  const base = new Date(originalTimestamp);
  if (Number.isNaN(base.getTime())) {
    return { ok: false, error: '原记录时间无效，无法修改日期。' };
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) {
    return { ok: false, error: '日期格式无效，请使用 YYYY-MM-DD。' };
  }

  const next = new Date(base);
  next.setFullYear(year, month - 1, day);
  if (next.getFullYear() !== year || next.getMonth() !== month - 1 || next.getDate() !== day) {
    return { ok: false, error: '日期超出范围，请检查后重试。' };
  }

  return { ok: true, timestamp: next.toISOString() };
}

function promptEditRecordDate(originalTimestamp) {
  const currentDate = formatDateInput(originalTimestamp);
  const dateText = window.prompt('编辑日期（YYYY-MM-DD）', currentDate);
  if (dateText == null) {
    return { ok: false, cancelled: true, timestamp: originalTimestamp };
  }
  const parsed = parseEditedDateWithOriginalTime(dateText, originalTimestamp);
  if (!parsed.ok) {
    return { ok: false, cancelled: false, error: parsed.error, timestamp: originalTimestamp };
  }
  return { ok: true, cancelled: false, timestamp: parsed.timestamp };
}

function mapSeverity(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'mild' || raw === '轻微') {
    return 'mild';
  }
  if (raw === 'medium' || raw === '中等' || raw === '一般') {
    return 'medium';
  }
  if (raw === 'high' || raw === '明显' || raw === '严重') {
    return 'high';
  }
  return '';
}

function mapSleepQuality(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'good' || raw === '良好') {
    return 'good';
  }
  if (raw === 'normal' || raw === '一般' || raw === '中等') {
    return 'normal';
  }
  if (raw === 'poor' || raw === '较差') {
    return 'poor';
  }
  return '';
}

function normalizeStatus(value) {
  const raw = String(value || '').toLowerCase();
  if (raw === 'taken' || raw === '已服用') {
    return 'taken';
  }
  if (raw === 'missed' || raw === '漏服') {
    return 'missed';
  }
  if (raw === 'planned' || raw === '计划服用') {
    return 'planned';
  }
  return '';
}

function normalizeTimeSlot(value) {
  const raw = String(value || '').trim().toLowerCase();
  const aliasMap = {
    before_breakfast: 'before_breakfast',
    早餐前: 'before_breakfast',
    早饭前: 'before_breakfast',
    晨起: 'before_breakfast',
    after_breakfast: 'after_breakfast',
    早餐后: 'after_breakfast',
    早饭后: 'after_breakfast',
    before_lunch: 'before_lunch',
    午饭前: 'before_lunch',
    午餐前: 'before_lunch',
    after_lunch: 'after_lunch',
    午饭后: 'after_lunch',
    午餐后: 'after_lunch',
    before_dinner: 'before_dinner',
    晚饭前: 'before_dinner',
    晚餐前: 'before_dinner',
    下午高峰: 'before_dinner',
    after_dinner: 'after_dinner',
    晚饭后: 'after_dinner',
    晚餐后: 'after_dinner',
    before_sleep: 'before_sleep',
    睡前: 'before_sleep',
    other: 'other',
    其他: 'other',
  };
  return aliasMap[raw] || '';
}

function inferTimeSlotByDate(dateLike) {
  const date = dateLike instanceof Date ? dateLike : new Date(dateLike);
  const hour = Number.isFinite(date.getTime()) ? date.getHours() : new Date().getHours();

  if (hour < 8) {
    return 'before_breakfast';
  }
  if (hour < 11) {
    return 'after_breakfast';
  }
  if (hour < 12) {
    return 'before_lunch';
  }
  if (hour < 17) {
    return 'after_lunch';
  }
  if (hour < 18) {
    return 'before_dinner';
  }
  if (hour < 22) {
    return 'after_dinner';
  }
  return 'before_sleep';
}

function timeSlotLabel(slot) {
  const normalized = normalizeTimeSlot(slot);
  return TIME_SLOT_LABEL_MAP[normalized] || '';
}

function pickRecordTimeSlot(record) {
  const payloadSlot = normalizeTimeSlot(record?.payload?.timeSlot || record?.payload?.time_slot);
  if (payloadSlot) {
    return payloadSlot;
  }
  return inferTimeSlotByDate(record?.timestamp || nowIso());
}

function showToast(text, mode = 'ok') {
  if (!els.healthToast || !text) {
    return;
  }
  if (state.toastTimer) {
    window.clearTimeout(state.toastTimer);
    state.toastTimer = null;
  }
  els.healthToast.textContent = text;
  els.healthToast.classList.remove('warn', 'error', 'show');
  if (mode === 'warn' || mode === 'error') {
    els.healthToast.classList.add(mode);
  }
  els.healthToast.classList.add('show');
  state.toastTimer = window.setTimeout(() => {
    els.healthToast.classList.remove('show', 'warn', 'error');
    state.toastTimer = null;
  }, TOAST_VISIBLE_MS);
}

function bindLongPressGesture(element, onLongPress, onTap) {
  if (!element || typeof onLongPress !== 'function') {
    return;
  }
  let pressTimer = null;
  let longPressed = false;
  let suppressTap = false;
  let activePointerId = null;
  let startPoint = null;
  let tapHandledOnPointerUp = false;

  const clearTimer = () => {
    if (pressTimer) {
      window.clearTimeout(pressTimer);
      pressTimer = null;
    }
  };

  const resetPointer = () => {
    activePointerId = null;
    startPoint = null;
  };

  const isSamePointer = (event) => {
    if (activePointerId == null) {
      return true;
    }
    return !event || event.pointerId == null || event.pointerId === activePointerId;
  };

  const start = (event) => {
    if (event && event.button != null && event.button !== 0) {
      return;
    }
    longPressed = false;
    suppressTap = false;
    tapHandledOnPointerUp = false;
    activePointerId = event && event.pointerId != null ? event.pointerId : null;
    startPoint = event ? {
      x: Number(event.clientX) || 0,
      y: Number(event.clientY) || 0,
    } : null;
    clearTimer();
    pressTimer = window.setTimeout(() => {
      longPressed = true;
      suppressTap = true;
      onLongPress(event);
    }, LONG_PRESS_MS);
  };

  const handleMove = (event) => {
    if (!startPoint || !isSamePointer(event)) {
      return;
    }
    const deltaX = Math.abs((Number(event.clientX) || 0) - startPoint.x);
    const deltaY = Math.abs((Number(event.clientY) || 0) - startPoint.y);
    if (deltaX > TAP_MOVE_TOLERANCE_PX || deltaY > TAP_MOVE_TOLERANCE_PX) {
      suppressTap = true;
      clearTimer();
    }
  };

  const end = (event) => {
    if (!isSamePointer(event)) {
      return;
    }
    const shouldTap = event && event.pointerType === 'touch' && !longPressed && !suppressTap && typeof onTap === 'function';
    clearTimer();
    resetPointer();
    if (shouldTap) {
      tapHandledOnPointerUp = true;
      onTap(event);
    }
  };

  const cancel = (event) => {
    if (!isSamePointer(event)) {
      return;
    }
    suppressTap = true;
    clearTimer();
    resetPointer();
  };

  const handleLeave = (event) => {
    if (event && event.pointerType === 'touch') {
      return;
    }
    cancel(event);
  };

  element.addEventListener('pointerdown', start);
  element.addEventListener('pointermove', handleMove);
  element.addEventListener('pointerup', end);
  element.addEventListener('pointercancel', cancel);
  element.addEventListener('pointerleave', handleLeave);
  element.addEventListener('selectstart', (event) => {
    event.preventDefault();
  });
  element.addEventListener('contextmenu', (event) => {
    event.preventDefault();
  });
  element.addEventListener('click', (event) => {
    if (tapHandledOnPointerUp) {
      tapHandledOnPointerUp = false;
      event.preventDefault();
      event.stopPropagation();
      longPressed = false;
      suppressTap = false;
      return;
    }
    if (longPressed || suppressTap) {
      event.preventDefault();
      event.stopPropagation();
      longPressed = false;
      suppressTap = false;
      return;
    }
    if (typeof onTap === 'function') {
      onTap(event);
    }
    longPressed = false;
    suppressTap = false;
  });
}

function opAlias(op) {
  const key = String(op || '').toLowerCase().trim();
  const map = {
    add_bp: 'add_bp',
    blood_pressure: 'add_bp',
    add_blood_pressure: 'add_bp',
    记录血压: 'add_bp',
    add_heart_rate: 'add_heart_rate',
    heart_rate: 'add_heart_rate',
    pulse: 'add_heart_rate',
    hr: 'add_heart_rate',
    记录心率: 'add_heart_rate',
    add_medication: 'add_medication',
    medication: 'add_medication',
    add_drug: 'add_medication',
    记录用药: 'add_medication',
    add_symptom: 'add_symptom',
    symptom: 'add_symptom',
    记录症状: 'add_symptom',
    add_sleep: 'add_sleep',
    sleep: 'add_sleep',
    记录睡眠: 'add_sleep',
  };
  return map[key] || '';
}

function exactOp(op) {
  const key = String(op || '').toLowerCase().trim();
  return OP_ALLOW_LIST.includes(key) ? key : '';
}

function buildRecord(type, personId, payload, source, timestamp) {
  return {
    id: makeId('rec'),
    personId,
    type,
    payload,
    timestamp,
    source,
    createdAt: nowIso(),
  };
}

function setResult(text, mode = 'ok') {
  els.aiResult.textContent = text;
  els.aiResult.classList.remove('ok', 'warn', 'error');
  els.aiResult.classList.add(mode);
  if (text) {
    showToast(text, mode);
  }
}

function setBackupHint(text, mode = 'ok') {
  if (!els.backupHint) {
    return;
  }
  els.backupHint.textContent = text;
  els.backupHint.classList.remove('ok', 'warn', 'error');
  if (text) {
    els.backupHint.classList.add(mode);
  }
}

function setVoiceStatus(text, mode = 'ok') {
  if (!els.voiceStatus) {
    return;
  }
  els.voiceStatus.textContent = text;
  els.voiceStatus.classList.remove('ok', 'warn', 'error');
  els.voiceStatus.classList.add(mode);
  if (mode !== 'ok' && text) {
    showToast(text, mode);
  }
}

function summarizeRecord(record, options = {}) {
  const fullAdvice = options.fullAdvice === true;
  const payload = record.payload || {};
  if (record.type === 'ai_advice') {
    const advice = toTrimmedText(String(payload.text || ''), MAX_ADVICE_TEXT_LEN);
    if (!advice) {
      return 'AI建议';
    }
    if (fullAdvice) {
      return `AI建议\n${advice}`;
    }
    return `AI建议 ${toTrimmedText(advice, 240)}`;
  }
  if (record.type === 'blood_pressure') {
    const note = payload.note ? `，备注: ${payload.note}` : '';
    return `${payload.systolic}/${payload.diastolic} mmHg${note}`;
  }
  if (record.type === 'heart_rate') {
    const note = payload.note ? `，备注: ${payload.note}` : '';
    return `${payload.bpm} 次/分${note}`;
  }
  if (record.type === 'medication') {
    const statusMap = { taken: '已服用', missed: '漏服', planned: '计划服用' };
    const note = payload.note ? `，备注: ${payload.note}` : '';
    return `${payload.name} ${payload.dose}（${statusMap[payload.status] || payload.status}）${note}`;
  }
  if (record.type === 'symptom') {
    const severityMap = { mild: '轻微', medium: '中等', high: '明显' };
    const note = payload.note ? `，备注: ${payload.note}` : '';
    return `${payload.name}（${severityMap[payload.severity] || payload.severity}）${note}`;
  }
  const qualityMap = { good: '良好', normal: '一般', poor: '较差' };
  const note = payload.note ? `，备注: ${payload.note}` : '';
  return `${payload.hours} 小时（${qualityMap[payload.quality] || payload.quality}）${note}`;
}

function recordTypeLabel(type) {
  const map = {
    blood_pressure: '血压',
    heart_rate: '心率',
    medication: '用药',
    symptom: '症状',
    sleep: '睡眠',
    ai_advice: 'AI建议',
  };
  return map[type] || '记录';
}

function statToneByLabel(label) {
  if (/均值/.test(label)) {
    return 'avg';
  }
  if (/峰值|最长/.test(label)) {
    return 'peak';
  }
  if (/低谷|最短/.test(label)) {
    return 'valley';
  }
  if (/执行率/.test(label)) {
    return 'good';
  }
  if (/记录|次数|建议|总/.test(label)) {
    return 'count';
  }
  return 'neutral';
}

function ensureTimelineDateKey() {
  if (!state.timelineDateKey) {
    state.timelineDateKey = localDayKey(new Date()) || '';
  }
  return state.timelineDateKey;
}

function timelineScopeLabel() {
  if (state.timelineDateMode === 'all') {
    return '全部';
  }
  const key = ensureTimelineDateKey();
  if (!key) {
    return '今日';
  }
  return `${formatDayKeyLabel(key)}`;
}

function timelineScopedRecords(sourceRecords = activePersonRecords()) {
  const records = Array.isArray(sourceRecords) ? sourceRecords : [];
  if (state.timelineDateMode === 'all') {
    return records;
  }
  const key = ensureTimelineDateKey();
  if (!key) {
    return records;
  }
  return records.filter((record) => localDayKey(record.timestamp) === key);
}

function normalizeTimelineKeyword(value) {
  return toTrimmedText(value, 60);
}

function recordMatchesTimelineKeyword(record, keyword) {
  const needle = normalizeTimelineKeyword(keyword).toLowerCase();
  if (!needle) {
    return true;
  }
  const fullSummary = summarizeRecord(record, { fullAdvice: true }).replace(/\s+/g, ' ');
  const haystack = [
    recordTypeLabel(record.type),
    fullSummary,
    formatTime(record.timestamp),
    timeSlotLabel(pickRecordTimeSlot(record)),
    JSON.stringify(record.payload || {}),
  ].join(' ').toLowerCase();
  return haystack.includes(needle);
}

function timelineKeywordFilteredRecords(sourceRecords = []) {
  const records = Array.isArray(sourceRecords) ? sourceRecords : [];
  const keyword = normalizeTimelineKeyword(state.timelineKeyword);
  if (!keyword) {
    return records;
  }
  return records.filter((record) => recordMatchesTimelineKeyword(record, keyword));
}

function timelineRecordsByStatKey(records, statKey) {
  const scoped = Array.isArray(records) ? records : [];
  const key = String(statKey || '').trim();
  if (!key || key === 'total_records') {
    return scoped;
  }
  if (key === 'high_symptom_count') {
    return scoped.filter((record) => record.type === 'symptom' && record.payload?.severity === 'high');
  }
  const keyToType = {
    blood_pressure_count: 'blood_pressure',
    blood_pressure_avg: 'blood_pressure',
    bp_sys_peak: 'blood_pressure',
    bp_dia_peak: 'blood_pressure',
    heart_rate_count: 'heart_rate',
    heart_rate_avg: 'heart_rate',
    heart_rate_peak: 'heart_rate',
    heart_rate_valley: 'heart_rate',
    medication_count: 'medication',
    medication_adherence: 'medication',
    symptom_count: 'symptom',
    sleep_count: 'sleep',
    sleep_avg: 'sleep',
    sleep_longest: 'sleep',
    ai_advice_count: 'ai_advice',
  };
  const type = keyToType[key];
  if (!type) {
    return scoped;
  }
  return scoped.filter((record) => record.type === type);
}

function getActiveRecords() {
  const personRecords = activePersonRecords();
  const scoped = timelineScopedRecords(personRecords);
  const keywordFiltered = timelineKeywordFilteredRecords(scoped);
  return timelineRecordsByStatKey(keywordFiltered, state.timelineStatFocus);
}

function renderPersons() {
  const current = state.activePersonId;
  els.personSelector.innerHTML = '';

  for (const person of state.persons) {
    const opt = document.createElement('option');
    opt.value = person.id;
    opt.textContent = `${person.name}${person.relation ? ` (${person.relation})` : ''}`;
    els.personSelector.appendChild(opt);
  }

  if (state.persons.length > 0) {
    if (!personById(current)) {
      state.activePersonId = state.persons[0].id;
    }
    els.personSelector.value = state.activePersonId;
  }

  if (els.personHints) {
    const total = state.records.filter((record) => record.personId === state.activePersonId).length;
    const target = personById(state.activePersonId);
    els.personHints.textContent = target ? `${target.name} · ${total} 条记录` : '';
  }
}

const SVG_NS = 'http://www.w3.org/2000/svg';

function activePersonRecords() {
  return state.records.filter((record) => record.personId === state.activePersonId);
}

function createSvgNode(tagName, attrs = {}) {
  const node = document.createElementNS(SVG_NS, tagName);
  for (const [key, value] of Object.entries(attrs)) {
    node.setAttribute(key, String(value));
  }
  return node;
}

function clearSvg(svg) {
  if (!svg) {
    return;
  }
  while (svg.firstChild) {
    svg.removeChild(svg.firstChild);
  }
}

function drawEmptyChart(svg, text) {
  clearSvg(svg);
  svg.appendChild(createSvgNode('text', {
    x: 160,
    y: 64,
    'text-anchor': 'middle',
    'font-size': '12',
    fill: '#6a7d83',
  }));
  if (svg.lastChild) {
    svg.lastChild.textContent = text;
  }
}

function renderTimelineStats(records) {
  if (!els.timelineStats) {
    return;
  }

  els.timelineStats.innerHTML = '';
  const recent = Array.isArray(records) ? records : [];
  const primaryStatKeySet = new Set(TIMELINE_PRIMARY_STAT_KEYS);

  const bp = recent.filter((r) => r.type === 'blood_pressure');
  const hr = recent.filter((r) => r.type === 'heart_rate');
  const meds = recent.filter((r) => r.type === 'medication');
  const symptoms = recent.filter((r) => r.type === 'symptom');
  const sleeps = recent.filter((r) => r.type === 'sleep');
  const advice = recent.filter((r) => r.type === 'ai_advice');

  const bpSys = bp.map((row) => Number(row.payload?.systolic || 0)).filter((n) => Number.isFinite(n) && n > 0);
  const bpDia = bp.map((row) => Number(row.payload?.diastolic || 0)).filter((n) => Number.isFinite(n) && n > 0);
  const hrValues = hr.map((row) => Number(row.payload?.bpm || 0)).filter((n) => Number.isFinite(n) && n > 0);
  const sleepValues = sleeps.map((row) => Number(row.payload?.hours || 0)).filter((n) => Number.isFinite(n) && n >= 0);
  const medTaken = meds.filter((row) => row.payload?.status === 'taken').length;
  const medMissed = meds.filter((row) => row.payload?.status === 'missed').length;
  const medBase = medTaken + medMissed;

  const avg = (list, digits = 0) => {
    if (!list.length) {
      return null;
    }
    const value = list.reduce((sum, n) => sum + n, 0) / list.length;
    return digits > 0 ? value.toFixed(digits) : Math.round(value);
  };

  const pills = [
    { key: 'total_records', label: '范围总记录', value: String(recent.length) },
    { key: 'blood_pressure_count', label: '血压记录', value: String(bp.length) },
    { key: 'heart_rate_count', label: '心率记录', value: String(hr.length) },
    { key: 'symptom_count', label: '症状记录', value: String(symptoms.length) },
    { key: 'sleep_count', label: '睡眠记录', value: String(sleeps.length) },
    { key: 'medication_count', label: '用药记录', value: String(meds.length) },
    { key: 'ai_advice_count', label: 'AI建议', value: String(advice.length) },
    { key: 'blood_pressure_avg', label: '血压均值', value: bpSys.length && bpDia.length ? `${avg(bpSys)}/${avg(bpDia)}` : '-' },
    { key: 'bp_sys_peak', label: '收缩压峰值', value: bpSys.length ? String(Math.max(...bpSys)) : '-' },
    { key: 'bp_dia_peak', label: '舒张压峰值', value: bpDia.length ? String(Math.max(...bpDia)) : '-' },
    { key: 'heart_rate_avg', label: '心率均值', value: hrValues.length ? `${avg(hrValues)} 次/分` : '-' },
    { key: 'heart_rate_peak', label: '心率峰值', value: hrValues.length ? `${Math.max(...hrValues)} 次/分` : '-' },
    { key: 'heart_rate_valley', label: '心率低谷', value: hrValues.length ? `${Math.min(...hrValues)} 次/分` : '-' },
    { key: 'sleep_avg', label: '睡眠均值', value: sleepValues.length ? `${avg(sleepValues, 1)} 小时` : '-' },
    { key: 'sleep_longest', label: '最长睡眠', value: sleepValues.length ? `${Math.max(...sleepValues)} 小时` : '-' },
    { key: 'medication_adherence', label: '服药执行率', value: medBase > 0 ? `${Math.round((medTaken / medBase) * 100)}%` : '-' },
    { key: 'high_symptom_count', label: '明显症状次数', value: String(symptoms.filter((row) => row.payload?.severity === 'high').length) },
  ];
  const hasExtraStats = pills.length > TIMELINE_PRIMARY_STAT_KEYS.length;
  if (!primaryStatKeySet.has(state.timelineStatFocus)) {
    state.timelineStatsExpanded = true;
  }
  const visiblePills = state.timelineStatsExpanded
    ? pills
    : pills.filter((item) => primaryStatKeySet.has(item.key));

  for (const item of visiblePills) {
    const box = document.createElement('div');
    box.className = 'stat-pill';
    box.dataset.statKey = item.key;
    box.dataset.statLabel = item.label;
    const tone = statToneByLabel(item.label);
    box.classList.add(`stat-pill-${tone}`);
    if (item.key === state.timelineStatFocus) {
      box.classList.add('stat-pill-active');
    }
    box.setAttribute('role', 'button');
    box.setAttribute('tabindex', '0');
    box.setAttribute('aria-pressed', item.key === state.timelineStatFocus ? 'true' : 'false');

    const label = document.createElement('span');
    label.textContent = item.label;
    label.className = 'stat-label';

    const value = document.createElement('strong');
    value.textContent = String(item.value);
    value.className = 'stat-value';
    value.classList.add(`stat-value-${tone}`);

    box.appendChild(label);
    box.appendChild(value);
    box.addEventListener('click', () => {
      setTimelineStatFocus(item.key, item.label);
    });
    box.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setTimelineStatFocus(item.key, item.label);
      }
    });
    els.timelineStats.appendChild(box);
  }

  if (!els.btnTimelineStatsToggle) {
    return;
  }
  if (!hasExtraStats) {
    els.btnTimelineStatsToggle.hidden = true;
    els.btnTimelineStatsToggle.textContent = '';
    return;
  }
  const extraCount = pills.length - TIMELINE_PRIMARY_STAT_KEYS.length;
  const expanded = state.timelineStatsExpanded;
  els.btnTimelineStatsToggle.hidden = false;
  els.btnTimelineStatsToggle.setAttribute('aria-expanded', expanded ? 'true' : 'false');
  els.btnTimelineStatsToggle.textContent = expanded
    ? '收起更多指标'
    : `展开更多指标（+${extraCount}项）`;
}

function toggleTimelineStatsExpanded() {
  const next = !state.timelineStatsExpanded;
  if (!next && !TIMELINE_PRIMARY_STAT_KEYS.includes(state.timelineStatFocus)) {
    state.timelineStatFocus = 'total_records';
    state.timelineStatLabel = '范围总记录';
  }
  state.timelineStatsExpanded = next;
  renderTimeline();
}

function trendWindowLabel() {
  const map = {
    today: '今日',
    recent_days: '近7日',
  };
  return map[normalizeTrendWindow(state.trendWindow)] || '近7日';
}

function chartMetaEl(chartType) {
  if (chartType === 'bp') {
    return els.bpMeta;
  }
  if (chartType === 'sleep') {
    return els.sleepMeta;
  }
  return els.hrMeta;
}

function chartMetaTone(segment, index) {
  const text = String(segment || '').trim();
  if (!text) {
    return 'plain';
  }
  if (index === 0) {
    return 'window';
  }
  if (text.startsWith('最近:')) {
    return 'latest';
  }
  if (text.startsWith('均值:')) {
    return 'avg';
  }
  if (text.startsWith('峰值:') || text.startsWith('最长:')) {
    return 'peak';
  }
  if (text.startsWith('低谷:') || text.startsWith('最短:')) {
    return 'valley';
  }
  return 'plain';
}

function renderChartMeta(chartType) {
  const target = chartMetaEl(chartType);
  if (!target) {
    return;
  }
  target.innerHTML = '';

  const base = String(state.chartSummary[chartType] || '').trim();
  const inspect = String(state.chartInspect[chartType] || '').trim();
  if (!base && !inspect) {
    return;
  }

  const segments = [];
  if (chartType === 'sleep' && inspect) {
    segments.push({ text: inspect, tone: 'inspect', inspect: true });
  } else {
    if (base) {
      base.split('·')
        .map((item) => item.trim())
        .filter(Boolean)
        .forEach((item, index) => {
          segments.push({ text: item, tone: chartMetaTone(item, index), inspect: false });
        });
    }
    if (inspect) {
      segments.push({ text: inspect, tone: 'inspect', inspect: true });
    }
  }

  segments.forEach((segment, index) => {
    if (index > 0) {
      const sep = document.createElement('span');
      sep.className = 'chart-meta-sep';
      sep.textContent = ' · ';
      target.appendChild(sep);
    }
    const text = document.createElement('span');
    text.className = `chart-meta-seg chart-meta-seg-${segment.tone}`;
    if (segment.inspect) {
      text.classList.add('chart-meta-seg-selected');
    }
    text.textContent = segment.text;
    target.appendChild(text);
  });
}

function setChartBaseSummary(chartType, text) {
  state.chartSummary[chartType] = text || '';
  state.chartInspect[chartType] = '';
  state.chartSelectedIndex[chartType] = -1;
  const target = chartMetaEl(chartType);
  if (target) {
    target.classList.remove('has-inspect-detail');
  }
  renderChartMeta(chartType);
}

function setChartInspectDetail(chartType, detailText) {
  state.chartInspect[chartType] = detailText ? String(detailText) : '';
  const target = chartMetaEl(chartType);
  if (!target) {
    return;
  }
  target.classList.toggle('has-inspect-detail', Boolean(state.chartInspect[chartType]));
  renderChartMeta(chartType);
}

function resetChartPointStyle(chartType, point) {
  if (!point) {
    return;
  }
  if (chartType === 'bp') {
    if (point.sysNode) {
      point.sysNode.setAttribute('r', '2.3');
      point.sysNode.setAttribute('fill', CHART_COLORS.bpSys);
      point.sysNode.setAttribute('opacity', '1');
    }
    if (point.diaNode) {
      point.diaNode.setAttribute('r', '2.1');
      point.diaNode.setAttribute('fill', CHART_COLORS.bpDia);
      point.diaNode.setAttribute('opacity', '1');
    }
    return;
  }
  if (chartType === 'sleep') {
    if (point.dotNode) {
      point.dotNode.setAttribute('r', '2.6');
      point.dotNode.setAttribute('fill', point.dotColor || CHART_COLORS.sleepFallback);
      point.dotNode.setAttribute('opacity', '1');
      point.dotNode.setAttribute('stroke', 'none');
      point.dotNode.removeAttribute('stroke-width');
    }
    return;
  }
  if (point.dotNode) {
    point.dotNode.setAttribute('r', '2.4');
    point.dotNode.setAttribute('fill', CHART_COLORS.hr);
    point.dotNode.setAttribute('opacity', '1');
  }
}

function highlightChartPoint(chartType, point) {
  if (!point) {
    return;
  }
  if (chartType === 'bp') {
    if (point.sysNode) {
      point.sysNode.setAttribute('r', '3.6');
      point.sysNode.setAttribute('fill', CHART_COLORS.bpSysHighlight);
      point.sysNode.setAttribute('opacity', '1');
    }
    if (point.diaNode) {
      point.diaNode.setAttribute('r', '3.4');
      point.diaNode.setAttribute('fill', CHART_COLORS.bpDiaHighlight);
      point.diaNode.setAttribute('opacity', '1');
    }
    return;
  }
  if (chartType === 'sleep') {
    if (point.dotNode) {
      point.dotNode.setAttribute('r', '4');
      point.dotNode.setAttribute('fill', point.dotColor || CHART_COLORS.sleepGood);
      point.dotNode.setAttribute('stroke', CHART_COLORS.sleepSelectStroke);
      point.dotNode.setAttribute('stroke-width', '1.6');
      point.dotNode.setAttribute('opacity', '1');
    }
    return;
  }
  if (point.dotNode) {
    point.dotNode.setAttribute('r', '3.9');
    point.dotNode.setAttribute('fill', CHART_COLORS.hrHighlight);
    point.dotNode.setAttribute('opacity', '1');
  }
}

function setChartSelectedPoint(chartType, index) {
  const points = state.chartData[chartType] || [];
  const prev = Number.isFinite(state.chartSelectedIndex[chartType])
    ? state.chartSelectedIndex[chartType]
    : -1;
  if (prev >= 0 && prev < points.length) {
    resetChartPointStyle(chartType, points[prev]);
  }
  if (!Number.isFinite(index) || index < 0 || index >= points.length) {
    state.chartSelectedIndex[chartType] = -1;
    return;
  }
  highlightChartPoint(chartType, points[index]);
  state.chartSelectedIndex[chartType] = index;
}

function pickRowsForTrend(rows) {
  const mode = normalizeTrendWindow(state.trendWindow);
  if (mode === 'today') {
    const today = new Date();
    return rows.filter((row) => {
      const ts = new Date(row.timestamp);
      return Number.isFinite(ts.getTime()) && sameLocalDay(ts, today);
    });
  }
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - 6);
  return rows.filter((row) => {
    const ts = new Date(row.timestamp);
    return Number.isFinite(ts.getTime()) && ts >= start;
  });
}

function buildDayGroupedRows(rows, valueBuilder) {
  const grouped = new Map();
  rows.forEach((row) => {
    const key = localDayKey(row.timestamp);
    if (!key) {
      return;
    }
    if (!grouped.has(key)) {
      grouped.set(key, []);
    }
    grouped.get(key).push(row);
  });
  return [...grouped.keys()].sort().map((key) => valueBuilder(key, grouped.get(key) || []));
}

function buildBpSeries(records) {
  const rows = records
    .filter((record) => record.type === 'blood_pressure')
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const scoped = pickRowsForTrend(rows);
  const mode = normalizeTrendWindow(state.trendWindow);
  if (mode === 'recent_days') {
    return buildDayGroupedRows(scoped, (dayKey, dayRows) => {
      const sys = dayRows.map((row) => Number(row.payload?.systolic || 0)).filter((n) => Number.isFinite(n) && n > 0);
      const dia = dayRows.map((row) => Number(row.payload?.diastolic || 0)).filter((n) => Number.isFinite(n) && n > 0);
      if (!sys.length || !dia.length) {
        return null;
      }
      return {
        timestamp: dayRows[dayRows.length - 1].timestamp,
        timeLabel: `${formatDayKeyLabel(dayKey)} 日均`,
        systolic: Math.round(sys.reduce((sum, n) => sum + n, 0) / sys.length),
        diastolic: Math.round(dia.reduce((sum, n) => sum + n, 0) / dia.length),
      };
    }).filter(Boolean);
  }

  return scoped.map((row) => ({
    timestamp: row.timestamp,
    timeLabel: formatTime(row.timestamp),
    systolic: Number(row.payload?.systolic || 0),
    diastolic: Number(row.payload?.diastolic || 0),
  })).filter((row) => Number.isFinite(row.systolic) && Number.isFinite(row.diastolic));
}

function buildSleepSeries(records) {
  const rows = records
    .filter((record) => record.type === 'sleep')
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const scoped = pickRowsForTrend(rows);
  const mode = normalizeTrendWindow(state.trendWindow);
  if (mode === 'recent_days') {
    return buildDayGroupedRows(scoped, (dayKey, dayRows) => {
      const values = dayRows.map((row) => Number(row.payload?.hours || 0)).filter((n) => Number.isFinite(n) && n >= 0);
      if (!values.length) {
        return null;
      }
      const latest = dayRows[dayRows.length - 1];
      return {
        timestamp: latest.timestamp,
        timeLabel: `${formatDayKeyLabel(dayKey)} 日均`,
        hours: Number((values.reduce((sum, n) => sum + n, 0) / values.length).toFixed(1)),
        quality: latest.payload?.quality || 'normal',
        note: toTrimmedText(String(latest.payload?.note || ''), 80),
      };
    }).filter(Boolean);
  }
  return scoped.map((row) => ({
    timestamp: row.timestamp,
    timeLabel: formatTime(row.timestamp),
    hours: Number(row.payload?.hours || 0),
    quality: row.payload?.quality || 'normal',
    note: toTrimmedText(String(row.payload?.note || ''), 80),
  })).filter((row) => Number.isFinite(row.hours));
}

function buildHeartRateSeries(records) {
  const rows = records
    .filter((record) => record.type === 'heart_rate')
    .slice()
    .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  const scoped = pickRowsForTrend(rows);
  const mode = normalizeTrendWindow(state.trendWindow);
  if (mode === 'recent_days') {
    return buildDayGroupedRows(scoped, (dayKey, dayRows) => {
      const values = dayRows.map((row) => Number(row.payload?.bpm || 0)).filter((n) => Number.isFinite(n) && n > 0);
      if (!values.length) {
        return null;
      }
      return {
        timestamp: dayRows[dayRows.length - 1].timestamp,
        timeLabel: `${formatDayKeyLabel(dayKey)} 日均`,
        bpm: Math.round(values.reduce((sum, n) => sum + n, 0) / values.length),
      };
    }).filter(Boolean);
  }
  return scoped.map((row) => ({
    timestamp: row.timestamp,
    timeLabel: formatTime(row.timestamp),
    bpm: Number(row.payload?.bpm || 0),
  })).filter((row) => Number.isFinite(row.bpm));
}

function renderBpChart(records) {
  if (!els.bpChart || !els.bpMeta) {
    return;
  }

  const rows = buildBpSeries(records);
  if (!rows.length) {
    drawEmptyChart(els.bpChart, '暂无血压记录');
    state.chartData.bp = [];
    setChartBaseSummary('bp', '');
    return;
  }

  clearSvg(els.bpChart);
  const width = 320;
  const height = 120;
  const padX = 16;
  const padY = 12;
  const sysValues = rows.map((row) => row.systolic);
  const diaValues = rows.map((row) => row.diastolic);
  const valuePool = sysValues.concat(diaValues);
  const minValue = Math.max(40, Math.min(...valuePool) - 8);
  const maxValue = Math.min(260, Math.max(...valuePool) + 8);
  const range = Math.max(20, maxValue - minValue);
  const xAt = (index) => (rows.length === 1
    ? width / 2
    : padX + (index * (width - padX * 2)) / (rows.length - 1));
  const yAt = (value) => height - padY - ((value - minValue) / range) * (height - padY * 2);

  for (let i = 0; i < 4; i += 1) {
    const y = padY + (i * (height - padY * 2)) / 3;
    els.bpChart.appendChild(createSvgNode('line', {
      x1: padX,
      y1: y,
      x2: width - padX,
      y2: y,
      stroke: CHART_COLORS.grid,
      'stroke-width': 1,
    }));
  }

  const diaLine = rows.map((row, idx) => `${xAt(idx)},${yAt(row.diastolic)}`).join(' ');
  const sysLine = rows.map((row, idx) => `${xAt(idx)},${yAt(row.systolic)}`).join(' ');

  els.bpChart.appendChild(createSvgNode('polyline', {
    points: diaLine,
    fill: 'none',
    stroke: CHART_COLORS.bpDia,
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));
  els.bpChart.appendChild(createSvgNode('polyline', {
    points: sysLine,
    fill: 'none',
    stroke: CHART_COLORS.bpSys,
    'stroke-width': 2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));

  state.chartData.bp = rows.map((row, idx) => {
    const x = xAt(idx);
    const sysNode = createSvgNode('circle', {
      cx: x,
      cy: yAt(row.systolic),
      r: 2.3,
      fill: CHART_COLORS.bpSys,
    });
    const diaNode = createSvgNode('circle', {
      cx: x,
      cy: yAt(row.diastolic),
      r: 2.1,
      fill: CHART_COLORS.bpDia,
    });
    els.bpChart.appendChild(sysNode);
    els.bpChart.appendChild(diaNode);
    return {
      x,
      y: (yAt(row.systolic) + yAt(row.diastolic)) / 2,
      timeLabel: row.timeLabel,
      systolic: row.systolic,
      diastolic: row.diastolic,
      sysNode,
      diaNode,
    };
  });

  const latest = rows[rows.length - 1];
  const avgSys = Math.round(sysValues.reduce((sum, value) => sum + value, 0) / sysValues.length);
  const avgDia = Math.round(diaValues.reduce((sum, value) => sum + value, 0) / diaValues.length);
  const maxSys = Math.max(...sysValues);
  const maxDia = Math.max(...diaValues);
  const minSys = Math.min(...sysValues);
  const minDia = Math.min(...diaValues);
  const summary = `${trendWindowLabel()} · 最近: ${latest.systolic}/${latest.diastolic} · 均值: ${avgSys}/${avgDia} · 峰值: ${maxSys}/${maxDia} · 低谷: ${minSys}/${minDia}`;
  setChartBaseSummary('bp', summary);
}

function renderSleepChart(records) {
  if (!els.sleepChart || !els.sleepMeta) {
    return;
  }

  const rows = buildSleepSeries(records);
  if (!rows.length) {
    drawEmptyChart(els.sleepChart, '暂无睡眠记录');
    state.chartData.sleep = [];
    setChartBaseSummary('sleep', '');
    return;
  }

  clearSvg(els.sleepChart);
  const width = 320;
  const height = 120;
  const padX = 16;
  const padY = 12;
  const values = rows.map((row) => row.hours);
  const minValue = 0;
  const maxValue = Math.max(8, Math.max(...values) + 1);
  const range = Math.max(3, maxValue - minValue);
  const xAt = (index) => (rows.length === 1
    ? width / 2
    : padX + (index * (width - padX * 2)) / (rows.length - 1));
  const yAt = (value) => height - padY - ((value - minValue) / range) * (height - padY * 2);
  const colorMap = {
    good: CHART_COLORS.sleepGood,
    normal: CHART_COLORS.sleepNormal,
    poor: CHART_COLORS.sleepPoor,
  };

  for (let i = 0; i < 4; i += 1) {
    const y = padY + (i * (height - padY * 2)) / 3;
    els.sleepChart.appendChild(createSvgNode('line', {
      x1: padX,
      y1: y,
      x2: width - padX,
      y2: y,
      stroke: CHART_COLORS.grid,
      'stroke-width': 1,
    }));
  }

  els.sleepChart.appendChild(createSvgNode('line', {
    x1: padX,
    y1: yAt(0),
    x2: width - padX,
    y2: yAt(0),
    stroke: CHART_COLORS.baseline,
    'stroke-width': 1,
  }));

  const line = rows.map((row, idx) => `${xAt(idx)},${yAt(row.hours)}`).join(' ');
  els.sleepChart.appendChild(createSvgNode('polyline', {
    points: line,
    fill: 'none',
    stroke: CHART_COLORS.sleepGood,
    'stroke-width': 2.2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));

  state.chartData.sleep = rows.map((row, idx) => {
    const x = xAt(idx);
    const y = yAt(row.hours);
    const dotColor = colorMap[row.quality] || CHART_COLORS.sleepFallback;
    const dotNode = createSvgNode('circle', {
      cx: x,
      cy: y,
      r: 2.6,
      fill: dotColor,
    });
    els.sleepChart.appendChild(dotNode);
    return {
      x,
      y,
      timeLabel: row.timeLabel,
      hours: row.hours,
      note: row.note || '',
      dotNode,
      dotColor,
    };
  });

  const latest = rows[rows.length - 1];
  const avgHours = (rows.reduce((sum, row) => sum + row.hours, 0) / rows.length).toFixed(1);
  const longestHours = Math.max(...rows.map((row) => row.hours));
  const shortestHours = Math.min(...rows.map((row) => row.hours));
  const summary = `${trendWindowLabel()} · 最近: ${latest.hours} 小时 · 均值: ${avgHours} 小时 · 最长: ${longestHours} 小时 · 最短: ${shortestHours} 小时`;
  setChartBaseSummary('sleep', summary);
}

function renderHeartRateChart(records) {
  if (!els.hrChart || !els.hrMeta) {
    return;
  }

  const rows = buildHeartRateSeries(records);
  if (!rows.length) {
    drawEmptyChart(els.hrChart, '暂无心率记录');
    state.chartData.heartRate = [];
    setChartBaseSummary('heartRate', '');
    return;
  }

  clearSvg(els.hrChart);
  const width = 320;
  const height = 120;
  const padX = 16;
  const padY = 12;
  const values = rows.map((row) => row.bpm);
  const minValue = Math.max(30, Math.min(...values) - 8);
  const maxValue = Math.min(220, Math.max(...values) + 8);
  const range = Math.max(20, maxValue - minValue);
  const xAt = (index) => (rows.length === 1
    ? width / 2
    : padX + (index * (width - padX * 2)) / (rows.length - 1));
  const yAt = (value) => height - padY - ((value - minValue) / range) * (height - padY * 2);

  const normalTop = yAt(100);
  const normalBottom = yAt(60);
  const zoneY = Math.min(normalTop, normalBottom);
  const zoneH = Math.abs(normalBottom - normalTop);
  els.hrChart.appendChild(createSvgNode('rect', {
    x: padX,
    y: zoneY,
    width: width - padX * 2,
    height: zoneH,
    fill: CHART_COLORS.sleepZone,
  }));

  for (let i = 0; i < 4; i += 1) {
    const y = padY + (i * (height - padY * 2)) / 3;
    els.hrChart.appendChild(createSvgNode('line', {
      x1: padX,
      y1: y,
      x2: width - padX,
      y2: y,
      stroke: CHART_COLORS.grid,
      'stroke-width': 1,
    }));
  }

  const line = rows.map((row, idx) => `${xAt(idx)},${yAt(row.bpm)}`).join(' ');
  els.hrChart.appendChild(createSvgNode('polyline', {
    points: line,
    fill: 'none',
    stroke: CHART_COLORS.hr,
    'stroke-width': 2.2,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
  }));

  state.chartData.heartRate = rows.map((row, idx) => {
    const x = xAt(idx);
    const y = yAt(row.bpm);
    const dotNode = createSvgNode('circle', {
      cx: x,
      cy: y,
      r: 2.4,
      fill: CHART_COLORS.hr,
    });
    els.hrChart.appendChild(dotNode);
    return {
      x,
      y,
      timeLabel: row.timeLabel,
      bpm: row.bpm,
      dotNode,
    };
  });

  const latest = rows[rows.length - 1];
  const avg = Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  const peak = Math.max(...values);
  const valley = Math.min(...values);
  const summary = `${trendWindowLabel()} · 最近: ${latest.bpm} 次/分 · 均值: ${avg} 次/分 · 峰值: ${peak} · 低谷: ${valley}`;
  setChartBaseSummary('heartRate', summary);
}

function inspectChartPoint(chartType, event) {
  const points = state.chartData[chartType] || [];
  if (!points.length || !event || !event.currentTarget) {
    return;
  }
  const rect = event.currentTarget.getBoundingClientRect();
  if (!rect.width || !rect.height) {
    return;
  }
  const x = ((event.clientX - rect.left) / rect.width) * 320;
  const y = ((event.clientY - rect.top) / rect.height) * 120;
  let nearest = points[0];
  let nearestIndex = 0;
  let minDist = Number.POSITIVE_INFINITY;
  points.forEach((point, index) => {
    const dx = point.x - x;
    const dy = point.y - y;
    const dist = (dx * dx) + (dy * dy);
    if (dist < minDist) {
      minDist = dist;
      nearest = point;
      nearestIndex = index;
    }
  });
  setChartSelectedPoint(chartType, nearestIndex);

  if (chartType === 'bp') {
    setChartInspectDetail('bp', `选中: ${nearest.timeLabel} ${nearest.systolic}/${nearest.diastolic}`);
    return;
  }
  if (chartType === 'sleep') {
    const note = toTrimmedText(String(nearest.note || ''), 80) || '无';
    setChartInspectDetail('sleep', `备注: ${note}（${nearest.timeLabel}，${nearest.hours} 小时）`);
    return;
  }
  setChartInspectDetail('heartRate', `选中: ${nearest.timeLabel} ${nearest.bpm} 次/分`);
}

function renderTimelineVisuals() {
  const personRecords = activePersonRecords();
  const scopedRecords = timelineScopedRecords(personRecords);
  renderTimelineStats(scopedRecords);
  renderBpChart(personRecords);
  renderHeartRateChart(personRecords);
  renderSleepChart(personRecords);
  renderTimelineDateControls();
}

function timelineSlotOrder(slotKey) {
  const order = {
    before_breakfast: 1,
    after_breakfast: 2,
    before_lunch: 3,
    after_lunch: 4,
    before_dinner: 5,
    after_dinner: 6,
    before_sleep: 7,
    other: 8,
    unspecified: 9,
    ai_misc: 10,
  };
  return Number.isFinite(order[slotKey]) ? order[slotKey] : 99;
}

function normalizeTimelineSlot(record) {
  if (record.type === 'ai_advice') {
    return 'ai_misc';
  }
  const slot = normalizeTimeSlot(pickRecordTimeSlot(record));
  return slot || 'unspecified';
}

function timelineSlotLabel(slotKey) {
  if (slotKey === 'ai_misc') {
    return 'AI建议';
  }
  if (slotKey === 'unspecified') {
    return '未标记时段';
  }
  return timeSlotLabel(slotKey);
}

function buildTimelineGroups(records) {
  const grouped = new Map();
  records.forEach((record) => {
    const dayKey = localDayKey(record.timestamp) || 'unknown';
    const slotKey = normalizeTimelineSlot(record);
    const key = `${dayKey}__${slotKey}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        key,
        dayKey,
        slotKey,
        slotLabel: timelineSlotLabel(slotKey),
        latestTimestamp: record.timestamp,
        records: [],
        byType: Object.create(null),
      });
    }
    const row = grouped.get(key);
    row.records.push(record);
    if (record.timestamp > row.latestTimestamp) {
      row.latestTimestamp = record.timestamp;
    }
    if (!Array.isArray(row.byType[record.type])) {
      row.byType[record.type] = [];
    }
    row.byType[record.type].push(record);
  });

  return [...grouped.values()]
    .sort((a, b) => {
      if (a.dayKey !== b.dayKey) {
        if (a.dayKey === 'unknown') {
          return 1;
        }
        if (b.dayKey === 'unknown') {
          return -1;
        }
        return b.dayKey.localeCompare(a.dayKey);
      }
      return timelineSlotOrder(a.slotKey) - timelineSlotOrder(b.slotKey);
    });
}

function summarizeGroupedType(type, records) {
  const rows = records
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  const latest = rows[0];
  const payload = latest.payload || {};
  const more = rows.length > 1 ? `（${rows.length}条）` : '';

  const formatDetailedRows = () => rows.map((row, index) => {
    const text = summarizeRecord(row);
    if (rows.length === 1) {
      return text;
    }
    return `${index + 1}. ${formatTime(row.timestamp)} ${text}`;
  }).join('\n');

  if (rows.length > 1 && type !== 'ai_advice') {
    return formatDetailedRows();
  }

  if (type === 'blood_pressure') {
    const note = payload.note ? `，${payload.note}` : '';
    return `${payload.systolic}/${payload.diastolic} mmHg${note}${more}`;
  }
  if (type === 'heart_rate') {
    const note = payload.note ? `，${payload.note}` : '';
    return `${payload.bpm} 次/分${note}${more}`;
  }
  if (type === 'medication') {
    return formatDetailedRows();
  }
  if (type === 'symptom') {
    return formatDetailedRows();
  }
  if (type === 'sleep') {
    const qualityMap = { good: '良好', normal: '一般', poor: '较差' };
    const note = payload.note ? `，${payload.note}` : '';
    return `${payload.hours} 小时（${qualityMap[payload.quality] || payload.quality || '未知'}）${note}${more}`;
  }
  const texts = rows
    .map((row, index) => {
      const raw = toTrimmedText(String(row.payload?.text || ''), MAX_ADVICE_TEXT_LEN);
      if (!raw) {
        return rows.length > 1 ? `${index + 1}. （空）` : 'AI建议';
      }
      if (rows.length === 1) {
        return raw;
      }
      return `${index + 1}. ${formatTime(row.timestamp)}\n${raw}`;
    })
    .filter(Boolean);
  return texts.join('\n\n');
}

function chooseTimelineRecordByPrompt(type, rows, actionText = '编辑') {
  const list = Array.isArray(rows) ? rows.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)) : [];
  if (!list.length) {
    return null;
  }
  if (list.length === 1) {
    return list[0];
  }

  const options = list.map((row, index) => {
    const digest = summarizeRecord(row).replace(/\s+/g, ' ');
    return `${index + 1}. ${formatTime(row.timestamp)} · ${toTrimmedText(digest, 64)}`;
  }).join('\n');
  const input = window.prompt(
    `该时段有 ${list.length} 条${recordTypeLabel(type)}记录，请输入要${actionText}的序号（1-${list.length}）：\n${options}`,
    '1',
  );
  if (input == null) {
    return null;
  }
  const picked = Math.round(toNumber(input));
  if (!Number.isFinite(picked) || picked < 1 || picked > list.length) {
    setResult('序号无效，未执行。', 'warn');
    return null;
  }
  return list[picked - 1];
}

async function deleteTimelineRecordsByType(type, rows) {
  const list = Array.isArray(rows) ? rows.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)) : [];
  if (!list.length) {
    return;
  }

  if (list.length === 1) {
    const ok = window.confirm(`确认删除这条${recordTypeLabel(type)}记录吗？`);
    if (!ok) {
      return;
    }
    await deleteRecordsByIds([list[0].id]);
    return;
  }

  const options = list.map((row, index) => `${index + 1}. ${formatTime(row.timestamp)}`).join('\n');
  const input = window.prompt(
    `该时段有 ${list.length} 条${recordTypeLabel(type)}记录。\n输入序号删除单条，输入 all 删除全部：\n${options}`,
    '1',
  );
  if (input == null) {
    return;
  }
  const clean = toTrimmedText(input, 24).toLowerCase();
  if (clean === 'all') {
    const ok = window.confirm(`确认删除该时段全部 ${list.length} 条${recordTypeLabel(type)}记录吗？`);
    if (!ok) {
      return;
    }
    await deleteRecordsByIds(list.map((row) => row.id));
    return;
  }

  const picked = Math.round(toNumber(clean));
  if (!Number.isFinite(picked) || picked < 1 || picked > list.length) {
    setResult('序号无效，未执行删除。', 'warn');
    return;
  }
  const ok = window.confirm(`确认删除第 ${picked} 条${recordTypeLabel(type)}记录吗？`);
  if (!ok) {
    return;
  }
  await deleteRecordsByIds([list[picked - 1].id]);
}

async function updateRecordById(recordId, payloadUpdater, options = {}) {
  const target = state.records.find((row) => row.id === recordId);
  if (!target) {
    setResult('记录不存在或已删除。', 'warn');
    return false;
  }
  const nextPayload = payloadUpdater ? payloadUpdater({ ...(target.payload || {}) }) : { ...(target.payload || {}) };
  if (!nextPayload || typeof nextPayload !== 'object') {
    return false;
  }
  const nextTimestamp = options.timestamp || target.timestamp;
  const ts = new Date(nextTimestamp);
  if (Number.isNaN(ts.getTime())) {
    setResult('记录日期无效，未保存。', 'error');
    return false;
  }
  const nextRecord = {
    ...target,
    payload: nextPayload,
    timestamp: ts.toISOString(),
    updatedAt: nowIso(),
  };

  await withStores([STORE_RECORDS, STORE_AUDIT], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_RECORDS].put(nextRecord));
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event: 'record_edit_manual',
      detail: {
        recordId: target.id,
        personId: target.personId,
        type: target.type,
      },
      createdAt: nowIso(),
    }));
  });

  return true;
}

async function editTimelineRecordsByType(type, rows, options = {}) {
  const list = Array.isArray(rows) ? rows.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp)) : [];
  if (!list.length) {
    return;
  }
  const forcedId = options && typeof options.recordId === 'string' ? options.recordId : '';
  const target = forcedId
    ? (list.find((row) => row.id === forcedId) || null)
    : chooseTimelineRecordByPrompt(type, list, '编辑');
  if (!target) {
    return;
  }
  const payload = target.payload || {};
  let edited = false;
  const resolveEditedDate = () => {
    const picked = promptEditRecordDate(target.timestamp);
    if (picked.cancelled) {
      return { stop: true, timestamp: target.timestamp };
    }
    if (!picked.ok) {
      setResult(picked.error || '日期无效，未保存。', 'error');
      return { stop: true, timestamp: target.timestamp };
    }
    return { stop: false, timestamp: picked.timestamp };
  };

  if (type === 'blood_pressure') {
    const valueText = window.prompt('编辑血压（格式：收缩压/舒张压）', `${payload.systolic || ''}/${payload.diastolic || ''}`);
    if (valueText == null) {
      return;
    }
    const match = valueText.trim().match(/^(\d{2,3})\s*\/\s*(\d{2,3})$/);
    if (!match) {
      setResult('血压格式无效。', 'error');
      return;
    }
    const systolic = Number(match[1]);
    const diastolic = Number(match[2]);
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic) || systolic <= diastolic) {
      setResult('血压值无效。', 'error');
      return;
    }
    const note = window.prompt('编辑备注（可留空）', String(payload.note || ''));
    if (note == null) {
      return;
    }
    const datePick = resolveEditedDate();
    if (datePick.stop) {
      return;
    }
    edited = await updateRecordById(target.id, (nextPayload) => ({
      ...nextPayload,
      systolic,
      diastolic,
      note: toRecordText(note),
    }), { timestamp: datePick.timestamp });
  } else if (type === 'heart_rate') {
    const bpmText = window.prompt('编辑心率（30-220）', String(payload.bpm || ''));
    if (bpmText == null) {
      return;
    }
    const bpm = Math.round(toNumber(bpmText));
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 220) {
      setResult('心率值无效。', 'error');
      return;
    }
    const note = window.prompt('编辑备注（可留空）', String(payload.note || ''));
    if (note == null) {
      return;
    }
    const datePick = resolveEditedDate();
    if (datePick.stop) {
      return;
    }
    edited = await updateRecordById(target.id, (nextPayload) => ({
      ...nextPayload,
      bpm,
      note: toRecordText(note),
    }), { timestamp: datePick.timestamp });
  } else if (type === 'medication') {
    const name = window.prompt('编辑药名', String(payload.name || ''));
    if (name == null) {
      return;
    }
    const dose = window.prompt('编辑剂量', String(payload.dose || ''));
    if (dose == null) {
      return;
    }
    const statusCurrent = normalizeStatus(payload.status);
    const statusLabelMap = { taken: '已服用', missed: '漏服', planned: '计划服用' };
    const statusDefault = statusLabelMap[statusCurrent] || '已服用';
    const statusText = window.prompt('编辑状态（已服用/漏服/计划服用）', statusDefault);
    if (statusText == null) {
      return;
    }
    const status = normalizeStatus(statusText);
    const cleanName = toRecordText(name);
    const cleanDose = toRecordText(dose);
    if (!cleanName || !cleanDose || !status) {
      setResult('用药内容无效。', 'error');
      return;
    }
    const datePick = resolveEditedDate();
    if (datePick.stop) {
      return;
    }
    edited = await updateRecordById(target.id, (nextPayload) => ({
      ...nextPayload,
      name: cleanName,
      dose: cleanDose,
      status,
    }), { timestamp: datePick.timestamp });
  } else if (type === 'symptom') {
    const name = window.prompt('编辑症状名称', String(payload.name || ''));
    if (name == null) {
      return;
    }
    const severityCurrent = mapSeverity(payload.severity);
    const severityLabelMap = { mild: '轻微', medium: '中等', high: '明显' };
    const severityDefault = severityLabelMap[severityCurrent] || '轻微';
    const severityText = window.prompt('编辑程度（轻微/中等/明显）', severityDefault);
    if (severityText == null) {
      return;
    }
    const severity = mapSeverity(severityText);
    if (!toRecordText(name) || !severity) {
      setResult('症状内容无效。', 'error');
      return;
    }
    const note = window.prompt('编辑备注（可留空）', String(payload.note || ''));
    if (note == null) {
      return;
    }
    const datePick = resolveEditedDate();
    if (datePick.stop) {
      return;
    }
    edited = await updateRecordById(target.id, (nextPayload) => ({
      ...nextPayload,
      name: toRecordText(name),
      severity,
      note: toRecordText(note),
    }), { timestamp: datePick.timestamp });
  } else if (type === 'sleep') {
    const hoursText = window.prompt('编辑睡眠时长（小时）', String(payload.hours || ''));
    if (hoursText == null) {
      return;
    }
    const hours = Number(toNumber(hoursText));
    const qualityCurrent = mapSleepQuality(payload.quality);
    const qualityLabelMap = { good: '良好', normal: '一般', poor: '较差' };
    const qualityDefault = qualityLabelMap[qualityCurrent] || '良好';
    const qualityText = window.prompt('编辑睡眠质量（良好/一般/较差）', qualityDefault);
    if (qualityText == null) {
      return;
    }
    const quality = mapSleepQuality(qualityText);
    if (!Number.isFinite(hours) || hours < 0 || hours > 24 || !quality) {
      setResult('睡眠内容无效。', 'error');
      return;
    }
    const note = window.prompt('编辑备注（可留空）', String(payload.note || ''));
    if (note == null) {
      return;
    }
    const datePick = resolveEditedDate();
    if (datePick.stop) {
      return;
    }
    edited = await updateRecordById(target.id, (nextPayload) => ({
      ...nextPayload,
      hours,
      quality,
      note: toRecordText(note),
    }), { timestamp: datePick.timestamp });
  } else if (type === 'ai_advice') {
    const text = window.prompt('编辑 AI 建议', String(payload.text || ''));
    if (text == null) {
      return;
    }
    const clean = toTrimmedText(text, MAX_ADVICE_TEXT_LEN);
    if (!clean) {
      setResult('AI建议不能为空。', 'warn');
      return;
    }
    const datePick = resolveEditedDate();
    if (datePick.stop) {
      return;
    }
    edited = await updateRecordById(target.id, (nextPayload) => ({
      ...nextPayload,
      text: clean,
    }), { timestamp: datePick.timestamp });
  }

  if (!edited) {
    return;
  }
  await refreshAll();
  const more = list.length > 1 && !forcedId ? `（本时段共${list.length}条）` : '';
  setResult(`${recordTypeLabel(type)}记录已编辑${more}。`, 'ok');
}

function renderTimeline() {
  renderTimelineVisuals();
  const list = getActiveRecords()
    .slice(0, 420);
  const groups = buildTimelineGroups(list).slice(0, 100);

  els.timelineList.innerHTML = '';
  if (!groups.length) {
    if (state.timelineManageMode) {
      state.timelineManageMode = false;
    }
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = '暂无记录。';
    els.timelineList.appendChild(empty);
    return;
  }

  const typeOrder = ['heart_rate', 'blood_pressure', 'symptom', 'medication', 'sleep', 'ai_advice'];
  for (const group of groups) {
    const item = document.createElement('article');
    item.className = 'item timeline-group-item';

    const meta = document.createElement('div');
    meta.className = 'meta meta-rich';

    const time = document.createElement('span');
    time.className = 'meta-time';
    time.textContent = formatTime(group.latestTimestamp);
    meta.appendChild(time);

    const dayTag = document.createElement('span');
    dayTag.className = 'meta-tag meta-tag-source';
    dayTag.textContent = group.dayKey === 'unknown' ? '未知日期' : formatDayKeyLabel(group.dayKey);
    meta.appendChild(dayTag);

    const slotTag = document.createElement('span');
    slotTag.className = 'meta-tag meta-tag-slot';
    slotTag.textContent = group.slotLabel;
    meta.appendChild(slotTag);

    const countTag = document.createElement('span');
    countTag.className = 'meta-tag meta-tag-source';
    countTag.textContent = `${group.records.length}条`;
    meta.appendChild(countTag);

    item.appendChild(meta);

    const content = document.createElement('div');
    content.className = 'timeline-group-content';

    typeOrder.forEach((type) => {
      const rows = group.byType[type] || [];
      if (!rows.length) {
        return;
      }
      const sortedRows = rows.slice().sort((a, b) => b.timestamp.localeCompare(a.timestamp));
      const manageWithMulti = state.timelineManageMode && sortedRows.length > 1;
      const rowEl = document.createElement('div');
      rowEl.className = 'timeline-group-row';
      rowEl.title = state.timelineManageMode ? '单击退出历史编辑/删除模式' : '长按进入历史编辑/删除模式';
      if (state.timelineManageMode) {
        rowEl.classList.add('timeline-group-row-manage');
      }

      const label = document.createElement('span');
      label.className = `timeline-row-label value-${String(type).replace(/_/g, '-')}`;
      label.textContent = recordTypeLabel(type);

      const value = document.createElement('span');
      value.className = `timeline-row-value value-${String(type).replace(/_/g, '-')}`;
      if (type === 'ai_advice') {
        value.classList.add('ai-advice');
      }
      const summaryText = manageWithMulti
        ? `共 ${sortedRows.length} 条，展开后可逐条编辑或删除。`
        : summarizeGroupedType(type, sortedRows);
      value.textContent = summaryText;
      value.classList.toggle('timeline-row-value-multiline', summaryText.includes('\n'));

      rowEl.appendChild(label);
      rowEl.appendChild(value);
      bindLongPressGesture(
        rowEl,
        () => {
          if (!state.timelineManageMode) {
            setTimelineManageMode(true, { guardTap: true });
          }
        },
        (event) => {
          if (!state.timelineManageMode) {
            return;
          }
          if (isTimelineManageGuardActive()) {
            if (event) {
              event.preventDefault();
              event.stopPropagation();
            }
            return;
          }
          const opsNode = event && event.target && event.target.closest
            ? event.target.closest('.timeline-row-ops')
            : null;
          if (opsNode) {
            return;
          }
          setTimelineManageMode(false);
        },
      );

      if (state.timelineManageMode && sortedRows.length <= 1) {
        const ops = document.createElement('div');
        ops.className = 'timeline-row-ops';

        const btnEdit = document.createElement('button');
        btnEdit.type = 'button';
        btnEdit.className = 'timeline-row-op timeline-row-op-edit';
        btnEdit.title = `编辑${recordTypeLabel(type)}记录`;
        btnEdit.setAttribute('aria-label', `编辑${recordTypeLabel(type)}记录`);
        btnEdit.textContent = '✎';
        btnEdit.addEventListener('click', () => {
          editTimelineRecordsByType(type, sortedRows, { recordId: sortedRows[0].id }).catch(() => {
            setResult('编辑失败。', 'error');
          });
        });

        const btnDelete = document.createElement('button');
        btnDelete.type = 'button';
        btnDelete.className = 'timeline-row-op timeline-row-op-delete';
        btnDelete.title = `删除该时段的${recordTypeLabel(type)}记录`;
        btnDelete.setAttribute('aria-label', `删除该时段的${recordTypeLabel(type)}记录`);
        btnDelete.textContent = '×';
        btnDelete.addEventListener('click', () => {
          deleteTimelineRecordsByType(type, sortedRows).catch(() => {
            setResult('删除失败。', 'error');
          });
        });

        ops.appendChild(btnEdit);
        ops.appendChild(btnDelete);
        rowEl.appendChild(ops);
      }

      content.appendChild(rowEl);

      if (manageWithMulti) {
        const manageList = document.createElement('div');
        manageList.className = 'timeline-row-manage-list';

        sortedRows.forEach((row, index) => {
          const manageItem = document.createElement('div');
          manageItem.className = 'timeline-manage-item';

          const manageText = document.createElement('div');
          manageText.className = 'timeline-manage-item-text';
          const digest = summarizeRecord(row).replace(/\s+/g, ' ');
          manageText.textContent = `${index + 1}. ${formatTime(row.timestamp)} · ${toTrimmedText(digest, 120)}`;

          const manageOps = document.createElement('div');
          manageOps.className = 'timeline-manage-item-ops';

          const btnEdit = document.createElement('button');
          btnEdit.type = 'button';
          btnEdit.className = 'timeline-row-op timeline-row-op-edit timeline-manage-item-op';
          btnEdit.title = `编辑第${index + 1}条${recordTypeLabel(type)}记录`;
          btnEdit.setAttribute('aria-label', `编辑第${index + 1}条${recordTypeLabel(type)}记录`);
          btnEdit.textContent = '✎';
          btnEdit.addEventListener('click', () => {
            editTimelineRecordsByType(type, sortedRows, { recordId: row.id }).catch(() => {
              setResult('编辑失败。', 'error');
            });
          });

          const btnDelete = document.createElement('button');
          btnDelete.type = 'button';
          btnDelete.className = 'timeline-row-op timeline-row-op-delete timeline-manage-item-op';
          btnDelete.title = `删除第${index + 1}条${recordTypeLabel(type)}记录`;
          btnDelete.setAttribute('aria-label', `删除第${index + 1}条${recordTypeLabel(type)}记录`);
          btnDelete.textContent = '×';
          btnDelete.addEventListener('click', () => {
            deleteRecordsByIds([row.id]).catch(() => {
              setResult('删除失败。', 'error');
            });
          });

          manageOps.appendChild(btnEdit);
          manageOps.appendChild(btnDelete);
          manageItem.appendChild(manageText);
          manageItem.appendChild(manageOps);
          manageList.appendChild(manageItem);
        });

        content.appendChild(manageList);
      }
    });

    if (!content.childNodes.length) {
      const emptyText = document.createElement('div');
      emptyText.className = 'value';
      emptyText.textContent = '该时段暂无可展示记录。';
      content.appendChild(emptyText);
    }

    item.appendChild(content);

    els.timelineList.appendChild(item);
  }
}

function renderPending() {
  const list = state.pending.slice().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  els.pendingCount.textContent = String(list.length);
  els.pendingList.innerHTML = '';

  if (!list.length) {
    const empty = document.createElement('div');
    empty.className = 'item';
    empty.textContent = '没有待确认项。';
    els.pendingList.appendChild(empty);
    return;
  }

  for (const pending of list) {
    const item = document.createElement('article');
    item.className = 'item';

    const meta = document.createElement('div');
    meta.className = 'meta';
    meta.textContent = `${formatTime(pending.createdAt)} · 原因: ${pending.reason}`;

    const value = document.createElement('div');
    value.className = 'value';
    value.textContent = JSON.stringify(pending.rawAction);

    const ops = document.createElement('div');
    ops.className = 'ops';

    const btnConfirm = document.createElement('button');
    btnConfirm.type = 'button';
    btnConfirm.textContent = '确认写入';
    btnConfirm.addEventListener('click', () => {
      confirmPending(pending.id).catch(() => {
        setResult('确认写入失败。', 'error');
      });
    });

    const btnEdit = document.createElement('button');
    btnEdit.type = 'button';
    btnEdit.className = 'ghost-btn';
    btnEdit.textContent = '编辑后确认';
    btnEdit.addEventListener('click', () => {
      editAndConfirmPending(pending.id).catch(() => {
        setResult('编辑确认失败。', 'error');
      });
    });

    const btnDiscard = document.createElement('button');
    btnDiscard.type = 'button';
    btnDiscard.className = 'danger';
    btnDiscard.textContent = '丢弃';
    btnDiscard.addEventListener('click', () => {
      discardPending(pending.id).catch(() => {
        setResult('丢弃失败。', 'error');
      });
    });

    ops.appendChild(btnConfirm);
    ops.appendChild(btnEdit);
    ops.appendChild(btnDiscard);

    item.appendChild(meta);
    item.appendChild(value);
    item.appendChild(ops);
    els.pendingList.appendChild(item);
  }
}

function setActiveTimeSlot(slot, options = {}) {
  const fallback = inferTimeSlotByDate(new Date());
  const target = normalizeTimeSlot(slot) || fallback;
  state.activeTimeSlot = target;
  const quiet = options.quiet === true;

  els.timeSlotButtons.forEach((button) => {
    const current = normalizeTimeSlot(button.dataset.timeSlot) === target;
    button.classList.toggle('active', current);
    button.setAttribute('aria-pressed', current ? 'true' : 'false');
  });

  if (!quiet) {
    const label = timeSlotLabel(target);
    if (label) {
      setResult(`已切换到 ${label}。`, 'ok');
    }
  }
}

function isTapGuardActive(until) {
  return Number.isFinite(until) && until > Date.now();
}

function isTimelineManageGuardActive() {
  return state.timelineManageMode && isTapGuardActive(state.timelineManageGuardUntil);
}

function isMedTemplateManageGuardActive() {
  return state.medTemplateManageMode && isTapGuardActive(state.medTemplateManageGuardUntil);
}

function setTimelineManageMode(enabled, options = {}) {
  state.timelineManageMode = !!enabled;
  state.timelineManageGuardUntil = state.timelineManageMode && options.guardTap
    ? Date.now() + MANAGE_MODE_RELEASE_GUARD_MS
    : 0;
  if (!state.timelineManageMode) {
    state.medTemplateManageMode = false;
    state.medTemplateManageGuardUntil = 0;
  }
  renderTimeline();
  renderMedicationTemplates();
}

function setMedTemplateManageMode(enabled, options = {}) {
  state.medTemplateManageMode = !!enabled;
  state.medTemplateManageGuardUntil = state.medTemplateManageMode && options.guardTap
    ? Date.now() + MANAGE_MODE_RELEASE_GUARD_MS
    : 0;
  renderMedicationTemplates();
}

function parseDayKey(dayKey) {
  const match = String(dayKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    return null;
  }
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 12, 0, 0, 0);
  return Number.isNaN(date.getTime()) ? null : date;
}

function shiftDayKey(dayKey, deltaDays) {
  const base = parseDayKey(dayKey) || new Date();
  base.setDate(base.getDate() + deltaDays);
  return localDayKey(base);
}

function renderTimelineDateControls() {
  if (!els.timelineDateLabel || !els.btnTimelineAll) {
    return;
  }
  const isAll = state.timelineDateMode === 'all';
  const label = isAll ? '全部日期' : `${timelineScopeLabel()}`;
  els.timelineDateLabel.textContent = label;
  els.btnTimelineAll.classList.toggle('active', isAll);
  els.btnTimelineAll.setAttribute('aria-pressed', isAll ? 'true' : 'false');
  if (els.timelineDateInput) {
    els.timelineDateInput.value = isAll ? '' : (ensureTimelineDateKey() || '');
  }
  if (els.timelineKeywordInput && els.timelineKeywordInput.value !== state.timelineKeyword) {
    els.timelineKeywordInput.value = state.timelineKeyword;
  }
}

function setTimelineDateMode(mode, dayKey = null, options = {}) {
  const nextMode = mode === 'all' ? 'all' : 'day';
  state.timelineDateMode = nextMode;
  if (nextMode === 'day') {
    state.timelineDateKey = dayKey || state.timelineDateKey || localDayKey(new Date());
  }
  renderTimelineDateControls();
  renderTimeline();
  if (!options.quiet) {
    setResult(nextMode === 'all' ? '已切换为全部日期。' : `已切换到 ${timelineScopeLabel()}。`, 'ok');
  }
}

function shiftTimelineDate(deltaDays) {
  const current = ensureTimelineDateKey();
  const next = shiftDayKey(current, deltaDays);
  setTimelineDateMode('day', next, { quiet: false });
}

function applyTimelineDateFromInput(options = {}) {
  if (!els.timelineDateInput) {
    return false;
  }
  const raw = toTrimmedText(els.timelineDateInput.value, 16);
  if (!raw) {
    if (!options.quiet) {
      setResult('请选择日期后再跳转。', 'warn');
    }
    return false;
  }
  const parsed = parseDayKey(raw);
  if (!parsed) {
    if (!options.quiet) {
      setResult('日期格式无效，请使用 YYYY-MM-DD。', 'error');
    }
    return false;
  }
  const key = localDayKey(parsed);
  if (!key) {
    if (!options.quiet) {
      setResult('日期无效，请重试。', 'error');
    }
    return false;
  }
  setTimelineDateMode('day', key, { quiet: options.quiet === true });
  return true;
}

function setTimelineKeyword(keyword, options = {}) {
  state.timelineKeyword = normalizeTimelineKeyword(keyword);
  renderTimeline();
  if (options.quiet) {
    return;
  }
  if (state.timelineKeyword) {
    setResult(`已按关键词“${state.timelineKeyword}”筛选。`, 'ok');
  } else {
    setResult('已清空关键词筛选。', 'ok');
  }
}

function setTimelineStatFocus(statKey, statLabel = '') {
  const key = String(statKey || '').trim() || 'total_records';
  state.timelineStatFocus = key;
  state.timelineStatLabel = statLabel || '范围总记录';
  renderTimeline();
  setResult(`已筛选：${state.timelineStatLabel}。`, 'ok');
}

function normalizeTrendWindow(value) {
  const key = String(value || '').trim().toLowerCase();
  const allowed = ['today', 'recent_days'];
  return allowed.includes(key) ? key : 'recent_days';
}

function applyTrendWindowUi() {
  const target = normalizeTrendWindow(state.trendWindow);
  els.trendWindowButtons.forEach((button) => {
    const current = normalizeTrendWindow(button.dataset.trendWindow) === target;
    button.classList.toggle('active', current);
    button.setAttribute('aria-pressed', current ? 'true' : 'false');
  });
}

function setTrendWindow(windowKey, persist = true) {
  state.trendWindow = normalizeTrendWindow(windowKey);
  applyTrendWindowUi();
  renderTimeline();
  if (persist && state.db) {
    setMeta(META_KEY_TREND_WINDOW, state.trendWindow).catch(() => {});
  }
}

function sameLocalDay(a, b) {
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function localDayKey(dateLike) {
  const date = new Date(dateLike);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function formatDayKeyLabel(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key)) {
    return key;
  }
  return key.slice(5).replace('-', '/');
}

function setOnboardingVisible(visible) {
  if (!els.onboardingPanel) {
    return;
  }
  els.onboardingPanel.classList.toggle('hidden', !visible);
}

function applyElderMode(enabled, persist = true) {
  state.elderMode = !!enabled;
  document.body.classList.toggle('elder-mode', state.elderMode);
  if (els.btnElderMode) {
    els.btnElderMode.classList.toggle('active', state.elderMode);
    els.btnElderMode.setAttribute('aria-pressed', state.elderMode ? 'true' : 'false');
    els.btnElderMode.textContent = state.elderMode ? '标准模式' : '老人模式';
  }
  if (persist && state.db) {
    setMeta(META_KEY_ELDER_MODE, state.elderMode).catch(() => {});
  }
}

function setImportMode(mode, persist = true) {
  state.strictImport = mode !== 'compat';
  if (els.importMode) {
    els.importMode.value = state.strictImport ? 'strict' : 'compat';
  }
  if (persist && state.db) {
    setMeta(META_KEY_IMPORT_MODE, state.strictImport ? 'strict' : 'compat').catch(() => {});
  }
}

function setActiveRecordFormType(type, persist = true) {
  const normalized = String(type || '').trim().toLowerCase();
  const mapped = (normalized === 'blood_pressure' || normalized === 'heart_rate') ? 'vitals' : normalized;
  const allowed = ['vitals', 'medication', 'symptom', 'sleep'];
  const target = allowed.includes(mapped) ? mapped : 'vitals';
  state.activeRecordFormType = target;

  els.recordTypeButtons.forEach((button) => {
    const current = button.dataset.recordType === target;
    button.classList.toggle('active', current);
    button.setAttribute('aria-pressed', current ? 'true' : 'false');
  });

  const forms = document.querySelectorAll('[data-record-form]');
  forms.forEach((form) => {
    const current = form.getAttribute('data-record-form') === target;
    form.classList.toggle('is-active', current);
    form.classList.toggle('is-hidden', !current);
    if (!current) {
      form.setAttribute('aria-hidden', 'true');
    } else {
      form.removeAttribute('aria-hidden');
    }
  });

  if (persist && state.db) {
    setMeta(META_KEY_RECORD_FORM_TYPE, target).catch(() => {});
  }
}

function setActiveModule(moduleName, persist = true) {
  const allowed = ['persons', 'record', 'ai', 'pending', 'timeline'];
  const hasBackupModule = els.moduleButtons.some((button) => button.dataset.module === 'backup')
    && els.modulePanels.some((panel) => panel.getAttribute('data-module-panel') === 'backup');
  if (hasBackupModule) {
    allowed.push('backup');
  }
  const target = allowed.includes(moduleName) ? moduleName : 'record';
  state.activeModule = target;

  els.moduleButtons.forEach((button) => {
    const current = button.dataset.module === target;
    button.classList.toggle('active', current);
    button.setAttribute('aria-pressed', current ? 'true' : 'false');
  });

  els.modulePanels.forEach((panel) => {
    const current = panel.getAttribute('data-module-panel') === target;
    panel.classList.toggle('is-hidden', !current);
    if (!current) {
      panel.setAttribute('aria-hidden', 'true');
    } else {
      panel.removeAttribute('aria-hidden');
    }
  });

  if (target === 'timeline') {
    renderTimeline();
  } else if (target === 'pending') {
    renderPending();
  } else if (target === 'persons') {
    renderPersons();
  }

  if (persist && state.db) {
    setMeta(META_KEY_ACTIVE_MODULE, target).catch(() => {});
  }
}

function defaultFormPrefill() {
  return {
    bpSys: '120',
    bpDia: '80',
    bpNote: '',
    hrBpm: '72',
    hrNote: '',
    medName: '',
    medDose: '',
    medStatus: 'taken',
    symptomName: '',
    symptomSeverity: 'mild',
    symptomNote: '',
    sleepHours: '',
    sleepQuality: 'good',
    sleepNote: '',
  };
}

function prefillMetaKey(personId) {
  return `${META_KEY_FORM_PREFILL_PREFIX}${personId}`;
}

function normalizeFormPrefill(input) {
  const base = defaultFormPrefill();
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return base;
  }

  return {
    bpSys: toIntString(input.bpSys, 120, 70, 260),
    bpDia: toIntString(input.bpDia, 80, 40, 180),
    bpNote: toRecordText(String(input.bpNote ?? '')),
    hrBpm: toIntString(input.hrBpm, 72, 30, 220),
    hrNote: toRecordText(String(input.hrNote ?? '')),
    medName: toRecordText(String(input.medName ?? '')),
    medDose: toRecordText(String(input.medDose ?? '')),
    medStatus: normalizeStatus(input.medStatus) || 'taken',
    symptomName: toRecordText(String(input.symptomName ?? '')),
    symptomSeverity: mapSeverity(input.symptomSeverity) || 'mild',
    symptomNote: toRecordText(String(input.symptomNote ?? '')),
    sleepHours: toTrimmedText(String(input.sleepHours ?? ''), 6),
    sleepQuality: mapSleepQuality(input.sleepQuality) || 'good',
    sleepNote: toRecordText(String(input.sleepNote ?? '')),
  };
}

function buildRecordBasedPrefill(personId) {
  const base = defaultFormPrefill();
  if (!personId) {
    return base;
  }

  const latestByType = new Map();
  const records = state.records
    .filter((record) => record.personId === personId)
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  for (const record of records) {
    if (!latestByType.has(record.type)) {
      latestByType.set(record.type, record);
    }
  }

  const bp = latestByType.get('blood_pressure');
  if (bp) {
    base.bpSys = String(bp.payload?.systolic ?? '');
    base.bpDia = String(bp.payload?.diastolic ?? '');
    base.bpNote = toRecordText(String(bp.payload?.note ?? ''));
  }

  const heartRate = latestByType.get('heart_rate');
  if (heartRate) {
    base.hrBpm = String(heartRate.payload?.bpm ?? '');
    base.hrNote = toRecordText(String(heartRate.payload?.note ?? ''));
  }

  const med = latestByType.get('medication');
  if (med) {
    base.medName = toRecordText(String(med.payload?.name ?? ''));
    base.medDose = toRecordText(String(med.payload?.dose ?? ''));
    base.medStatus = normalizeStatus(med.payload?.status) || 'taken';
  }

  const symptom = latestByType.get('symptom');
  if (symptom) {
    base.symptomName = toRecordText(String(symptom.payload?.name ?? ''));
    base.symptomSeverity = mapSeverity(symptom.payload?.severity) || 'mild';
    base.symptomNote = toRecordText(String(symptom.payload?.note ?? ''));
  }

  const sleep = latestByType.get('sleep');
  if (sleep) {
    base.sleepHours = String(sleep.payload?.hours ?? '');
    base.sleepQuality = mapSleepQuality(sleep.payload?.quality) || 'good';
    base.sleepNote = toRecordText(String(sleep.payload?.note ?? ''));
  }

  return normalizeFormPrefill(base);
}

function applyFormPrefill(prefill) {
  const normalized = normalizeFormPrefill(prefill);
  els.bpSys.value = normalized.bpSys;
  els.bpDia.value = normalized.bpDia;
  els.bpNote.value = normalized.bpNote;
  if (els.hrBpm) {
    els.hrBpm.value = normalized.hrBpm;
  }
  if (els.hrNote) {
    els.hrNote.value = normalized.hrNote;
  }

  els.medName.value = normalized.medName;
  els.medDose.value = normalized.medDose;
  els.medStatus.value = normalized.medStatus;

  els.symptomName.value = normalized.symptomName;
  els.symptomSeverity.value = normalized.symptomSeverity;
  els.symptomNote.value = normalized.symptomNote;

  els.sleepHours.value = normalized.sleepHours;
  els.sleepQuality.value = normalized.sleepQuality;
  els.sleepNote.value = normalized.sleepNote;
}

function collectCurrentFormPrefill() {
  return normalizeFormPrefill({
    bpSys: els.bpSys.value,
    bpDia: els.bpDia.value,
    bpNote: els.bpNote.value,
    hrBpm: els.hrBpm ? els.hrBpm.value : '',
    hrNote: els.hrNote ? els.hrNote.value : '',
    medName: els.medName.value,
    medDose: els.medDose.value,
    medStatus: els.medStatus.value,
    symptomName: els.symptomName.value,
    symptomSeverity: els.symptomSeverity.value,
    symptomNote: els.symptomNote.value,
    sleepHours: els.sleepHours.value,
    sleepQuality: els.sleepQuality.value,
    sleepNote: els.sleepNote.value,
  });
}

function normalizeMedicationTemplate(item) {
  if (!item || typeof item !== 'object') {
    return null;
  }
  const name = toRecordText(String(item.name || ''));
  const dose = toRecordText(String(item.dose || ''));
  if (!name || !dose) {
    return null;
  }
  return {
    id: toTrimmedText(String(item.id || `${name}_${dose}`), 64) || `${name}_${dose}`,
    name,
    dose,
  };
}

function medicationTemplateKey(name, dose) {
  const cleanName = toRecordText(String(name || ''));
  const cleanDose = toRecordText(String(dose || ''));
  if (!cleanName || !cleanDose) {
    return '';
  }
  return `${cleanName}__${cleanDose}`.toLowerCase();
}

function normalizeMedicationTemplateHiddenKeys(input) {
  if (!Array.isArray(input)) {
    return [];
  }
  const seen = new Set();
  const result = [];
  for (const row of input) {
    const raw = toRecordText(String(row || '')).toLowerCase();
    if (!raw || seen.has(raw)) {
      continue;
    }
    seen.add(raw);
    result.push(raw);
    if (result.length >= 120) {
      break;
    }
  }
  return result;
}

async function persistMedicationTemplateHiddenKeys() {
  const payload = normalizeMedicationTemplateHiddenKeys(Array.from(state.medTemplateHiddenKeys));
  state.medTemplateHiddenKeys = new Set(payload);
  await setMeta(META_KEY_MED_TEMPLATE_HIDDEN_KEYS, payload);
}

function listMedicationTemplatesFromRecords(limit = 8) {
  const rows = state.records
    .filter((record) => record.type === 'medication')
    .slice()
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const result = [];
  const seen = new Set();
  for (const row of rows) {
    const name = toRecordText(String(row.payload?.name || ''));
    const dose = toRecordText(String(row.payload?.dose || ''));
    const key = medicationTemplateKey(name, dose);
    if (!key || state.medTemplateHiddenKeys.has(key)) {
      continue;
    }
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push({ id: key, name, dose });
    if (result.length >= limit) {
      break;
    }
  }
  return result;
}

function renderMedicationTemplates() {
  if (!els.medTemplateList) {
    return;
  }
  els.medTemplateList.innerHTML = '';
  if (!state.medTemplates.length) {
    const hint = document.createElement('span');
    hint.className = 'hint-row';
    hint.textContent = '暂无常用药，点击“添加常用药”创建。';
    els.medTemplateList.appendChild(hint);
    return;
  }

  state.medTemplates.forEach((tpl, index) => {
    const wrap = document.createElement('div');
    wrap.className = 'med-template-item';

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ghost-btn quick-chip';
    button.textContent = `${tpl.name} ${tpl.dose}`;
    button.dataset.medTemplateIndex = String(index);
    button.setAttribute('aria-label', `填入常用药 ${tpl.name} ${tpl.dose}`);
    button.title = state.medTemplateManageMode ? '点击空白处退出常用药编辑/删除模式' : '长按进入常用药编辑/删除模式';
    bindLongPressGesture(
      button,
      () => {
        if (!state.medTemplateManageMode) {
          setMedTemplateManageMode(true, { guardTap: true });
        }
      },
      (event) => {
        if (!state.medTemplateManageMode) {
          if (event) {
            event.preventDefault();
            event.stopPropagation();
          }
          applyMedicationTemplateByIndex(index);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        return;
      },
    );
    wrap.appendChild(button);

    if (state.medTemplateManageMode) {
      const ops = document.createElement('div');
      ops.className = 'med-template-ops';

      const btnEdit = document.createElement('button');
      btnEdit.type = 'button';
      btnEdit.className = 'med-template-op med-template-op-edit';
      btnEdit.textContent = '✎';
      btnEdit.title = '编辑常用药';
      btnEdit.setAttribute('aria-label', `编辑常用药 ${tpl.name}`);
      btnEdit.dataset.medTemplateAction = 'edit';
      btnEdit.dataset.medTemplateIndex = String(index);

      const btnDelete = document.createElement('button');
      btnDelete.type = 'button';
      btnDelete.className = 'med-template-op med-template-op-delete';
      btnDelete.textContent = '×';
      btnDelete.title = '删除常用药';
      btnDelete.setAttribute('aria-label', `删除常用药 ${tpl.name}`);
      btnDelete.dataset.medTemplateAction = 'delete';
      btnDelete.dataset.medTemplateIndex = String(index);

      ops.appendChild(btnEdit);
      ops.appendChild(btnDelete);
      wrap.appendChild(ops);
    }

    els.medTemplateList.appendChild(wrap);
  });
}

function applyMedicationTemplateByIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.medTemplates.length) {
    setResult('常用药不存在。', 'warn');
    return false;
  }
  const medTemplate = state.medTemplates[index];
  els.medName.value = medTemplate.name;
  els.medDose.value = medTemplate.dose;
  els.medStatus.value = 'taken';
  setResult(`已填入常用药：${medTemplate.name} ${medTemplate.dose}`, 'ok');
  return true;
}

async function removeMedicationTemplateByIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.medTemplates.length) {
    setResult('常用药不存在。', 'warn');
    return;
  }
  const target = state.medTemplates[index];
  const ok = window.confirm(`确认删除常用药：${target.name} ${target.dose}？`);
  if (!ok) {
    return;
  }
  const removedKey = medicationTemplateKey(target.name, target.dose);
  if (removedKey) {
    state.medTemplateHiddenKeys.add(removedKey);
  }
  state.medTemplates = state.medTemplates.filter((_row, i) => i !== index);
  await persistMedicationTemplateHiddenKeys();
  await persistMedicationTemplates();
  renderMedicationTemplates();
  setResult('常用药已删除。', 'ok');
}

async function editMedicationTemplateByIndex(index) {
  if (!Number.isInteger(index) || index < 0 || index >= state.medTemplates.length) {
    setResult('常用药不存在。', 'warn');
    return;
  }
  const target = state.medTemplates[index];
  const nextNameRaw = window.prompt('编辑药名', target.name);
  if (nextNameRaw == null) {
    return;
  }
  const nextDoseRaw = window.prompt('编辑剂量', target.dose);
  if (nextDoseRaw == null) {
    return;
  }
  const nextName = toRecordText(nextNameRaw);
  const nextDose = toRecordText(nextDoseRaw);
  if (!nextName || !nextDose) {
    setResult('药名和剂量不能为空。', 'warn');
    return;
  }
  const oldKey = medicationTemplateKey(target.name, target.dose);
  const newKey = medicationTemplateKey(nextName, nextDose);
  if (oldKey && oldKey !== newKey) {
    state.medTemplateHiddenKeys.add(oldKey);
  }
  if (newKey) {
    state.medTemplateHiddenKeys.delete(newKey);
  }

  const next = state.medTemplates.slice();
  next[index] = { id: next[index].id, name: nextName, dose: nextDose };
  state.medTemplates = mergeMedicationTemplates(next);
  await persistMedicationTemplateHiddenKeys();
  await persistMedicationTemplates();
  renderMedicationTemplates();
  setResult('常用药已更新。', 'ok');
}

function mergeMedicationTemplates(storedTemplates) {
  const normalizedStored = Array.isArray(storedTemplates)
    ? storedTemplates.map(normalizeMedicationTemplate).filter(Boolean)
    : [];

  const fallback = listMedicationTemplatesFromRecords(10);
  const merged = [];
  const seen = new Set();
  for (const row of normalizedStored.concat(fallback)) {
    const key = `${row.name}__${row.dose}`.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push({
      id: row.id || key,
      name: row.name,
      dose: row.dose,
    });
    if (merged.length >= 12) {
      break;
    }
  }
  return merged;
}

async function loadMedicationTemplates() {
  const [stored, hiddenKeys] = await Promise.all([
    getMeta(META_KEY_MED_TEMPLATES),
    getMeta(META_KEY_MED_TEMPLATE_HIDDEN_KEYS),
  ]);
  state.medTemplateHiddenKeys = new Set(normalizeMedicationTemplateHiddenKeys(hiddenKeys));
  state.medTemplates = mergeMedicationTemplates(stored);
  renderMedicationTemplates();
}

async function persistMedicationTemplates() {
  const payload = state.medTemplates
    .map(normalizeMedicationTemplate)
    .filter(Boolean)
    .slice(0, 12);
  await setMeta(META_KEY_MED_TEMPLATES, payload);
}

async function upsertMedicationTemplate(name, dose, options = {}) {
  const normalized = normalizeMedicationTemplate({ name, dose });
  if (!normalized) {
    return;
  }
  const key = medicationTemplateKey(normalized.name, normalized.dose);
  if (!key) {
    return;
  }
  const force = !!options.force;
  if (state.medTemplateHiddenKeys.has(key)) {
    if (!force) {
      return;
    }
    state.medTemplateHiddenKeys.delete(key);
    await persistMedicationTemplateHiddenKeys();
  }
  const next = state.medTemplates
    .filter((row) => medicationTemplateKey(row.name, row.dose) !== key);
  next.unshift(normalized);
  state.medTemplates = next.slice(0, 12);
  renderMedicationTemplates();
  await persistMedicationTemplates();
}

async function handleAddMedicationTemplate() {
  const name = window.prompt('输入常用药药名（例如：缬沙坦）');
  if (name == null) {
    return;
  }
  const dose = window.prompt('输入剂量（例如：80mg / 1片）');
  if (dose == null) {
    return;
  }
  const cleanName = toRecordText(name);
  const cleanDose = toRecordText(dose);
  if (!cleanName || !cleanDose) {
    setResult('常用药名称或剂量不能为空。', 'warn');
    return;
  }
  await upsertMedicationTemplate(cleanName, cleanDose, { force: true });
  els.medName.value = cleanName;
  els.medDose.value = cleanDose;
  els.medStatus.value = 'taken';
  setResult('已添加常用药并填入。', 'ok');
}

async function loadFormPrefillForPerson(personId) {
  if (!personById(personId)) {
    applyFormPrefill(defaultFormPrefill());
    return;
  }

  const fallback = buildRecordBasedPrefill(personId);
  const stored = await getMeta(prefillMetaKey(personId));
  const merged = normalizeFormPrefill({
    ...fallback,
    ...(stored && typeof stored === 'object' && !Array.isArray(stored) ? stored : {}),
  });
  applyFormPrefill(merged);
}

async function saveFormPrefillForPerson(personId) {
  if (!personById(personId)) {
    return;
  }
  await setMeta(prefillMetaKey(personId), collectCurrentFormPrefill());
}

async function refreshAll() {
  const [persons, records, pending] = await Promise.all([
    getAll(STORE_PERSONS),
    getAll(STORE_RECORDS),
    getAll(STORE_PENDING),
  ]);

  state.persons = persons.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  state.records = records;
  state.pending = pending;

  if (!personById(state.activePersonId) && state.persons.length) {
    state.activePersonId = state.persons[0].id;
  }

  renderPersons();
  await loadFormPrefillForPerson(state.activePersonId);
  await loadMedicationTemplates();
  setActiveTimeSlot(inferTimeSlotByDate(new Date()), { quiet: true });
  renderTimeline();
  renderPending();
  await updateBackupStatus();
}

async function appendAudit(event, detail) {
  return withStores([STORE_AUDIT], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event,
      detail,
      createdAt: nowIso(),
    }));
  });
}

async function addPerson(name, relation) {
  const person = {
    id: makeId('person'),
    name,
    relation,
    createdAt: nowIso(),
  };

  await withStores([STORE_PERSONS, STORE_AUDIT], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_PERSONS].add(person));
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event: 'person_add',
      detail: person,
      createdAt: nowIso(),
    }));
  });

  state.activePersonId = person.id;
}

async function addRecord(record, eventName = 'record_add_manual') {
  await withStores([STORE_RECORDS, STORE_AUDIT], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_RECORDS].add(record));
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event: eventName,
      detail: {
        recordId: record.id,
        personId: record.personId,
        type: record.type,
      },
      createdAt: nowIso(),
    }));
  });
}

async function deleteRecordById(recordId) {
  await deleteRecordsByIds([recordId]);
}

async function deleteRecordsByIds(recordIds) {
  const ids = [...new Set((Array.isArray(recordIds) ? recordIds : []).filter(Boolean))];
  if (!ids.length) {
    return;
  }

  const targetRows = state.records.filter((row) => ids.includes(row.id));
  if (!targetRows.length) {
    setResult('记录不存在或已删除。', 'warn');
    return;
  }

  await withStores([STORE_RECORDS, STORE_AUDIT], 'readwrite', async (stores) => {
    for (const target of targetRows) {
      await reqToPromise(stores[STORE_RECORDS].delete(target.id));
      await reqToPromise(stores[STORE_AUDIT].add({
        id: makeId('audit'),
        event: 'record_delete_manual',
        detail: {
          recordId: target.id,
          personId: target.personId,
          type: target.type,
        },
        createdAt: nowIso(),
      }));
    }
  });

  await refreshAll();
  setResult(targetRows.length > 1 ? `已删除 ${targetRows.length} 条记录。` : '记录已删除。', 'ok');
}

async function removePendingById(id, eventName) {
  await withStores([STORE_PENDING, STORE_AUDIT], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_PENDING].delete(id));
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event: eventName,
      detail: { id },
      createdAt: nowIso(),
    }));
  });
}

function normalizeJsonText(input) {
  return input
    .trim()
    .replace(/^[\uFEFF\u200B]+/, '')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/，/g, ',')
    .replace(/：/g, ':')
    .replace(/\r\n/g, '\n')
    .replace(/,\s*([}\]])/g, '$1');
}

function extractJsonFromText(text) {
  const healthBlock = text.match(/```health_actions\s*([\s\S]*?)```/i);
  if (healthBlock && healthBlock[1]) {
    return healthBlock[1].trim();
  }

  const jsonBlocks = [...text.matchAll(/```json\s*([\s\S]*?)```/ig)];
  if (jsonBlocks.length) {
    for (const block of jsonBlocks) {
      const body = (block[1] || '').trim();
      if (body.includes('actions')) {
        return body;
      }
    }
    return (jsonBlocks[0][1] || '').trim();
  }

  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first >= 0 && last > first) {
    return text.slice(first, last + 1).trim();
  }
  return '';
}

function extractAdviceText(text) {
  const source = String(text || '').replace(/\r\n/g, '\n').trim();
  if (!source) {
    return '';
  }

  // If the whole reply is plain JSON, treat it as actions payload only.
  if (source.startsWith('{') && source.endsWith('}')) {
    return '';
  }

  const healthBlock = source.match(/```health_actions[\s\S]*?```/i);
  if (healthBlock && Number.isInteger(healthBlock.index)) {
    return toTrimmedText(source.slice(0, healthBlock.index).trim(), MAX_ADVICE_TEXT_LEN);
  }

  const jsonBlock = source.match(/```json[\s\S]*?```/i);
  if (jsonBlock && Number.isInteger(jsonBlock.index)) {
    return toTrimmedText(source.slice(0, jsonBlock.index).trim(), MAX_ADVICE_TEXT_LEN);
  }

  const firstBrace = source.indexOf('{');
  if (firstBrace > 0) {
    return toTrimmedText(source.slice(0, firstBrace).trim(), MAX_ADVICE_TEXT_LEN);
  }

  return toTrimmedText(source, MAX_ADVICE_TEXT_LEN);
}

function parseActionEnvelope(text) {
  const rawJson = extractJsonFromText(text);
  if (!rawJson) {
    return { ok: false, error: '未找到可解析的 JSON 内容。' };
  }

  const normalized = normalizeJsonText(rawJson);
  try {
    const parsed = JSON.parse(normalized);
    return { ok: true, envelope: parsed };
  } catch (_err) {
    return { ok: false, error: 'JSON 解析失败，请让 AI 严格输出标准 JSON。' };
  }
}

function validateEnvelopeShape(envelope, strictMode) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) {
    return { ok: false, error: '根对象必须是 JSON 对象。', warnings: [] };
  }

  const warnings = [];
  const schema = String(envelope.schema || '');
  if (strictMode && schema !== ACTION_SCHEMA) {
    return { ok: false, error: `严格模式要求 schema=${ACTION_SCHEMA}。`, warnings: [] };
  }
  if (!strictMode && schema !== ACTION_SCHEMA) {
    warnings.push(`schema 不是 ${ACTION_SCHEMA}，已按兼容模式处理。`);
  }

  if (!Array.isArray(envelope.actions)) {
    return { ok: false, error: 'actions 必须为数组。', warnings: [] };
  }

  if (envelope.actions.length > MAX_ACTIONS_IMPORT) {
    return { ok: false, error: `单次导入动作数不能超过 ${MAX_ACTIONS_IMPORT}。`, warnings: [] };
  }

  if (Object.prototype.hasOwnProperty.call(envelope, 'person_id') && typeof envelope.person_id !== 'string') {
    return { ok: false, error: 'person_id 必须是字符串。', warnings: [] };
  }

  return { ok: true, warnings };
}

function validateAction(action, rootPersonId, options = {}) {
  const strictMode = options.strictMode !== false;
  const source = options.source || 'ai_auto';

  if (!action || typeof action !== 'object' || Array.isArray(action)) {
    return { ok: false, reason: '动作不是对象', rawAction: action };
  }

  const op = strictMode ? exactOp(action.op) : opAlias(action.op);
  if (!op) {
    return { ok: false, reason: `不支持的 op: ${String(action.op || '') || '(空)'}`, rawAction: action };
  }

  const actionPersonId = toTrimmedText(action.person_id || '', 48);
  const rootId = toTrimmedText(rootPersonId || '', 48);
  const personId = actionPersonId || rootId || state.activePersonId;
  if (!personId || !personById(personId)) {
    return { ok: false, reason: 'person_id 缺失或不存在', rawAction: action };
  }
  if (strictMode && actionPersonId && rootId && actionPersonId !== rootId) {
    return { ok: false, reason: 'action.person_id 与根 person_id 不一致', rawAction: action };
  }

  const hasTimestamp = Object.prototype.hasOwnProperty.call(action, 'timestamp');
  if (strictMode && !hasTimestamp) {
    return { ok: false, reason: '严格模式必须提供 timestamp', rawAction: action };
  }

  const rawTs = hasTimestamp ? action.timestamp : nowIso();
  const dt = new Date(rawTs);
  if (Number.isNaN(dt.getTime())) {
    return { ok: false, reason: 'timestamp 格式无效', rawAction: action };
  }
  const timestamp = dt.toISOString();
  const timeSlot = normalizeTimeSlot(action.time_slot || action.timeSlot || action.slot) || inferTimeSlotByDate(dt);

  if (op === 'add_bp') {
    const systolic = Math.round(toNumber(action.systolic ?? action.sys));
    const diastolic = Math.round(toNumber(action.diastolic ?? action.dia));
    if (!Number.isFinite(systolic) || !Number.isFinite(diastolic)) {
      return { ok: false, reason: '血压值必须是数字', rawAction: action };
    }
    if (systolic < 70 || systolic > 260 || diastolic < 40 || diastolic > 180 || systolic <= diastolic) {
      return { ok: false, reason: '血压范围异常', rawAction: action };
    }
    const note = toRecordText(action.note);
    return {
      ok: true,
      record: buildRecord('blood_pressure', personId, {
        systolic,
        diastolic,
        note,
        timeSlot,
      }, source, timestamp),
    };
  }

  if (op === 'add_heart_rate') {
    const bpm = Math.round(toNumber(action.bpm ?? action.heart_rate ?? action.hr));
    if (!Number.isFinite(bpm) || bpm < 30 || bpm > 220) {
      return { ok: false, reason: '心率范围异常', rawAction: action };
    }
    const note = toRecordText(action.note);
    return {
      ok: true,
      record: buildRecord('heart_rate', personId, {
        bpm,
        note,
        timeSlot,
      }, source, timestamp),
    };
  }

  if (op === 'add_medication') {
    const name = toRecordText(action.name);
    const dose = toRecordText(action.dose);
    const status = normalizeStatus(action.status);
    if (!name || !dose || !status) {
      return { ok: false, reason: '用药字段不完整', rawAction: action };
    }
    const note = toRecordText(action.note);
    return {
      ok: true,
      record: buildRecord('medication', personId, {
        name,
        dose,
        status,
        note,
        timeSlot,
      }, source, timestamp),
    };
  }

  if (op === 'add_symptom') {
    const name = toRecordText(action.name);
    const severity = mapSeverity(action.severity);
    if (!name || !severity) {
      return { ok: false, reason: '症状字段不完整', rawAction: action };
    }
    const note = toRecordText(action.note);
    return {
      ok: true,
      record: buildRecord('symptom', personId, {
        name,
        severity,
        note,
        timeSlot,
      }, source, timestamp),
    };
  }

  const hours = Number(toNumber(action.hours));
  const quality = mapSleepQuality(action.quality);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24 || !quality) {
    return { ok: false, reason: '睡眠字段不完整', rawAction: action };
  }
  const note = toRecordText(action.note);
  return {
    ok: true,
    record: buildRecord('sleep', personId, {
      hours,
      quality,
      note,
      timeSlot,
    }, source, timestamp),
  };
}

async function processActionEnvelope(envelope, options = {}) {
  const strictMode = options.strictMode !== false;
  const source = options.source || 'ai_auto';
  const eventName = options.eventName || 'ai_import';

  const shape = validateEnvelopeShape(envelope, strictMode);
  if (!shape.ok) {
    return { ok: false, error: shape.error, committed: 0, pending: 0, warnings: [] };
  }

  const rootPersonId = toTrimmedText(envelope.person_id || state.activePersonId || '', 48);

  if (!envelope.actions.length) {
    await appendAudit(eventName, {
      committed: 0,
      pending: 0,
      strictMode,
      emptyActions: true,
    });
    return {
      ok: true,
      committed: 0,
      pending: 0,
      warnings: shape.warnings.concat(['actions 为空，本次无新增记录。']),
    };
  }

  const existing = state.records.slice();
  const fingerprintSet = new Set(existing.map(recordFingerprint));
  const recordBatch = [];
  const pendingBatch = [];

  for (const action of envelope.actions) {
    const checked = validateAction(action, rootPersonId, { strictMode, source });
    if (!checked.ok) {
      pendingBatch.push({
        id: makeId('pending'),
        personId: toTrimmedText(action?.person_id || rootPersonId || state.activePersonId, 48),
        reason: checked.reason,
        rawAction: action,
        createdAt: nowIso(),
      });
      continue;
    }

    const fp = recordFingerprint(checked.record);
    if (fingerprintSet.has(fp)) {
      pendingBatch.push({
        id: makeId('pending'),
        personId: checked.record.personId,
        reason: '疑似重复记录，已进入待确认',
        rawAction: action,
        createdAt: nowIso(),
      });
      continue;
    }

    fingerprintSet.add(fp);
    recordBatch.push(checked.record);
  }

  await withStores([STORE_RECORDS, STORE_PENDING, STORE_AUDIT], 'readwrite', async (stores) => {
    for (const record of recordBatch) {
      await reqToPromise(stores[STORE_RECORDS].add(record));
    }
    for (const item of pendingBatch) {
      await reqToPromise(stores[STORE_PENDING].put(item));
    }
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event: eventName,
      detail: {
        committed: recordBatch.length,
        pending: pendingBatch.length,
        strictMode,
      },
      createdAt: nowIso(),
    }));
  });

  await refreshAll();
  return {
    ok: true,
    committed: recordBatch.length,
    pending: pendingBatch.length,
    warnings: shape.warnings,
  };
}

async function saveAdviceTextRecord(rawText, options = {}) {
  const maxLen = Number.isFinite(options.maxLen) && options.maxLen > 0
    ? Math.floor(options.maxLen)
    : MAX_ADVICE_TEXT_LEN;
  const source = options.source || 'ai_auto';

  const adviceText = toTrimmedText(String(rawText || ''), maxLen);
  if (!adviceText) {
    return { ok: false, saved: false, duplicate: false, reason: 'empty_text' };
  }
  if (!personById(state.activePersonId)) {
    return { ok: false, saved: false, duplicate: false, reason: 'person_missing' };
  }

  const duplicateAdvice = state.records.some((record) => (
    record.personId === state.activePersonId
    && record.type === 'ai_advice'
    && toTrimmedText(String(record.payload?.text || ''), maxLen) === adviceText
  ));
  if (duplicateAdvice) {
    return { ok: true, saved: false, duplicate: true, reason: 'duplicate' };
  }

  await addRecord(
    buildRecord('ai_advice', state.activePersonId, { text: adviceText }, source, nowIso()),
    'record_add_ai_advice',
  );
  await refreshAll();
  return { ok: true, saved: true, duplicate: false, reason: '' };
}

async function importActionsFromAi(sourceText) {
  const parsed = parseActionEnvelope(sourceText);
  if (!parsed.ok) {
    if (!state.strictImport) {
      const compatSaved = await saveAdviceTextRecord(sourceText, {
        source: 'ai_auto',
        maxLen: MAX_COMPAT_TEXT_IMPORT_LEN,
      });
      if (compatSaved.saved) {
        setResult('兼容模式已按纯文本入库。', 'ok');
      } else if (compatSaved.duplicate) {
        setResult('兼容模式：文本与已有 AI 建议重复，未重复保存。', 'warn');
      } else {
        setResult('兼容模式未检测到可入库文本。', 'warn');
      }
      return;
    }
    setResult(parsed.error, 'error');
    return;
  }

  const result = await processActionEnvelope(parsed.envelope, {
    strictMode: state.strictImport,
    source: 'ai_auto',
    eventName: 'ai_import',
  });

  if (!result.ok) {
    if (!state.strictImport) {
      const compatSaved = await saveAdviceTextRecord(sourceText, {
        source: 'ai_auto',
        maxLen: MAX_COMPAT_TEXT_IMPORT_LEN,
      });
      if (compatSaved.saved) {
        setResult(`兼容模式结构化入库失败，已按纯文本入库。原因：${result.error}`, 'warn');
      } else if (compatSaved.duplicate) {
        setResult(`兼容模式结构化入库失败，且文本重复未保存。原因：${result.error}`, 'warn');
      } else {
        setResult(result.error, 'error');
      }
      return;
    }
    setResult(result.error, 'error');
    return;
  }

  const modeText = state.strictImport ? '严格模式' : '兼容模式';
  let message = `${modeText}导入完成：自动提交 ${result.committed} 条，待确认 ${result.pending} 条。`;

  const adviceText = extractAdviceText(sourceText);
  if (adviceText) {
    const adviceSaved = await saveAdviceTextRecord(adviceText, {
      source: 'ai_auto',
      maxLen: state.strictImport ? MAX_ADVICE_TEXT_LEN : MAX_COMPAT_TEXT_IMPORT_LEN,
    });
    if (adviceSaved.saved) {
      message += ' 已保存AI建议。';
    } else if (adviceSaved.duplicate) {
      message += ' AI建议与已有内容重复，未重复保存。';
    }
  }

  if (result.warnings.length) {
    message += ` 提示：${result.warnings.join('；')}`;
  }
  setResult(message, result.pending ? 'warn' : 'ok');
}

function buildMemoryPackPayload() {
  const person = personById(state.activePersonId);
  if (!person) {
    return null;
  }

  const now = Date.now();
  const sevenDaysAgo = now - 7 * 24 * 3600 * 1000;
  const allRecords = state.records
    .filter((record) => record.personId === person.id)
    .filter((record) => {
      const ts = Date.parse(record.timestamp);
      return Number.isFinite(ts) && ts >= sevenDaysAgo;
    })
    .sort((a, b) => b.timestamp.localeCompare(a.timestamp));

  const adviceRecords = allRecords.filter((record) => record.type === 'ai_advice');
  const records = allRecords.filter((record) => record.type !== 'ai_advice');

  const bp = records.filter((record) => record.type === 'blood_pressure');
  const heartRates = records.filter((record) => record.type === 'heart_rate');
  const meds = records.filter((record) => record.type === 'medication');
  const symptoms = records.filter((record) => record.type === 'symptom');
  const sleeps = records.filter((record) => record.type === 'sleep');

  const avgSys = bp.length
    ? Math.round(bp.reduce((sum, row) => sum + Number(row.payload.systolic || 0), 0) / bp.length)
    : null;
  const avgDia = bp.length
    ? Math.round(bp.reduce((sum, row) => sum + Number(row.payload.diastolic || 0), 0) / bp.length)
    : null;

  const avgSleep = sleeps.length
    ? (sleeps.reduce((sum, row) => sum + Number(row.payload.hours || 0), 0) / sleeps.length).toFixed(1)
    : null;
  const avgHeartRate = heartRates.length
    ? Math.round(heartRates.reduce((sum, row) => sum + Number(row.payload.bpm || 0), 0) / heartRates.length)
    : null;

  return {
    schema: MEMORY_SCHEMA,
    generated_at: nowIso(),
    person: {
      id: person.id,
      name: person.name,
      relation: person.relation || '',
    },
    window_days: 7,
    summary: {
      record_count: records.length,
      blood_pressure: {
        count: bp.length,
        avg_systolic: avgSys,
        avg_diastolic: avgDia,
      },
      heart_rate: {
        count: heartRates.length,
        avg_bpm: avgHeartRate,
      },
      medication_count: meds.length,
      symptom_count: symptoms.length,
      advice_count: adviceRecords.length,
      sleep: {
        count: sleeps.length,
        avg_hours: avgSleep,
      },
    },
    recent_records: records.slice(0, 40).map((record) => ({
      timestamp: record.timestamp,
      type: record.type,
      payload: record.payload,
      source: record.source,
    })),
    recent_advice: adviceRecords.slice(0, 20).map((record) => ({
      timestamp: record.timestamp,
      text: toTrimmedText(String(record.payload?.text || ''), 300),
      source: record.source,
    })),
  };
}

function templateTaskText(templateKey) {
  if (templateKey === 'morning') {
    return '请完成晨间核对：总结昨夜睡眠、今日晨间血压和当前用药执行，并给出当日可执行建议。若有新记录，给出 actions。';
  }
  if (templateKey === 'night') {
    return '请完成晚间复盘：总结全天症状变化、用药执行情况、睡眠准备状态，并给出明日建议。若有新记录，给出 actions。';
  }
  if (templateKey === 'followup') {
    return '请聚焦异常跟进：识别是否存在连续高压/漏服/症状加重，并给出立即执行的下一步建议。若有新记录，给出 actions。';
  }
  if (templateKey === 'report') {
    return '请生成最近7天结构化报表：指标趋势、波动点、异常点、需继续观察的重点，并给出后续建议。若有新记录，给出 actions。';
  }
  if (templateKey === 'record_advice') {
    return '请基于刚新增的记录和最近7天数据，给出今日可执行建议（血压复测、用药提醒、症状观察、何时应就医）。若有新记录，给出 actions。';
  }
  return '请先给简短中文建议，再输出可导入的 actions。';
}

function buildActionExample(personId) {
  return {
    schema: ACTION_SCHEMA,
    person_id: personId,
    actions: [
      {
        op: 'add_bp',
        timestamp: '2026-03-04T08:30:00+08:00',
        time_slot: 'after_breakfast',
        systolic: 138,
        diastolic: 86,
        note: '早餐后',
      },
    ],
  };
}

function buildPrompt(templateKey = 'generic') {
  const memoryPack = buildMemoryPackPayload();
  if (!memoryPack) {
    return '';
  }

  const personId = memoryPack.person.id;
  const instructions = [
    '你是家庭健康记录协作助手，请给出具体、可执行、面向家属的中文建议。',
    '先输出详细建议（建议 10-16 行），并使用以下小标题：',
    '【总体判断】、【关键风险点】、【今日执行计划】、【观察与复测】、【何时就医】。',
    '在【今日执行计划】里请按 早/中/晚 或 下一次执行时间 写清动作。',
    '每条建议尽量包含时间/频次/阈值（例如“2小时后复测”“连续两次>160/100需就医”），避免空泛描述。',
    `然后必须输出一个代码块，语言标识固定为 health_actions，JSON 的 schema 固定为 ${ACTION_SCHEMA}。`,
    `动作 op 仅允许: ${OP_ALLOW_LIST.join(', ')}。`,
    'JSON 必须严格可解析，不要带注释，不要多输出第二个代码块。',
    `person_id 固定使用: ${personId}。`,
    '如果没有新增记录也必须输出 actions: []。',
    `任务: ${templateTaskText(templateKey)}`,
  ].join('\n');

  const exampleText = JSON.stringify(buildActionExample(personId), null, 2);
  return `${instructions}\n\nMemory Pack:\n${JSON.stringify(memoryPack, null, 2)}\n\n输出示例:\n\
\`\`\`health_actions\n${exampleText}\n\`\`\``;
}

async function copyToClipboard(text) {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
    await navigator.clipboard.writeText(text);
    return;
  }
  const area = document.createElement('textarea');
  area.value = text;
  area.style.position = 'fixed';
  area.style.left = '-9999px';
  document.body.appendChild(area);
  area.select();
  document.execCommand('copy');
  area.remove();
}

async function copyPromptTemplate(templateKey) {
  const prompt = buildPrompt(templateKey);
  if (!prompt) {
    setResult('请先新增成员。', 'error');
    return false;
  }

  try {
    await copyToClipboard(prompt);
  } catch (_err) {
    setResult('复制失败，请手动复制。', 'error');
    return false;
  }
  setResult('模板已复制。', 'ok');
  return true;
}

async function triggerAutoAdviceAfterRecord() {
  const copied = await copyPromptTemplate('record_advice');
  if (!copied) {
    setResult('记录已保存，但建议模板复制失败。', 'warn');
    return;
  }
  setResult('记录已保存，已复制“记录+建议”模板。', 'ok');
}

function setFormSubmitState(form, submitting) {
  if (!form) {
    return;
  }
  const submitBtn = form.querySelector('button[type="submit"]');
  if (!submitBtn) {
    return;
  }
  submitBtn.disabled = submitting;
  submitBtn.textContent = submitting ? '保存中...' : '保存';
}

function clearFormNotesAfterSave(formType) {
  if (formType === 'vitals') {
    if (els.bpNote) {
      els.bpNote.value = '';
    }
    if (els.hrNote) {
      els.hrNote.value = '';
    }
    return;
  }
  if (formType === 'symptom' && els.symptomNote) {
    els.symptomNote.value = '';
    return;
  }
  if (formType === 'sleep' && els.sleepNote) {
    els.sleepNote.value = '';
  }
}

async function handleManualFormSubmit(formType, form) {
  const inFlight = Boolean(state.manualSubmit.inFlight[formType]);
  if (inFlight) {
    setResult('正在保存，请稍候。', 'warn');
    return;
  }

  const nowMs = Date.now();
  const lastAt = Number(state.manualSubmit.lastAt[formType] || 0);
  if (nowMs - lastAt < MANUAL_SUBMIT_DEBOUNCE_MS) {
    setResult('提交过快，请稍候再试。', 'warn');
    return;
  }

  state.manualSubmit.inFlight[formType] = true;
  setFormSubmitState(form, true);
  try {
    const personId = state.activePersonId;
    if (!personById(personId)) {
      setResult('请先新增成员。', 'error');
      return;
    }

    const recordsToAdd = [];
    const timestamp = nowIso();
    const timeSlot = normalizeTimeSlot(state.activeTimeSlot) || inferTimeSlotByDate(timestamp);

    if (formType === 'vitals') {
      const systolic = Math.round(toNumber(els.bpSys.value));
      const diastolic = Math.round(toNumber(els.bpDia.value));
      if (!Number.isFinite(systolic) || !Number.isFinite(diastolic) || systolic <= diastolic) {
        setResult('血压输入无效。', 'error');
        return;
      }

      const bpm = Math.round(toNumber(els.hrBpm ? els.hrBpm.value : ''));
      if (!Number.isFinite(bpm) || bpm < 30 || bpm > 220) {
        setResult('心率输入无效。', 'error');
        return;
      }

      recordsToAdd.push(buildRecord('blood_pressure', personId, {
        systolic,
        diastolic,
        note: toRecordText(els.bpNote.value),
        timeSlot,
      }, 'manual', timestamp));
      recordsToAdd.push(buildRecord('heart_rate', personId, {
        bpm,
        note: toRecordText(els.hrNote ? els.hrNote.value : ''),
        timeSlot,
      }, 'manual', timestamp));
    }

    if (formType === 'medication') {
      const name = toRecordText(els.medName.value);
      const dose = toRecordText(els.medDose.value);
      const status = normalizeStatus(els.medStatus.value);
      if (!name || !dose || !status) {
        setResult('用药输入无效。', 'error');
        return;
      }
      recordsToAdd.push(buildRecord('medication', personId, {
        name,
        dose,
        status,
        note: '',
        timeSlot,
      }, 'manual', timestamp));
    }

    if (formType === 'symptom') {
      const name = toRecordText(els.symptomName.value);
      const severity = mapSeverity(els.symptomSeverity.value);
      if (!name || !severity) {
        setResult('症状输入无效。', 'error');
        return;
      }
      recordsToAdd.push(buildRecord('symptom', personId, {
        name,
        severity,
        note: toRecordText(els.symptomNote.value),
        timeSlot,
      }, 'manual', timestamp));
    }

    if (formType === 'sleep') {
      const hours = Number(toNumber(els.sleepHours.value));
      const quality = mapSleepQuality(els.sleepQuality.value);
      if (!Number.isFinite(hours) || hours < 0 || hours > 24 || !quality) {
        setResult('睡眠输入无效。', 'error');
        return;
      }
      recordsToAdd.push(buildRecord('sleep', personId, {
        hours,
        quality,
        note: toRecordText(els.sleepNote.value),
        timeSlot,
      }, 'manual', timestamp));
    }

    if (!recordsToAdd.length) {
      setResult('未生成记录。', 'error');
      return;
    }

    const uniqueRecords = recordsToAdd.filter((record) => (
      !state.records.some((row) => recordFingerprint(row) === recordFingerprint(record))
    ));
    if (!uniqueRecords.length) {
      setResult('疑似重复记录，未保存。', 'warn');
      return;
    }

    for (const record of uniqueRecords) {
      await addRecord(record, 'record_add_manual');
      if (record.type === 'medication') {
        await upsertMedicationTemplate(record.payload.name, record.payload.dose);
      }
    }

    clearFormNotesAfterSave(formType);
    await saveFormPrefillForPerson(personId);
    await refreshAll();
    state.manualSubmit.lastAt[formType] = Date.now();
    if (formType === 'vitals') {
      if (uniqueRecords.length === recordsToAdd.length) {
        setResult('血压和心率已保存。', 'ok');
      } else {
        setResult(`已保存 ${uniqueRecords.length} 项，重复 ${recordsToAdd.length - uniqueRecords.length} 项。`, 'warn');
      }
      return;
    }
    setResult('记录已保存。', 'ok');
  } finally {
    state.manualSubmit.inFlight[formType] = false;
    setFormSubmitState(form, false);
  }
}

async function confirmPending(id) {
  const item = state.pending.find((row) => row.id === id);
  if (!item) {
    return;
  }

  const checked = validateAction(item.rawAction, item.personId, { strictMode: false, source: 'manual_review' });
  if (!checked.ok) {
    setResult(`待确认项仍无效: ${checked.reason}`, 'error');
    return;
  }

  const duplicate = state.records.some((row) => recordFingerprint(row) === recordFingerprint(checked.record));
  if (duplicate) {
    await removePendingById(id, 'pending_drop_duplicate');
    await refreshAll();
    setResult('该项与现有记录重复，已自动丢弃。', 'warn');
    return;
  }

  await withStores([STORE_RECORDS, STORE_PENDING, STORE_AUDIT], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_RECORDS].add(checked.record));
    await reqToPromise(stores[STORE_PENDING].delete(id));
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event: 'pending_confirm',
      detail: { pendingId: id, recordId: checked.record.id },
      createdAt: nowIso(),
    }));
  });

  await refreshAll();
  setResult('待确认项已写入。', 'ok');
}

async function editAndConfirmPending(id) {
  const item = state.pending.find((row) => row.id === id);
  if (!item) {
    return;
  }

  const draft = JSON.stringify(item.rawAction, null, 2);
  const edited = window.prompt('编辑动作 JSON（单行或多行均可）', draft);
  if (!edited) {
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(normalizeJsonText(edited));
  } catch (_err) {
    setResult('编辑后的 JSON 无法解析。', 'error');
    return;
  }

  const checked = validateAction(parsed, item.personId, { strictMode: false, source: 'manual_review' });
  if (!checked.ok) {
    setResult(`编辑后仍无效: ${checked.reason}`, 'error');
    return;
  }

  const duplicate = state.records.some((row) => recordFingerprint(row) === recordFingerprint(checked.record));
  if (duplicate) {
    setResult('编辑后与已有记录重复，未写入。', 'warn');
    return;
  }

  await withStores([STORE_RECORDS, STORE_PENDING, STORE_AUDIT], 'readwrite', async (stores) => {
    await reqToPromise(stores[STORE_RECORDS].add(checked.record));
    await reqToPromise(stores[STORE_PENDING].delete(id));
    await reqToPromise(stores[STORE_AUDIT].add({
      id: makeId('audit'),
      event: 'pending_edit_confirm',
      detail: { pendingId: id, recordId: checked.record.id },
      createdAt: nowIso(),
    }));
  });

  await refreshAll();
  setResult('编辑后已写入。', 'ok');
}

async function discardPending(id) {
  await removePendingById(id, 'pending_discard');
  await refreshAll();
  setResult('待确认项已丢弃。', 'warn');
}

function speechRecognizerCtor() {
  return window.SpeechRecognition || window.webkitSpeechRecognition || null;
}

function parseVoiceTextToEnvelope(rawText) {
  const person = personById(state.activePersonId);
  if (!person) {
    return { ok: false, error: '请先新增成员。' };
  }

  const text = String(rawText || '')
    .replace(/[，。；]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  if (!text) {
    return { ok: false, error: '语音内容为空。' };
  }

  const timeSlot = inferTimeSlotByDate(new Date());
  let action = null;
  let m = text.match(/(?:血压)?\s*(\d{2,3})\s*[\/／\s]\s*(\d{2,3})/);
  if (m) {
    action = {
      op: 'add_bp',
      timestamp: nowIso(),
      time_slot: timeSlot,
      person_id: person.id,
      systolic: Number(m[1]),
      diastolic: Number(m[2]),
      note: '语音录入',
    };
  }

  if (!action) {
    m = text.match(/(?:心率|脉搏|脉率)\s*([0-9]{2,3})/);
    if (m) {
      action = {
        op: 'add_heart_rate',
        timestamp: nowIso(),
        time_slot: timeSlot,
        person_id: person.id,
        bpm: Number(m[1]),
        note: '语音录入',
      };
    }
  }

  if (!action) {
    m = text.match(/(?:服用|吃了|已服|吃)\s*([\u4e00-\u9fa5A-Za-z0-9]{1,20})\s*([0-9]+(?:\.[0-9]+)?\s*(?:mg|g|ml|片|粒|袋|喷))/i);
    if (m) {
      const status = /漏服/.test(text) ? 'missed' : /计划/.test(text) ? 'planned' : 'taken';
      action = {
        op: 'add_medication',
        timestamp: nowIso(),
        time_slot: timeSlot,
        person_id: person.id,
        name: m[1],
        dose: m[2].replace(/\s+/g, ''),
        status,
        note: '语音录入',
      };
    }
  }

  if (!action) {
    m = text.match(/(?:症状|感觉)?\s*([\u4e00-\u9fa5A-Za-z]{1,20})\s*(轻微|中等|明显|严重)/);
    if (m) {
      action = {
        op: 'add_symptom',
        timestamp: nowIso(),
        time_slot: timeSlot,
        person_id: person.id,
        name: m[1],
        severity: m[2] === '轻微' ? 'mild' : m[2] === '中等' ? 'medium' : 'high',
        note: '语音录入',
      };
    }
  }

  if (!action) {
    m = text.match(/(?:睡了|睡眠|昨晚睡|睡)\s*([0-9]+(?:\.[0-9]+)?)\s*(?:小时|h|个小时)/i);
    if (m) {
      let quality = 'normal';
      if (/好|不错/.test(text)) {
        quality = 'good';
      }
      if (/差|不好/.test(text)) {
        quality = 'poor';
      }
      action = {
        op: 'add_sleep',
        timestamp: nowIso(),
        time_slot: timeSlot,
        person_id: person.id,
        hours: Number(m[1]),
        quality,
        note: '语音录入',
      };
    }
  }

  if (!action) {
    return { ok: false, error: '未匹配到语音模板，可改用 AI 模板转换。' };
  }

  return {
    ok: true,
    envelope: {
      schema: ACTION_SCHEMA,
      person_id: person.id,
      actions: [action],
    },
  };
}

async function importVoiceTranscriptText(rawText, source = 'voice_text') {
  const transcript = toTrimmedText(rawText || '', 200);
  if (!transcript) {
    setVoiceStatus('请先输入语音文本。', 'warn');
    return;
  }

  const parsed = parseVoiceTextToEnvelope(transcript);
  if (!parsed.ok) {
    setVoiceStatus(parsed.error, 'warn');
    els.aiResponse.value = transcript;
    setResult('语音文本未能结构化，已放入 AI 回复输入框。', 'warn');
    return;
  }

  const result = await processActionEnvelope(parsed.envelope, {
    strictMode: true,
    source,
    eventName: source === 'voice_auto' ? 'voice_import' : 'voice_text_import',
  });
  if (!result.ok) {
    setVoiceStatus(result.error, 'error');
    setResult(result.error, 'error');
    return;
  }

  els.voiceTranscript.value = '';
  setVoiceStatus(`提交 ${result.committed} 条，待确认 ${result.pending} 条。`, result.pending ? 'warn' : 'ok');
  setResult(`语音导入完成：提交 ${result.committed} 条，待确认 ${result.pending} 条。`, result.pending ? 'warn' : 'ok');
}

async function handleVoiceInput() {
  const Ctor = speechRecognizerCtor();
  if (!Ctor) {
    setVoiceStatus('当前浏览器不支持语音识别。', 'warn');
    setResult('浏览器不支持语音识别，可直接输入语音文本后点“文本入库”。', 'warn');
    return;
  }

  if (state.isListening) {
    setVoiceStatus('正在识别中，请稍候。', 'warn');
    return;
  }

  const recog = new Ctor();
  recog.lang = 'zh-CN';
  recog.interimResults = false;
  recog.maxAlternatives = 1;

  state.isListening = true;
  if (els.btnVoice) {
    els.btnVoice.disabled = true;
    els.btnVoice.textContent = '识别中...';
  }
  setVoiceStatus('请说一句完整话，例如“血压138 86”。', 'ok');

  recog.onresult = async (event) => {
    const transcript = toTrimmedText(event.results?.[0]?.[0]?.transcript || '', 200);
    els.voiceTranscript.value = transcript;
    await importVoiceTranscriptText(transcript, 'voice_auto');
  };

  recog.onerror = (event) => {
    setVoiceStatus(`语音识别失败: ${event.error || '未知错误'}`, 'error');
    setResult('语音识别失败，请重试。', 'error');
  };

  recog.onend = () => {
    state.isListening = false;
    if (els.btnVoice) {
      els.btnVoice.disabled = false;
      els.btnVoice.textContent = '语音录入';
    }
  };

  recog.start();
}

async function exportBackup() {
  const [persons, records, pending, audit, meta] = await Promise.all([
    getAll(STORE_PERSONS),
    getAll(STORE_RECORDS),
    getAll(STORE_PENDING),
    getAll(STORE_AUDIT),
    getAll(STORE_META),
  ]);

  const payload = {
    schema: BACKUP_SCHEMA,
    exportedAt: nowIso(),
    data: {
      persons,
      records,
      pending,
      audit: audit.slice(-5000),
      meta,
    },
  };

  const text = JSON.stringify(payload, null, 2);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
  anchor.href = url;
  anchor.download = `health-backup-${stamp}.json`;
  anchor.click();
  URL.revokeObjectURL(url);

  await setMeta('lastBackupAt', nowIso());
  await appendAudit('backup_export', { count: records.length });
  await updateBackupStatus();
  setResult('备份已导出。', 'ok');
}

async function importBackupFile(file) {
  const text = await file.text();
  let payload;
  try {
    payload = JSON.parse(text);
  } catch (_err) {
    setResult('备份文件不是合法 JSON。', 'error');
    return;
  }

  if (!payload || payload.schema !== BACKUP_SCHEMA || !payload.data) {
    setResult('备份文件 schema 不匹配。', 'error');
    return;
  }

  const overwrite = window.confirm('确定覆盖当前本地数据吗？\n选择“取消”将执行合并导入。');

  const incoming = payload.data;
  const persons = Array.isArray(incoming.persons) ? incoming.persons : [];
  const records = Array.isArray(incoming.records) ? incoming.records : [];
  const pending = Array.isArray(incoming.pending) ? incoming.pending : [];
  const audit = Array.isArray(incoming.audit) ? incoming.audit : [];
  const meta = Array.isArray(incoming.meta) ? incoming.meta : [];

  await withStores([STORE_PERSONS, STORE_RECORDS, STORE_PENDING, STORE_AUDIT, STORE_META], 'readwrite', async (stores) => {
    if (overwrite) {
      await reqToPromise(stores[STORE_PERSONS].clear());
      await reqToPromise(stores[STORE_RECORDS].clear());
      await reqToPromise(stores[STORE_PENDING].clear());
      await reqToPromise(stores[STORE_AUDIT].clear());
      await reqToPromise(stores[STORE_META].clear());
    }

    for (const row of persons) {
      await reqToPromise(stores[STORE_PERSONS].put(row));
    }
    for (const row of records) {
      await reqToPromise(stores[STORE_RECORDS].put(row));
    }
    for (const row of pending) {
      await reqToPromise(stores[STORE_PENDING].put(row));
    }
    for (const row of audit.slice(-5000)) {
      await reqToPromise(stores[STORE_AUDIT].put(row));
    }
    for (const row of meta) {
      if (row && typeof row.key === 'string') {
        await reqToPromise(stores[STORE_META].put(row));
      }
    }

    await reqToPromise(stores[STORE_META].put({ key: 'lastBackupAt', value: nowIso() }));
    await reqToPromise(stores[STORE_AUDIT].put({
      id: makeId('audit'),
      event: overwrite ? 'backup_import_overwrite' : 'backup_import_merge',
      detail: {
        persons: persons.length,
        records: records.length,
        pending: pending.length,
      },
      createdAt: nowIso(),
    }));
  });

  await refreshAll();
  setResult(overwrite ? '备份已覆盖恢复。' : '备份已合并导入。', 'ok');
}

async function updateBackupStatus() {
  const last = await getMeta('lastBackupAt');
  if (!last) {
    setBackupHint('', 'ok');
    return;
  }

  const ts = Date.parse(last);
  if (!Number.isFinite(ts)) {
    setBackupHint('备份时间格式异常，请重新导出备份。', 'warn');
    return;
  }

  const elapsedDays = (Date.now() - ts) / (24 * 3600 * 1000);
  if (elapsedDays >= BACKUP_REMINDER_DAYS) {
    setBackupHint(`上次备份: ${formatTime(last)}，已超过 ${BACKUP_REMINDER_DAYS} 天，建议立即备份。`, 'warn');
    return;
  }

  setBackupHint('', 'ok');
}

async function ensureDefaultPerson() {
  const persons = await getAll(STORE_PERSONS);
  if (persons.length) {
    return;
  }
  await addPerson('家人A', '默认成员');
}

async function loadUiPrefs() {
  const elder = await getMeta(META_KEY_ELDER_MODE);
  applyElderMode(Boolean(elder), false);

  const importMode = await getMeta(META_KEY_IMPORT_MODE);
  setImportMode(importMode === 'compat' ? 'compat' : 'strict', false);

  const recordFormType = await getMeta(META_KEY_RECORD_FORM_TYPE);
  setActiveRecordFormType(typeof recordFormType === 'string' ? recordFormType : 'vitals', false);

  const activeModule = await getMeta(META_KEY_ACTIVE_MODULE);
  setActiveModule(typeof activeModule === 'string' ? activeModule : 'record', false);

  const trendWindow = await getMeta(META_KEY_TREND_WINDOW);
  setTrendWindow(typeof trendWindow === 'string' ? trendWindow : 'recent_days', false);

  const onboardingSeen = await getMeta(META_KEY_ONBOARDING_SEEN);
  setOnboardingVisible(!onboardingSeen);
}

function bindEvents() {
  els.refresh.addEventListener('click', () => {
    refreshAll().catch(() => {
      setResult('刷新失败。', 'error');
    });
  });

  if (els.btnElderMode) {
    els.btnElderMode.addEventListener('click', () => {
      applyElderMode(!state.elderMode, true);
      setResult(state.elderMode ? '已切换到老人模式。' : '已切换到标准模式。', 'ok');
    });
  }

  if (els.btnOnboardingDone) {
    els.btnOnboardingDone.addEventListener('click', () => {
      setOnboardingVisible(false);
      setMeta(META_KEY_ONBOARDING_SEEN, true).catch(() => {});
    });
  }

  els.moduleButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const moduleName = button.dataset.module || 'record';
      setActiveModule(moduleName, true);
    });
  });

  els.recordTypeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.recordType || 'vitals';
      setActiveRecordFormType(type, true);
    });
  });

  els.timeSlotButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const slot = button.dataset.timeSlot || '';
      setActiveTimeSlot(slot);
    });
  });

  els.trendWindowButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const next = button.dataset.trendWindow || 'recent_days';
      setTrendWindow(next, true);
    });
  });

  if (els.btnTimelinePrevDay) {
    els.btnTimelinePrevDay.addEventListener('click', () => {
      shiftTimelineDate(-1);
    });
  }
  if (els.btnTimelineNextDay) {
    els.btnTimelineNextDay.addEventListener('click', () => {
      shiftTimelineDate(1);
    });
  }
  if (els.btnTimelineAll) {
    els.btnTimelineAll.addEventListener('click', () => {
      if (state.timelineDateMode === 'all') {
        setTimelineDateMode('day', localDayKey(new Date()), { quiet: false });
        return;
      }
      setTimelineDateMode('all', null, { quiet: false });
    });
  }
  if (els.btnTimelinePickDate) {
    els.btnTimelinePickDate.addEventListener('click', () => {
      applyTimelineDateFromInput({ quiet: false });
    });
  }
  if (els.timelineDateInput) {
    els.timelineDateInput.addEventListener('change', () => {
      applyTimelineDateFromInput({ quiet: true });
    });
  }
  if (els.btnTimelineKeywordSearch) {
    els.btnTimelineKeywordSearch.addEventListener('click', () => {
      const value = els.timelineKeywordInput ? els.timelineKeywordInput.value : '';
      setTimelineKeyword(value, { quiet: false });
    });
  }
  if (els.btnTimelineKeywordClear) {
    els.btnTimelineKeywordClear.addEventListener('click', () => {
      if (els.timelineKeywordInput) {
        els.timelineKeywordInput.value = '';
      }
      setTimelineKeyword('', { quiet: false });
    });
  }
  if (els.timelineKeywordInput) {
    els.timelineKeywordInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') {
        return;
      }
      event.preventDefault();
      setTimelineKeyword(els.timelineKeywordInput.value, { quiet: false });
    });
  }
  if (els.btnTimelineStatsToggle) {
    els.btnTimelineStatsToggle.addEventListener('click', () => {
      toggleTimelineStatsExpanded();
    });
  }

  document.addEventListener('click', (event) => {
    const rawTarget = event && event.target ? event.target : null;
    if (!rawTarget || typeof rawTarget.closest !== 'function') {
      return;
    }

    if (state.timelineManageMode) {
      const insideTimelineRow = rawTarget.closest(
        '.timeline-group-row, .timeline-row-ops, .timeline-row-manage-list, .timeline-manage-item, .timeline-manage-item-ops',
      );
      const insideTimelineControl = rawTarget.closest(
        '.timeline-row-op, .timeline-manage-item-op, .timeline-date-sticky-row, .timeline-date-controls, .trend-window-switch, #timeline-stats, .timeline-stats-toggle',
      );
      if (!insideTimelineRow && !insideTimelineControl && !isTimelineManageGuardActive()) {
        setTimelineManageMode(false);
      }
    }

    if (state.medTemplateManageMode) {
      const insideMedTemplateItem = rawTarget.closest('.med-template-item, .med-template-ops, .med-template-op');
      if (!insideMedTemplateItem && !isMedTemplateManageGuardActive()) {
        setMedTemplateManageMode(false);
      }
    }

    if (isTimelineManageGuardActive() || isMedTemplateManageGuardActive()) {
      return;
    }

    const target = rawTarget.closest('button');
    if (!target) {
      return;
    }

    const bpPreset = target.getAttribute('data-bp-preset');
    if (bpPreset) {
      const match = bpPreset.match(/^(\d{2,3})\/(\d{2,3})$/);
      if (match) {
        els.bpSys.value = match[1];
        els.bpDia.value = match[2];
        setResult(`已填入血压快捷值 ${bpPreset}。`, 'ok');
      }
      return;
    }

    const medTemplateIndexText = target.getAttribute('data-med-template-index');
    const medTemplateAction = target.getAttribute('data-med-template-action');
    if (medTemplateAction && medTemplateIndexText != null) {
      const index = Number(medTemplateIndexText);
      if (medTemplateAction === 'edit') {
        editMedicationTemplateByIndex(index).catch(() => {
          setResult('常用药编辑失败。', 'error');
        });
      } else if (medTemplateAction === 'delete') {
        removeMedicationTemplateByIndex(index).catch(() => {
          setResult('常用药删除失败。', 'error');
        });
      }
      return;
    }

    if (medTemplateIndexText != null) {
      if (state.medTemplateManageMode) {
        return;
      }
      applyMedicationTemplateByIndex(Number(medTemplateIndexText));
      return;
    }

    const fieldId = target.getAttribute('data-fill-target');
    if (!fieldId) {
      return;
    }
    const value = target.getAttribute('data-fill-value');
    const field = document.getElementById(fieldId);
    if (!field || value == null) {
      return;
    }
    field.value = value;
    if (field.tagName === 'SELECT') {
      field.dispatchEvent(new Event('change', { bubbles: true }));
    }
    setResult('已填入快捷值。', 'ok');
  });

  if (els.btnMedTemplateAdd) {
    els.btnMedTemplateAdd.addEventListener('click', () => {
      handleAddMedicationTemplate().catch(() => {
        setResult('添加常用药失败。', 'error');
      });
    });
  }

  els.personSelector.addEventListener('change', () => {
    state.activePersonId = els.personSelector.value;
    renderPersons();
    renderTimeline();
    loadFormPrefillForPerson(state.activePersonId).catch(() => {});
  });

  els.personForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const name = toTrimmedText(els.personName.value, 24);
    const relation = toTrimmedText(els.personRelation.value, 24);
    if (!name) {
      setResult('成员姓名不能为空。', 'error');
      return;
    }

    await addPerson(name, relation);
    els.personName.value = '';
    els.personRelation.value = '';
    await refreshAll();
    setResult('成员已新增。', 'ok');
  });

  els.formBp.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleManualFormSubmit('vitals', els.formBp);
  });

  els.formMed.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleManualFormSubmit('medication', els.formMed);
  });

  els.formSymptom.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleManualFormSubmit('symptom', els.formSymptom);
  });

  els.formSleep.addEventListener('submit', async (event) => {
    event.preventDefault();
    await handleManualFormSubmit('sleep', els.formSleep);
  });

  if (els.bpChart) {
    els.bpChart.addEventListener('click', (event) => {
      inspectChartPoint('bp', event);
    });
  }
  if (els.sleepChart) {
    els.sleepChart.addEventListener('click', (event) => {
      inspectChartPoint('sleep', event);
    });
  }
  if (els.hrChart) {
    els.hrChart.addEventListener('click', (event) => {
      inspectChartPoint('heartRate', event);
    });
  }

  if (els.importMode) {
    els.importMode.addEventListener('change', () => {
      setImportMode(els.importMode.value, true);
      setResult(state.strictImport ? '已启用严格模式导入。' : '已切换到兼容模式导入。', 'ok');
    });
  }

  els.templateButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const templateKey = button.dataset.template || 'generic';
      copyPromptTemplate(templateKey).catch(() => {
        setResult('模板复制失败。', 'error');
      });
    });
  });

  if (els.btnVoice) {
    const support = !!speechRecognizerCtor();
    els.btnVoice.disabled = !support;
    if (!support) {
      setVoiceStatus('当前浏览器不支持语音识别。', 'warn');
    }
    els.btnVoice.addEventListener('click', () => {
      handleVoiceInput().catch(() => {
        setVoiceStatus('语音识别失败。', 'error');
      });
    });
  }

  if (els.btnVoiceImport) {
    els.btnVoiceImport.addEventListener('click', () => {
      importVoiceTranscriptText(els.voiceTranscript.value, 'voice_text').catch(() => {
        setVoiceStatus('语音文本入库失败。', 'error');
      });
    });
  }

  els.btnImportActions.addEventListener('click', () => {
    const text = toTrimmedText(els.aiResponse.value, 50000);
    if (!text) {
      setResult('请先粘贴 AI 回复内容。', 'error');
      return;
    }

    importActionsFromAi(text).catch(() => {
      setResult('入库失败，请检查格式。', 'error');
    });
  });

  if (els.btnClearAiResponse) {
    els.btnClearAiResponse.addEventListener('click', () => {
      els.aiResponse.value = '';
      setResult('已清空 AI 回复内容。', 'ok');
    });
  }

  if (els.btnExport) {
    els.btnExport.addEventListener('click', () => {
      exportBackup().catch(() => {
        setResult('导出备份失败。', 'error');
      });
    });
  }

  if (els.importFile) {
    els.importFile.addEventListener('change', () => {
      const file = els.importFile.files && els.importFile.files[0];
      els.importFile.value = '';
      if (!file) {
        return;
      }

      importBackupFile(file).catch(() => {
        setResult('导入备份失败。', 'error');
      });
    });
  }
}

async function bootstrap() {
  initWheelSelectors();
  applyTrendWindowUi();
  bindEvents();
  state.db = await openDb();
  await ensureDefaultPerson();
  await loadUiPrefs();
  await refreshAll();
  setResult('健康工具已就绪。', 'ok');
}

bootstrap().catch((err) => {
  console.error(err);
  setResult('初始化失败，请刷新页面重试。', 'error');
});
