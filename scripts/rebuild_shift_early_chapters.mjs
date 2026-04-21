import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  applyMirrorX,
  applyMirrorY,
  clone,
  createBlock,
  createExit,
  createRng,
  getShapeCells,
  hashSeed,
  shuffle,
  TARGET_STYLE_POOL,
} from '../web_frontend/src/shift/data/catalog.js';
import {
  collectOpeningStaticMetrics,
  validateFirstClear,
  validateLevelFull,
  validateLevelMedium,
  validateLevelQuick,
  validateLevelStatic,
} from '../web_frontend/src/shift/core/solver.js';
import { hasExitLayoutConflict, normalizeExitLayout } from '../web_frontend/src/shift/core/exit-rules.js';
import { CHAPTER_BANDS } from '../web_frontend/src/shift/design/chapter-bands.js';
import {
  createGeneratorV3CandidatePlan,
  getGeneratorV3PlacementAnchors,
} from '../web_frontend/src/shift/design/generator-v3.js';
import { SHAPE_POOLS } from '../web_frontend/src/shift/design/shape-pools.js';
import { CAMPAIGN_CHAPTER_01 } from '../web_frontend/src/shift/data/campaign/chapter-01.js';
import { CAMPAIGN_CHAPTER_02 } from '../web_frontend/src/shift/data/campaign/chapter-02.js';
import { CAMPAIGN_CHAPTER_03 } from '../web_frontend/src/shift/data/campaign/chapter-03.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAMPAIGN_DIR = path.resolve(__dirname, '../web_frontend/src/shift/data/campaign');

const SOURCE_CHAPTERS = {
  1: CAMPAIGN_CHAPTER_01,
  2: CAMPAIGN_CHAPTER_02,
  3: CAMPAIGN_CHAPTER_03,
};

const CHAPTER_META = {
  1: {
    id: 'chapter-01',
    number: 1,
    title: '整块离场',
    shortTitle: '整块',
    tagline: '先看颜色，再把整块送到边缘门槽。',
  },
  2: {
    id: 'chapter-02',
    number: 2,
    title: 'L 形借位',
    shortTitle: 'L形',
    tagline: '缺角就是空间，把异形当成正式解题骨架。',
  },
  3: {
    id: 'chapter-03',
    number: 3,
    title: 'T 形堵点',
    shortTitle: 'T形',
    tagline: '中心锚块一旦堵住，全局顺序都会改变。',
  },
  4: {
    id: 'chapter-04',
    number: 4,
    title: '多门竞争',
    shortTitle: '多门',
    tagline: '门不再只是出口，而是路线竞争的核心。',
  },
  5: {
    id: 'chapter-05',
    number: 5,
    title: '顺序压缩',
    shortTitle: '压缩',
    tagline: '不靠新机制，只靠更狠的顺序依赖提压。',
  },
};

const CHAPTER_BUILD_ORDER = [1, 2, 3, 4, 5];
const SHAPE_VARIANTS = {
  mono: ['default'],
  domino: ['h', 'v'],
  bar3: ['h', 'v'],
  'square-2': ['default'],
  'L-3': ['ur', 'dr', 'dl', 'ul'],
  'L-4': ['ur', 'dr', 'dl', 'ul'],
  'T-4': ['up', 'right', 'down', 'left'],
  'cross-5': ['default'],
};
const SOURCE_POOL_BY_CHAPTER = {
  1: [CAMPAIGN_CHAPTER_01.levels],
  2: [CAMPAIGN_CHAPTER_01.levels, CAMPAIGN_CHAPTER_02.levels],
  3: [CAMPAIGN_CHAPTER_02.levels, CAMPAIGN_CHAPTER_03.levels],
  4: [CAMPAIGN_CHAPTER_03.levels],
  5: [CAMPAIGN_CHAPTER_03.levels],
};

function getChapterBand(chapterNumber) {
  return CHAPTER_BANDS.find((entry) => entry.chapter === chapterNumber) || null;
}

function getEffectiveBand(chapterNumber, index) {
  const chapterBand = getChapterBand(chapterNumber);
  if (!chapterBand) {
    return null;
  }
  const segment = (chapterBand.segments || []).find((entry) => index >= entry.start && index <= entry.end) || null;
  return {
    ...chapterBand,
    ...(segment || {}),
    chapter: chapterBand.chapter,
    title: chapterBand.title,
    segmentKey: segment?.key || null,
  };
}

function getSeedPools(chapterNumber) {
  return SOURCE_POOL_BY_CHAPTER[chapterNumber] || [CAMPAIGN_CHAPTER_03.levels];
}

function getShapeFamily(block) {
  const preset = String(block.shapePreset || 'mono');
  if (preset.startsWith('domino')) {
    return 'domino';
  }
  if (preset.startsWith('bar3')) {
    return 'bar3';
  }
  if (preset.startsWith('square-2')) {
    return 'square-2';
  }
  if (preset.startsWith('L-3')) {
    return 'L-3';
  }
  if (preset.startsWith('L-4')) {
    return 'L-4';
  }
  if (preset.startsWith('T-4')) {
    return 'T-4';
  }
  if (preset.startsWith('cross-5')) {
    return 'cross-5';
  }
  return 'mono';
}

function uniqueColors(level) {
  return [...new Set((level.blocks || []).map((block) => block.style))].sort();
}

function occupiedCells(level) {
  return (level.blocks || []).reduce((sum, block) => sum + block.shapeCells.length, 0);
}

function occupancyRate(level) {
  return occupiedCells(level) / Math.max(1, level.board.cols * level.board.rows);
}

function getProjectionLengthForBlock(block, edge) {
  const xs = block.shapeCells.map((cell) => cell.x);
  const ys = block.shapeCells.map((cell) => cell.y);
  const width = Math.max(...xs) + 1;
  const height = Math.max(...ys) + 1;
  return edge === 'left' || edge === 'right' ? height : width;
}

function getCompatibleExits(level, block) {
  return (level.exits || []).filter((exit) => exit.acceptColor === block.style && exit.span >= getProjectionLengthForBlock(block, exit.edge));
}

function collectDoorMetrics(level) {
  const exits = level.exits || [];
  const blocks = level.blocks || [];
  const compatibleBlocksByExit = new Map(exits.map((exit) => [exit.id, []]));
  const compatibleExitsByBlock = new Map();

  blocks.forEach((block) => {
    const compatibleExits = getCompatibleExits(level, block);
    compatibleExitsByBlock.set(block.id, compatibleExits.map((exit) => exit.id));
    compatibleExits.forEach((exit) => {
      const list = compatibleBlocksByExit.get(exit.id) || [];
      list.push(block.id);
      compatibleBlocksByExit.set(exit.id, list);
    });
  });

  let contestedExits = 0;
  compatibleBlocksByExit.forEach((blockIds) => {
    if (new Set(blockIds).size >= 2) {
      contestedExits += 1;
    }
  });

  let multiExitBlocks = 0;
  compatibleExitsByBlock.forEach((exitIds) => {
    if (new Set(exitIds).size >= 2) {
      multiExitBlocks += 1;
    }
  });

  return {
    doorGroupCount: exits.length,
    doorSlotCount: exits.reduce((sum, exit) => sum + Math.max(0, exit.span), 0),
    doorCompetitionCount: contestedExits + multiExitBlocks,
  };
}

function inBand(value, band) {
  if (!band || band.length < 2) {
    return true;
  }
  return value >= band[0] && value <= band[1];
}

function getMoveValidationBand(band) {
  if (!band?.solutionBand) {
    return band?.solutionBand || null;
  }
  const [min, max] = band.solutionBand;
  let upperPadding = 0;
  if (band.segmentKey === 'hard') {
    upperPadding = 4;
  } else if (band.segmentKey === 'expert') {
    upperPadding = 2;
  }
  const lowerSlack = band.segmentKey === 'hard' ? 1 : 0;
  return [Math.max(0, min - lowerSlack), max + upperPadding];
}

function getFirstClearTargetProfile(band) {
  const openingBand = Array.isArray(band?.openingActionBand) ? [...band.openingActionBand] : [2, 4];
  switch (band?.segmentKey) {
    case 'teaching':
      return {
        openingActionBand: [3, 6],
        directClearMax: 1,
        firstClearDepthBand: [1, 3],
        firstClearAreaMin: 1,
        firstClearRouteMax: 4,
        falseFirstClearMax: 1,
        firstClearReleaseMin: 10,
        largeNearExitMax: 1,
      };
    case 'ramp':
      return {
        openingActionBand: [2, 4],
        directClearMax: 1,
        firstClearDepthBand: [1, 3],
        firstClearAreaMin: 2,
        firstClearRouteMax: 3,
        falseFirstClearMax: 1,
        firstClearReleaseMin: 14,
        largeNearExitMax: 1,
      };
    case 'main':
      return {
        openingActionBand: [2, 4],
        directClearMax: 1,
        firstClearDepthBand: [2, 4],
        firstClearAreaMin: 2,
        firstClearRouteMax: 3,
        falseFirstClearMax: 1,
        firstClearReleaseMin: 18,
        largeNearExitMax: 1,
      };
    case 'pressure':
      return {
        openingActionBand: [1, 3],
        directClearMax: 0,
        firstClearDepthBand: [3, 5],
        firstClearAreaMin: 2,
        firstClearRouteMax: 2,
        falseFirstClearMax: 2,
        firstClearReleaseMin: 24,
        largeNearExitMax: 0,
      };
    case 'climax':
      return {
        openingActionBand: [1, 2],
        directClearMax: 0,
        firstClearDepthBand: [4, 6],
        firstClearAreaMin: 3,
        firstClearRouteMax: 2,
        falseFirstClearMax: 2,
        firstClearReleaseMin: 28,
        largeNearExitMax: 0,
      };
    case 'hard':
      return {
        openingActionBand: openingBand,
        directClearMax: 1,
        firstClearDepthBand: [2, 4],
        firstClearAreaMin: 2,
        firstClearRouteMax: 3,
        falseFirstClearMax: 1,
        firstClearReleaseMin: 18,
        largeNearExitMax: 1,
      };
    case 'expert':
      return {
        openingActionBand: openingBand,
        directClearMax: 0,
        firstClearDepthBand: [3, 5],
        firstClearAreaMin: 3,
        firstClearRouteMax: 2,
        falseFirstClearMax: 2,
        firstClearReleaseMin: 24,
        largeNearExitMax: 0,
      };
    case 'brutal':
    default:
      return {
        openingActionBand: openingBand,
        directClearMax: 0,
        firstClearDepthBand: [4, 7],
        firstClearAreaMin: 3,
        firstClearRouteMax: 2,
        falseFirstClearMax: 2,
        firstClearReleaseMin: 30,
        largeNearExitMax: 0,
      };
  }
}

function distanceToBand(value, band) {
  if (!Array.isArray(band) || band.length < 2 || !Number.isFinite(value)) {
    return 0;
  }
  if (value < band[0]) {
    return band[0] - value;
  }
  if (value > band[1]) {
    return value - band[1];
  }
  return 0;
}

function buildPrecheckRejectedReport(staticReport, reason, extra = {}) {
  return {
    ...staticReport,
    isSolvable: false,
    reason,
    bestMoveCountEstimate: null,
    clearOrder: [],
    criticalEventChain: [],
    solutionFamilyCount: 0,
    dependencyDepth: null,
    averageSetupSpan: null,
    firstClearMoveIndex: null,
    firstClearSetupDepth: null,
    firstClearEdgeDistance: null,
    expandedStates: 0,
    familySearchComplete: false,
    ...extra,
  };
}

function evaluateOpeningStaticAgainstBand(openingMetrics, band) {
  const profile = getFirstClearTargetProfile(band);
  const checks = {
    openingActionOk: inBand(openingMetrics?.openingActionCountRaw || 0, profile.openingActionBand),
    directClearOk: (openingMetrics?.directClearCount || 0) <= profile.directClearMax,
    largeNearExitOk: (openingMetrics?.openingLargeBlockNearExitCount || 0) <= profile.largeNearExitMax,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    profile,
    checks,
  };
}

function evaluateFirstClearAgainstBand(firstClearReport, band) {
  const profile = getFirstClearTargetProfile(band);
  const checks = {
    firstClearReachableOk: !!firstClearReport?.isFirstClearReachable,
    firstClearDepthOk: inBand(firstClearReport?.bestFirstClearDepth, profile.firstClearDepthBand),
    firstClearAreaOk: (firstClearReport?.firstClearArea || 0) >= profile.firstClearAreaMin,
    firstClearReleaseOk: (firstClearReport?.firstClearReleaseGain || 0) >= profile.firstClearReleaseMin,
    firstClearRouteOk: (firstClearReport?.firstClearRouteCount || 0) <= profile.firstClearRouteMax,
    falseFirstClearOk: (firstClearReport?.falseFirstClearCount || 0) <= profile.falseFirstClearMax,
  };
  return {
    ok: Object.values(checks).every(Boolean),
    profile,
    checks,
  };
}

function evaluateLevelAgainstBand(level, report, band) {
  const colors = uniqueColors(level);
  const occupancy = Number(occupancyRate(level).toFixed(3));
  const doorMetrics = collectDoorMetrics(level);
  const firstClearProfile = getFirstClearTargetProfile(band);
  const checks = {
    rowsOk: inBand(level.board.rows, band.rows),
    colorsOk: inBand(colors.length, band.colors),
    occupancyOk: inBand(occupancy, band.occupancy),
    moveOk: !report.bestMoveCountEstimate || inBand(report.bestMoveCountEstimate, getMoveValidationBand(band)),
    familiesOk: !Number.isFinite(band.solutionFamilyMax) || report.solutionFamilyCount <= band.solutionFamilyMax,
    doorGroupsOk: inBand(doorMetrics.doorGroupCount, band.doorGroups),
    doorSlotsOk: inBand(doorMetrics.doorSlotCount, band.doorSlots),
    doorCompetitionOk: !Number.isFinite(band.doorCompetitionMin) || doorMetrics.doorCompetitionCount >= band.doorCompetitionMin,
    mobileOk: report.mobileViewportFit.matchesBoardSpec,
    openingOk: inBand(report.openingActionCountRaw, firstClearProfile.openingActionBand),
    directClearOk: report.directClearCount <= firstClearProfile.directClearMax,
    largeNearExitOk: report.openingLargeBlockNearExitCount <= firstClearProfile.largeNearExitMax,
    firstClearReachableOk: !!report.firstClearBlockId,
    firstClearDepthOk: inBand(report.bestFirstClearDepth, firstClearProfile.firstClearDepthBand),
    firstClearAreaOk: (report.firstClearArea || 0) >= firstClearProfile.firstClearAreaMin,
    firstClearReleaseOk: (report.firstClearReleaseGain || 0) >= firstClearProfile.firstClearReleaseMin,
    firstClearRouteOk: (report.firstClearRouteCount || 0) <= firstClearProfile.firstClearRouteMax,
    falseFirstClearOk: (report.falseFirstClearCount || 0) <= firstClearProfile.falseFirstClearMax,
  };
  return {
    colors,
    occupancy,
    doorMetrics,
    firstClearProfile,
    ok: report.isStructurallyValid
      && report.isSolvable
      && Object.values(checks).every(Boolean),
    checks,
  };
}

function scoreCandidate(level, report, band, evaluation) {
  const occupancyTarget = band.occupancy[0] + ((band.occupancy[1] - band.occupancy[0]) * 0.72);
  const moveTarget = band.solutionBand[0] + ((band.solutionBand[1] - band.solutionBand[0]) * 0.62);
  const doorGroupTarget = band.doorGroups[0];
  const doorSlotTarget = band.doorSlots[0];
  const doorCompetitionTarget = Number.isFinite(band.doorCompetitionMin) ? band.doorCompetitionMin : 0;
  let score = 0;
  score -= Math.abs(evaluation.occupancy - occupancyTarget) * 100;
  const moveDelta = (report.bestMoveCountEstimate || moveTarget) - moveTarget;
  score -= moveDelta < 0 ? Math.abs(moveDelta) * 4 : Math.abs(moveDelta) * 2;
  score -= Math.abs(evaluation.doorMetrics.doorGroupCount - doorGroupTarget) * 4;
  score -= Math.abs(evaluation.doorMetrics.doorSlotCount - doorSlotTarget) * 2;
  if (Number.isFinite(doorCompetitionTarget)) {
    score -= Math.abs(evaluation.doorMetrics.doorCompetitionCount - doorCompetitionTarget) * 2;
  }
  score -= report.solutionFamilyCount * 5;
  const firstClearProfile = evaluation.firstClearProfile || getFirstClearTargetProfile(band);
  score -= distanceToBand(report.openingActionCountRaw, firstClearProfile.openingActionBand) * 10;
  score -= Math.max(0, report.directClearCount - firstClearProfile.directClearMax) * 24;
  score -= Math.max(0, report.openingLargeBlockNearExitCount - firstClearProfile.largeNearExitMax) * 16;
  score -= distanceToBand(report.bestFirstClearDepth, firstClearProfile.firstClearDepthBand) * 12;
  score -= Math.max(0, firstClearProfile.firstClearAreaMin - (report.firstClearArea || 0)) * 16;
  score -= Math.max(0, firstClearProfile.firstClearReleaseMin - (report.firstClearReleaseGain || 0)) * 2.2;
  score -= Math.max(0, (report.firstClearRouteCount || 0) - firstClearProfile.firstClearRouteMax) * 18;
  score -= Math.max(0, (report.falseFirstClearCount || 0) - firstClearProfile.falseFirstClearMax) * 14;
  score += (report.firstClearKeynessScore || 0) * 0.8;
  if (evaluation.ok) {
    score += 1000;
  }
  return Number(score.toFixed(2));
}

function buildStructuralCandidateReport(level, band) {
  const staticReport = validateLevelStatic(level, {
    solutionFamilyCap: Math.max(4, band.solutionFamilyMax || 4),
  });
  if (!staticReport.isStructurallyValid) {
    return buildPrecheckRejectedReport(staticReport, 'structural_invalid', {
      openingActionCount: 99,
      openingActionCountRaw: 99,
      openingMovableBlockCount: 99,
      directClearCount: 99,
      directLargeClearCount: 99,
      openingLargeBlockNearExitCount: 99,
      matchingEdgeTouchCount: 99,
      averageBestExitDistance: 0,
      openingStaticMetrics: null,
    });
  }
  const openingMetrics = collectOpeningStaticMetrics(level);
  return {
    ...staticReport,
    isSolvable: false,
    reason: 'structural_candidate',
    openingActionCount: openingMetrics.openingActionCountRaw,
    openingActionCountRaw: openingMetrics.openingActionCountRaw,
    openingMovableBlockCount: openingMetrics.openingMovableBlockCount,
    directClearCount: openingMetrics.directClearCount,
    directLargeClearCount: openingMetrics.directLargeClearCount,
    openingLargeBlockNearExitCount: openingMetrics.openingLargeBlockNearExitCount,
    matchingEdgeTouchCount: openingMetrics.matchingEdgeTouchCount,
    averageBestExitDistance: openingMetrics.averageBestExitDistance,
    openingStaticMetrics: openingMetrics,
  };
}

function evaluateStructuralCandidateAgainstBand(level, report, band) {
  const colors = uniqueColors(level);
  const occupancy = Number(occupancyRate(level).toFixed(3));
  const doorMetrics = collectDoorMetrics(level);
  const firstClearProfile = getFirstClearTargetProfile(band);
  const checks = {
    structuralOk: !!report.isStructurallyValid,
    rowsOk: inBand(level.board.rows, band.rows),
    colorsOk: inBand(colors.length, band.colors),
    occupancyOk: inBand(occupancy, band.occupancy),
    doorGroupsOk: inBand(doorMetrics.doorGroupCount, band.doorGroups),
    doorSlotsOk: inBand(doorMetrics.doorSlotCount, band.doorSlots),
    doorCompetitionOk: !Number.isFinite(band.doorCompetitionMin) || doorMetrics.doorCompetitionCount >= band.doorCompetitionMin,
    mobileOk: !!report.mobileViewportFit?.matchesBoardSpec,
    openingOk: inBand(report.openingActionCountRaw, firstClearProfile.openingActionBand),
    directClearOk: (report.directClearCount || 0) <= firstClearProfile.directClearMax,
    largeNearExitOk: (report.openingLargeBlockNearExitCount || 0) <= firstClearProfile.largeNearExitMax,
  };
  return {
    colors,
    occupancy,
    doorMetrics,
    firstClearProfile,
    ok: Object.values(checks).every(Boolean),
    checks,
  };
}

