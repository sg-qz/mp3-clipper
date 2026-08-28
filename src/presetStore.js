/**
 * presetStore.js
 * 预设剪辑方案的本地持久化（localStorage）+ 内置默认预设。
 * 纯逻辑模块，不依赖 UI。
 */

const STORAGE_KEY = 'mp3-clipper-presets';

/** 首次加载时写入的内置默认预设 */
export const DEFAULT_PRESETS = [
  {
    id: 'builtin-trim-start-3',
    name: '去开头 3 秒',
    mode: 'trim',
    trimStartSec: 3, trimStartMs: 0,
    trimEndSec: 0, trimEndMs: 0,
    keepStartSec: 0, keepStartMs: 0,
    keepEndSec: 0, keepEndMs: 0,
  },
  {
    id: 'builtin-trim-end-5',
    name: '去结尾 5 秒',
    mode: 'trim',
    trimStartSec: 0, trimStartMs: 0,
    trimEndSec: 5, trimEndMs: 0,
    keepStartSec: 0, keepStartMs: 0,
    keepEndSec: 0, keepEndMs: 0,
  },
  {
    id: 'builtin-keep-30-60',
    name: '保留 30s–60s',
    mode: 'keep',
    trimStartSec: 0, trimStartMs: 0,
    trimEndSec: 0, trimEndMs: 0,
    keepStartSec: 30, keepStartMs: 0,
    keepEndSec: 60, keepEndMs: 0,
  },
];

/** 生成稳定唯一 ID */
function genId() {
  return `preset-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 深拷贝默认预设（避免外部修改污染常量） */
function cloneDefaults() {
  return DEFAULT_PRESETS.map((p) => ({ ...p }));
}

/**
 * 读取预设列表；若本地无数据或读取失败，则写入并返回默认预设。
 * @returns {Array<object>}
 */
export function loadPresets() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      savePresets(DEFAULT_PRESETS);
      return cloneDefaults();
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      savePresets(DEFAULT_PRESETS);
      return cloneDefaults();
    }
    return parsed;
  } catch (err) {
    return cloneDefaults();
  }
}

/**
 * 覆盖保存整个预设列表。
 * @param {Array<object>} presets
 */
export function savePresets(presets) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(presets));
}

/**
 * 新增预设（自动生成 id）。
 * @param {object} preset
 * @returns {Array<object>} 更新后的列表
 */
export function addPreset(preset) {
  const presets = loadPresets();
  const next = [...presets, { ...preset, id: preset.id || genId() }];
  savePresets(next);
  return next;
}

/**
 * 按 id 更新预设字段。
 * @param {string} id
 * @param {object} patch
 * @returns {Array<object>}
 */
export function updatePreset(id, patch) {
  const presets = loadPresets();
  const next = presets.map((p) => (p.id === id ? { ...p, ...patch } : p));
  savePresets(next);
  return next;
}

/**
 * 按 id 删除预设。
 * @param {string} id
 * @returns {Array<object>}
 */
export function deletePreset(id) {
  const presets = loadPresets();
  const next = presets.filter((p) => p.id !== id);
  savePresets(next);
  return next;
}

/**
 * 生成人类可读的预设描述（用于列表展示）。
 * @param {object} p
 * @returns {string}
 */
export function describePreset(p) {
  const fmt = (sec = 0, ms = 0) => {
    const total = (sec || 0) + (ms || 0) / 1000;
    return total > 0 ? `${total}s` : '';
  };

  if (p.mode === 'keep') {
    const start = fmt(p.keepStartSec, p.keepStartMs) || '0s';
    const hasEnd = (p.keepEndSec || 0) > 0 || (p.keepEndMs || 0) > 0;
    const end = hasEnd ? fmt(p.keepEndSec, p.keepEndMs) : '结尾';
    return `保留 ${start} → ${end}`;
  }

  const head = fmt(p.trimStartSec, p.trimStartMs);
  const tail = fmt(p.trimEndSec, p.trimEndMs);
  const parts = [];
  if (head) parts.push(`去头 ${head}`);
  if (tail) parts.push(`去尾 ${tail}`);
  return parts.length ? parts.join('，') : '不裁剪';
}
