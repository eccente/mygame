'use strict';

const RAW_BUILD_TAG = '20260824112338';
const BUILD_TAG = RAW_BUILD_TAG.startsWith('__BUILD_') ? `dev-${Date.now()}` : RAW_BUILD_TAG;
const VIEW_ALLOW_LIST = ['home', 'game', 'health', 'shift'];
const FEATURE_STYLE_ID = 'feature-style';
const BACKUP_STALE_DAYS = 3;
const LEGACY_HEALTH_BACKUP_SCHEMA = 'health-backup/v1';
const GAME_BACKUP_PROVIDER_IDS = Object.freeze(['game', 'shift']);

const FEATURE_STYLE_BY_VIEW = {
  game: `./src/styles.css?v=${BUILD_TAG}`,
  health: `./src/health.css?v=${BUILD_TAG}`,
  shift: `./src/shift.css?v=${BUILD_TAG}`,
};

const FEATURE_SCRIPT_BY_VIEW = {
  game: {
    id: 'feature-script-game',
    src: `./src/app.js?v=${BUILD_TAG}`,
  },
  health: {
    id: 'feature-script-health',
    src: `./src/health.js?v=${BUILD_TAG}`,
  },
  shift: {
    id: 'feature-script-shift',
    src: `./src/shift-entry.js?v=${BUILD_TAG}`,
  },
};

const state = {
  activeView: 'home',
  moduleLoading: Object.create(null),
};

const els = {
  views: Array.from(document.querySelectorAll('[data-view]')),
  status: document.getElementById('shell-status'),
  btnProjectExport: document.getElementById('btn-project-export'),
  projectImportFile: document.getElementById('project-import-file'),
  projectGameImportFile: document.getElementById('project-game-import-file'),
  projectBackupScope: document.getElementById('project-backup-scope'),
  projectBackupStatus: document.getElementById('project-backup-status'),
};

function normalizeView(view) {
  const raw = String(view || '').trim().toLowerCase();
  return VIEW_ALLOW_LIST.includes(raw) ? raw : 'home';
}