function scoreStructuralCandidate(level, report, band, evaluation) {
  const occupancyTarget = band.occupancy[0] + ((band.occupancy[1] - band.occupancy[0]) * 0.72);
  const doorGroupTarget = band.doorGroups[0];
  const doorSlotTarget = band.doorSlots[0];
  const doorCompetitionTarget = Number.isFinite(band.doorCompetitionMin) ? band.doorCompetitionMin : 0;
  const firstClearProfile = evaluation.firstClearProfile || getFirstClearTargetProfile(band);
  let score = 0;
  if (!report.isStructurallyValid) {
    score -= 2000;
  }
  score -= Math.abs(evaluation.occupancy - occupancyTarget) * 120;
  score -= Math.abs(evaluation.doorMetrics.doorGroupCount - doorGroupTarget) * 6;
  score -= Math.abs(evaluation.doorMetrics.doorSlotCount - doorSlotTarget) * 3;
  if (Number.isFinite(doorCompetitionTarget)) {
    score -= Math.abs(evaluation.doorMetrics.doorCompetitionCount - doorCompetitionTarget) * 3;
  }
  score -= distanceToBand(report.openingActionCountRaw, firstClearProfile.openingActionBand) * 14;
  score -= Math.max(0, (report.directClearCount || 0) - firstClearProfile.directClearMax) * 44;
  score -= Math.max(0, (report.openingLargeBlockNearExitCount || 0) - firstClearProfile.largeNearExitMax) * 32;
  score += (report.averageBestExitDistance || 0) * 14;
  score -= (report.openingMovableBlockCount || 0) * 4;
  score -= (report.matchingEdgeTouchCount || 0) * 5;
  if (!evaluation.ok) {
    score -= 220;
    Object.entries(evaluation.checks).forEach(([key, value]) => {
      if (value) {
        return;
      }
      score -= key === 'structuralOk' ? 500 : key === 'mobileOk' ? 250 : 32;
    });
  }
  return Number(score.toFixed(2));
}

function compareStructuralCandidateStrength(left, right) {
  const leftOk = Number(!!left?.evaluation?.ok);
  const rightOk = Number(!!right?.evaluation?.ok);
  if (leftOk !== rightOk) {
    return leftOk - rightOk;
  }
  const leftOpeningOk = Number(
    !!left?.evaluation?.checks?.openingOk
    && !!left?.evaluation?.checks?.directClearOk
    && !!left?.evaluation?.checks?.largeNearExitOk
  );
  const rightOpeningOk = Number(
    !!right?.evaluation?.checks?.openingOk
    && !!right?.evaluation?.checks?.directClearOk
    && !!right?.evaluation?.checks?.largeNearExitOk
  );
  if (leftOpeningOk !== rightOpeningOk) {
    return leftOpeningOk - rightOpeningOk;
  }
  const leftOccupancy = left?.evaluation?.occupancy || 0;
  const rightOccupancy = right?.evaluation?.occupancy || 0;
  if (leftOccupancy !== rightOccupancy) {
    return leftOccupancy - rightOccupancy;
  }
  return (left?.score || -99999) - (right?.score || -99999);
}

function getCandidateLayoutFingerprint(level) {
  if (!level) {
    return '';
  }
  const exits = (level.exits || [])
    .map((exit) => `${exit.edge}:${exit.start}:${exit.span}:${exit.acceptColor}`)
    .sort()
    .join('|');
  const blocks = (level.blocks || [])
    .map((block) => `${block.style}:${getShapeFamily(block)}:${block.shapeVariant || 'default'}:${block.x},${block.y}:${block.moveAxis || 'both'}`)
    .sort()
    .join('|');
  return `${level.board?.cols || 0}x${level.board?.rows || 0}::${exits}::${blocks}`;
}

function getStructuralAttemptBudget(chapterNumber, band, quickOnly = false) {
  const segmentKey = band?.segmentKey || 'hard';
  if (chapterNumber === 2) {
    if (quickOnly) {
      if (segmentKey === 'brutal') {
        return 6;
      }
      if (segmentKey === 'expert') {
        return 5;
      }
      return 4;
    }
    if (segmentKey === 'brutal') {
      return 10;
    }
    if (segmentKey === 'expert') {
      return 8;
    }
    return 6;
  }
  const segmentBoost = segmentKey === 'brutal' ? 2 : segmentKey === 'expert' ? 1 : 0;
  return quickOnly ? 4 + segmentBoost : 6 + segmentBoost;
}

function getQuickShortlistLimit(chapterNumber, band, quickOnly = false) {
  if (chapterNumber === 2) {
    if (quickOnly) {
      return band?.segmentKey === 'brutal' ? 3 : 2;
    }
    return band?.segmentKey === 'brutal' ? 3 : 2;
  }
  return 2;
}

function getFinalizationShortlistLimit(chapterNumber, band) {
  return chapterNumber === 2 && band?.segmentKey === 'brutal' ? 2 : 1;
}

function getIntermediateShortlistLimit(chapterNumber, band) {
  if (chapterNumber === 2) {
    if (band?.segmentKey === 'brutal') {
      return 1;
    }
    if (band?.segmentKey === 'expert') {
      return 2;
    }
    return 1;
  }
  return 1;
}

function getBoundedValidationOptions(candidate) {
  const isChapterTwo = candidate?.level?.chapter === 2;
  const segmentKey = candidate?.band?.segmentKey || 'hard';
  if (isChapterTwo) {
    if (segmentKey === 'brutal') {
      return {
        maxStates: 2200,
        maxSolutions: 2,
        solutionDepthSlack: 1,
        solutionFamilyCap: Math.max(4, candidate.band.solutionFamilyMax || 4),
        firstClearMaxStates: 680,
        firstClearMaxRoutes: 2,
        firstClearDepthSlack: 1,
        firstClearRouteFamilyCap: 2,
      };
    }
    if (segmentKey === 'expert') {
      return {
        maxStates: 2400,
        maxSolutions: 2,
        solutionDepthSlack: 1,
        solutionFamilyCap: Math.max(4, candidate.band.solutionFamilyMax || 4),
        firstClearMaxStates: 760,
        firstClearMaxRoutes: 3,
        firstClearDepthSlack: 1,
        firstClearRouteFamilyCap: 2,
      };
    }
    return {
      maxStates: 1800,
      maxSolutions: 2,
      solutionDepthSlack: 1,
      solutionFamilyCap: Math.max(4, candidate.band.solutionFamilyMax || 4),
      firstClearMaxStates: 640,
      firstClearMaxRoutes: 2,
      firstClearDepthSlack: 1,
      firstClearRouteFamilyCap: 2,
    };
  }
  return {
    maxStates: 2600,
    maxSolutions: 2,
    solutionDepthSlack: 1,
    solutionFamilyCap: Math.max(4, candidate?.band?.solutionFamilyMax || 4),
    firstClearMaxStates: 900,
    firstClearMaxRoutes: 3,
    firstClearDepthSlack: 1,
    firstClearRouteFamilyCap: 2,
  };
}

function upgradeCandidateToBounded(candidate) {
  if (!candidate?.level || !candidate?.band) {
    return candidate;
  }
  if (candidate.validationStage === 'bounded' || candidate.validationStage === 'full') {
    return candidate;
  }
  const options = getBoundedValidationOptions(candidate);
  const report = validateLevelMedium(candidate.level, options);
  const evaluation = evaluateLevelAgainstBand(candidate.level, report, candidate.band);
  return {
    ...candidate,
    ok: evaluation.ok,
    report,
    evaluation,
    score: scoreCandidate(candidate.level, report, candidate.band, evaluation),
    validationStage: 'bounded',
  };
}

function getFailedCheckCount(candidate) {
  return Object.values(candidate?.evaluation?.checks || {}).filter((value) => value === false).length;
}

function shouldRunFullValidation(candidate) {
  if (!candidate?.report || !candidate?.evaluation) {
    return false;
  }
  if (!candidate.report.isSolvable || candidate.report.reason === 'search_limit') {
    return false;
  }
  const failedCount = getFailedCheckCount(candidate);
  if (candidate.evaluation.ok) {
    return true;
  }
  const allowedResidual = candidate.band?.segmentKey === 'brutal' ? 2 : 1;
  const allowedKeys = new Set(['moveOk', 'familiesOk']);
  const failedKeys = Object.entries(candidate.evaluation.checks)
    .filter(([, value]) => value === false)
    .map(([key]) => key);
  return failedCount <= allowedResidual && failedKeys.every((key) => allowedKeys.has(key));
}

function sortCandidatesDescending(pool, compareFn) {
  return [...pool].sort((left, right) => compareFn(right, left));
}

function pickRangeValue(range, rng, options = {}) {
  const [min, max] = range || [0, 0];
  if (min === max) {
    return min;
  }
  const bias = Number.isFinite(options.bias) ? options.bias : 0.5;
  const value = min + ((max - min) * ((rng() + bias) / 2));
  return options.integer === false ? value : Math.round(value);
}

function getSegmentBias(segmentKey) {
  switch (segmentKey) {
    case 'teaching':
      return 0.2;
    case 'ramp':
      return 0.4;
    case 'main':
      return 0.65;
    case 'pressure':
      return 0.82;
    case 'climax':
      return 0.92;
    case 'hard':
      return 0.48;
    case 'expert':
      return 0.78;
    case 'brutal':
      return 0.94;
    default:
      return 0.5;
  }
}

function chooseTargetRows(band, rng) {
  return pickRangeValue(band.rows || [8, 8], rng, { bias: getSegmentBias(band.segmentKey) });
}

function shiftLevelY(level, delta) {
  if (!delta) {
    return level;
  }
  const next = clone(level);
  next.blocks = next.blocks.map((block) => ({
    ...block,
    y: block.y + delta,
  }));
  next.exits = next.exits.map((exit) => ({
    ...exit,
    start: exit.edge === 'left' || exit.edge === 'right' ? exit.start + delta : exit.start,
  }));
  return next;
}

function remapLevelColors(level, allowedColors, rng) {
  const currentColors = uniqueColors(level);
  const mappedColors = shuffle(allowedColors, rng);
  const colorMap = new Map();
  currentColors.forEach((color, index) => {
    colorMap.set(color, mappedColors[index] || allowedColors[index] || allowedColors[0]);
  });
  const next = clone(level);
  next.blocks = next.blocks.map((block) => ({
    ...block,
    style: colorMap.get(block.style) || block.style,
  }));
  next.exits = next.exits.map((exit) => ({
    ...exit,
    acceptColor: colorMap.get(exit.acceptColor) || exit.acceptColor,
  }));
  return next;
}

function ensureColorCoverage(level, allowedColors, rng) {
  const counts = new Map();
  (level.blocks || []).forEach((block) => {
    counts.set(block.style, (counts.get(block.style) || 0) + 1);
  });
  const missing = allowedColors.filter((color) => !counts.has(color));
  if (!missing.length) {
    return;
  }
  const candidates = [...(level.blocks || [])]
    .filter((block) => (counts.get(block.style) || 0) >= 2)
    .sort((left, right) => left.shapeCells.length - right.shapeCells.length || left.id.localeCompare(right.id));
  missing.forEach((color, index) => {
    const block = candidates[index] || candidates[0];
    if (!block) {
      return;
    }
    counts.set(block.style, (counts.get(block.style) || 1) - 1);
    block.style = color;
    counts.set(color, (counts.get(color) || 0) + 1);
  });
}

function renameLevelEntities(level, chapterNumber, levelIndex) {
  const chapterLabel = String(chapterNumber).padStart(2, '0');
  const levelLabel = String(levelIndex).padStart(2, '0');
  const next = clone(level);
  next.id = `c${chapterLabel}-l${levelLabel}`;
  next.title = `${chapterNumber}-${levelLabel}`;
  next.blocks = next.blocks.map((block, index) => ({
    ...block,
    id: `${next.id}-b${index + 1}`,
  }));
  next.exits = next.exits.map((exit, index) => ({
    ...exit,
    id: `exit-${next.id}-${index + 1}`,
  }));
  next.chapter = chapterNumber;
  next.index = levelIndex;
  next.rewardCoins = 80;
  next.meta = {
    ...next.meta,
    mode: 'campaign',
    difficultyBand: next.meta?.difficultyBand || 'teaching',
    levelInChapter: levelIndex,
  };
  return next;
}

function filterSeedByBand(seed, band) {
  const allowedShapes = new Set(band.shapes || []);
  const next = clone(seed);
  next.blocks = next.blocks.filter((block) => allowedShapes.has(getShapeFamily(block)));
  return next;
}

function getSeedChapterCandidates(chapterNumber, targetRows) {
  const pools = getSeedPools(chapterNumber).flat();
  const compatible = pools.filter((level) => level.board.rows <= targetRows);
  return compatible.length ? compatible : pools;
}

function prepareSeedLevel(seed, chapterNumber, levelIndex, band, attempt) {
  const rng = createRng(hashSeed(`shift-seed:${chapterNumber}:${levelIndex}:${attempt}`));
  const allowedColors = TARGET_STYLE_POOL.slice(0, band.colors[0]);
  const targetRows = chooseTargetRows(band, rng);
  let level = filterSeedByBand(seed, band);
  level.board.cols = 6;
  level.board.rows = targetRows;
  const slack = Math.max(0, targetRows - seed.board.rows);
  if (slack) {
    level = shiftLevelY(level, Math.floor(rng() * (slack + 1)));
  }
  const mirrorMode = Math.floor(rng() * 4);
  if (mirrorMode === 1 || mirrorMode === 3) {
    level = applyMirrorX(level);
  }
  if (mirrorMode === 2 || mirrorMode === 3) {
    level = applyMirrorY(level);
  }
  level = remapLevelColors(level, allowedColors, rng);
  level = renameLevelEntities(level, chapterNumber, levelIndex);
  level.exits = normalizeExitLayout(level.exits || []);
  level.meta = {
    ...level.meta,
    difficultyBand: band.difficultyBand || 'teaching',
    tags: [`segment-${band.segmentKey || 'base'}`, 'generated'],
    guideText: '',
  };
  return level;
}

function exitsOverlap(left, right) {
  if (left.edge !== right.edge) {
    return false;
  }
  const leftEnd = left.start + left.span;
  const rightEnd = right.start + right.span;
  return left.start < rightEnd && right.start < leftEnd;
}

function buildEdgeSlots(length, spans = [2, 1, 3]) {
  const slots = [];
  spans.forEach((span) => {
    for (let start = 0; start + span <= length; start += span === 1 ? 2 : span) {
      slots.push({ start, span });
    }
  });
  return slots;
}

function buildExtraExitCandidates(level) {
  const horizontal = buildEdgeSlots(level.board.cols, [2, 1, 3]);
  const vertical = buildEdgeSlots(level.board.rows, [2, 1, 3]);
  const candidates = [];
  ['top', 'bottom'].forEach((edge) => {
    horizontal.forEach((slot) => {
      candidates.push({ edge, start: slot.start, span: slot.span });
    });
  });
  ['left', 'right'].forEach((edge) => {
    vertical.forEach((slot) => {
      candidates.push({ edge, start: slot.start, span: slot.span });
    });
  });
  return candidates;
}

function canAddExit(level, candidate) {
  return !hasExitLayoutConflict(level.exits || [], candidate);
}

function getExitCenterDistance(level, candidate) {
  const edgeLength = candidate.edge === 'top' || candidate.edge === 'bottom' ? level.board.cols : level.board.rows;
  const edgeCenter = (edgeLength - 1) / 2;
  const slotCenter = candidate.start + ((candidate.span - 1) / 2);
  return Math.abs(slotCenter - edgeCenter);
}

function scoreOpeningMetricsAgainstBand(openingMetrics, band) {
  const profile = getFirstClearTargetProfile(band);
  let score = 0;
  score -= distanceToBand(openingMetrics?.openingActionCountRaw, profile.openingActionBand) * 14;
  score -= Math.max(0, (openingMetrics?.directClearCount || 0) - profile.directClearMax) * 36;
  score -= Math.max(0, openingMetrics?.directLargeClearCount || 0) * 18;
  score -= Math.max(0, (openingMetrics?.openingLargeBlockNearExitCount || 0) - profile.largeNearExitMax) * 22;
  score += Math.min(6, openingMetrics?.averageBestExitDistance || 0) * 8;
  return score;
}

function buildExitPreviewPlacement(level, candidate, color, band, options = {}) {
  const previewExit = createExit('preview-exit', candidate.edge, candidate.start, candidate.span, color);
  const previewLevel = {
    ...level,
    exits: [...(level.exits || []), previewExit],
  };
  const openingMetrics = collectOpeningStaticMetrics(previewLevel);
  const doorMetrics = collectDoorMetrics(previewLevel);
  const existingExitCounts = new Map();
  (level.exits || []).forEach((exit) => {
    existingExitCounts.set(exit.acceptColor, (existingExitCounts.get(exit.acceptColor) || 0) + 1);
  });
  const compatibleBlocks = (level.blocks || []).filter((block) => block.style === color && candidate.span >= getProjectionLengthForBlock(block, candidate.edge));
  const profile = getFirstClearTargetProfile(band);
  let score = scoreOpeningMetricsAgainstBand(openingMetrics, band);
  score += compatibleBlocks.length * 5;
  score += existingExitCounts.get(color) ? 0 : 12;
  score -= (existingExitCounts.get(color) || 0) * 8;
  score -= getExitCenterDistance(level, candidate) * (band?.segmentKey === 'expert' || band?.segmentKey === 'brutal' || band?.segmentKey === 'pressure' || band?.segmentKey === 'climax' ? 6 : 3);
  score -= candidate.span * (profile.directClearMax <= 0 ? 8 : 4);

  if (options.focusBlock) {
    const focusClearance = getExitClearance(options.focusBlock, previewExit, level.board);
    const focusProjection = getProjectionLengthForBlock(options.focusBlock, candidate.edge);
    score += focusClearance * 18;
    score -= Math.abs(candidate.span - focusProjection) * 4;
    if (focusClearance === 0) {
      score -= 80;
    }
  }

  if (options.currentMetrics) {
    const currentMetrics = options.currentMetrics;
    const targetGroups = options.targetGroups || 0;
    const targetSlots = options.targetSlots || 0;
    const competitionTarget = options.competitionTarget || 0;
    const needsBandFill = currentMetrics.doorGroupCount < targetGroups || currentMetrics.doorSlotCount < targetSlots;
    const competitionGain = doorMetrics.doorCompetitionCount > currentMetrics.doorCompetitionCount;
    if (needsBandFill) {
      score += 20;
    } else if (doorMetrics.doorCompetitionCount < competitionTarget && !competitionGain) {
      score -= 28;
    }
    score += (doorMetrics.doorCompetitionCount - currentMetrics.doorCompetitionCount) * 14;
  }

  return {
    score,
    previewExit,
    previewLevel,
    openingMetrics,
    doorMetrics,
    compatibleBlocks,
  };
}

