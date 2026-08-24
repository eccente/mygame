import {
  STYLE_CONFIG,
  TARGET_STYLE_POOL,
  applyMirrorX,
  applyMirrorY,
  clone,
  createBlock,
  createExit,
  createRng,
  flattenCampaignChapters,
  hashSeed,
  shuffle,
} from './data/catalog.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_01 } from './data/campaign/chapter-01.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_02 } from './data/campaign/chapter-02.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_02_PREVIEW_C02_BATCH1 } from './data/campaign/chapter-02-preview-c02-batch1.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_02_PREVIEW_C02_RANDOM10 } from './data/campaign/chapter-02-preview-c02-random10.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_02_PREVIEW_C02_FAMILY30 } from './data/campaign/chapter-02-preview-c02-family30.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_03 } from './data/campaign/chapter-03.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_04 } from './data/campaign/chapter-04.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_05 } from './data/campaign/chapter-05.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_06 } from './data/campaign/chapter-06.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_07 } from './data/campaign/chapter-07.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_08 } from './data/campaign/chapter-08.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_09 } from './data/campaign/chapter-09.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_10 } from './data/campaign/chapter-10.js?v=20260824112338';
import { CAMPAIGN_CHAPTER_11 } from './data/campaign/chapter-11.js?v=20260824112338';
import { ENDLESS_DIFFICULTIES, createEndlessLevel, getEndlessDifficulty } from './design/endless-generator-v1.js?v=20260824112338';

function getShiftPreviewKey() {
  if (typeof window === 'undefined' || !window.location) {
    return '';
  }
  try {
    return new URLSearchParams(window.location.search).get('shift_preview') || '';
  } catch (error) {
    return '';
  }
}

const SHIFT_PREVIEW_KEY = getShiftPreviewKey();

const PREVIEW_CHAPTERS = {
  'c02-batch1': [CAMPAIGN_CHAPTER_02_PREVIEW_C02_BATCH1],
  'c02-random10': [CAMPAIGN_CHAPTER_02_PREVIEW_C02_RANDOM10],
  'c02-family30': [CAMPAIGN_CHAPTER_02_PREVIEW_C02_FAMILY30],
};

const CAMPAIGN_SOURCE = flattenCampaignChapters(
  PREVIEW_CHAPTERS[SHIFT_PREVIEW_KEY] || [
    CAMPAIGN_CHAPTER_01,
    CAMPAIGN_CHAPTER_02,
    CAMPAIGN_CHAPTER_03,
    CAMPAIGN_CHAPTER_04,
    CAMPAIGN_CHAPTER_05,
    CAMPAIGN_CHAPTER_06,
    CAMPAIGN_CHAPTER_07,
    CAMPAIGN_CHAPTER_08,
    CAMPAIGN_CHAPTER_09,
    CAMPAIGN_CHAPTER_10,
    CAMPAIGN_CHAPTER_11,
  ]
);

export const CAMPAIGN_CHAPTERS = CAMPAIGN_SOURCE.chapters;
export const SHIFT_LEVELS = CAMPAIGN_SOURCE.levels;
export { STYLE_CONFIG };

export function getCampaignChapterByIndex(index = 0) {
  const safeIndex = Math.max(0, Math.min(index, SHIFT_LEVELS.length - 1));
  return CAMPAIGN_CHAPTERS.find((chapter) => safeIndex >= chapter.startIndex && safeIndex <= chapter.endIndex) || CAMPAIGN_CHAPTERS[0];
}

export function getCampaignLevelMeta(index = 0) {
  const level = SHIFT_LEVELS[Math.max(0, Math.min(index, SHIFT_LEVELS.length - 1))] || SHIFT_LEVELS[0];
  const chapter = getCampaignChapterByIndex(index);
  const levelInChapter = level?.meta?.levelInChapter || Math.max(1, index - chapter.startIndex + 1);
  return {
    level,
    chapter,
    levelInChapter,
  };
}

export function formatCampaignLevelLabel(index = 0) {
  const { chapter, levelInChapter } = getCampaignLevelMeta(index);
  return `${chapter.number}-${String(levelInChapter).padStart(2, '0')}`;
}

export { ENDLESS_DIFFICULTIES, getEndlessDifficulty, createEndlessLevel };