function viewFromHash() {
  const hash = String(window.location.hash || '').replace(/^#/, '');
  return normalizeView(hash || 'home');
}

function setStatus(message, level = '') {
  if (!els.status) {
    return;
  }
  els.status.textContent = message || '';
  els.status.className = `shell-status${level ? ` ${level}` : ''}`;
}

function getBackupHub() {
  const hub = window.mygameBackupHub;
  if (!hub || typeof hub !== 'object') {
    return null;
  }
  return hub;
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

function setProjectBackupStatus(message, level = '') {
  if (!els.projectBackupStatus) {
    return;
  }
  els.projectBackupStatus.textContent = message || '';
  els.projectBackupStatus.className = `backup-status${level ? ` ${level}` : ''}`;
}

function setProjectBackupBusy(busy) {
  if (els.btnProjectExport) {
    els.btnProjectExport.disabled = !!busy;
  }
  if (els.projectImportFile) {
    els.projectImportFile.disabled = !!busy;
  }
  if (els.projectGameImportFile) {
    els.projectGameImportFile.disabled = !!busy;
  }
}

function renderProjectBackupScope() {
  if (!els.projectBackupScope) {
    return;
  }
  const hub = getBackupHub();
  if (!hub || typeof hub.getProviders !== 'function') {
    els.projectBackupScope.textContent = '范围：备份模块未就绪。';
    return;
  }
  const providers = hub.getProviders();
  if (!Array.isArray(providers) || !providers.length) {
    els.projectBackupScope.textContent = '范围：当前没有可用的备份模块。';
    return;
  }
  const names = providers.map((row) => row.label || row.id).join('、');
  els.projectBackupScope.textContent = `范围：${names}`;
}

function renderProjectBackupFreshness() {
  const hub = getBackupHub();
  if (!hub || typeof hub.getLastBackupAt !== 'function') {
    setProjectBackupStatus('备份时间状态不可用。', 'warn');
    return;
  }
  const last = String(hub.getLastBackupAt() || '').trim();
  if (!last) {
    setProjectBackupStatus('尚未执行全项目备份，建议先导出一次。', 'warn');
    return;
  }
  const ts = Date.parse(last);
  if (!Number.isFinite(ts)) {
    setProjectBackupStatus('上次备份时间格式异常，请重新导出。', 'warn');
    return;
  }
  const elapsedDays = (Date.now() - ts) / (24 * 3600 * 1000);
  if (elapsedDays >= BACKUP_STALE_DAYS) {
    setProjectBackupStatus(`上次备份: ${formatTime(last)}，已超过 ${BACKUP_STALE_DAYS} 天。`, 'warn');
    return;
  }
  setProjectBackupStatus(`上次备份: ${formatTime(last)}`, 'ok');
}

function buildFileStamp() {
  return new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
}

function downloadBackupText(text, filename) {
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function normalizeIncomingBackupPayload(rawPayload, hub) {
  if (!rawPayload || typeof rawPayload !== 'object') {
    throw new Error('备份文件内容无效。');
  }
  if (rawPayload.schema === hub.BACKUP_SCHEMA) {
    return rawPayload;
  }
  if (rawPayload.schema === LEGACY_HEALTH_BACKUP_SCHEMA && rawPayload.data && typeof rawPayload.data === 'object') {
    return {
      schema: hub.BACKUP_SCHEMA,
      exportedAt: rawPayload.exportedAt || new Date().toISOString(),
      providers: {
        health: {
          version: 1,
          label: '健康管理',
          data: rawPayload.data,
        },
      },
    };
  }
  throw new Error('备份 schema 不匹配。');
}

async function handleProjectBackupExport() {
  const hub = getBackupHub();
  if (!hub || typeof hub.exportBackupPayload !== 'function') {
    throw new Error('备份模块尚未初始化。');
  }
  setProjectBackupBusy(true);
  try {
    const payload = await hub.exportBackupPayload();
    const text = JSON.stringify(payload, null, 2);
    const fileName = `mygame-backup-${buildFileStamp()}.json`;
    downloadBackupText(text, fileName);
    if (typeof hub.setLastBackupAt === 'function') {
      hub.setLastBackupAt(payload.exportedAt || new Date().toISOString());
    }
    renderProjectBackupFreshness();
    setProjectBackupStatus('全项目备份已导出。', 'ok');
  } finally {
    setProjectBackupBusy(false);
  }
}

function ensureBackupContainsProviders(payload, providerIds, errorMessage) {
  const providers = payload && payload.providers && typeof payload.providers === 'object'
    ? payload.providers
    : null;
  if (!providers) {
    throw new Error(errorMessage);
  }
  const hasAny = providerIds.some((providerId) => {
    const entry = providers[providerId];
    return !!(entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'data'));
  });
  if (!hasAny) {
    throw new Error(errorMessage);
  }
}

function dispatchProjectBackupImported(result, mode) {
  const importedAt = result && result.importedAt ? result.importedAt : new Date().toISOString();
  try {
    window.dispatchEvent(new CustomEvent('mygame:backup-imported', {
      detail: {
        mode,
        importedAt,
        importedProviders: Array.isArray(result?.importedProviders) ? result.importedProviders.slice() : [],
        skippedProviders: Array.isArray(result?.skippedProviders) ? result.skippedProviders.slice() : [],
      },
    }));
  } catch (_err) {
    // ignore cross-context errors
  }
  return importedAt;
}

async function handleProjectBackupImport(file, options = {}) {
  const hub = getBackupHub();
  if (!hub || typeof hub.importBackupPayload !== 'function') {
    throw new Error('备份模块尚未初始化。');
  }
  if (!file) {
    throw new Error('请选择备份文件。');
  }
  const text = await file.text();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_err) {
    throw new Error('备份文件不是合法 JSON。');
  }

  const normalized = normalizeIncomingBackupPayload(parsed, hub);
  const targetProviderIds = Array.isArray(options.providerIds) ? options.providerIds : [];
  if (targetProviderIds.length) {
    ensureBackupContainsProviders(
      normalized,
      targetProviderIds,
      options.missingProvidersMessage || '这个备份里没有可导入的目标模块。'
    );
  }
  const overwrite = window.confirm('确定覆盖当前本地数据吗？\n选择“取消”将执行合并导入。');
  const mode = overwrite ? 'overwrite' : 'merge';
  const result = await hub.importBackupPayload(normalized, {
    mode,
    providerIds: targetProviderIds,
  });

  const importedAt = dispatchProjectBackupImported(result, mode);
  if (typeof hub.setLastBackupAt === 'function') {
    hub.setLastBackupAt(importedAt);
  }
  renderProjectBackupFreshness();
}

function applyViewVisibility(view) {
  els.views.forEach((node) => {
    const current = normalizeView(node.dataset.view);
    node.classList.toggle('is-hidden', current !== view);
  });
  document.body.setAttribute('data-shell-view', view);
}

function notifyViewChange(view) {
  try {
    window.dispatchEvent(new CustomEvent('mygame:view-change', {
      detail: { view: normalizeView(view) },
    }));
  } catch (_err) {
    // ignore cross-context errors
  }
}

function ensureFeatureStyle(view) {
  const targetHref = FEATURE_STYLE_BY_VIEW[view] || '';
  const current = document.getElementById(FEATURE_STYLE_ID);

  if (!targetHref) {
    if (current) {
      current.remove();
    }
    return;
  }

  if (current && current.getAttribute('href') === targetHref) {
    return;
  }

  if (current) {
    current.remove();
  }

  const link = document.createElement('link');
  link.id = FEATURE_STYLE_ID;
  link.rel = 'stylesheet';
  link.href = targetHref;
  document.head.appendChild(link);
}

function ensureFeatureModule(view) {
  const config = FEATURE_SCRIPT_BY_VIEW[view];
  if (!config) {
    return Promise.resolve();
  }

  if (document.getElementById(config.id)) {
    return Promise.resolve();
  }

  if (state.moduleLoading[view]) {
    return state.moduleLoading[view];
  }

  state.moduleLoading[view] = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.id = config.id;
    script.type = 'module';
    script.src = config.src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${config.src}`));
    document.body.appendChild(script);
  }).finally(() => {
    state.moduleLoading[view] = null;
  });

  return state.moduleLoading[view];
}

function setHashForView(view) {
  if (view === 'home') {
    const cleanUrl = `${window.location.pathname}${window.location.search}`;
    window.history.replaceState({}, '', cleanUrl);
    return;
  }

  const targetHash = `#${view}`;
  if (window.location.hash !== targetHash) {
    window.location.hash = targetHash;
  }
}

async function switchView(view, options = {}) {
  const target = normalizeView(view);
  const fromHashChange = options.fromHashChange === true;

  state.activeView = target;
  ensureFeatureStyle(target);
  applyViewVisibility(target);
  notifyViewChange(target);

  if (!fromHashChange) {
    setHashForView(target);
  }

  if (target === 'home') {
    renderProjectBackupScope();
    renderProjectBackupFreshness();
    setStatus('');
    return;
  }

  try {
    await ensureFeatureModule(target);
    setStatus('');
  } catch (_err) {
    setStatus('模块加载失败，请刷新页面后重试。', 'error');
  }
}

function bindViewLinks() {
  const links = Array.from(document.querySelectorAll('[data-view-link]'));
  links.forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      const view = normalizeView(node.getAttribute('data-view-link'));
      switchView(view).catch(() => {
        setStatus('页面切换失败，请重试。', 'error');
      });
    });
  });
}