function chooseColorForExit(level, candidate, allowedColors, band) {
  const choices = [...allowedColors]
    .map((color) => {
      const preview = buildExitPreviewPlacement(level, candidate, color, band);
      if (!preview.compatibleBlocks.length) {
        return null;
      }
      return {
        color,
        score: preview.score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.color.localeCompare(right.color));

  return choices[0]?.color || null;
}

function desiredDoorGroups(level, band) {
  const target = level.meta?.generatorV3Plan?.contract?.doorGroupsTarget;
  if (Number.isFinite(target)) {
    return target;
  }
  const min = band.doorGroups?.[0] || 0;
  const max = band.doorGroups?.[1] || min;
  if (band.segmentKey === 'teaching') {
    return min;
  }
  if (band.segmentKey === 'climax') {
    return Math.min(max, min + 1);
  }
  return min;
}

function desiredDoorSlots(level, band) {
  const target = level.meta?.generatorV3Plan?.contract?.doorSlotsTarget;
  if (Number.isFinite(target)) {
    return target;
  }
  const min = band.doorSlots?.[0] || 0;
  const max = band.doorSlots?.[1] || min;
  if (band.segmentKey === 'teaching') {
    return max;
  }
  return min;
}

function addCoverageExitForBlock(level, block, color, counterRef, band) {
  const candidates = buildExtraExitCandidates(level)
    .filter((candidate) => candidate.span >= getProjectionLengthForBlock(block, candidate.edge) && canAddExit(level, candidate))
    .map((candidate) => ({
      candidate,
      preview: buildExitPreviewPlacement(level, candidate, color, band, { focusBlock: block }),
    }))
    .sort((left, right) => right.preview.score - left.preview.score || left.candidate.span - right.candidate.span || left.candidate.start - right.candidate.start);
  const match = candidates[0] || null;
  if (!match) {
    return false;
  }
  level.exits.push(createExit(`exit-${level.id}-${counterRef.value}`, match.candidate.edge, match.candidate.start, match.candidate.span, color));
  counterRef.value += 1;
  return true;
}

function ensureExitCoverage(level, allowedColors, band) {
  const counterRef = { value: (level.exits || []).length + 1 };
  const getUncoveredBlocks = () => (level.blocks || []).filter((block) => !getCompatibleExits(level, block).length);

  let guard = 0;
  while (guard < 24) {
    guard += 1;
    const uncoveredBlocks = getUncoveredBlocks();
    if (!uncoveredBlocks.length) {
      break;
    }

    const exitColors = new Set((level.exits || []).map((exit) => exit.acceptColor));
    const missingColors = allowedColors.filter((color) => !exitColors.has(color) && uncoveredBlocks.some((block) => block.style === color));
    const focusColors = missingColors.length ? missingColors : [...new Set(uncoveredBlocks.map((block) => block.style))];
    let bestChoice = null;

    buildExtraExitCandidates(level)
      .filter((candidate) => canAddExit(level, candidate))
      .forEach((candidate) => {
        focusColors.forEach((color) => {
          const coveredBlocks = uncoveredBlocks.filter((block) => block.style === color && candidate.span >= getProjectionLengthForBlock(block, candidate.edge));
          if (!coveredBlocks.length) {
            return;
          }
          const focusBlock = [...coveredBlocks].sort((left, right) => right.shapeCells.length - left.shapeCells.length || left.id.localeCompare(right.id))[0];
          const preview = buildExitPreviewPlacement(level, candidate, color, band, { focusBlock });
          const existingColorExits = (level.exits || []).filter((exit) => exit.acceptColor === color).length;
          let score = preview.score + coveredBlocks.length * 48;
          score += missingColors.includes(color) ? 28 : 0;
          score -= existingColorExits * 10;
          if (coveredBlocks.some((block) => block.shapeCells.length >= 3)) {
            score += 10;
          }
          if (!bestChoice || score > bestChoice.score) {
            bestChoice = { candidate, color, score };
          }
        });
      });

    if (!bestChoice) {
      const fallback = uncoveredBlocks[0] || null;
      if (!fallback || !addCoverageExitForBlock(level, fallback, fallback.style, counterRef, band)) {
        break;
      }
      continue;
    }

    level.exits.push(createExit(`exit-${level.id}-${counterRef.value}`, bestChoice.candidate.edge, bestChoice.candidate.start, bestChoice.candidate.span, bestChoice.color));
    counterRef.value += 1;
  }
}

function extendExits(level, band, allowedColors, rng) {
  const targetGroups = desiredDoorGroups(level, band);
  const targetSlots = desiredDoorSlots(level, band);
  const maxGroups = Math.max(targetGroups, band.doorGroups?.[1] || targetGroups);
  const maxSlots = Math.max(targetSlots, band.doorSlots?.[1] || targetSlots);
  const competitionTarget = band.doorCompetitionMin || 0;
  let metrics = collectDoorMetrics(level);
  let counter = (level.exits || []).length + 1;
  const candidates = shuffle(buildExtraExitCandidates(level), rng).sort((left, right) => left.span - right.span || left.start - right.start);

  while (candidates.length) {
    if (metrics.doorGroupCount >= targetGroups && metrics.doorSlotCount >= targetSlots && metrics.doorCompetitionCount >= competitionTarget) {
      break;
    }
    let bestChoice = null;
    for (const candidate of candidates) {
      if (!canAddExit(level, candidate)) {
        continue;
      }
      if (metrics.doorGroupCount + 1 > maxGroups) {
        continue;
      }
      if (metrics.doorSlotCount + candidate.span > maxSlots) {
        continue;
      }
      const color = chooseColorForExit(level, candidate, allowedColors, band);
      if (!color) {
        continue;
      }
      const preview = buildExitPreviewPlacement(level, candidate, color, band, {
        currentMetrics: metrics,
        targetGroups,
        targetSlots,
        competitionTarget,
      });
      if (!bestChoice || preview.score > bestChoice.preview.score) {
        bestChoice = {
          candidate,
          color,
          preview,
        };
      }
    }
    if (!bestChoice) {
      break;
    }
    level.exits.push(createExit(`exit-${level.id}-${counter}`, bestChoice.candidate.edge, bestChoice.candidate.start, bestChoice.candidate.span, bestChoice.color));
    counter += 1;
    metrics = bestChoice.preview.doorMetrics;
    const index = candidates.findIndex((entry) => entry.edge === bestChoice.candidate.edge && entry.start === bestChoice.candidate.start && entry.span === bestChoice.candidate.span);
    if (index >= 0) {
      candidates.splice(index, 1);
    }
  }
}

function getOccupiedSet(level, ignoreId = '') {
  const set = new Set();
  (level.blocks || []).forEach((block) => {
    if (block.id === ignoreId) {
      return;
    }
    block.shapeCells.forEach((cell) => {
      set.add(`${block.x + cell.x},${block.y + cell.y}`);
    });
  });
  return set;
}

function canPlace(level, block) {
  const occupied = getOccupiedSet(level, block.id);
  for (const cell of block.shapeCells) {
    const x = block.x + cell.x;
    const y = block.y + cell.y;
    if (x < 0 || y < 0 || x >= level.board.cols || y >= level.board.rows) {
      return false;
    }
    if (occupied.has(`${x},${y}`)) {
      return false;
    }
  }
  return true;
}

function buildPriorityPositions(level, rng) {
  const cols = level.board.cols;
  const rows = level.board.rows;
  const centerX = (cols - 1) / 2;
  const centerY = (rows - 1) / 2;
  const positions = [];
  for (let y = 0; y < rows; y += 1) {
    for (let x = 0; x < cols; x += 1) {
      positions.push({
        x,
        y,
        d: Math.abs(x - centerX) + Math.abs(y - centerY),
      });
    }
  }
  const groups = new Map();
  positions.forEach((pos) => {
    const key = pos.d.toFixed(2);
    const list = groups.get(key) || [];
    list.push(pos);
    groups.set(key, list);
  });
  return [...groups.keys()]
    .sort((left, right) => Number(left) - Number(right))
    .flatMap((key) => shuffle(groups.get(key) || [], rng));
}

function getPlacementCandidates(level, shapeKey, shapeVariant, rng, limit = 24) {
  const plan = level.meta?.generatorV3Plan || null;
  const anchors = getGeneratorV3PlacementAnchors(level, { shapeKey, shapeVariant }, rng, plan, { limit });
  if (anchors.length) {
    return anchors;
  }
  return buildPriorityPositions(level, rng).slice(0, limit);
}

function buildGeneratorV3PlanSummary(generatorV3Plan) {
  if (!generatorV3Plan) {
    return null;
  }
  return {
    profileId: generatorV3Plan.contract.profileId,
    motifKey: generatorV3Plan.motif.key,
    contract: generatorV3Plan.contract,
    roleBudget: generatorV3Plan.budgets.roleBudget,
    shapeQuota: generatorV3Plan.budgets.shapeQuota,
    openingActionTarget: generatorV3Plan.budgets.openingActionTarget,
    difficultyScoreTarget: generatorV3Plan.budgets.difficultyScoreTarget,
    dependencySkeleton: generatorV3Plan.dependencySkeleton,
  };
}

function attachGeneratorV3Meta(level, band, generatorV3Plan, extraTags = []) {
  const tags = [...new Set([
    ...(level.meta?.tags || []),
    `segment-${band.segmentKey || 'base'}`,
    'generated',
    'generator-v3',
    `motif-${generatorV3Plan?.motif?.key || 'dense-interlock'}`,
    ...extraTags,
  ])];
  level.meta = {
    ...(level.meta || {}),
    mode: 'campaign',
    difficultyBand: band.difficultyBand || level.meta?.difficultyBand || 'teaching',
    levelInChapter: level.index,
    guideText: '',
    tags,
    generatorV3Plan: buildGeneratorV3PlanSummary(generatorV3Plan),
  };
  return level;
}

function createEmptyGeneratedLevel(chapterNumber, levelIndex, rows, band, generatorV3Plan) {
  const chapterLabel = String(chapterNumber).padStart(2, '0');
  const levelLabel = String(levelIndex).padStart(2, '0');
  const level = {
    id: `c${chapterLabel}-l${levelLabel}`,
    chapter: chapterNumber,
    index: levelIndex,
    title: `${chapterNumber}-${levelLabel}`,
    rewardCoins: 80,
    board: {
      cols: 6,
      rows,
      themeKey: 'toy-workshop',
    },
    exits: [],
    blocks: [],
    tiles: [],
    gates: [],
    meta: {
      mode: 'campaign',
      difficultyBand: band.difficultyBand || 'teaching',
      levelInChapter: levelIndex,
      tags: [],
      guideText: '',
    },
  };
  return attachGeneratorV3Meta(level, band, generatorV3Plan, ['reverse-seed']);
}

function getProjectionSpanForBlock(block, edge) {
  const coords = (block.shapeCells || []).map((cell) => (edge === 'left' || edge === 'right' ? cell.y : cell.x));
  return {
    start: coords.length ? Math.min(...coords) : 0,
    end: coords.length ? Math.max(...coords) + 1 : 0,
  };
}

function getExitClearance(block, exit, board) {
  if (exit.edge === 'left') {
    return block.x;
  }
  if (exit.edge === 'right') {
    return Math.max(0, board.cols - (block.x + block.w));
  }
  if (exit.edge === 'top') {
    return block.y;
  }
  return Math.max(0, board.rows - (block.y + block.h));
}

function getAlignedAnchorsForExit(level, block, exit, buffer = 1) {
  const span = getProjectionSpanForBlock(block, exit.edge);
  const anchors = [];
  const maxOrthStart = exit.start + exit.span - span.end;
  for (let orth = exit.start - span.start; orth <= maxOrthStart; orth += 1) {
    let anchor = null;
    if (exit.edge === 'left') {
      anchor = { x: buffer, y: orth };
    } else if (exit.edge === 'right') {
      anchor = { x: level.board.cols - block.w - buffer, y: orth };
    } else if (exit.edge === 'top') {
      anchor = { x: orth, y: buffer };
    } else {
      anchor = { x: orth, y: level.board.rows - block.h - buffer };
    }
    if (!anchor) {
      continue;
    }
    if (anchor.x < 0 || anchor.y < 0 || anchor.x + block.w > level.board.cols || anchor.y + block.h > level.board.rows) {
      continue;
    }
    anchors.push(anchor);
  }
  return anchors;
}

function getReverseMotifPhaseOrder(generatorV3Plan) {
  const motifKey = generatorV3Plan?.dependencySkeleton?.motifKey || generatorV3Plan?.motif?.key || 'dense-interlock';
  switch (motifKey) {
    case 'corner-yield':
      return [['anchor'], ['gatekeeper'], ['bait', 'filler']];
    case 'shared-door-queue':
    case 'gate-competition':
      return [['anchor', 'gatekeeper'], ['gatekeeper', 'bait'], ['filler']];
    case 'central-knot':
    case 'locked-spine':
      return [['anchor'], ['anchor', 'gatekeeper'], ['gatekeeper', 'bait'], ['filler']];
    case 'hidden-first-clear':
      return [['anchor'], ['bait', 'gatekeeper'], ['filler']];
    case 'phase-split':
      return [['anchor'], ['gatekeeper'], ['bait'], ['filler']];
    default:
      return [['anchor'], ['gatekeeper'], ['bait'], ['filler']];
  }
}

function buildReverseRoleSequence(generatorV3Plan) {
  const roleBudget = generatorV3Plan?.budgets?.roleBudget || { anchor: 2, gatekeeper: 2, filler: 4, bait: 1 };
  const remaining = {
    anchor: roleBudget.anchor || 0,
    gatekeeper: roleBudget.gatekeeper || 0,
    bait: roleBudget.bait || 0,
    filler: roleBudget.filler || 0,
  };
  const phaseRoleOrder = getReverseMotifPhaseOrder(generatorV3Plan);
  const sequence = [];
  let guard = 0;
  while (Object.values(remaining).some((count) => count > 0) && guard < 96) {
    guard += 1;
    let progressed = false;
    phaseRoleOrder.forEach((roles, phaseIndex) => {
      roles.forEach((role) => {
        if ((remaining[role] || 0) <= 0) {
          return;
        }
        sequence.push({ role, phaseIndex });
        remaining[role] -= 1;
        progressed = true;
      });
    });
    if (!progressed) {
      break;
    }
  }
  return sequence;
}

function findPreviousReverseTaskIndex(tasks, startIndex, predicate) {
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    if (predicate(tasks[index], index)) {
      return index;
    }
  }
  return -1;
}

function buildReverseShapeTasks(generatorV3Plan, rng) {
  const quotas = [...(generatorV3Plan?.budgets?.shapeQuota || [])]
    .sort((left, right) => right.minCount - left.minCount || right.targetCount - left.targetCount || right.desiredArea - left.desiredArea || left.shapeKey.localeCompare(right.shapeKey));
  const targetCells = Math.max(1, Math.round((generatorV3Plan?.contract?.targetOccupiedCells || 24) * 0.92));
  const tasks = [];
  const counts = new Map();
  let occupied = 0;

  const pushTask = (entry) => {
    const shapeVariants = shuffle([...(SHAPE_VARIANTS[entry.shapeKey] || ['default'])], rng);
    const preferredVariant = shapeVariants[0] || 'default';
    const area = Math.max(...shapeVariants.map((shapeVariant) => getShapeCells(entry.shapeKey, shapeVariant).length));
    tasks.push({
      shapeKey: entry.shapeKey,
      shapeVariants,
      preferredVariant,
      area,
      weight: entry.targetCount * 100 + entry.minCount * 20 + entry.desiredArea,
    });
    counts.set(entry.shapeKey, (counts.get(entry.shapeKey) || 0) + 1);
    occupied += area;
  };

  quotas.forEach((entry) => {
    for (let index = 0; index < (entry.minCount || 0); index += 1) {
      pushTask(entry);
    }
  });

  let guard = 0;
  while (occupied < targetCells && guard < 180) {
    guard += 1;
    let progressed = false;
    for (const entry of quotas) {
      const used = counts.get(entry.shapeKey) || 0;
      if (used >= Math.max(entry.targetCount || 0, entry.minCount || 0) && occupied >= targetCells * 0.94) {
        continue;
      }
      pushTask(entry);
      progressed = true;
      if (occupied >= targetCells) {
        break;
      }
    }
    if (!progressed) {
      break;
    }
  }

  const skeleton = generatorV3Plan?.dependencySkeleton || {};
  const roleSequence = buildReverseRoleSequence(generatorV3Plan);
  const chainLength = Math.max(1, Math.min(tasks.length, skeleton.mainChainLength || tasks.length));
  const sortedTasks = tasks
    .sort((left, right) => right.area - left.area || right.weight - left.weight || left.shapeKey.localeCompare(right.shapeKey))
    .map((task, index) => {
      const roleEntry = roleSequence[index] || roleSequence[roleSequence.length - 1] || { role: 'filler', phaseIndex: 3 };
      return {
        ...task,
        taskId: `task-${index + 1}`,
        orderIndex: index,
        shapeVariant: task.preferredVariant,
        role: roleEntry.role || 'filler',
        phaseIndex: roleEntry.phaseIndex ?? 0,
        chainIndex: index < chainLength ? index : -1,
        preferReuseExit: roleEntry.role !== 'anchor',
      };
    });

  return sortedTasks.map((task, index, list) => {
    let dependsOnTaskId = null;
    if (task.chainIndex > 0) {
      dependsOnTaskId = list[index - 1]?.taskId || null;
    } else if (task.role === 'gatekeeper') {
      const prevIndex = findPreviousReverseTaskIndex(list, index, (entry) => entry.role === 'anchor' || entry.role === 'gatekeeper');
      dependsOnTaskId = prevIndex >= 0 ? list[prevIndex].taskId : list[0]?.taskId || null;
    } else if (task.role === 'bait') {
      const prevIndex = findPreviousReverseTaskIndex(list, index, (entry) => entry.role === 'gatekeeper' || entry.role === 'anchor');
      dependsOnTaskId = prevIndex >= 0 ? list[prevIndex].taskId : list[0]?.taskId || null;
    } else if (task.role === 'filler' && chainLength > 0) {
      dependsOnTaskId = list[index % chainLength]?.taskId || list[0]?.taskId || null;
    }
    return {
      ...task,
      dependsOnTaskId,
    };
  });
}

function getTaskVariants(task) {
  if (Array.isArray(task?.shapeVariants) && task.shapeVariants.length) {
    return [...new Set(task.shapeVariants)];
  }
  if (task?.shapeVariant) {
    return [task.shapeVariant];
  }
  return [...(SHAPE_VARIANTS[task?.shapeKey] || ['default'])];
}

function createReverseTaskBlock(level, counter, color, task, shapeVariant, x, y) {
  return createBlock({
    id: `rev-${level.id}-${counter}`,
    style: color,
    x,
    y,
    shapeKey: task.shapeKey,
    shapeVariant,
  });
}

function rankTaskVariantsForExit(task, exit, color, rng) {
  return shuffle(getTaskVariants(task), rng)
    .map((shapeVariant) => {
      const probe = createBlock({
        id: 'probe',
        style: color,
        x: 0,
        y: 0,
        shapeKey: task.shapeKey,
        shapeVariant,
      });
      const projection = getProjectionLengthForBlock(probe, exit.edge);
      return {
        shapeVariant,
        projection,
        fits: projection <= exit.span,
        slack: Math.max(0, exit.span - projection),
      };
    })
    .sort((left, right) => Number(right.fits) - Number(left.fits) || left.slack - right.slack || right.projection - left.projection || left.shapeVariant.localeCompare(right.shapeVariant))
    .map((entry) => entry.shapeVariant);
}

function getReversePressure(band) {
  switch (band?.segmentKey) {
    case 'teaching':
    case 'ramp':
      return 0;
    case 'main':
    case 'hard':
      return 1;
    case 'pressure':
    case 'expert':
      return 2;
    case 'climax':
    case 'brutal':
      return 3;
    default:
      return 1;
  }
}

function getReverseBuffersForRole(role, pass = 0, band = null) {
  const pressure = getReversePressure(band);
  const heavyExtra = pressure >= 2 ? 2 : pressure >= 1 ? 1 : 0;
  const lightExtra = pressure >= 2 ? 1 : 0;
  switch (role) {
    case 'anchor':
      return pass > 0 ? [2 + heavyExtra, 3 + heavyExtra, 4 + heavyExtra, 5 + heavyExtra] : [2 + heavyExtra, 3 + heavyExtra, 4 + heavyExtra];
    case 'gatekeeper':
      return pass > 0 ? [2 + heavyExtra, 3 + heavyExtra, 4 + heavyExtra, 5 + heavyExtra] : [2 + heavyExtra, 3 + heavyExtra, 4 + heavyExtra];
    case 'bait':
      return pass > 0 ? [1 + lightExtra, 2 + lightExtra, 3 + lightExtra] : [1 + lightExtra, 2 + lightExtra];
    default:
      return pass > 0 ? [1 + lightExtra, 2 + lightExtra, 3 + lightExtra, 4 + lightExtra] : [2 + lightExtra, 3 + lightExtra, 4 + lightExtra];
  }
}

function getReverseRoleWeights(task, band = null) {
  const pressure = getReversePressure(band);
  const weights = {
    clearance: 108,
    adjacency: 26,
    flex: 16,
    centerPenalty: 8,
    overlap: 24,
    gapPenalty: 12,
  };
  switch (task?.role) {
    case 'anchor':
      weights.clearance = 144;
      weights.adjacency = 22;
      weights.flex = 18;
      weights.centerPenalty = 10;
      weights.overlap = 18;
      break;
    case 'gatekeeper':
      weights.clearance = 132;
      weights.adjacency = 30;
      weights.flex = 18;
      weights.centerPenalty = 7;
      weights.overlap = 42;
      weights.gapPenalty = 18;
      break;
    case 'bait':
      weights.clearance = 96;
      weights.adjacency = 20;
      weights.flex = 14;
      weights.centerPenalty = 5;
      weights.overlap = 34;
      weights.gapPenalty = 10;
      break;
    default:
      weights.clearance = 116;
      weights.adjacency = 28;
      weights.flex = 16;
      weights.centerPenalty = 7;
      weights.overlap = 26;
      break;
  }
  if ((task?.chainIndex || -1) >= 0) {
    weights.clearance += 10;
    weights.overlap += 8;
  }
  if ((task?.phaseIndex || 0) === 0) {
    weights.clearance += 6;
  }
  if (pressure > 0) {
    weights.clearance += pressure * 16;
    weights.adjacency += pressure * 5;
    weights.overlap += pressure * 6;
    weights.gapPenalty += pressure * 2;
    weights.flex -= pressure >= 2 ? pressure * 12 : pressure * 4;
    if (pressure >= 2) {
      weights.centerPenalty += 1;
    }
  }
  return weights;
}

function getBlockBounds(block) {
  const xs = block.shapeCells.map((cell) => block.x + cell.x);
  const ys = block.shapeCells.map((cell) => block.y + cell.y);
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

function getBoundsGap(leftBlock, rightBlock) {
  const left = getBlockBounds(leftBlock);
  const right = getBlockBounds(rightBlock);
  const gapX = right.minX > left.maxX ? right.minX - left.maxX - 1 : left.minX > right.maxX ? left.minX - right.maxX - 1 : 0;
  const gapY = right.minY > left.maxY ? right.minY - left.maxY - 1 : left.minY > right.maxY ? left.minY - right.maxY - 1 : 0;
  return gapX + gapY;
}

function getBoundsOverlapOnExitAxis(leftBlock, rightBlock, edge) {
  const left = getBlockBounds(leftBlock);
  const right = getBlockBounds(rightBlock);
  if (edge === 'left' || edge === 'right') {
    return Math.max(0, Math.min(left.maxY, right.maxY) - Math.max(left.minY, right.minY) + 1);
  }
  return Math.max(0, Math.min(left.maxX, right.maxX) - Math.max(left.minX, right.minX) + 1);
}

function getReverseDependencyReference(task, placedTaskMeta, level) {
  const dependencyMeta = task?.dependsOnTaskId ? placedTaskMeta.get(task.dependsOnTaskId) : null;
  if (!dependencyMeta) {
    return { dependencyMeta: null, dependencyBlock: null };
  }
  const dependencyBlock = (level.blocks || []).find((entry) => entry.id === dependencyMeta.blockId) || null;
  return { dependencyMeta, dependencyBlock };
}



function getReverseAnchorMiniFirstClearLimit(band, pass = 0) {
  const pressure = getReversePressure(band);
  if (pressure >= 3 && pass === 0) {
    return 1;
  }
  return 0;
}

function scoreReverseAnchorMiniFirstClear(previewLevel, previewBlock, band) {
  const pressure = getReversePressure(band);
  const report = validateFirstClear(previewLevel, {
    firstClearMaxStates: pressure >= 3 ? 56 : 40,
    firstClearMaxRoutes: 1,
    firstClearDepthSlack: 0,
    firstClearRouteFamilyCap: 1,
  });
  let score = 0;
  if (!report.isFirstClearReachable) {
    score -= 120;
    return score;
  }
  const previewIsFirstClear = report.firstClearBlockId === previewBlock.id;
  if (previewIsFirstClear) {
    score -= 80 + (previewBlock.shapeCells.length * 12);
    if ((report.bestFirstClearSetupDepth ?? 99) <= 1) {
      score -= 120;
    } else if ((report.bestFirstClearSetupDepth ?? 99) === 2) {
      score -= 54;
    }
    if ((report.bestFirstClearDepth ?? 99) <= 2) {
      score -= 64;
    }
  }
  if ((report.bestFirstClearSetupDepth ?? 99) <= 1) {
    score -= 42 + (pressure * 10);
  }
  if ((report.firstClearArea || 0) < Math.min(3, previewBlock.shapeCells.length)) {
    score -= 18 + (pressure * 4);
  }
  if ((report.firstClearReleaseGain || 0) < (pressure >= 2 ? 20 : 14)) {
    score -= 24 + (pressure * 6);
  }
  return score;
}

function getReverseAnchorRefineLimit(band, pass = 0) {
  const pressure = getReversePressure(band);
  if (pressure >= 3) {
    return pass > 0 ? 5 : 4;
  }
  if (pressure >= 2) {
    return pass > 0 ? 3 : 2;
  }
  if (pressure >= 1) {
    return pass > 0 ? 2 : 1;
  }
  return 1;
}


function countBlocksCompatibleWithExit(level, exit) {
  return (level.blocks || []).reduce((sum, block) => {
    if (block.style !== exit.acceptColor) {
      return sum;
    }
    return sum + Number(exit.span >= getProjectionLengthForBlock(block, exit.edge));
  }, 0);
}


function estimateBlockQuickExitSetupRisk(level, block) {
  const exits = getCompatibleExits(level, block);
  let directRoutes = 0;
  let oneStepRoutes = 0;
  let twoStepRoutes = 0;
  let bestSetupDepth = Number.POSITIVE_INFINITY;

  exits.forEach((exit) => {
    [0, 1, 2].forEach((buffer) => {
      const anchors = getAlignedAnchorsForExit(level, block, exit, buffer);
      const hasRoute = anchors.some((anchor) => {
        if (anchor.x === block.x && anchor.y === block.y) {
          return true;
        }
        const moved = { ...block, x: anchor.x, y: anchor.y };
        return canPlace(level, moved);
      });
      if (!hasRoute) {
        return;
      }
      bestSetupDepth = Math.min(bestSetupDepth, buffer);
      if (buffer === 0) {
        directRoutes += 1;
      } else if (buffer === 1) {
        oneStepRoutes += 1;
      } else {
        twoStepRoutes += 1;
      }
    });
  });

  return {
    bestSetupDepth: Number.isFinite(bestSetupDepth) ? bestSetupDepth : null,
    directRoutes,
    oneStepRoutes,
    twoStepRoutes,
  };
}


function collectQuickExitRiskProbeBlocks(level, excludedBlockId = '', options = {}) {
  const sampleLimit = Number.isFinite(options.sampleLimit) ? Math.max(1, Math.floor(options.sampleLimit)) : Infinity;
  return (level.blocks || [])
    .filter((block) => block.id !== excludedBlockId)
    .map((block) => ({
      block,
      area: block.shapeCells.length,
      clearance: getBlockBestExitClearance(level, block) ?? 99,
      exitCount: getCompatibleExits(level, block).length,
    }))
    .filter((entry) => entry.exitCount > 0)
    .sort((left, right) => left.clearance - right.clearance
      || Number(right.area >= 3) - Number(left.area >= 3)
      || right.area - left.area
      || left.exitCount - right.exitCount
      || left.block.id.localeCompare(right.block.id))
    .slice(0, sampleLimit)
    .map((entry) => entry.block);
}

function estimateOtherBlocksQuickExitRisk(level, excludedBlockId = '', options = {}) {
  const summary = {
    directCount: 0,
    oneStepCount: 0,
    twoStepCount: 0,
    largeQuickCount: 0,
    routeCount: 0,
    bestSetupDepth: null,
    bestBlockId: '',
    bestBlockArea: 0,
  };
  collectQuickExitRiskProbeBlocks(level, excludedBlockId, options).forEach((block) => {
    const risk = estimateBlockQuickExitSetupRisk(level, block);
    if (risk.bestSetupDepth === null) {
      return;
    }
    if (summary.bestSetupDepth === null
      || risk.bestSetupDepth < summary.bestSetupDepth
      || (risk.bestSetupDepth === summary.bestSetupDepth && block.shapeCells.length > summary.bestBlockArea)) {
      summary.bestSetupDepth = risk.bestSetupDepth;
      summary.bestBlockId = block.id;
      summary.bestBlockArea = block.shapeCells.length;
    }
    if (risk.directRoutes > 0) {
      summary.directCount += 1;
    }
    if (risk.directRoutes > 0 || risk.oneStepRoutes > 0) {
      summary.oneStepCount += 1;
    }
    if (risk.directRoutes > 0 || risk.oneStepRoutes > 0 || risk.twoStepRoutes > 0) {
      summary.twoStepCount += 1;
    }
    if (block.shapeCells.length >= 3 && (risk.bestSetupDepth ?? 99) <= 1) {
      summary.largeQuickCount += 1;
    }
    summary.routeCount += (risk.directRoutes || 0) + (risk.oneStepRoutes || 0) + (risk.twoStepRoutes || 0);
  });
  return summary;
}

function getReverseOtherRiskSampleLimit(band, blockArea = 0) {
  const pressure = getReversePressure(band);
  if (pressure >= 3) {
    return blockArea >= 3 ? 6 : 3;
  }
  if (pressure >= 2) {
    return blockArea >= 3 ? 4 : 0;
  }
  return 0;
}

function scoreReverseAnchorPreview(level, previewBlock, exit, band, baseDoorMetrics, baseOpeningMetrics, baseOtherRisk = null) {
  const pressure = getReversePressure(band);
  const previewLevel = {
    ...level,
    blocks: [...(level.blocks || []), previewBlock],
  };
  const nextDoorMetrics = collectDoorMetrics(previewLevel);
  const nextOpeningMetrics = collectOpeningStaticMetrics(previewLevel);
  const firstClearProfile = getFirstClearTargetProfile(band);
  const clearance = getExitClearance(previewBlock, exit, level.board);
  const previewFlex = getCompatibleExits(previewLevel, previewBlock).length;
  const quickExitRisk = estimateBlockQuickExitSetupRisk(previewLevel, previewBlock);
  const otherRiskSampleLimit = getReverseOtherRiskSampleLimit(band, previewBlock.shapeCells.length);
  const openingOtherRisk = otherRiskSampleLimit > 0
    ? (baseOtherRisk || estimateOtherBlocksQuickExitRisk(level, previewBlock.id, { sampleLimit: otherRiskSampleLimit }))
    : { directCount: 0, oneStepCount: 0, twoStepCount: 0, largeQuickCount: 0, routeCount: 0, bestSetupDepth: null, bestBlockId: '', bestBlockArea: 0 };
  const nextOtherRisk = otherRiskSampleLimit > 0
    ? estimateOtherBlocksQuickExitRisk(previewLevel, previewBlock.id, { sampleLimit: otherRiskSampleLimit })
    : openingOtherRisk;
  const directClearDelta = (nextOpeningMetrics.directClearCount || 0) - (baseOpeningMetrics?.directClearCount || 0);
  const directLargeClearDelta = (nextOpeningMetrics.directLargeClearCount || 0) - (baseOpeningMetrics?.directLargeClearCount || 0);
  const largeNearExitDelta = (nextOpeningMetrics.openingLargeBlockNearExitCount || 0) - (baseOpeningMetrics?.openingLargeBlockNearExitCount || 0);
  const matchingEdgeTouchDelta = (nextOpeningMetrics.matchingEdgeTouchCount || 0) - (baseOpeningMetrics?.matchingEdgeTouchCount || 0);
  const avgDistanceDelta = (nextOpeningMetrics.averageBestExitDistance || 0) - (baseOpeningMetrics?.averageBestExitDistance || 0);
  const openingBandDelta = distanceToBand(nextOpeningMetrics.openingActionCountRaw, firstClearProfile.openingActionBand)
    - distanceToBand(baseOpeningMetrics?.openingActionCountRaw, firstClearProfile.openingActionBand);
  const competitionDelta = (nextDoorMetrics.doorCompetitionCount || 0) - (baseDoorMetrics?.doorCompetitionCount || 0);
  const exitLoadDelta = countBlocksCompatibleWithExit(previewLevel, exit) - countBlocksCompatibleWithExit(level, exit);
  const otherDirectDelta = (nextOtherRisk.directCount || 0) - (openingOtherRisk.directCount || 0);
  const otherOneStepDelta = (nextOtherRisk.oneStepCount || 0) - (openingOtherRisk.oneStepCount || 0);
  const otherTwoStepDelta = (nextOtherRisk.twoStepCount || 0) - (openingOtherRisk.twoStepCount || 0);
  const otherLargeQuickDelta = (nextOtherRisk.largeQuickCount || 0) - (openingOtherRisk.largeQuickCount || 0);
  const otherRouteDelta = (nextOtherRisk.routeCount || 0) - (openingOtherRisk.routeCount || 0);
  let score = 0;
  score += competitionDelta * (28 + (pressure * 12));
  score += Math.max(0, exitLoadDelta) * (18 + (pressure * 8));
  score += Math.max(0, avgDistanceDelta) * (14 + (pressure * 4));
  score += Math.min(6, clearance) * (18 + (pressure * 6));
  score -= Math.max(0, directClearDelta) * (88 + (pressure * 16));
  score -= Math.max(0, directLargeClearDelta) * (72 + (pressure * 14));
  score -= Math.max(0, largeNearExitDelta) * (56 + (pressure * 12));
  score -= Math.max(0, matchingEdgeTouchDelta) * (34 + (pressure * 8));
  score -= Math.max(0, openingBandDelta) * (18 + (pressure * 4));
  score -= Math.max(0, otherDirectDelta) * (92 + (pressure * 18));
  score -= Math.max(0, otherOneStepDelta) * (52 + (pressure * 14));
  score -= Math.max(0, otherTwoStepDelta) * (24 + (pressure * 8));
  score -= Math.max(0, otherLargeQuickDelta) * (64 + (pressure * 16));
  score -= Math.max(0, otherRouteDelta) * (10 + (pressure * 4));
  if ((nextOtherRisk.bestSetupDepth ?? 99) <= 1) {
    score -= 28 + (pressure * 8) + ((nextOtherRisk.bestBlockArea || 0) >= 3 ? 36 : 0);
  }
  score -= (quickExitRisk.directRoutes || 0) * (110 + (pressure * 26));
  score -= (quickExitRisk.oneStepRoutes || 0) * (64 + (pressure * 18));
  score -= (quickExitRisk.twoStepRoutes || 0) * (28 + (pressure * 10));
  if (quickExitRisk.bestSetupDepth === 0) {
    score -= 140;
  } else if (quickExitRisk.bestSetupDepth === 1) {
    score -= 72;
  } else if (quickExitRisk.bestSetupDepth === 2) {
    score -= 28;
  }
  if (clearance === 0) {
    score -= 140;
  } else if (clearance === 1) {
    score -= 68;
  } else if (clearance === 2 && pressure >= 2) {
    score -= 22;
  }
  if (previewBlock.shapeCells.length >= 3 && (clearance <= 1 || (quickExitRisk.bestSetupDepth ?? 99) <= 1)) {
    score -= 96;
  }
  if (previewFlex > (pressure >= 2 ? 1 : 2)) {
    score -= (previewFlex - (pressure >= 2 ? 1 : 2)) * (12 + (pressure * 4));
  }
  return score;
}

function rankReverseAnchorsForTask(level, prototype, exit, task, placedTaskMeta, rng, pass = 0, band = null) {
  const weights = getReverseRoleWeights(task, band);
  const { dependencyBlock } = getReverseDependencyReference(task, placedTaskMeta, level);
  const candidates = new Map();
  getReverseBuffersForRole(task.role, pass, band).forEach((buffer, bufferIndex) => {
    shuffle(getAlignedAnchorsForExit(level, prototype, exit, buffer), rng).forEach((anchor, orderIndex) => {
      const key = `${anchor.x},${anchor.y}`;
      if (!candidates.has(key)) {
        candidates.set(key, { anchor, buffer, bufferIndex, orderIndex });
      }
    });
  });

  const baseDoorMetrics = collectDoorMetrics(level);
  const baseOpeningMetrics = collectOpeningStaticMetrics(level);
  const ranked = [...candidates.values()]
    .map((entry) => {
      const preview = { ...prototype, x: entry.anchor.x, y: entry.anchor.y };
      const clearance = getExitClearance(preview, exit, level.board);
      const adjacency = getBlockAdjacencyScore(level, preview);
      const flex = getCompatibleExits(level, preview).length;
      const centerDistance = getBlockCenterDistance(level, preview);
      let score = clearance * weights.clearance + adjacency * weights.adjacency + flex * weights.flex - centerDistance * weights.centerPenalty - entry.bufferIndex * 6 - entry.orderIndex;
      if (dependencyBlock) {
        const overlap = getBoundsOverlapOnExitAxis(preview, dependencyBlock, exit.edge);
        const gap = getBoundsGap(preview, dependencyBlock);
        score += overlap * weights.overlap - gap * weights.gapPenalty;
      }
      return {
        ...entry,
        preview,
        score,
      };
    })
    .sort((left, right) => right.score - left.score || left.bufferIndex - right.bufferIndex || left.orderIndex - right.orderIndex);

  const refineLimit = getReverseAnchorRefineLimit(band, pass);
  const baseOtherRiskSampleLimit = getReversePressure(band) >= 3 ? 6 : getReversePressure(band) >= 2 ? 4 : 0;
  const baseOtherRisk = baseOtherRiskSampleLimit > 0
    ? estimateOtherBlocksQuickExitRisk(level, '', { sampleLimit: baseOtherRiskSampleLimit })
    : null;
  ranked.slice(0, refineLimit).forEach((entry) => {
    if (!canPlace(level, entry.preview) || !hasCompatibleExit(level, entry.preview)) {
      entry.score -= 999;
      return;
    }
    entry.score += scoreReverseAnchorPreview(level, entry.preview, exit, band, baseDoorMetrics, baseOpeningMetrics, baseOtherRisk);
  });

  const miniFirstClearLimit = getReverseAnchorMiniFirstClearLimit(band, pass);
  ranked.slice(0, miniFirstClearLimit).forEach((entry) => {
    if (!canPlace(level, entry.preview) || !hasCompatibleExit(level, entry.preview)) {
      return;
    }
    const previewLevel = {
      ...level,
      blocks: [...(level.blocks || []), entry.preview],
    };
    entry.score += scoreReverseAnchorMiniFirstClear(previewLevel, entry.preview, band);
  });

  return ranked
    .sort((left, right) => right.score - left.score || left.bufferIndex - right.bufferIndex || left.orderIndex - right.orderIndex)
    .map((entry) => ({
      anchor: entry.anchor,
      buffer: entry.buffer,
      bufferIndex: entry.bufferIndex,
      orderIndex: entry.orderIndex,
      score: entry.score,
    }));
}

function rankReverseExitsForTask(exits, task, exitLoadCounts, placedTaskMeta, rng, band = null) {
  const pressure = getReversePressure(band);
  const { dependencyMeta } = getReverseDependencyReference(task, placedTaskMeta, { blocks: [] });
  return shuffle(exits, rng)
    .map((exit) => {
      const load = exitLoadCounts.get(exit.id) || 0;
      let score = task?.preferReuseExit ? load * (22 + (pressure * 10)) : load * (-10 + (pressure * 4));
      score += (4 - Math.min(4, exit.span)) * (pressure >= 2 ? 10 : 4);
      score += exit.span * (task?.role === 'anchor' ? 8 : task?.role === 'bait' ? -2 : 4);
      if (load > 0) {
        score += 12 + (pressure * 8);
      }
      if (dependencyMeta) {
        if (exit.id === dependencyMeta.exitId) {
          score += task?.preferReuseExit ? 72 + (pressure * 18) : -16 + (pressure * 4);
        }
        if (exit.edge === dependencyMeta.edge) {
          score += 18 + (pressure * 4);
        }
      }
      if (task?.role === 'bait' && exit.span === 1) {
        score += 12;
      }
      if (task?.role === 'anchor' && exit.span >= 2) {
        score += 8;
      }
      return { exit, score };
    })
    .sort((left, right) => right.score - left.score || right.exit.span - left.exit.span || left.exit.start - right.exit.start)
    .map((entry) => entry.exit);
}

function buildReverseColorSnapshot(level, allowedColors) {
  const exitCounts = new Map(allowedColors.map((color) => [color, 0]));
  (level.exits || []).forEach((exit) => {
    exitCounts.set(exit.acceptColor, (exitCounts.get(exit.acceptColor) || 0) + 1);
  });
  const blockCounts = new Map(allowedColors.map((color) => [color, 0]));
  (level.blocks || []).forEach((block) => {
    blockCounts.set(block.style, (blockCounts.get(block.style) || 0) + 1);
  });
  return { exitCounts, blockCounts };
}

function buildReverseColorPriority(level, allowedColors, rng) {
  const { exitCounts, blockCounts } = buildReverseColorSnapshot(level, allowedColors);
  return shuffle(allowedColors, rng).sort((left, right) => {
    const leftScore = (blockCounts.get(left) || 0) * 4 - (exitCounts.get(left) || 0) * 2;
    const rightScore = (blockCounts.get(right) || 0) * 4 - (exitCounts.get(right) || 0) * 2;
    return leftScore - rightScore || left.localeCompare(right);
  });
}

function buildTaskColorPriority(task, level, allowedColors, placedTaskMeta, rng, band = null) {
  const pressure = getReversePressure(band);
  const { exitCounts, blockCounts } = buildReverseColorSnapshot(level, allowedColors);
  const { dependencyMeta } = getReverseDependencyReference(task, placedTaskMeta, level);
  const largeTask = (task?.area || 0) >= 3;
  return shuffle(allowedColors, rng)
    .map((color) => {
      const blockCount = blockCounts.get(color) || 0;
      const exitCount = exitCounts.get(color) || 0;
      const congestionScore = blockCount / Math.max(1, exitCount || 1);
      let score = 0;
      if (task?.role === 'anchor') {
        score += exitCount * 14 - blockCount * 10;
        if (!blockCount) {
          score += 10;
        }
        if (dependencyMeta?.color === color) {
          score -= 26;
        }
      } else {
        score += blockCount * 12 + exitCount * 4 + congestionScore * (10 + (pressure * 6));
        if (dependencyMeta?.color === color) {
          score += 54;
        }
      }
      if ((task?.chainIndex || -1) >= 0 && dependencyMeta?.color === color) {
        score += 20;
      }
      if (task?.role === 'bait' && exitCount > 0) {
        score += 8;
      }
      if (pressure >= 2 && exitCount > 0) {
        score += 10 + (congestionScore * 8);
      }
      if (pressure >= 2 && task?.role !== 'anchor' && exitCount === 0) {
        score -= 18;
      }
      if (largeTask && pressure >= 2) {
        score -= exitCount * (18 + (pressure * 4));
        if (exitCount <= 1) {
          score += 24;
        }
      }
      return { color, score };
    })
    .sort((left, right) => right.score - left.score || left.color.localeCompare(right.color))
    .map((entry) => entry.color);
}


function getReversePlacementBudget(level, task, band = null, pass = 0, allowedColorCount = 0) {
  const pressure = getReversePressure(band);
  const boardCells = Math.max(1, (level.board?.cols || 0) * (level.board?.rows || 0));
  const targetOccupied = Math.ceil(boardCells * (band?.occupancy?.[0] || 0.72));
  const occupied = occupiedCells(level);
  const occupancyRatio = occupied / boardCells;
  const shortfall = Math.max(0, targetOccupied - occupied);
  const gapBoost = shortfall >= Math.max(8, Math.round(targetOccupied * 0.18)) ? 1 : 0;
  const deepBoost = shortfall >= Math.max(12, Math.round(targetOccupied * 0.28)) ? 1 : 0;
  const pressureBoost = pressure >= 2 ? 1 : 0;
  const aggressiveBoost = pass >= 2 ? 1 + (pass - 2) : 0;
  return {
    colorLimit: Math.max(1, Math.min(allowedColorCount || 1, (pass > 0 ? allowedColorCount : Math.min(3, allowedColorCount)) + gapBoost)),
    exitLimit: (pass > 0 ? 4 : 2) + pressureBoost + aggressiveBoost,
    variantLimit: (pass > 0 ? 3 : 2) + gapBoost,
    anchorLimit: (pass > 0 ? 14 : 8) + (gapBoost * 4) + (deepBoost * 4) + (pressureBoost * 2) + (aggressiveBoost * 4),
    placementLimit: (task.role === 'anchor' || task.role === 'gatekeeper'
      ? (pass > 0 ? 26 : 18)
      : (pass > 0 ? 20 : 12)) + (gapBoost * 6) + (deepBoost * 6) + (pressureBoost * 4) + (aggressiveBoost * 6),
    occupancyRatio,
  };
}

function buildReverseExitLayout(level, generatorV3Plan, allowedColors, rng, band = null) {
  const targetGroups = generatorV3Plan?.contract?.doorGroupsTarget || allowedColors.length;
  const targetSlots = generatorV3Plan?.contract?.doorSlotsTarget || Math.max(targetGroups, allowedColors.length * 2);
  const maxGroups = Math.max(targetGroups, band?.doorGroups?.[1] || targetGroups);
  const maxSlots = Math.max(targetSlots, band?.doorSlots?.[1] || targetSlots);
  const candidates = shuffle(buildExtraExitCandidates(level), rng);
  const exitCounts = new Map(allowedColors.map((color) => [color, 0]));
  let counter = 1;
  let slotsUsed = 0;
  const preferredEdges = shuffle(['left', 'right', 'top', 'bottom'], rng);
  const pressure = getReversePressure(band);

  const derivePreferredSpan = (remainingGroups, remainingSlots) => {
    if (remainingGroups <= 0) {
      return pressure >= 2 ? 1 : 2;
    }
    return Math.max(1, Math.min(3, Math.ceil(remainingSlots / Math.max(1, remainingGroups))));
  };

  const pickCandidate = (color, preferredSpan = 2) => {
    const spanOrder = [...new Set([preferredSpan, 2, 3, 1])];
    const ranked = candidates
      .filter((candidate) => canAddExit(level, candidate))
      .map((candidate) => {
        const edgeBias = preferredEdges.length - preferredEdges.indexOf(candidate.edge);
        const centerDistance = getExitCenterDistance(level, candidate);
        let score = edgeBias * 3 - centerDistance * (4 + (pressure * 2));
        score -= Math.abs(candidate.span - preferredSpan) * 10;
        if ((candidate.edge === 'top' || candidate.edge === 'bottom') && level.board.rows > level.board.cols) {
          score += 6 + (pressure * 4);
        }
        score -= (exitCounts.get(color) || 0) * 10;
        if ((exitCounts.get(color) || 0) === 0) {
          score += 12;
        }
        if (spanOrder.includes(candidate.span)) {
          score += Math.max(0, 18 - (spanOrder.indexOf(candidate.span) * 6));
        }
        return { candidate, score };
      })
      .sort((left, right) => right.score - left.score || right.candidate.span - left.candidate.span || left.candidate.start - right.candidate.start);
    const picked = ranked[0]?.candidate || null;
    if (!picked) {
      return null;
    }
    candidates.splice(candidates.indexOf(picked), 1);
    return picked;
  };

  allowedColors.forEach((color) => {
    if (level.exits.length >= maxGroups) {
      return;
    }
    const remainingGroups = Math.max(1, maxGroups - level.exits.length);
    const remainingSlots = Math.max(1, targetSlots - slotsUsed);
    const preferredSpan = derivePreferredSpan(remainingGroups, remainingSlots);
    const candidate = pickCandidate(color, preferredSpan);
    if (!candidate) {
      return;
    }
    level.exits.push(createExit(`exit-${level.id}-${counter}`, candidate.edge, candidate.start, candidate.span, color));
    counter += 1;
    exitCounts.set(color, (exitCounts.get(color) || 0) + 1);
    slotsUsed += candidate.span;
  });

  while ((level.exits.length < targetGroups || slotsUsed < targetSlots) && level.exits.length < maxGroups && slotsUsed < maxSlots) {
    const color = [...allowedColors].sort((left, right) => (exitCounts.get(left) || 0) - (exitCounts.get(right) || 0) || left.localeCompare(right))[0];
    const remainingGroups = Math.max(1, maxGroups - level.exits.length);
    const remainingSlots = Math.max(1, targetSlots - slotsUsed);
    const preferredSpan = derivePreferredSpan(remainingGroups, remainingSlots);
    const candidate = pickCandidate(color, preferredSpan);
    if (!candidate) {
      break;
    }
    level.exits.push(createExit(`exit-${level.id}-${counter}`, candidate.edge, candidate.start, candidate.span, color));
    counter += 1;
    exitCounts.set(color, (exitCounts.get(color) || 0) + 1);
    slotsUsed += candidate.span;
  }

  level.exits = normalizeExitLayout(level.exits || []);
  return level;
}

function getReverseTargetOccupiedCells(level, band, generatorV3Plan) {
  const bandMin = Math.ceil(level.board.cols * level.board.rows * (band.occupancy?.[0] || 0.72));
  const contractTarget = generatorV3Plan?.contract?.targetOccupiedCells || bandMin;
  return Math.max(bandMin, Math.round(contractTarget * 0.94));
}

function sortReverseTaskQueue(tasks) {
  return [...tasks].sort((left, right) => {
    if ((left.phaseIndex || 0) !== (right.phaseIndex || 0)) {
      return (left.phaseIndex || 0) - (right.phaseIndex || 0);
    }
    if ((left.chainIndex || -1) !== (right.chainIndex || -1)) {
      if ((left.chainIndex || -1) < 0) {
        return 1;
      }
      if ((right.chainIndex || -1) < 0) {
        return -1;
      }
      return (left.chainIndex || 0) - (right.chainIndex || 0);
    }
    return right.area - left.area || left.orderIndex - right.orderIndex;
  });
}

function tryPlaceReverseTask(level, task, counterRef, assignments, allowedColors, exitLoadCounts, placedTaskMeta, rng, pass = 0, band = null) {
  const budget = getReversePlacementBudget(level, task, band, pass, allowedColors.length);
  const colorLimit = budget.colorLimit;
  const exitLimit = budget.exitLimit;
  const variantLimit = budget.variantLimit;
  const anchorLimit = budget.anchorLimit;
  const placementLimit = budget.placementLimit;
  const colors = buildTaskColorPriority(task, level, allowedColors, placedTaskMeta, rng, band).slice(0, colorLimit);

  for (const color of colors) {
    const exits = rankReverseExitsForTask((level.exits || []).filter((exit) => exit.acceptColor === color), task, exitLoadCounts, placedTaskMeta, rng, band).slice(0, exitLimit);
    for (const exit of exits) {
      const variants = rankTaskVariantsForExit(task, exit, color, rng).slice(0, variantLimit);
      for (const shapeVariant of variants) {
        const prototype = createReverseTaskBlock(level, counterRef.value, color, task, shapeVariant, 0, 0);
        if (getProjectionLengthForBlock(prototype, exit.edge) > exit.span) {
          continue;
        }
        const anchors = rankReverseAnchorsForTask(level, prototype, exit, task, placedTaskMeta, rng, pass, band).slice(0, anchorLimit);
        for (const entry of anchors) {
          const block = { ...prototype, x: entry.anchor.x, y: entry.anchor.y };
          if (!canPlace(level, block) || !hasCompatibleExit(level, block)) {
            continue;
          }
          level.blocks.push(block);
          assignments.push({
            blockId: block.id,
            exitId: exit.id,
            shapeKey: task.shapeKey,
            shapeVariant,
            role: task.role,
            phaseIndex: task.phaseIndex,
            chainIndex: task.chainIndex,
          });
          exitLoadCounts.set(exit.id, (exitLoadCounts.get(exit.id) || 0) + 1);
          placedTaskMeta.set(task.taskId, {
            taskId: task.taskId,
            blockId: block.id,
            exitId: exit.id,
            edge: exit.edge,
            color,
            role: task.role,
            phaseIndex: task.phaseIndex,
            chainIndex: task.chainIndex,
          });
          counterRef.value += 1;
          return true;
        }
      }
    }
  }

  for (const color of colors) {
    const positions = getPlacementCandidates(level, task.shapeKey, task.preferredVariant || task.shapeVariant || 'default', rng, placementLimit);
    for (const pos of positions) {
      const variants = shuffle(getTaskVariants(task), rng).slice(0, variantLimit + (pass > 0 ? 1 : 0));
      for (const shapeVariant of variants) {
        const block = createReverseTaskBlock(level, counterRef.value, color, task, shapeVariant, pos.x, pos.y);
        if (!canPlace(level, block) || !hasCompatibleExit(level, block)) {
          continue;
        }
        const compatibleExits = rankReverseExitsForTask(getCompatibleExits(level, block), task, exitLoadCounts, placedTaskMeta, rng, band);
        const exit = compatibleExits[0] || null;
        if (!exit) {
          continue;
        }
        level.blocks.push(block);
        assignments.push({
          blockId: block.id,
          exitId: exit.id,
          shapeKey: task.shapeKey,
          shapeVariant,
          role: task.role,
          phaseIndex: task.phaseIndex,
          chainIndex: task.chainIndex,
        });
        exitLoadCounts.set(exit.id, (exitLoadCounts.get(exit.id) || 0) + 1);
        placedTaskMeta.set(task.taskId, {
          taskId: task.taskId,
          blockId: block.id,
          exitId: exit.id,
          edge: exit.edge,
          color,
          role: task.role,
          phaseIndex: task.phaseIndex,
          chainIndex: task.chainIndex,
        });
        counterRef.value += 1;
        return true;
      }
    }
  }
  return false;
}

function getBlockAdjacencyScore(level, block) {
  const occupied = getOccupiedSet(level, block.id);
  const touched = new Set();
  for (const cell of block.shapeCells) {
    const x = block.x + cell.x;
    const y = block.y + cell.y;
    [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ].forEach(([dx, dy]) => {
      const key = `${x + dx},${y + dy}`;
      if (occupied.has(key)) {
        touched.add(key);
      }
    });
  }
  return touched.size;
}

function getBlockCenterDistance(level, block) {
  const centerX = (level.board.cols - 1) / 2;
  const centerY = (level.board.rows - 1) / 2;
  let sumX = 0;
  let sumY = 0;
  for (const cell of block.shapeCells) {
    sumX += block.x + cell.x;
    sumY += block.y + cell.y;
  }
  const count = Math.max(1, block.shapeCells.length);
  const avgX = sumX / count;
  const avgY = sumY / count;
  return Math.abs(avgX - centerX) + Math.abs(avgY - centerY);
}

function buildReverseAssignmentsFromLevel(level, rng) {
  const exitLoadCounts = new Map();
  const roleBudget = level.meta?.generatorV3Plan?.roleBudget || { anchor: 2, gatekeeper: 2, filler: 6, bait: 1 };
  const dependencySkeleton = level.meta?.generatorV3Plan?.dependencySkeleton || { mainChainLength: 5 };
  const raw = (level.blocks || []).map((block) => {
    const exits = shuffle(getCompatibleExits(level, block), rng).sort((left, right) => {
      const loadDelta = (exitLoadCounts.get(right.id) || 0) - (exitLoadCounts.get(left.id) || 0);
      if (loadDelta) {
        return loadDelta;
      }
      return left.span - right.span || left.start - right.start;
    });
    const exit = exits[0] || null;
    if (exit) {
      exitLoadCounts.set(exit.id, (exitLoadCounts.get(exit.id) || 0) + 1);
    }
    const clearance = exit ? getExitClearance(block, exit, level.board) : 0;
    const adjacency = getBlockAdjacencyScore(level, block);
    const flex = getCompatibleExits(level, block).length;
    return {
      blockId: block.id,
      exitId: exit?.id || '',
      exitEdge: exit?.edge || '',
      style: block.style,
      shapeKey: getShapeFamily(block),
      shapeVariant: block.shapeVariant || 'default',
      clearance,
      adjacency,
      flex,
      area: block.shapeCells.length,
    };
  }).sort((left, right) => {
    return left.clearance - right.clearance || right.adjacency - left.adjacency || left.flex - right.flex || right.area - left.area || left.blockId.localeCompare(right.blockId);
  });

  const anchorCount = Math.min(roleBudget.anchor || 0, raw.length);
  const gatekeeperCount = Math.min(roleBudget.gatekeeper || 0, Math.max(0, raw.length - anchorCount));
  const baitCount = Math.min(roleBudget.bait || 0, Math.max(0, raw.length - anchorCount - gatekeeperCount));
  const chainLength = Math.min(Math.max(1, dependencySkeleton.mainChainLength || 5), raw.length);

  return raw.map((entry, index) => {
    let role = 'filler';
    let phaseIndex = 3;
    if (index < anchorCount) {
      role = 'anchor';
      phaseIndex = 0;
    } else if (index < anchorCount + gatekeeperCount) {
      role = 'gatekeeper';
      phaseIndex = 1;
    } else if (index < anchorCount + gatekeeperCount + baitCount) {
      role = 'bait';
      phaseIndex = 2;
    }
    return {
      blockId: entry.blockId,
      exitId: entry.exitId,
      shapeKey: entry.shapeKey,
      shapeVariant: entry.shapeVariant,
      role,
      phaseIndex,
      chainIndex: index < chainLength ? index : -1,
      preferReuseExit: role !== 'anchor',
      color: entry.style,
      edge: entry.exitEdge,
    };
  });
}

function shouldIntensifyLowMoveCandidate(report, band) {
  if (!report?.isSolvable || !band?.solutionBand) {
    return false;
  }
  if (!Number.isFinite(report.bestMoveCountEstimate)) {
    return false;
  }
  return report.bestMoveCountEstimate < band.solutionBand[0];
}


function collectOpeningRiskyBlocks(level) {
  return (level.blocks || [])
    .map((block) => ({
      blockId: block.id,
      area: block.shapeCells.length,
      bestClearance: getBlockBestExitClearance(level, block) ?? 99,
      quickRisk: estimateBlockQuickExitSetupRisk(level, block),
    }))
    .sort((left, right) => {
      const leftDepth = left.quickRisk.bestSetupDepth ?? 99;
      const rightDepth = right.quickRisk.bestSetupDepth ?? 99;
      return leftDepth - rightDepth
        || left.bestClearance - right.bestClearance
        || right.area - left.area
        || left.blockId.localeCompare(right.blockId);
    });
}

function shouldRepairOpeningPressureCandidate(report, evaluation, band, level) {
  if (!report || !evaluation || !band || level?.chapter !== 2) {
    return false;
  }
  if (band.segmentKey !== 'brutal') {
    return false;
  }
  return !evaluation.ok && (
    evaluation.checks.openingOk === false
    || evaluation.checks.largeNearExitOk === false
    || evaluation.checks.firstClearReachableOk === false
    || evaluation.checks.firstClearDepthOk === false
    || evaluation.checks.firstClearReleaseOk === false
  );
}

function maybeRepairOpeningPressureCandidate(level, band, rng, currentReport, currentEvaluation, currentScore) {
  if (!shouldRepairOpeningPressureCandidate(currentReport, currentEvaluation, band, level)) {
    return { level, report: currentReport, evaluation: currentEvaluation, score: currentScore, changed: false };
  }

  let best = {
    level,
    report: currentReport,
    evaluation: currentEvaluation,
    score: currentScore,
    ok: currentEvaluation.ok,
  };
  const riskyBlocks = collectOpeningRiskyBlocks(level)
    .filter((entry) => (entry.quickRisk.bestSetupDepth ?? 99) <= 1 || entry.bestClearance <= 1 || (entry.area >= 3 && (entry.quickRisk.bestSetupDepth ?? 99) <= 2))
    .slice(0, 2);

  riskyBlocks.forEach((entry) => {
    const sourceBlock = (level.blocks || []).find((block) => block.id === entry.blockId);
    if (!sourceBlock) {
      return;
    }
    const anchors = getPlacementCandidates(level, getShapeFamily(sourceBlock), sourceBlock.shapeVariant || 'default', rng, 36)
      .filter((anchor) => anchor.x !== sourceBlock.x || anchor.y !== sourceBlock.y)
      .slice(0, 12);

    anchors.forEach((anchor) => {
      const candidateLevel = clone(level);
      const block = (candidateLevel.blocks || []).find((item) => item.id === entry.blockId);
      if (!block) {
        return;
      }
      block.x = anchor.x;
      block.y = anchor.y;
      if (!canPlace(candidateLevel, block) || !hasCompatibleExit(candidateLevel, block)) {
        return;
      }
      const report = probeValidate(candidateLevel, band);
      const evaluation = evaluateLevelAgainstBand(candidateLevel, report, band);
      const score = scoreCandidate(candidateLevel, report, band, evaluation);
      const candidate = { level: candidateLevel, report, evaluation, score, ok: evaluation.ok };
      if (compareCandidateStrength(candidate, best) > 0) {
        best = candidate;
      }
    });
  });

  if (best.level === level) {
    return { level, report: currentReport, evaluation: currentEvaluation, score: currentScore, changed: false };
  }

  const finalReport = quickValidate(best.level, band);
  const finalEvaluation = evaluateLevelAgainstBand(best.level, finalReport, band);
  const finalScore = scoreCandidate(best.level, finalReport, band, finalEvaluation);
  const finalCandidate = { level: best.level, report: finalReport, evaluation: finalEvaluation, score: finalScore, ok: finalEvaluation.ok };
  if (compareCandidateStrength(finalCandidate, { level, report: currentReport, evaluation: currentEvaluation, score: currentScore, ok: currentEvaluation.ok }) <= 0) {
    return { level, report: currentReport, evaluation: currentEvaluation, score: currentScore, changed: false };
  }

  return {
    level: best.level,
    report: finalReport,
    evaluation: finalEvaluation,
    score: finalScore,
    changed: true,
  };
}

function maybeIntensifyLowMoveCandidate(level, band, allowedColors, rng, currentReport, currentEvaluation, currentScore) {
  if (level.chapter !== 2 || band.segmentKey !== 'hard') {
    return { level, report: currentReport, evaluation: currentEvaluation, score: currentScore, changed: false };
  }
  if (!shouldIntensifyLowMoveCandidate(currentReport, band)) {
    return { level, report: currentReport, evaluation: currentEvaluation, score: currentScore, changed: false };
  }
  const candidateLevel = clone(level);
  const assignments = buildReverseAssignmentsFromLevel(candidateLevel, rng);
  reverseScrambleBlocks(candidateLevel, assignments, allowedColors, rng, band);
  candidateLevel.exits = normalizeExitLayout(candidateLevel.exits || []);
  const report = quickValidate(candidateLevel, band);
  const evaluation = evaluateLevelAgainstBand(candidateLevel, report, band);
  const score = scoreCandidate(candidateLevel, report, band, evaluation);
  const better = (report.bestMoveCountEstimate || 0) > (currentReport.bestMoveCountEstimate || 0)
    || (evaluation.ok && !currentEvaluation.ok)
    || score > currentScore;
  if (!better) {
    return { level, report: currentReport, evaluation: currentEvaluation, score: currentScore, changed: false };
  }
  return { level: candidateLevel, report, evaluation, score, changed: true };
}


function getBlockBestExitClearance(level, block) {
  const exits = getCompatibleExits(level, block);
  if (!exits.length) {
    return null;
  }
  return exits.reduce((best, exit) => Math.min(best, getExitClearance(block, exit, level.board)), Number.POSITIVE_INFINITY);
}

function scoreHiddenBlockPosition(level, block, band) {
  const pressure = getReversePressure(band);
  const quickRisk = estimateBlockQuickExitSetupRisk(level, block);
  const otherRisk = estimateOtherBlocksQuickExitRisk(level, block.id);
  const bestClearance = getBlockBestExitClearance(level, block) ?? 0;
  const adjacency = getBlockAdjacencyScore(level, block);
  const centerDistance = getBlockCenterDistance(level, block);
  let score = 0;
  score += Math.min(6, bestClearance) * (26 + (pressure * 8));
  score += adjacency * (10 + (pressure * 3));
  score -= centerDistance * (4 + pressure);
  score -= (quickRisk.directRoutes || 0) * (120 + (pressure * 20));
  score -= (quickRisk.oneStepRoutes || 0) * (72 + (pressure * 14));
  score -= (quickRisk.twoStepRoutes || 0) * (30 + (pressure * 8));
  score -= (otherRisk.directCount || 0) * (10 + (pressure * 4));
  score -= (otherRisk.oneStepCount || 0) * (6 + (pressure * 2));
  if ((quickRisk.bestSetupDepth ?? 99) <= 1) {
    score -= 64 + ((block.shapeCells.length >= 3) ? 48 : 0);
  }
  return score;
}


function scoreOpeningHideQuality(level, band) {
  const pressure = getReversePressure(band);
  const openingMetrics = collectOpeningStaticMetrics(level);
  const otherRisk = estimateOtherBlocksQuickExitRisk(level);
  const firstClearProfile = getFirstClearTargetProfile(band);
  let score = 0;
  score -= distanceToBand(openingMetrics.openingActionCountRaw, firstClearProfile.openingActionBand) * 24;
  score -= Math.max(0, openingMetrics.directClearCount - firstClearProfile.directClearMax) * (80 + (pressure * 12));
  score -= Math.max(0, openingMetrics.directLargeClearCount || 0) * (72 + (pressure * 12));
  score -= Math.max(0, openingMetrics.openingLargeBlockNearExitCount - firstClearProfile.largeNearExitMax) * (54 + (pressure * 10));
  score += Math.max(0, openingMetrics.averageBestExitDistance || 0) * (10 + (pressure * 2));
  score -= (otherRisk.directCount || 0) * (44 + (pressure * 10));
  score -= (otherRisk.oneStepCount || 0) * (24 + (pressure * 6));
  score -= (otherRisk.largeQuickCount || 0) * (54 + (pressure * 12));
  if ((otherRisk.bestSetupDepth ?? 99) <= 1) {
    score -= 42 + (((otherRisk.bestBlockArea || 0) >= 3) ? 24 : 0);
  }
  return Number(score.toFixed(2));
}

function applyHideShallowQuickClearBlocksIfBetter(level, rng, band) {
  const candidate = clone(level);
  hideShallowQuickClearBlocks(candidate, rng, band);
  const beforeHideScore = scoreOpeningHideQuality(level, band);
  const afterHideScore = scoreOpeningHideQuality(candidate, band);
  if (afterHideScore <= beforeHideScore) {
    return false;
  }
  const beforeReport = buildStructuralCandidateReport(level, band);
  const afterReport = buildStructuralCandidateReport(candidate, band);
  const beforeEvaluation = evaluateStructuralCandidateAgainstBand(level, beforeReport, band);
  const afterEvaluation = evaluateStructuralCandidateAgainstBand(candidate, afterReport, band);
  const beforeScore = scoreStructuralCandidate(level, beforeReport, band, beforeEvaluation);
  const afterScore = scoreStructuralCandidate(candidate, afterReport, band, afterEvaluation);
  const better = compareStructuralCandidateStrength(
    { ok: beforeEvaluation.ok, report: beforeReport, evaluation: beforeEvaluation, score: beforeScore },
    { ok: afterEvaluation.ok, report: afterReport, evaluation: afterEvaluation, score: afterScore },
  ) < 0;
  if (!better) {
    return false;
  }
  level.blocks = candidate.blocks;
  return true;
}

function hideShallowQuickClearBlocks(level, rng, band) {
  const pressure = getReversePressure(band);
  if (pressure <= 0) {
    return;
  }
  const candidateLimit = pressure >= 2 ? 48 : 32;
  const passCount = pressure >= 2 ? 2 : 1;
  for (let pass = 0; pass < passCount; pass += 1) {
    const riskyBlocks = (level.blocks || [])
      .map((block) => {
        const quickRisk = estimateBlockQuickExitSetupRisk(level, block);
        const bestClearance = getBlockBestExitClearance(level, block);
        return {
          block,
          quickRisk,
          bestClearance: bestClearance ?? 99,
        };
      })
      .filter((entry) => {
        const depth = entry.quickRisk.bestSetupDepth ?? 99;
        return depth <= 1 || entry.bestClearance <= 1 || (entry.block.shapeCells.length >= 3 && depth <= 2);
      })
      .sort((left, right) => {
        const leftDepth = left.quickRisk.bestSetupDepth ?? 99;
        const rightDepth = right.quickRisk.bestSetupDepth ?? 99;
        return leftDepth - rightDepth
          || left.bestClearance - right.bestClearance
          || right.block.shapeCells.length - left.block.shapeCells.length
          || left.block.id.localeCompare(right.block.id);
      })
      .slice(0, pressure >= 2 ? 6 : 3);

    let movedAny = false;
    riskyBlocks.forEach((entry) => {
      const currentBlock = (level.blocks || []).find((block) => block.id === entry.block.id);
      if (!currentBlock) {
        return;
      }
      const currentScore = scoreHiddenBlockPosition(level, currentBlock, band);
      const anchors = getPlacementCandidates(level, getShapeFamily(currentBlock), currentBlock.shapeVariant || 'default', rng, candidateLimit);
      let bestAnchor = null;
      let bestScore = currentScore;
      anchors.forEach((anchor) => {
        if (anchor.x === currentBlock.x && anchor.y === currentBlock.y) {
          return;
        }
        const preview = { ...currentBlock, x: anchor.x, y: anchor.y };
        if (!canPlace(level, preview) || !hasCompatibleExit(level, preview)) {
          return;
        }
        const previewLevel = clone(level);
        const target = (previewLevel.blocks || []).find((block) => block.id === currentBlock.id);
        if (!target) {
          return;
        }
        target.x = preview.x;
        target.y = preview.y;
        const nextScore = scoreHiddenBlockPosition(previewLevel, target, band);
        if (nextScore > bestScore + 18) {
          bestScore = nextScore;
          bestAnchor = anchor;
        }
      });
      if (bestAnchor) {
        currentBlock.x = bestAnchor.x;
        currentBlock.y = bestAnchor.y;
        movedAny = true;
      }
    });
    if (!movedAny) {
      break;
    }
  }
}

function reverseScrambleBlocks(level, assignments, allowedColors, rng, band = null) {
  const ordered = [...assignments].reverse();
  for (let pass = 0; pass < 2; pass += 1) {
    ordered.forEach((assignment) => {
      const block = (level.blocks || []).find((entry) => entry.id === assignment.blockId);
      const exit = (level.exits || []).find((entry) => entry.id === assignment.exitId) || (level.exits || []).find((entry) => entry.acceptColor === block?.style);
      if (!block || !exit) {
        return;
      }
      const currentClearance = getExitClearance(block, exit, level.board);
      const currentAdjacency = getBlockAdjacencyScore(level, block);
      const currentCenterDistance = getBlockCenterDistance(level, block);
      const currentFlex = getCompatibleExits(level, block).length;
      const roleWeights = getReverseRoleWeights(assignment, band);
      const currentScore = currentClearance * roleWeights.clearance + currentAdjacency * roleWeights.adjacency + currentFlex * roleWeights.flex - currentCenterDistance * roleWeights.centerPenalty;
      const anchors = getPlacementCandidates(level, assignment.shapeKey, assignment.shapeVariant, rng, 28)
        .map((anchor, index) => ({ anchor, index }))
        .sort((left, right) => {
          const leftBlock = { ...block, x: left.anchor.x, y: left.anchor.y };
          const rightBlock = { ...block, x: right.anchor.x, y: right.anchor.y };
          const leftClearance = getExitClearance(leftBlock, exit, level.board);
          const rightClearance = getExitClearance(rightBlock, exit, level.board);
          const leftAdjacency = getBlockAdjacencyScore(level, leftBlock);
          const rightAdjacency = getBlockAdjacencyScore(level, rightBlock);
          const leftFlex = getCompatibleExits(level, leftBlock).length;
          const rightFlex = getCompatibleExits(level, rightBlock).length;
          const leftCenterDistance = getBlockCenterDistance(level, leftBlock);
          const rightCenterDistance = getBlockCenterDistance(level, rightBlock);
          const leftScore = leftClearance * roleWeights.clearance + leftAdjacency * roleWeights.adjacency + leftFlex * roleWeights.flex - leftCenterDistance * roleWeights.centerPenalty - left.index;
          const rightScore = rightClearance * roleWeights.clearance + rightAdjacency * roleWeights.adjacency + rightFlex * roleWeights.flex - rightCenterDistance * roleWeights.centerPenalty - right.index;
          return rightScore - leftScore;
        });
      for (const entry of anchors) {
        const preview = { ...block, x: entry.anchor.x, y: entry.anchor.y };
        const nextClearance = getExitClearance(preview, exit, level.board);
        if (nextClearance < currentClearance) {
          continue;
        }
        if (!canPlace(level, preview) || !hasCompatibleExit(level, preview)) {
          continue;
        }
        const nextAdjacency = getBlockAdjacencyScore(level, preview);
        const nextCenterDistance = getBlockCenterDistance(level, preview);
        const nextFlex = getCompatibleExits(level, preview).length;
        const nextScore = nextClearance * roleWeights.clearance + nextAdjacency * roleWeights.adjacency + nextFlex * roleWeights.flex - nextCenterDistance * roleWeights.centerPenalty;
        if (nextScore <= currentScore && !(pass > 0 && nextAdjacency > currentAdjacency)) {
          continue;
        }
        block.x = preview.x;
        block.y = preview.y;
        break;
      }
    });
  }
  ensureColorCoverage(level, allowedColors, rng);
}

function buildReverseConstructionSeedLevel(chapterNumber, levelIndex, band, generatorV3Plan, rng) {
  if (!generatorV3Plan?.contract) {
    return null;
  }
  const rows = generatorV3Plan.contract.board.rows || band.rows?.[0] || 8;
  const allowedColors = generatorV3Plan.allowedColors || TARGET_STYLE_POOL.slice(0, band.colors?.[0] || 4);
  const level = createEmptyGeneratedLevel(chapterNumber, levelIndex, rows, band, generatorV3Plan);
  const tasks = sortReverseTaskQueue(buildReverseShapeTasks(generatorV3Plan, rng));
  buildReverseExitLayout(level, generatorV3Plan, allowedColors, rng, band);
  const assignments = [];
  const exitLoadCounts = new Map();
  const placedTaskMeta = new Map();
  const counterRef = { value: 1 };
  const reverseTargetCells = getReverseTargetOccupiedCells(level, band, generatorV3Plan);

  let pending = tasks;
  const maxPasses = getReversePressure(band) >= 2 ? 3 : 2;
  for (let pass = 0; pass < maxPasses; pass += 1) {
    const nextPending = [];
    for (const task of pending) {
      const placed = tryPlaceReverseTask(level, task, counterRef, assignments, allowedColors, exitLoadCounts, placedTaskMeta, rng, pass, band);
      if (!placed) {
        nextPending.push(task);
      }
      if (occupiedCells(level) >= reverseTargetCells) {
        break;
      }
    }
    pending = nextPending;
    if (occupiedCells(level) >= reverseTargetCells || !nextPending.length) {
      break;
    }
    pending = sortReverseTaskQueue(nextPending);
  }

  if (occupiedCells(level) < reverseTargetCells && pending.length) {
    let recoveryQueue = [...pending].sort((left, right) => {
      const roleOrder = { filler: 0, bait: 1, gatekeeper: 2, anchor: 3 };
      return (roleOrder[left.role] || 0) - (roleOrder[right.role] || 0)
        || left.area - right.area
        || (left.phaseIndex || 0) - (right.phaseIndex || 0)
        || left.orderIndex - right.orderIndex;
    });
    for (let recoveryPass = 0; recoveryPass < 2 && recoveryQueue.length; recoveryPass += 1) {
      const nextRecoveryQueue = [];
      let progressed = false;
      for (const task of recoveryQueue) {
        const placed = tryPlaceReverseTask(level, task, counterRef, assignments, allowedColors, exitLoadCounts, placedTaskMeta, rng, maxPasses + 1 + recoveryPass, band);
        if (!placed) {
          nextRecoveryQueue.push(task);
        } else {
          progressed = true;
        }
        if (occupiedCells(level) >= reverseTargetCells) {
          break;
        }
      }
      if (occupiedCells(level) >= reverseTargetCells || !progressed) {
        break;
      }
      recoveryQueue = nextRecoveryQueue;
    }
  }

  if (!level.blocks.length) {
    return null;
  }
  reverseScrambleBlocks(level, assignments, allowedColors, rng, band);
  ensureExitCoverage(level, allowedColors, band);
  level.exits = normalizeExitLayout(level.exits || []);
  return level;
}

function getShapePool(level, band, chapterNumber, rng) {
  const planShapeQuota = level.meta?.generatorV3Plan?.shapeQuota || [];
  if (planShapeQuota.length) {
    const pool = [];
    planShapeQuota.forEach((entry) => {
      const variants = SHAPE_VARIANTS[entry.shapeKey] || ['default'];
      variants.forEach((shapeVariant) => {
        const size = getShapeCells(entry.shapeKey, shapeVariant).length;
        pool.push({
          shapeKey: entry.shapeKey,
          shapeVariant,
          size,
          weight: (entry.targetCount * 100) + (entry.minCount * 40) + (entry.desiredArea || 0),
        });
      });
    });
    return shuffle(pool, rng).sort((left, right) => right.weight - left.weight || right.size - left.size || left.shapeKey.localeCompare(right.shapeKey));
  }

  const chapterCore = chapterNumber === 2
    ? ['L-4', 'L-3']
    : chapterNumber >= 3
      ? ['T-4', 'L-4', 'square-2']
      : ['square-2', 'bar3'];
  const shapeWeightKey = `chapter${String(chapterNumber).padStart(2, '0')}`;
  const shapeWeights = SHAPE_POOLS.campaign[shapeWeightKey] || SHAPE_POOLS.campaign.chapter03 || {};
  const boosted = new Set([...chapterCore, ...(band.shapes || [])]);
  const pool = [];
  (band.shapes || []).forEach((shapeKey) => {
    const variants = SHAPE_VARIANTS[shapeKey] || ['default'];
    variants.forEach((shapeVariant) => {
      const size = getShapeCells(shapeKey, shapeVariant).length;
      const configuredWeight = Number(shapeWeights[shapeKey]) || 0;
      pool.push({
        shapeKey,
        shapeVariant,
        size,
        weight: (configuredWeight * 1000) + (boosted.has(shapeKey) ? 120 : 0) + (size * 10),
      });
    });
  });
  return shuffle(pool, rng).sort((left, right) => right.weight - left.weight || right.size - left.size || left.shapeKey.localeCompare(right.shapeKey));
}

function getColorPriority(level, allowedColors, rng) {
  const counts = new Map(allowedColors.map((color) => [color, 0]));
  (level.blocks || []).forEach((block) => {
    counts.set(block.style, (counts.get(block.style) || 0) + 1);
  });
  return shuffle(allowedColors, rng).sort((left, right) => (counts.get(left) || 0) - (counts.get(right) || 0) || left.localeCompare(right));
}

function probeValidate(level, band) {
  const staticReport = validateLevelStatic(level, {
    solutionFamilyCap: Math.max(4, band.solutionFamilyMax || 4),
  });
  if (!staticReport.isStructurallyValid) {
    return staticReport;
  }
  const isChapterTwo = level.chapter === 2;
  const isChapterThree = level.chapter === 3;
  const openingMetrics = collectOpeningStaticMetrics(level);
  const openingEvaluation = evaluateOpeningStaticAgainstBand(openingMetrics, band);
  if (!openingEvaluation.ok) {
    return buildPrecheckRejectedReport(staticReport, 'opening_static_reject', {
      openingActionCount: openingMetrics.openingActionCountRaw,
      openingActionCountRaw: openingMetrics.openingActionCountRaw,
      openingMovableBlockCount: openingMetrics.openingMovableBlockCount,
      directClearCount: openingMetrics.directClearCount,
      directLargeClearCount: openingMetrics.directLargeClearCount,
      openingLargeBlockNearExitCount: openingMetrics.openingLargeBlockNearExitCount,
      matchingEdgeTouchCount: openingMetrics.matchingEdgeTouchCount,
      averageBestExitDistance: openingMetrics.averageBestExitDistance,
      openingStaticMetrics: openingMetrics,
    });
  }
  const firstClearReport = validateFirstClear(level, {
    firstClearMaxStates: isChapterTwo ? 120 : isChapterThree ? 180 : 240,
    firstClearMaxRoutes: 2,
    firstClearDepthSlack: 0,
    firstClearRouteFamilyCap: 2,
  });
  const firstClearEvaluation = evaluateFirstClearAgainstBand(firstClearReport, band);
  if (!firstClearEvaluation.ok) {
    return buildPrecheckRejectedReport(staticReport, 'first_clear_reject', {
      openingActionCount: openingMetrics.openingActionCountRaw,
      openingActionCountRaw: openingMetrics.openingActionCountRaw,
      openingMovableBlockCount: openingMetrics.openingMovableBlockCount,
      directClearCount: openingMetrics.directClearCount,
      directLargeClearCount: openingMetrics.directLargeClearCount,
      openingLargeBlockNearExitCount: openingMetrics.openingLargeBlockNearExitCount,
      matchingEdgeTouchCount: openingMetrics.matchingEdgeTouchCount,
      averageBestExitDistance: openingMetrics.averageBestExitDistance,
      openingStaticMetrics: openingMetrics,
      bestFirstClearDepth: firstClearReport.bestFirstClearDepth,
      bestFirstClearSetupDepth: firstClearReport.bestFirstClearSetupDepth,
      firstClearBlockId: firstClearReport.firstClearBlockId,
      firstClearArea: firstClearReport.firstClearArea,
      firstClearReleaseGain: firstClearReport.firstClearReleaseGain,
      firstClearRouteCount: firstClearReport.firstClearRouteCount,
      falseFirstClearCount: firstClearReport.falseFirstClearCount,
      firstClearKeynessScore: firstClearReport.firstClearKeynessScore,
      postFirstClearCollapseScore: firstClearReport.postFirstClearCollapseScore,
      firstClearReport,
      firstClearExpandedStates: firstClearReport.expandedStates,
      routeFamilySearchComplete: firstClearReport.routeFamilySearchComplete,
    });
  }
  return validateLevelQuick(level, {
    maxStates: isChapterTwo ? 220 : isChapterThree ? 320 : 520,
    maxSolutions: 1,
    solutionDepthSlack: 0,
    solutionFamilyCap: Math.max(4, band.solutionFamilyMax || 4),
  });
}


function relaxedDensityValidate(level, band) {
  const isChapterTwo = level.chapter === 2;
  const isChapterThree = level.chapter === 3;
  const staticReport = validateLevelStatic(level, {
    solutionFamilyCap: Math.max(4, band.solutionFamilyMax || 4),
  });
  if (!staticReport.isStructurallyValid) {
    return staticReport;
  }
  return validateLevelQuick(level, {
    maxStates: isChapterTwo ? 520 : isChapterThree ? 760 : 1100,
    maxSolutions: 1,
    solutionDepthSlack: 0,
    solutionFamilyCap: Math.max(4, band.solutionFamilyMax || 4),
  });
}

function quickValidate(level, band) {
  const isChapterTwo = level.chapter === 2;
  const isChapterThree = level.chapter === 3;
  const staticReport = validateLevelStatic(level, {
    solutionFamilyCap: Math.max(4, band.solutionFamilyMax || 4),
  });
  if (!staticReport.isStructurallyValid) {
    return staticReport;
  }
  const openingMetrics = collectOpeningStaticMetrics(level);
  const openingEvaluation = evaluateOpeningStaticAgainstBand(openingMetrics, band);
  if (!openingEvaluation.ok) {
    return buildPrecheckRejectedReport(staticReport, 'opening_static_reject', {
      openingActionCount: openingMetrics.openingActionCountRaw,
      openingActionCountRaw: openingMetrics.openingActionCountRaw,
      openingMovableBlockCount: openingMetrics.openingMovableBlockCount,
      directClearCount: openingMetrics.directClearCount,
      directLargeClearCount: openingMetrics.directLargeClearCount,
      openingLargeBlockNearExitCount: openingMetrics.openingLargeBlockNearExitCount,
      matchingEdgeTouchCount: openingMetrics.matchingEdgeTouchCount,
      averageBestExitDistance: openingMetrics.averageBestExitDistance,
      openingStaticMetrics: openingMetrics,
    });
  }
  const firstClearReport = validateFirstClear(level, {
    firstClearMaxStates: isChapterTwo ? 300 : isChapterThree ? 420 : 560,
    firstClearMaxRoutes: 4,
    firstClearDepthSlack: 1,
    firstClearRouteFamilyCap: 3,
  });
  const firstClearEvaluation = evaluateFirstClearAgainstBand(firstClearReport, band);
  if (!firstClearEvaluation.ok) {
    return buildPrecheckRejectedReport(staticReport, 'first_clear_reject', {
      openingActionCount: openingMetrics.openingActionCountRaw,
      openingActionCountRaw: openingMetrics.openingActionCountRaw,
      openingMovableBlockCount: openingMetrics.openingMovableBlockCount,
      directClearCount: openingMetrics.directClearCount,
      directLargeClearCount: openingMetrics.directLargeClearCount,
      openingLargeBlockNearExitCount: openingMetrics.openingLargeBlockNearExitCount,
      matchingEdgeTouchCount: openingMetrics.matchingEdgeTouchCount,
      averageBestExitDistance: openingMetrics.averageBestExitDistance,
      openingStaticMetrics: openingMetrics,
      bestFirstClearDepth: firstClearReport.bestFirstClearDepth,
      bestFirstClearSetupDepth: firstClearReport.bestFirstClearSetupDepth,
      firstClearBlockId: firstClearReport.firstClearBlockId,
      firstClearArea: firstClearReport.firstClearArea,
      firstClearReleaseGain: firstClearReport.firstClearReleaseGain,
      firstClearRouteCount: firstClearReport.firstClearRouteCount,
      falseFirstClearCount: firstClearReport.falseFirstClearCount,
      firstClearKeynessScore: firstClearReport.firstClearKeynessScore,
      postFirstClearCollapseScore: firstClearReport.postFirstClearCollapseScore,
      firstClearReport,
      firstClearExpandedStates: firstClearReport.expandedStates,
      routeFamilySearchComplete: firstClearReport.routeFamilySearchComplete,
    });
  }
  return validateLevelQuick(level, {
    maxStates: isChapterTwo ? 900 : isChapterThree ? 1500 : 2200,
    maxSolutions: isChapterTwo ? 2 : isChapterThree ? 3 : 4,
    solutionDepthSlack: 1,
    solutionFamilyCap: Math.max(4, band.solutionFamilyMax || 4),
  });
}

function targetOccupancyForBand(level, band) {
  const targetCells = level.meta?.generatorV3Plan?.contract?.targetOccupiedCells;
  if (Number.isFinite(targetCells) && level.board?.cols && level.board?.rows) {
    return targetCells / Math.max(1, level.board.cols * level.board.rows);
  }
  const [min, max] = band.occupancy || [0.66, 0.72];
  const factor = getSegmentBias(band.segmentKey);
  return min + ((max - min) * factor);
}

function hasCompatibleExit(level, block) {
  return getCompatibleExits(level, block).length > 0;
}

function withTemporaryBlock(level, block, iteratee) {
  level.blocks.push(block);
  try {
    return iteratee(level);
  } finally {
    level.blocks.pop();
  }
}

function getFastFillTolerance(band, options = {}) {
  const firstClearProfile = getFirstClearTargetProfile(band);
  const recovery = !!options.recovery;
  const signature = !!options.signature;
  const colors = band?.colors?.[1] || band?.colors?.[0] || 4;
  return {
    openingActionBand: [
      Math.max(0, firstClearProfile.openingActionBand[0] - (recovery ? 2 : 1)),
      firstClearProfile.openingActionBand[1] + (recovery ? 2 : 1),
    ],
    directClearMax: firstClearProfile.directClearMax + (signature ? 1 : recovery ? 2 : 1),
    largeNearExitMax: firstClearProfile.largeNearExitMax + (signature ? 1 : recovery ? 2 : 1),
    matchingEdgeTouchMax: Math.max(6, colors + (recovery ? 4 : 3)),
    minOpeningMovable: Math.max(1, firstClearProfile.openingActionBand[0] - 1),
  };
}

function canAcceptFastFillBlock(level, block, band, options = {}) {
  const tolerance = getFastFillTolerance(band, options);
  return withTemporaryBlock(level, block, (previewLevel) => {
    const openingMetrics = collectOpeningStaticMetrics(previewLevel);
    if ((openingMetrics.openingMovableBlockCount || 0) < tolerance.minOpeningMovable) {
      return false;
    }
    if (distanceToBand(openingMetrics.openingActionCountRaw, tolerance.openingActionBand) > 0) {
      return false;
    }
    if ((openingMetrics.directClearCount || 0) > tolerance.directClearMax) {
      return false;
    }
    if ((openingMetrics.openingLargeBlockNearExitCount || 0) > tolerance.largeNearExitMax) {
      return false;
    }
    if ((openingMetrics.matchingEdgeTouchCount || 0) > tolerance.matchingEdgeTouchMax) {
      return false;
    }
    return true;
  });
}

function augmentDensity(level, band, chapterNumber, allowedColors, rng) {
  const targetRate = targetOccupancyForBand(level, band);
  const targetMinCells = Math.ceil(level.board.cols * level.board.rows * targetRate);
  const targetMaxCells = Math.floor(level.board.cols * level.board.rows * (band.occupancy?.[1] || targetRate));
  const placementLimit = band.segmentKey === 'teaching' ? 12 : chapterNumber === 2 ? 24 : 18;
  const shapePool = getShapePool(level, band, chapterNumber, rng).slice(0, band.segmentKey === 'teaching' ? 8 : chapterNumber === 2 ? 16 : 12);
  let autoIndex = 1;
  let guard = 0;

  while (occupiedCells(level) < targetMinCells && guard < 48) {
    guard += 1;
    let added = false;
    const colors = getColorPriority(level, allowedColors, rng);
    for (const shape of shapePool) {
      const positions = getPlacementCandidates(level, shape.shapeKey, shape.shapeVariant, rng, placementLimit);
      for (const pos of positions) {
        for (const color of colors) {
          const block = createBlock({
            id: `auto-${level.id}-${autoIndex}`,
            style: color,
            x: pos.x,
            y: pos.y,
            shapeKey: shape.shapeKey,
            shapeVariant: shape.shapeVariant,
          });
          if (!canPlace(level, block)) {
            continue;
          }
          if (!hasCompatibleExit(level, block)) {
            continue;
          }
          if (occupiedCells(level) + block.shapeCells.length > targetMaxCells) {
            continue;
          }
          if (!canAcceptFastFillBlock(level, block, band)) {
            continue;
          }
          level.blocks.push(block);
          autoIndex += 1;
          added = true;
          break;
        }
        if (added) {
          break;
        }
      }
      if (added) {
        break;
      }
    }
    if (!added) {
      break;
    }
  }

  if (occupiedCells(level) < targetMinCells) {
    const recoveryPool = [...shapePool].sort((left, right) => left.size - right.size || right.weight - left.weight || left.shapeKey.localeCompare(right.shapeKey));
    const recoveryPlacementLimit = Math.max(placementLimit * 2, chapterNumber === 2 ? 56 : 40);
    let recoveryGuard = 0;
    while (occupiedCells(level) < targetMinCells && recoveryGuard < 24) {
      recoveryGuard += 1;
      let added = false;
      const colors = getColorPriority(level, allowedColors, rng);
      for (const shape of recoveryPool) {
        const positions = getPlacementCandidates(level, shape.shapeKey, shape.shapeVariant, rng, recoveryPlacementLimit);
        for (const pos of positions) {
          for (const color of colors) {
            const block = createBlock({
              id: `auto-recovery-${level.id}-${autoIndex}`,
              style: color,
              x: pos.x,
              y: pos.y,
              shapeKey: shape.shapeKey,
              shapeVariant: shape.shapeVariant,
            });
            if (!canPlace(level, block) || !hasCompatibleExit(level, block)) {
              continue;
            }
            if (occupiedCells(level) + block.shapeCells.length > targetMaxCells) {
              continue;
            }
            if (!canAcceptFastFillBlock(level, block, band, { recovery: true })) {
              continue;
            }
            level.blocks.push(block);
            autoIndex += 1;
            added = true;
            break;
          }
          if (added) {
            break;
          }
        }
        if (added) {
          break;
        }
      }
      if (!added) {
        break;
      }
    }
  }
}

function ensureChapterSignatureShape(level, band, chapterNumber, allowedColors, rng) {
  const existingFamilies = new Set((level.blocks || []).map(getShapeFamily));
  const desiredShapes = chapterNumber === 2
    ? ['L-4', 'L-3']
    : chapterNumber >= 3
      ? ['T-4']
      : [];
  if (!desiredShapes.length) {
    return;
  }
  const missingShapes = desiredShapes.filter((shape) => !existingFamilies.has(shape));
  if (!missingShapes.length) {
    return;
  }
  const placementLimit = 18;
  for (const shapeKey of missingShapes) {
    let inserted = false;
    const variants = SHAPE_VARIANTS[shapeKey] || ['default'];
    for (const shapeVariant of shuffle(variants, rng)) {
      const positions = getPlacementCandidates(level, shapeKey, shapeVariant, rng, placementLimit);
      for (const pos of positions) {
        for (const color of shuffle(allowedColors, rng)) {
          const block = createBlock({
            id: `core-${level.id}-${shapeKey}-${shapeVariant}`,
            style: color,
            x: pos.x,
            y: pos.y,
            shapeKey,
            shapeVariant,
          });
          if (!canPlace(level, block) || !hasCompatibleExit(level, block)) {
            continue;
          }
          if (!canAcceptFastFillBlock(level, block, band, { signature: true })) {
            continue;
          }
          level.blocks.push(block);
          inserted = true;
          break;
        }
        if (inserted) {
          break;
        }
      }
      if (inserted) {
        break;
      }
    }
  }
}

function collectShapeFamilyCounts(level) {
  const counts = new Map();
  (level.blocks || []).forEach((block) => {
    const family = getShapeFamily(block);
    counts.set(family, (counts.get(family) || 0) + 1);
  });
  return counts;
}

function getChapterSignatureQuota(chapterNumber, band) {
  if (chapterNumber !== 2) {
    return null;
  }
  if (band.segmentKey === 'hard') {
    return { totalL: 3, families: ['L-3', 'L-4'] };
  }
  if (band.segmentKey === 'expert') {
    return { totalL: 4, families: ['L-3', 'L-4'] };
  }
  return { totalL: 5, families: ['L-3', 'L-4'] };
}

function ensureChapterSignatureQuota(level, band, chapterNumber, allowedColors, rng) {
  const quota = getChapterSignatureQuota(chapterNumber, band);
  if (!quota) {
    return;
  }
  const placementLimit = 24;
  let counts = collectShapeFamilyCounts(level);
  let totalL = (counts.get('L-3') || 0) + (counts.get('L-4') || 0);

  for (const family of quota.families) {
    if ((counts.get(family) || 0) > 0) {
      continue;
    }
    const variants = SHAPE_VARIANTS[family] || ['default'];
    let inserted = false;
    for (const shapeVariant of shuffle(variants, rng)) {
      const positions = getPlacementCandidates(level, family, shapeVariant, rng, placementLimit);
      for (const pos of positions) {
        for (const color of shuffle(allowedColors, rng)) {
          const block = createBlock({
            id: `quota-${level.id}-${family}-${shapeVariant}`,
            style: color,
            x: pos.x,
            y: pos.y,
            shapeKey: family,
            shapeVariant,
          });
          if (!canPlace(level, block) || !hasCompatibleExit(level, block)) {
            continue;
          }
          if (!canAcceptFastFillBlock(level, block, band, { signature: true })) {
            continue;
          }
          level.blocks.push(block);
          inserted = true;
          counts = collectShapeFamilyCounts(level);
          totalL = (counts.get('L-3') || 0) + (counts.get('L-4') || 0);
          break;
        }
        if (inserted) {
          break;
        }
      }
      if (inserted) {
        break;
      }
    }
  }

  let guard = 0;
  while (totalL < quota.totalL && guard < 8) {
    guard += 1;
    let inserted = false;
    for (const family of shuffle(['L-4', 'L-3'], rng)) {
      const variants = SHAPE_VARIANTS[family] || ['default'];
      for (const shapeVariant of shuffle(variants, rng)) {
        const positions = getPlacementCandidates(level, family, shapeVariant, rng, placementLimit);
        for (const pos of positions) {
          for (const color of shuffle(allowedColors, rng)) {
            const block = createBlock({
              id: `quota-${level.id}-${family}-${shapeVariant}-${guard}`,
              style: color,
              x: pos.x,
              y: pos.y,
              shapeKey: family,
              shapeVariant,
            });
            if (!canPlace(level, block) || !hasCompatibleExit(level, block)) {
              continue;
            }
            if (!canAcceptFastFillBlock(level, block, band, { signature: true })) {
              continue;
            }
            level.blocks.push(block);
            inserted = true;
            counts = collectShapeFamilyCounts(level);
            totalL = (counts.get('L-3') || 0) + (counts.get('L-4') || 0);
            break;
          }
          if (inserted) {
            break;
          }
        }
        if (inserted) {
          break;
        }
      }
      if (inserted) {
        break;
      }
    }
    if (!inserted) {
      break;
    }
  }
}

function maybeExpandExitsForTeaching(level, band) {
  if (band.segmentKey !== 'teaching') {
    return;
  }
  const next = [];
  const seen = [];
  (level.exits || []).forEach((exit) => {
    let start = exit.start;
    let span = exit.span;
    const edgeLength = exit.edge === 'top' || exit.edge === 'bottom' ? level.board.cols : level.board.rows;
    if (span < 3 && start + span + 1 <= edgeLength) {
      span += 1;
    } else if (span < 3 && start > 0) {
      start -= 1;
      span += 1;
    }
    const candidate = { ...exit, start, span };
    if (hasExitLayoutConflict(seen, candidate)) {
      next.push(exit);
      seen.push(exit);
      return;
    }
    next.push(candidate);
    seen.push(candidate);
  });
  level.exits = next;
}

function buildCandidateForAttempt(chapterNumber, levelIndex, attempt, bandOverride = null) {
  const band = bandOverride || getEffectiveBand(chapterNumber, levelIndex);
  if (!band) {
    return { ok: false, reason: 'missing_band' };
  }
  const rng = createRng(hashSeed(`shift-candidate:${chapterNumber}:${levelIndex}:${attempt}`));
  const generatorV3Plan = createGeneratorV3CandidatePlan({ chapterNumber, levelIndex, attempt });
  const targetRows = generatorV3Plan?.contract?.board?.rows || chooseTargetRows(band, rng);
  const allowedColors = generatorV3Plan?.allowedColors || TARGET_STYLE_POOL.slice(0, band.colors[0]);
  let level = chapterNumber >= 2
    ? buildReverseConstructionSeedLevel(chapterNumber, levelIndex, band, generatorV3Plan, rng)
    : null;

  if (!level) {
    const seedPool = getSeedChapterCandidates(chapterNumber, targetRows);
    const seed = seedPool[Math.floor(rng() * seedPool.length)];
    level = prepareSeedLevel(seed, chapterNumber, levelIndex, band, attempt);
    attachGeneratorV3Meta(level, band, generatorV3Plan);
  }

  ensureColorCoverage(level, allowedColors, rng);
  maybeExpandExitsForTeaching(level, band);
  extendExits(level, band, allowedColors, rng);
  ensureChapterSignatureShape(level, band, chapterNumber, allowedColors, rng);
  ensureChapterSignatureQuota(level, band, chapterNumber, allowedColors, rng);
  ensureExitCoverage(level, allowedColors, band);
  augmentDensity(level, band, chapterNumber, allowedColors, rng);
  ensureChapterSignatureQuota(level, band, chapterNumber, allowedColors, rng);
  ensureExitCoverage(level, allowedColors, band);
  applyHideShallowQuickClearBlocksIfBetter(level, rng, band);
  level.exits = normalizeExitLayout(level.exits || []);

  const report = buildStructuralCandidateReport(level, band);
  const evaluation = evaluateStructuralCandidateAgainstBand(level, report, band);
  const score = scoreStructuralCandidate(level, report, band, evaluation);
  return {
    ok: evaluation.ok,
    level,
    report,
    band,
    evaluation,
    score,
    attempt,
    allowedColors,
    validationStage: 'structural',
  };
}

function upgradeCandidateToQuick(candidate) {
  if (!candidate?.level || !candidate?.band) {
    return candidate;
  }
  const band = candidate.band;
  const attempt = candidate.attempt || 1;
  const levelIndex = candidate.level.index || candidate.level.meta?.levelIndex || 1;
  const rng = createRng(hashSeed(`shift-candidate:${candidate.level.chapter}:${levelIndex}:${attempt}`));
  const allowedColors = candidate.allowedColors || TARGET_STYLE_POOL.slice(0, band.colors[0]);
  let level = candidate.level;
  let report = quickValidate(level, band);
  let evaluation = evaluateLevelAgainstBand(level, report, band);
  let score = scoreCandidate(level, report, band, evaluation);
  const intensified = maybeIntensifyLowMoveCandidate(level, band, allowedColors, rng, report, evaluation, score);
  if (intensified.changed) {
    level = intensified.level;
    report = intensified.report;
    evaluation = intensified.evaluation;
    score = intensified.score;
  }
  const repaired = maybeRepairOpeningPressureCandidate(level, band, rng, report, evaluation, score);
  if (repaired.changed) {
    level = repaired.level;
    report = repaired.report;
    evaluation = repaired.evaluation;
    score = repaired.score;
  }
  return {
    ...candidate,
    ok: evaluation.ok,
    level,
    report,
    evaluation,
    score,
    validationStage: 'quick',
  };
}

function compareCandidateStrength(left, right) {
  const leftOk = Number(!!left?.ok);
  const rightOk = Number(!!right?.ok);
  if (leftOk !== rightOk) {
    return leftOk - rightOk;
  }
  const leftMoveOk = Number(!!left?.evaluation?.checks?.moveOk);
  const rightMoveOk = Number(!!right?.evaluation?.checks?.moveOk);
  if (leftMoveOk !== rightMoveOk) {
    return leftMoveOk - rightMoveOk;
  }
  const leftFirstClearOk = Number(
    !!left?.evaluation?.checks?.firstClearDepthOk
    && !!left?.evaluation?.checks?.firstClearAreaOk
    && !!left?.evaluation?.checks?.firstClearReleaseOk
    && !!left?.evaluation?.checks?.directClearOk,
  );
  const rightFirstClearOk = Number(
    !!right?.evaluation?.checks?.firstClearDepthOk
    && !!right?.evaluation?.checks?.firstClearAreaOk
    && !!right?.evaluation?.checks?.firstClearReleaseOk
    && !!right?.evaluation?.checks?.directClearOk,
  );
  if (leftFirstClearOk !== rightFirstClearOk) {
    return leftFirstClearOk - rightFirstClearOk;
  }
  const leftMoves = left?.report?.bestMoveCountEstimate || 0;
  const rightMoves = right?.report?.bestMoveCountEstimate || 0;
  if (leftMoves !== rightMoves) {
    return leftMoves - rightMoves;
  }
  const leftDifficulty = left?.report?.difficultyScore || 0;
  const rightDifficulty = right?.report?.difficultyScore || 0;
  if (leftDifficulty !== rightDifficulty) {
    return leftDifficulty - rightDifficulty;
  }
  return (left?.score || -99999) - (right?.score || -99999);
}

function shouldTryHardAltSeed(candidate, band, attempt) {
  if (!candidate?.report || !band) {
    return false;
  }
  if (candidate.ok) {
    return false;
  }
  if (candidate.level?.chapter !== 2 || band.segmentKey !== 'hard') {
    return false;
  }
  if (attempt > 2) {
    return false;
  }
  if (!Number.isFinite(candidate.report.bestMoveCountEstimate)) {
    return true;
  }
  return candidate.report.bestMoveCountEstimate < (band.solutionBand?.[0] || 0);
}

function buildCandidate(chapterNumber, levelIndex, attempt) {
  const band = getEffectiveBand(chapterNumber, levelIndex);
  if (!band) {
    return { ok: false, reason: 'missing_band' };
  }
  let best = upgradeCandidateToQuick(buildCandidateForAttempt(chapterNumber, levelIndex, attempt, band));
  if (!shouldTryHardAltSeed(best, band, attempt)) {
    return best;
  }
  for (const offset of [2, 4]) {
    const alternate = upgradeCandidateToQuick(buildCandidateForAttempt(chapterNumber, levelIndex, attempt + offset, band));
    if (compareCandidateStrength(alternate, best) > 0) {
      best = alternate;
    }
    if (best.ok) {
      break;
    }
  }
  return best;
}

function buildFallbackCandidate(chapterNumber, levelIndex) {
  const band = getEffectiveBand(chapterNumber, levelIndex);
  if (!band) {
    return null;
  }
  const rng = createRng(hashSeed(`shift-fallback:${chapterNumber}:${levelIndex}`));
  const generatorV3Plan = createGeneratorV3CandidatePlan({ chapterNumber, levelIndex, attempt: 0 });
  const targetRows = generatorV3Plan?.contract?.board?.rows || band.rows?.[0] || 8;
  const allowedColors = generatorV3Plan?.allowedColors || TARGET_STYLE_POOL.slice(0, band.colors[0]);
  let level = chapterNumber >= 2
    ? buildReverseConstructionSeedLevel(chapterNumber, levelIndex, { ...band, rows: [targetRows, targetRows] }, generatorV3Plan, rng)
    : null;
  if (!level) {
    const seedPool = getSeedChapterCandidates(chapterNumber, targetRows);
    const seed = seedPool[0];
    level = prepareSeedLevel(seed, chapterNumber, levelIndex, { ...band, rows: [targetRows, targetRows] }, 1);
    attachGeneratorV3Meta(level, band, generatorV3Plan);
  }
  ensureColorCoverage(level, allowedColors, rng);
  if (band.segmentKey === 'teaching') {
    maybeExpandExitsForTeaching(level, band);
  }
  extendExits(level, band, allowedColors, rng);
  ensureChapterSignatureShape(level, band, chapterNumber, allowedColors, rng);
  ensureExitCoverage(level, allowedColors, band);
  applyHideShallowQuickClearBlocksIfBetter(level, rng, band);
  level.exits = normalizeExitLayout(level.exits || []);
  const structural = {
    level,
    band,
    report: buildStructuralCandidateReport(level, band),
    evaluation: null,
    score: -9999,
    ok: false,
    attempt: 0,
    allowedColors,
    validationStage: 'structural',
  };
  structural.evaluation = evaluateStructuralCandidateAgainstBand(level, structural.report, band);
  structural.score = scoreStructuralCandidate(level, structural.report, band, structural.evaluation);
  structural.ok = structural.evaluation.ok;
  return upgradeCandidateToBounded(upgradeCandidateToQuick(structural));
}

function finalizeCandidate(candidate) {
  if (!candidate?.level || !candidate?.band) {
    return candidate;
  }
  const isChapterTwo = candidate.level.chapter === 2;
  const options = {
    maxStates: isChapterTwo ? 7000 : 12000,
    maxSolutions: isChapterTwo ? 10 : 12,
    solutionDepthSlack: 1,
    solutionFamilyCap: Math.max(4, candidate.band.solutionFamilyMax || 4),
  };
  let report = validateLevelFull(candidate.level, options);
  if (!report.isSolvable || report.reason === 'search_limit') {
    report = validateLevelFull(candidate.level, {
      ...options,
      maxStates: isChapterTwo ? 14000 : 30000,
      maxSolutions: isChapterTwo ? 6 : 8,
    });
  }
  const evaluation = evaluateLevelAgainstBand(candidate.level, report, candidate.band);
  return {
    ...candidate,
    ok: evaluation.ok,
    report,
    evaluation,
    score: scoreCandidate(candidate.level, report, candidate.band, evaluation),
  };
}

function collectStructuralCandidatePool(chapterNumber, levelIndex, attempts, band) {
  const fingerprints = new Map();
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidate = buildCandidateForAttempt(chapterNumber, levelIndex, attempt, band);
    if (!candidate?.level) {
      continue;
    }
    const fingerprint = getCandidateLayoutFingerprint(candidate.level);
    const previous = fingerprints.get(fingerprint);
    if (!previous || compareStructuralCandidateStrength(candidate, previous) > 0) {
      fingerprints.set(fingerprint, candidate);
    }
  }
  return sortCandidatesDescending([...fingerprints.values()], compareStructuralCandidateStrength);
}

function selectBestCandidate(chapterNumber, levelIndex, baseAttempts = chapterNumber === 2 ? 4 : 4, fallbackAttempts = chapterNumber === 2 ? 10 : 12) {
  const band = getEffectiveBand(chapterNumber, levelIndex);
  if (!band) {
    return { ok: false, reason: 'missing_band' };
  }
  const structuralAttempts = Math.max(fallbackAttempts, getStructuralAttemptBudget(chapterNumber, band, false));
  const structuralPool = collectStructuralCandidatePool(chapterNumber, levelIndex, structuralAttempts, band);
  const quickLimit = Math.min(structuralPool.length, Math.max(baseAttempts, getQuickShortlistLimit(chapterNumber, band, false)));
  const quickPool = sortCandidatesDescending(
    structuralPool.slice(0, quickLimit).map((candidate) => upgradeCandidateToQuick(candidate)),
    compareCandidateStrength,
  );

  let bestQuick = quickPool[0] || null;
  const boundedLimit = Math.min(quickPool.length, getIntermediateShortlistLimit(chapterNumber, band));
  const boundedPool = sortCandidatesDescending(
    quickPool.slice(0, boundedLimit).map((candidate) => upgradeCandidateToBounded(candidate)),
    compareCandidateStrength,
  );
  let bestBounded = boundedPool[0] || null;
  let bestFinal = null;
  const fullAdmissionPool = boundedPool.filter((candidate) => shouldRunFullValidation(candidate));
  const finalizationLimit = Math.min(fullAdmissionPool.length, getFinalizationShortlistLimit(chapterNumber, band));
  for (const candidate of fullAdmissionPool.slice(0, finalizationLimit)) {
    const finalized = finalizeCandidate(candidate);
    if (!bestFinal || compareCandidateStrength(finalized, bestFinal) > 0) {
      bestFinal = finalized;
    }
    if (finalized.ok) {
      return finalized;
    }
  }

  if (!bestQuick && structuralPool.length) {
    bestQuick = upgradeCandidateToQuick(structuralPool[0]);
  }
  if (!bestBounded && bestQuick) {
    bestBounded = upgradeCandidateToBounded(bestQuick);
  }

  const fallback = buildFallbackCandidate(chapterNumber, levelIndex);
  if (fallback?.report?.isSolvable) {
    if (!bestFinal || compareCandidateStrength(fallback, bestFinal) > 0) {
      bestFinal = fallback;
    }
    if (!bestBounded || compareCandidateStrength(fallback, bestBounded) > 0) {
      bestBounded = fallback;
    }
    if (!bestQuick || compareCandidateStrength(fallback, bestQuick) > 0) {
      bestQuick = fallback;
    }
  }
  return bestFinal || bestBounded || bestQuick || fallback;
}

function selectBestQuickCandidate(chapterNumber, levelIndex, attempts = chapterNumber === 2 ? 1 : chapterNumber === 3 ? 1 : 3) {
  const band = getEffectiveBand(chapterNumber, levelIndex);
  if (!band) {
    return { ok: false, reason: 'missing_band' };
  }
  const structuralAttempts = Math.max(attempts, getStructuralAttemptBudget(chapterNumber, band, true));
  const structuralPool = collectStructuralCandidatePool(chapterNumber, levelIndex, structuralAttempts, band);
  const quickLimit = Math.min(structuralPool.length, Math.max(attempts, getQuickShortlistLimit(chapterNumber, band, true)));
  const quickPool = sortCandidatesDescending(
    structuralPool.slice(0, quickLimit).map((candidate) => upgradeCandidateToQuick(candidate)),
    compareCandidateStrength,
  );
  return quickPool[0] || (structuralPool.length ? upgradeCandidateToQuick(structuralPool[0]) : buildFallbackCandidate(chapterNumber, levelIndex));
}

function selectStructuralPreviewCandidate(chapterNumber, levelIndex, previewKey = 'preview') {
  const band = getEffectiveBand(chapterNumber, levelIndex);
  if (!band) {
    return { ok: false, reason: 'missing_band' };
  }
  const rng = createRng(hashSeed(`shift-structural-preview:${previewKey}:${chapterNumber}:${levelIndex}`));
  const baseAttempt = 1 + Math.floor(rng() * 128);
  const attempts = Array.from({ length: chapterNumber === 2 ? 6 : 4 }, (_, index) => baseAttempt + (index * 17));
  let best = null;
  attempts.forEach((attempt) => {
    const candidate = buildCandidateForAttempt(chapterNumber, levelIndex, attempt, band);
    if (!best || compareStructuralCandidateStrength(candidate, best) > 0) {
      best = candidate;
    }
  });
  return best || buildFallbackCandidate(chapterNumber, levelIndex);
}


function isFullPassCandidate(candidate) {
  return !!candidate
    && candidate.validationStage === 'full'
    && !!candidate.ok
    && !!candidate.report?.isSolvable;
}

function isPreviewOnlyCandidate(candidate) {
  return !!candidate?.level && !isFullPassCandidate(candidate);
}

function getCandidateSummaryReason(candidate, requireFullPass = false) {
  if (!candidate?.level) {
    return 'candidate_not_built';
  }
  if (isFullPassCandidate(candidate)) {
    return 'ok';
  }
  if (requireFullPass) {
    return candidate?.ok ? 'needs_full_pass' : 'needs_regen';
  }
  return candidate?.ok ? 'preview_only' : 'best_effort';
}

function quote(value) {
  return JSON.stringify(value);
}

function renderShapeCells(shapeCells) {
  return `[${shapeCells.map((cell) => `{ x: ${cell.x}, y: ${cell.y} }`).join(', ')}]`;
}

function renderExit(exit) {
  return `        createExit(${quote(exit.id)}, ${quote(exit.edge)}, ${exit.start}, ${exit.span}, ${quote(exit.acceptColor)})`;
}

function renderBlock(block) {
  const fields = [
    `id: ${quote(block.id)}`,
    `style: ${quote(block.style)}`,
    `x: ${block.x}`,
    `y: ${block.y}`,
    `shapePreset: ${quote(block.shapePreset)}`,
    `shapeVariant: ${quote(block.shapeVariant || 'default')}`,
    `shapeCells: ${renderShapeCells(block.shapeCells)}`,
  ];
  if (block.moveAxis && block.moveAxis !== 'both') {
    fields.push(`moveAxis: ${quote(block.moveAxis)}`);
  }
  if (block.baseMoveAxis && block.baseMoveAxis !== block.moveAxis && block.baseMoveAxis !== 'both') {
    fields.push(`baseMoveAxis: ${quote(block.baseMoveAxis)}`);
  }
  return `        createBlock({ ${fields.join(', ')} })`;
}

function renderLevel(level) {
  const lines = [];
  lines.push(`    level(${level.index}, {`);
  lines.push(`      title: ${quote(level.title)},`);
  if (level.board.rows !== 8) {
    lines.push(`      rows: ${level.board.rows},`);
  }
  lines.push(`      difficultyBand: ${quote(level.meta?.difficultyBand || 'teaching')},`);
  if ((level.meta?.tags || []).length) {
    lines.push(`      tags: ${quote(level.meta.tags)},`);
  }
  lines.push('      exits: [');
  lines.push(level.exits.map(renderExit).join(',\n'));
  lines.push('      ],');
  lines.push('      blocks: [');
  lines.push(level.blocks.map(renderBlock).join(',\n'));
  lines.push('      ],');
  lines.push('    })');
  return lines.join('\n');
}

function sanitizePreviewKey(previewKey = '') {
  return String(previewKey || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'preview';
}

function toConstToken(value = '') {
  return sanitizePreviewKey(value)
    .replace(/-/g, '_')
    .toUpperCase();
}

function buildPreviewChapterMeta(chapterMeta, previewKey, startIndex, endIndex) {
  const safePreviewKey = sanitizePreviewKey(previewKey);
  return {
    ...chapterMeta,
    id: `${chapterMeta.id}-${safePreviewKey}`,
    title: `${chapterMeta.title} · 试玩`,
    shortTitle: `${chapterMeta.shortTitle}试玩`,
    tagline: `试玩批次 ${startIndex}-${endIndex}`,
  };
}

function buildPreviewLevels(levels = []) {
  return levels.map((level) => ({
    ...level,
    title: `${level.title} · 试玩`,
    meta: {
      ...(level.meta || {}),
      tags: [...new Set([...(level.meta?.tags || []), 'preview-only'])],
      previewOnly: true,
    },
  }));
}

function renderChapterModule(chapter, levels, options = {}) {
  const chapterNumber = chapter.number;
  const constName = options.constName || `CAMPAIGN_CHAPTER_${String(chapterNumber).padStart(2, '0')}`;
  return `import { createBlock, createCampaignLevel, createExit } from '../catalog.js';

const CHAPTER = ${chapterNumber};
const TITLE = ${quote(chapter.title)};
const SHORT = ${quote(chapter.shortTitle)};
const TAGLINE = ${quote(chapter.tagline)};

function level(index, definition) {
  return createCampaignLevel({
    chapter: CHAPTER,
    index,
    chapterTitle: TITLE,
    chapterShortTitle: SHORT,
    chapterTagline: TAGLINE,
    cols: 6,
    rows: definition.rows || 8,
    ...definition,
  });
}

export const ${constName} = {
  id: ${quote(chapter.id)},
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels: [
${levels.map(renderLevel).join(',\n')}
  ],
};
`;
}

async function main() {
  const write = process.argv.includes('--write');
  const quickOnly = process.argv.includes('--quick-only');
  const structuralOnly = process.argv.includes('--structural-only');
  const writePreviewArg = process.argv.find((arg) => arg.startsWith('--write-preview='));
  const writePreviewKey = writePreviewArg ? sanitizePreviewKey(writePreviewArg.split('=')[1]) : '';
  if (write && quickOnly) {
    console.error('--write 只允许配合正式 full-pass 生成，不能和 --quick-only 一起使用。');
    process.exit(1);
  }
  if (write && structuralOnly) {
    console.error('--write 不能和 --structural-only 一起使用；纯结构结果只允许导出试玩批次。');
    process.exit(1);
  }
  const previewMode = !!writePreviewKey;
  const requireFullPass = write;
  const chapterArg = process.argv.find((arg) => arg.startsWith('--chapter='));
  const fromArg = process.argv.find((arg) => arg.startsWith('--from='));
  const toArg = process.argv.find((arg) => arg.startsWith('--to='));
  const chapterFilter = chapterArg ? Number(chapterArg.split('=')[1]) || null : null;
  const fromLevel = fromArg ? Math.max(1, Number(fromArg.split('=')[1]) || 1) : 1;
  const toLevel = toArg ? Math.max(fromLevel, Number(toArg.split('=')[1]) || fromLevel) : null;
  const summaries = [];

  for (const chapterNumber of CHAPTER_BUILD_ORDER) {
    if (chapterFilter && chapterFilter !== chapterNumber) {
      continue;
    }
    const chapterMeta = CHAPTER_META[chapterNumber] || SOURCE_CHAPTERS[chapterNumber] || {
      id: `chapter-${String(chapterNumber).padStart(2, '0')}`,
      number: chapterNumber,
      title: `第 ${chapterNumber} 章`,
      shortTitle: `第${chapterNumber}章`,
      tagline: '',
    };
    const levelCount = getChapterBand(chapterNumber)?.levelCount || 30;
    const startIndex = Math.max(1, Math.min(levelCount, fromLevel));
    const endIndex = toLevel ? Math.max(startIndex, Math.min(levelCount, toLevel)) : levelCount;
    const levels = [];
    console.log(`generating chapter ${chapterNumber} (${chapterMeta.title}) levels ${startIndex}-${endIndex}...`);
    for (let levelIndex = startIndex; levelIndex <= endIndex; levelIndex += 1) {
      const candidate = structuralOnly
        ? selectStructuralPreviewCandidate(chapterNumber, levelIndex, writePreviewKey || 'preview')
        : quickOnly
          ? selectBestQuickCandidate(chapterNumber, levelIndex)
          : selectBestCandidate(chapterNumber, levelIndex);
      const rowSummary = {
        id: `c${String(chapterNumber).padStart(2, '0')}-l${String(levelIndex).padStart(2, '0')}`,
        ok: !!candidate?.ok,
      };
      if (!candidate || !candidate.level) {
        rowSummary.reason = 'candidate_not_built';
        rowSummary.writeEligible = false;
        summaries.push(rowSummary);
        continue;
      }
      rowSummary.validationStage = candidate.validationStage || 'unknown';
      rowSummary.writeEligible = isFullPassCandidate(candidate);
      rowSummary.previewOnly = isPreviewOnlyCandidate(candidate);
      rowSummary.reason = getCandidateSummaryReason(candidate, requireFullPass);
      rowSummary.score = candidate.score;
      rowSummary.occupancy = Number(occupancyRate(candidate.level).toFixed(3));
      rowSummary.colors = uniqueColors(candidate.level).length;
      rowSummary.doors = collectDoorMetrics(candidate.level);
      rowSummary.moves = candidate.report.bestMoveCountEstimate;
      rowSummary.families = candidate.report.solutionFamilyCount;
      rowSummary.segment = candidate.band.segmentKey;
      rowSummary.failedChecks = Object.entries(candidate.evaluation.checks)
        .filter(([, value]) => !value)
        .map(([key]) => key);
      if (!requireFullPass || rowSummary.writeEligible) {
        levels.push(candidate.level);
      }
      summaries.push(rowSummary);
      console.log(`${rowSummary.id} ${rowSummary.reason} stage=${rowSummary.validationStage} segment=${rowSummary.segment} occ=${rowSummary.occupancy} colors=${rowSummary.colors} doors=${rowSummary.doors.doorGroupCount}/${rowSummary.doors.doorSlotCount}/${rowSummary.doors.doorCompetitionCount} moves=${rowSummary.moves ?? 'n/a'} families=${rowSummary.families} score=${rowSummary.score}${rowSummary.failedChecks.length ? ` failed=${rowSummary.failedChecks.join('|')}` : ''}${requireFullPass && !rowSummary.writeEligible ? ' write=blocked' : ''}`);
    }

    if (writePreviewKey && levels.length) {
      const previewMeta = buildPreviewChapterMeta(chapterMeta, writePreviewKey, startIndex, endIndex);
      const previewLevels = buildPreviewLevels(levels);
      const previewFilename = path.join(CAMPAIGN_DIR, `chapter-${String(chapterNumber).padStart(2, '0')}-preview-${writePreviewKey}.js`);
      const previewConstName = `CAMPAIGN_CHAPTER_${String(chapterNumber).padStart(2, '0')}_PREVIEW_${toConstToken(writePreviewKey)}`;
      await fs.writeFile(previewFilename, renderChapterModule(previewMeta, previewLevels, { constName: previewConstName }), 'utf8');
      console.log(`preview_written=${previewFilename}`);
    }

    if (write && startIndex === 1 && endIndex === levelCount) {
      const fullPassCount = summaries
        .filter((summary) => summary.id.startsWith(`c${String(chapterNumber).padStart(2, '0')}-`))
        .filter((summary) => summary.writeEligible)
        .length;
      if (levels.length === levelCount && fullPassCount === levelCount) {
        const filename = path.join(CAMPAIGN_DIR, `chapter-${String(chapterNumber).padStart(2, '0')}.js`);
        await fs.writeFile(filename, renderChapterModule(chapterMeta, levels), 'utf8');
      } else {
        console.log(`chapter ${chapterNumber} write_skipped full_pass=${fullPassCount}/${levelCount}`);
      }
    }
  }

  const failed = summaries.filter((summary) => !summary.ok);
  const blockedWrites = requireFullPass
    ? summaries.filter((summary) => !summary.writeEligible)
    : [];
  const buildFailures = summaries.filter((summary) => summary.reason === 'candidate_not_built');
  const shouldIgnoreQualityFailures = previewMode && !requireFullPass;
  if (buildFailures.length || blockedWrites.length || (!shouldIgnoreQualityFailures && failed.length)) {
    console.log(`failed=${failed.length}${blockedWrites.length ? ` write_blocked=${blockedWrites.length}` : ''}${buildFailures.length ? ` build_failed=${buildFailures.length}` : ''}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
