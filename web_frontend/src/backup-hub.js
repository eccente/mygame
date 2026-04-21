'use strict';

const BACKUP_SCHEMA = 'mygame-backup/v1';
const BACKUP_LAST_AT_KEY = 'mygame_backup_last_at_v1';
const PROVIDER_EVENT = 'mygame:backup-providers-change';
const HUB_READY_EVENT = 'mygame:backup-hub-ready';

function toTrimmedText(value, maxLen = 120) {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim().slice(0, maxLen);
}

function nowIso() {
  return new Date().toISOString();
}

function emitProviderChange(getProviders) {
  try {
    window.dispatchEvent(new CustomEvent(PROVIDER_EVENT, {
      detail: { providers: getProviders() },
    }));
  } catch (_err) {
    // ignore cross-context errors
  }
}

function createBackupHub() {
  const providers = new Map();

  function getProviders() {
    return Array.from(providers.values())
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        version: provider.version,
      }))
      .sort((a, b) => a.id.localeCompare(b.id));
  }

  function registerProvider(definition) {
    if (!definition || typeof definition !== 'object') {
      throw new Error('备份模块定义无效。');
    }
    const id = toTrimmedText(String(definition.id || ''), 64).toLowerCase();
    if (!id) {
      throw new Error('备份模块缺少 id。');
    }
    if (typeof definition.exportData !== 'function' || typeof definition.importData !== 'function') {
      throw new Error(`备份模块 ${id} 缺少 exportData/importData。`);
    }

    const normalized = {
      id,
      label: toTrimmedText(String(definition.label || id), 48) || id,
      version: Number.isFinite(Number(definition.version)) ? Number(definition.version) : 1,
      exportData: definition.exportData,
      importData: definition.importData,
      clearData: typeof definition.clearData === 'function' ? definition.clearData : null,
    };
    providers.set(id, normalized);
    emitProviderChange(getProviders);
    return () => {
      providers.delete(id);
      emitProviderChange(getProviders);
    };
  }

  function setLastBackupAt(isoString) {
    const value = toTrimmedText(String(isoString || ''), 40);
    if (!value) {
      try {
        window.localStorage.removeItem(BACKUP_LAST_AT_KEY);
      } catch (_err) {
        // ignore persistence failures
      }
      return;
    }
    try {
      window.localStorage.setItem(BACKUP_LAST_AT_KEY, value);
    } catch (_err) {
      // ignore persistence failures
    }
  }

  function getLastBackupAt() {
    try {
      return toTrimmedText(String(window.localStorage.getItem(BACKUP_LAST_AT_KEY) || ''), 40);
    } catch (_err) {
      return '';
    }
  }

  async function exportBackupPayload() {
    const providerEntries = {};
    const providerList = getProviders();
    for (const providerMeta of providerList) {
      const provider = providers.get(providerMeta.id);
      if (!provider) {
        continue;
      }
      try {
        const exported = await provider.exportData();
        providerEntries[provider.id] = {
          version: provider.version,
          label: provider.label,
          data: exported == null ? null : exported,
        };
      } catch (err) {
        throw new Error(`模块「${provider.label}」导出失败：${err && err.message ? err.message : '未知错误'}`);
      }
    }

    const exportedAt = nowIso();
    return {
      schema: BACKUP_SCHEMA,
      exportedAt,
      providers: providerEntries,
    };
  }

  async function importBackupPayload(payload, options = {}) {
    if (!payload || typeof payload !== 'object' || payload.schema !== BACKUP_SCHEMA) {
      throw new Error('备份 schema 不匹配。');
    }
    const mode = options.mode === 'overwrite' ? 'overwrite' : 'merge';
    const incoming = payload.providers && typeof payload.providers === 'object' ? payload.providers : {};

    const summary = {
      mode,
      importedProviders: [],
      skippedProviders: [],
    };

    const providerList = getProviders();
    for (const providerMeta of providerList) {
      const provider = providers.get(providerMeta.id);
      if (!provider) {
        continue;
      }
      const entry = incoming[provider.id];
      const hasEntry = entry && typeof entry === 'object' && Object.prototype.hasOwnProperty.call(entry, 'data');

      if (!hasEntry) {
        if (mode === 'overwrite' && provider.clearData) {
          try {
            await provider.clearData();
            summary.importedProviders.push(provider.id);
          } catch (err) {
            throw new Error(`模块「${provider.label}」清空失败：${err && err.message ? err.message : '未知错误'}`);
          }
        } else {
          summary.skippedProviders.push(provider.id);
        }
        continue;
      }

      try {
        await provider.importData({
          data: entry.data,
          mode,
          backupVersion: Number.isFinite(Number(entry.version)) ? Number(entry.version) : 1,
        });
        summary.importedProviders.push(provider.id);
      } catch (err) {
        throw new Error(`模块「${provider.label}」导入失败：${err && err.message ? err.message : '未知错误'}`);
      }
    }

    const importedAt = nowIso();
    setLastBackupAt(importedAt);
    return {
      ...summary,
      importedAt,
    };
  }

  return {
    BACKUP_SCHEMA,
    PROVIDER_EVENT,
    registerProvider,
    getProviders,
    exportBackupPayload,
    importBackupPayload,
    setLastBackupAt,
    getLastBackupAt,
  };
}

if (!window.mygameBackupHub) {
  window.mygameBackupHub = createBackupHub();
  try {
    window.dispatchEvent(new CustomEvent(HUB_READY_EVENT));
  } catch (_err) {
    // ignore cross-context errors
  }
}