function bindHashChange() {
  window.addEventListener('hashchange', () => {
    switchView(viewFromHash(), { fromHashChange: true }).catch(() => {
      setStatus('页面切换失败，请重试。', 'error');
    });
  });
}

function bindProjectBackupActions() {
  if (!els.btnProjectExport || !els.projectImportFile || !els.projectGameImportFile) {
    return;
  }
  renderProjectBackupScope();
  renderProjectBackupFreshness();

  const hub = getBackupHub();
  if (hub && hub.PROVIDER_EVENT) {
    window.addEventListener(hub.PROVIDER_EVENT, () => {
      renderProjectBackupScope();
    });
  }

  els.btnProjectExport.addEventListener('click', () => {
    handleProjectBackupExport().catch((err) => {
      const message = err && err.message ? err.message : '导出全项目备份失败。';
      setProjectBackupStatus(message, 'error');
      setStatus(message, 'error');
    });
  });

  els.projectImportFile.addEventListener('change', () => {
    const file = els.projectImportFile.files && els.projectImportFile.files[0];
    els.projectImportFile.value = '';
    if (!file) {
      return;
    }
    setProjectBackupBusy(true);
    handleProjectBackupImport(file).then(() => {
      setProjectBackupStatus('备份已导入，正在刷新页面应用数据。', 'ok');
      setTimeout(() => {
        window.location.reload();
      }, 260);
    }).catch((err) => {
      const message = err && err.message ? err.message : '导入全项目备份失败。';
      setProjectBackupStatus(message, 'error');
      setStatus(message, 'error');
    }).finally(() => {
      setProjectBackupBusy(false);
    });
  });

  els.projectGameImportFile.addEventListener('change', () => {
    const file = els.projectGameImportFile.files && els.projectGameImportFile.files[0];
    els.projectGameImportFile.value = '';
    if (!file) {
      return;
    }
    setProjectBackupBusy(true);
    handleProjectBackupImport(file, {
      providerIds: GAME_BACKUP_PROVIDER_IDS,
      missingProvidersMessage: '这个备份里没有小游戏存档或方块挪一挪数据。',
    }).then(() => {
      setProjectBackupStatus('游戏存档已导入，正在刷新页面应用数据。', 'ok');
      setTimeout(() => {
        window.location.reload();
      }, 260);
    }).catch((err) => {
      const message = err && err.message ? err.message : '导入游戏存档失败。';
      setProjectBackupStatus(message, 'error');
      setStatus(message, 'error');
    }).finally(() => {
      setProjectBackupBusy(false);
    });
  });
}

function bootstrap() {
  bindViewLinks();
  bindHashChange();
  bindProjectBackupActions();
  switchView(viewFromHash(), { fromHashChange: true }).catch(() => {
    setStatus('初始化失败，请刷新页面重试。', 'error');
  });
}

bootstrap();
