import { SHAPE_POOLS } from './shape-pools.js?v=20260824112338';

export const MAINLINE_GENERATOR_CHAPTER_META = {
  6: {
    id: 'chapter-06',
    number: 6,
    title: '方向通道',
    shortTitle: '方向',
    tagline: '自由块和单向移动块开始混编。',
    primaryMechanic: 'directional',
    supportMechanics: ['directional'],
  },
  7: {
    id: 'chapter-07',
    number: 7,
    title: '钥匙开门',
    shortTitle: '钥门',
    tagline: '先踩钥匙垫，再打开锁门通路。',
    primaryMechanic: 'lock-gate',
    supportMechanics: ['directional'],
  },
  8: {
    id: 'chapter-08',
    number: 8,
    title: '单向门',
    shortTitle: '单向',
    tagline: '只能顺着箭头方向穿过门带。',
    primaryMechanic: 'one-way',
    supportMechanics: ['directional'],
  },
  9: {
    id: 'chapter-09',
    number: 9,
    title: '切换门',
    shortTitle: '切换',
    tagline: '踩住按钮，才能撑开门带。',
    primaryMechanic: 'toggle-gate',
    supportMechanics: ['directional'],
  },
  10: {
    id: 'chapter-10',
    number: 10,
    title: '变色垫',
    shortTitle: '变色',
    tagline: '先换颜色，再对准新的门槽。',
    primaryMechanic: 'recolor',
    supportMechanics: [],
  },
  11: {
    id: 'chapter-11',
    number: 11,
    title: '冰面滑行',
    shortTitle: '冰面',
    tagline: '滑到停下来的那一格，才是真正的位置。',
    primaryMechanic: 'ice',
    supportMechanics: [],
  },
  12: {
    id: 'chapter-12',
    number: 12,
    title: '终章拼盘',
    shortTitle: '终章',
    tagline: '六类机制轮番上阵，每一关都只保留一条硬核主线。',
    primaryMechanic: 'quota-sequence',
    supportMechanics: [],
    mechanicMixMode: 'single-mechanic-fixed-quota',
  },
};

export const MAINLINE_GENERATOR_SEED_CHAPTER_BY_MECHANIC = {
  directional: 6,
  'lock-gate': 7,
  'one-way': 8,
  'toggle-gate': 9,
  recolor: 10,
  ice: 11,
};

export const CHAPTER_12_MECHANIC_SEQUENCE = [
  'directional', 'lock-gate', 'one-way', 'toggle-gate', 'recolor', 'ice',
  'lock-gate', 'one-way', 'toggle-gate', 'recolor', 'ice', 'directional',
  'one-way', 'toggle-gate', 'recolor', 'ice', 'directional', 'lock-gate',
  'toggle-gate', 'recolor', 'ice', 'directional', 'lock-gate', 'one-way',
  'recolor', 'ice', 'directional', 'lock-gate', 'one-way', 'toggle-gate',
];

export const MAINLINE_DIRECTIONAL_SUPPORT_LIMIT = {
  6: [3, 5],
  7: [2, 4],
  8: [2, 4],
  9: [2, 5],
  10: [0, 0],
  11: [0, 0],
  12: [0, 0],
};

export function getGeneratorChapterMeta(chapter = 6) {
  return MAINLINE_GENERATOR_CHAPTER_META[chapter] || null;
}

export function getPrimaryMechanicForLevel(chapter = 6, levelIndex = 1) {
  if (chapter === 12) {
    return CHAPTER_12_MECHANIC_SEQUENCE[Math.max(0, levelIndex - 1)] || CHAPTER_12_MECHANIC_SEQUENCE[0];
  }
  return MAINLINE_GENERATOR_CHAPTER_META[chapter]?.primaryMechanic || 'directional';
}

export function getSupportMechanicsForLevel(chapter = 6) {
  return [...(MAINLINE_GENERATOR_CHAPTER_META[chapter]?.supportMechanics || [])];
}

export function getDirectionalSupportBand(chapter = 6) {
  return MAINLINE_DIRECTIONAL_SUPPORT_LIMIT[chapter] || [0, 0];
}

export function getMechanicSeedChapter(primaryMechanic = 'directional') {
  return MAINLINE_GENERATOR_SEED_CHAPTER_BY_MECHANIC[primaryMechanic] || 6;
}

export function getGeneratorShapeWeights(chapter = 6, primaryMechanic = '') {
  if (chapter === 12) {
    const remap = {
      directional: 'chapter06',
      'lock-gate': 'chapter07',
      'one-way': 'chapter08',
      'toggle-gate': 'chapter09',
      recolor: 'chapter10',
      ice: 'chapter11',
    };
    const key = remap[primaryMechanic] || 'chapter12';
    return { ...(SHAPE_POOLS.campaign[key] || SHAPE_POOLS.campaign.chapter12 || SHAPE_POOLS.campaign.chapter03) };
  }
  const directKey = `chapter${String(chapter).padStart(2, '0')}`;
  return { ...(SHAPE_POOLS.campaign[directKey] || SHAPE_POOLS.campaign.chapter03) };
}
