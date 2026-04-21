import { clone } from '../data/catalog.js';
import { collectExitLayoutIssues } from './exit-rules.js';
import { createLevelFootprintContext } from './footprints.js';
import {
  MOVE_AXIS_SET,
  canPlaceBlockAtAnchor,
  collectUnsupportedMechanics,
  createLevelSignature as createSharedLevelSignature,
  createStateHash as createSharedStateHash,
  getCompatibleExits as getSharedCompatibleExits,
  getExitMatch as getSharedExitMatch,
  getMoveDeltas as getSharedMoveDeltas,
  getOccupiedCells as getSharedOccupiedCells,
  getProjectionLength as getSharedProjectionLength,
  getProjectionSpan as getSharedProjectionSpan,
  normalizeLevelStatic,
  settleLevelAction,
} from './level-state.js';

const EDGE_SET = new Set(['left', 'right', 'top', 'bottom']);
const DEFAULT_MAX_STATES = 12000;
const DEFAULT_MAX_SOLUTIONS = 24;
const DEFAULT_DEPTH_SLACK = 2;
const DEFAULT_SOLUTION_FAMILY_CAP = 6;

const QUICK_VALIDATE_OPTION_DEFAULTS = {
  maxStates: 1600,
  maxSolutions: 4,
  solutionDepthSlack: 1,
  solutionFamilyCap: 4,
};

const MEDIUM_VALIDATE_OPTION_DEFAULTS = {
  maxStates: 3200,
  maxSolutions: 2,
  solutionDepthSlack: 1,
  solutionFamilyCap: 4,
  maxBlocksPerState: 8,
  maxAnchorsPerBlock: 5,
};

const FULL_VALIDATE_OPTION_DEFAULTS = {};

const FIRST_CLEAR_QUICK_OPTION_DEFAULTS = {
  firstClearMaxStates: 600,
  firstClearMaxRoutes: 6,
  firstClearDepthSlack: 1,
  firstClearRouteFamilyCap: 4,
};

const FIRST_CLEAR_MEDIUM_OPTION_DEFAULTS = {
  firstClearMaxStates: 900,
  firstClearMaxRoutes: 4,
  firstClearDepthSlack: 1,
  firstClearRouteFamilyCap: 3,
  firstClearMaxBlocksPerState: 8,
  firstClearMaxAnchorsPerBlock: 5,
};

const FIRST_CLEAR_FULL_OPTION_DEFAULTS = {
  firstClearMaxStates: 1200,
  firstClearMaxRoutes: 10,
  firstClearDepthSlack: 1,
  firstClearRouteFamilyCap: 6,
};

const MAINLINE_DIFFICULTY_SCORE_BANDS = {
  hard: [58, 72],
  expert: [73, 88],
  brutal: [89, 100],
  'endless-peak': [80, 92],
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function roundMetric(value, digits = 1) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Number(clamp(value, 0, 100).toFixed(digits));
}

function scoreFromBand(value, min, max) {
  if (!Number.isFinite(value)) {
    return 0;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return 0;
  }
  if (max <= min) {
    return value >= max ? 100 : 0;
  }
  return roundMetric(((clamp(value, min, max) - min) / (max - min)) * 100);
}

function inverseScoreFromBand(value, min, max) {
  return roundMetric(100 - scoreFromBand(value, min, max));
}

function averageNumbers(values = []) {
  const numbers = (values || []).filter((value) => Number.isFinite(value));
  if (!numbers.length) {
    return 0;
  }
  return numbers.reduce((sum, value) => sum + value, 0) / numbers.length;
}

function weightedAverage(entries = []) {
  let total = 0;
  let weightTotal = 0;
  (entries || []).forEach((entry) => {
    const value = Array.isArray(entry) ? entry[0] : entry?.value;
    const weight = Array.isArray(entry) ? entry[1] : entry?.weight;
    if (!Number.isFinite(value) || !Number.isFinite(weight) || weight <= 0) {
      return;
    }
    total += value * weight;
    weightTotal += weight;
  });
  if (!weightTotal) {
    return 0;
  }
  return roundMetric(total / weightTotal);
}

function countOccupiedCells(level) {
  return (level.blocks || []).reduce((sum, block) => sum + block.shapeCells.length, 0);
}

function getActiveColors(level) {
  return [...new Set((level.blocks || []).map((block) => block.style).filter(Boolean))].sort();
}

function calibrateDifficultyScore(score) {
  if (!Number.isFinite(score)) {
    return null;
  }
  return roundMetric(score + ((100 - score) * 0.33));
}

function getDifficultyTierFromScore(score) {
  if (!Number.isFinite(score)) {
    return null;
  }
  if (score >= MAINLINE_DIFFICULTY_SCORE_BANDS.brutal[0]) {
    return 'brutal';
  }
  if (score >= MAINLINE_DIFFICULTY_SCORE_BANDS.expert[0]) {
    return 'expert';
  }
  if (score >= MAINLINE_DIFFICULTY_SCORE_BANDS.hard[0]) {
    return 'hard';
  }
  return 'unrated';
}

function blockTouchesMatchingExit(level, block, exit) {
  return block.shapeCells.some((cell) => {
    const x = block.x + cell.x;
    const y = block.y + cell.y;
    if (exit.edge === 'left') {
      return x === 0 && y >= exit.start && y < exit.start + exit.span;
    }
    if (exit.edge === 'right') {
      return x === level.board.cols - 1 && y >= exit.start && y < exit.start + exit.span;
    }
    if (exit.edge === 'top') {
      return y === 0 && x >= exit.start && x < exit.start + exit.span;
    }
    return y === level.board.rows - 1 && x >= exit.start && x < exit.start + exit.span;
  });
}

function createEmptyDifficultyVector() {
  return {
    openingHiddenness: null,
    solutionLength: null,
    solutionNarrowness: null,
    dependencyDepth: null,
    boardPressure: null,
    mobilitySuppression: null,
    mechanicBurden: null,
    perceptualLoad: null,
  };
}

function createEmptyDifficultyReport() {
  return {
    fastDifficultyScore: null,
    solverDifficultyScore: null,
    difficultyScore: null,
    difficultyTier: null,
    difficultyVector: createEmptyDifficultyVector(),
  };
}

function buildDifficultyReport(level, structure, solveReport, openingStaticMetrics = null, firstClearReport = null) {
  if (!level || !structure) {
    return createEmptyDifficultyReport();
  }

  const blocks = level.blocks || [];
  const boardCells = Math.max(1, (level.board?.cols || 0) * (level.board?.rows || 0));
  const occupiedCells = countOccupiedCells(level);
  const emptyCells = Math.max(0, boardCells - occupiedCells);
  const occupancyRate = occupiedCells / boardCells;
  const activeColors = getActiveColors(level);
  const effectiveOpeningStaticMetrics = openingStaticMetrics || collectOpeningStaticMetrics(level);
  const openingActionCount = Number.isFinite(solveReport?.openingActionCount) && solveReport.openingActionCount > 0
    ? solveReport.openingActionCount
    : effectiveOpeningStaticMetrics.openingActionCountRaw;
  const immediateClearBlockCount = effectiveOpeningStaticMetrics.directClearCount;
  const matchingEdgeTouchCount = effectiveOpeningStaticMetrics.matchingEdgeTouchCount;
  const reachableAnchorCounts = blocks.map((block) => Math.max(0, getReachableAnchors(level, block).length - 1));
  const avgReachableAnchors = averageNumbers(reachableAnchorCounts);
  const lowMobilityRatio = blocks.length
    ? reachableAnchorCounts.filter((count) => count <= 2).length / blocks.length
    : 0;
  const fallbackExitDistance = Math.max(level.board?.cols || 0, level.board?.rows || 0, 1);
  const avgBestExitDistance = Number.isFinite(effectiveOpeningStaticMetrics.averageBestExitDistance)
    ? effectiveOpeningStaticMetrics.averageBestExitDistance
    : fallbackExitDistance;
  const effectiveFirstClearSetupDepth = Number.isFinite(solveReport?.firstClearSetupDepth)
    ? solveReport.firstClearSetupDepth
    : firstClearReport?.bestFirstClearSetupDepth;
  const effectiveFirstClearEdgeDistance = Number.isFinite(solveReport?.firstClearEdgeDistance)
    ? solveReport.firstClearEdgeDistance
    : firstClearReport?.firstClearEdgeDistance;
  const constrainedBlockRatio = blocks.length
    ? blocks.filter((block) => block.moveAxis !== 'both').length / blocks.length
    : 0;
  const mechanicTokenCount = (level.tiles?.length || 0)
    + (level.gates?.length || 0)
    + blocks.filter((block) => block.moveAxis !== 'both').length;
  const largeShapeRatio = blocks.length
    ? blocks.filter((block) => block.shapeCells.length >= 3).length / blocks.length
    : 0;
  const hasSolutionMetrics = !!solveReport?.isSolvable && Number.isFinite(solveReport.bestMoveCountEstimate);

  const staticOpeningHiddenness = weightedAverage([
    [inverseScoreFromBand(immediateClearBlockCount, 0, 3), 0.38],
    [inverseScoreFromBand(matchingEdgeTouchCount, 0, 4), 0.24],
    [scoreFromBand(avgBestExitDistance, 0, 4), 0.18],
    [inverseScoreFromBand(openingActionCount, 1, 6), 0.20],
  ]);
  const dynamicOpeningHiddenness = hasSolutionMetrics || Number.isFinite(effectiveFirstClearSetupDepth)
    ? weightedAverage([
      [scoreFromBand(effectiveFirstClearSetupDepth ?? 0, 0, 5), 0.50],
      [scoreFromBand(effectiveFirstClearEdgeDistance ?? 0, 0, 4), 0.25],
      [inverseScoreFromBand(immediateClearBlockCount, 0, 3), 0.15],
      [inverseScoreFromBand(matchingEdgeTouchCount, 0, 4), 0.10],
    ])
    : null;
  const openingHiddenness = dynamicOpeningHiddenness == null
    ? staticOpeningHiddenness
    : weightedAverage([
      [staticOpeningHiddenness, 0.45],
      [dynamicOpeningHiddenness, 0.55],
    ]);

  const solutionLength = hasSolutionMetrics
    ? weightedAverage([
      [scoreFromBand(solveReport.bestMoveCountEstimate ?? 0, 18, 60), 0.72],
      [scoreFromBand((solveReport.bestMoveCountEstimate || 0) / Math.max(1, blocks.length), 1.2, 4.2), 0.28],
    ])
    : 0;
  const solutionNarrowness = hasSolutionMetrics
    ? weightedAverage([
      [inverseScoreFromBand(solveReport.solutionFamilyCount || 6, 1, 6), 0.58],
      [inverseScoreFromBand(openingActionCount, 1, 6), 0.24],
      [scoreFromBand(effectiveFirstClearSetupDepth ?? 0, 0, 5), 0.18],
    ])
    : 0;
  const dependencyDepth = hasSolutionMetrics
    ? weightedAverage([
      [scoreFromBand(solveReport.dependencyDepth ?? 0, 0, 6), 0.65],
      [scoreFromBand(solveReport.averageSetupSpan ?? 0, 0, 4), 0.35],
    ])
    : 0;
  const boardPressure = weightedAverage([
    [scoreFromBand(occupancyRate, 0.64, 0.80), 0.42],
    [inverseScoreFromBand(emptyCells, 8, 20), 0.16],
    [scoreFromBand(avgBestExitDistance, 0, 4), 0.24],
    [scoreFromBand(structure.doorCompetitionCount || 0, 0, 8), 0.18],
  ]);
  const mobilitySuppression = weightedAverage([
    [inverseScoreFromBand(avgReachableAnchors, 1, 10), 0.55],
    [scoreFromBand(lowMobilityRatio, 0, 0.60), 0.25],
    [scoreFromBand(constrainedBlockRatio, 0, 0.50), 0.20],
  ]);
  const mechanicBurden = weightedAverage([
    [scoreFromBand(constrainedBlockRatio, 0, 0.55), 0.45],
    [scoreFromBand(level.gates?.length || 0, 0, 4), 0.30],
    [scoreFromBand((level.tiles?.length || 0) + mechanicTokenCount * 0.15, 0, 6), 0.25],
  ]);
  const perceptualLoad = weightedAverage([
    [scoreFromBand(blocks.length, 12, 24), 0.40],
    [scoreFromBand(activeColors.length, 4, 6), 0.20],
    [scoreFromBand(level.board?.rows || 0, 8, 11), 0.15],
    [scoreFromBand(structure.doorSlotCount || 0, 8, 15), 0.15],
    [scoreFromBand(largeShapeRatio, 0.15, 0.50), 0.10],
  ]);

  const difficultyVector = {
    openingHiddenness,
    solutionLength,
    solutionNarrowness,
    dependencyDepth,
    boardPressure,
    mobilitySuppression,
    mechanicBurden,
    perceptualLoad,
  };

  const fastDifficultyScoreRaw = weightedAverage([
    [openingHiddenness, 0.22],
    [boardPressure, 0.28],
    [mobilitySuppression, 0.24],
    [mechanicBurden, 0.12],
    [perceptualLoad, 0.14],
  ]);
  const solverDifficultyScoreRaw = hasSolutionMetrics
    ? weightedAverage([
      [openingHiddenness, 0.16],
      [solutionLength, 0.26],
      [solutionNarrowness, 0.28],
      [dependencyDepth, 0.18],
      [boardPressure, 0.07],
      [mechanicBurden, 0.05],
    ])
    : null;

  let difficultyScoreRaw = solverDifficultyScoreRaw == null
    ? fastDifficultyScoreRaw
    : roundMetric((fastDifficultyScoreRaw * 0.42) + (solverDifficultyScoreRaw * 0.58));
  if (hasSolutionMetrics && solveReport.familySearchComplete === false) {
    difficultyScoreRaw = roundMetric(difficultyScoreRaw * 0.97);
  }

  const fastDifficultyScore = calibrateDifficultyScore(fastDifficultyScoreRaw);
  const solverDifficultyScore = solverDifficultyScoreRaw == null
    ? null
    : calibrateDifficultyScore(solverDifficultyScoreRaw);
  const difficultyScore = calibrateDifficultyScore(difficultyScoreRaw);

  return {
    fastDifficultyScore,
    solverDifficultyScore,
    difficultyScore,
    difficultyTier: getDifficultyTierFromScore(difficultyScore),
    difficultyVector,
  };
}


function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.floor(number);
}

function normalizeLevel(sourceLevel = {}) {
  return normalizeLevelStatic(sourceLevel);
}

function getOccupiedCells(block, originX = block.x, originY = block.y) {
  return getSharedOccupiedCells(block, { x: originX, y: originY });
}

function getMoveDeltas(moveAxis = 'both') {
  return getSharedMoveDeltas(moveAxis);
}

function canPlace(level, block, x, y, ignoreId = '', approachDir = '') {
  return canPlaceBlockAtAnchor(level, block.id, { x, y }, { ignoreBlockId: ignoreId, approachDir });
}

function touchesExitEdge(level, block, edge) {
  return getOccupiedCells(block).some((cell) => {
    if (edge === 'left') {
      return cell.x === 0;
    }
    if (edge === 'right') {
      return cell.x === level.board.cols - 1;
    }
    if (edge === 'top') {
      return cell.y === 0;
    }
    return cell.y === level.board.rows - 1;
  });
}

function getProjectionSpan(block, edge) {
  return getSharedProjectionSpan(block, edge);
}

function getProjectionLength(block, edge) {
  return getSharedProjectionLength(block, edge);
}

function getExitMatch(level, block) {
  return getSharedExitMatch(level, block);
}

function getCompatibleExits(level, block) {
  return getSharedCompatibleExits(level, block);
}

function collectDoorMetrics(level, footprintContext = null) {
  const exits = level.exits || [];
  const blocks = level.blocks || [];
  const context = footprintContext || createLevelFootprintContext(level);
  const compatibleBlocksByExit = new Map(exits.map((exit) => [exit.id, []]));
  const compatibleExitsByBlock = new Map();

  blocks.forEach((block) => {
    const blockStats = context.getBlockStats(block.id);
    const compatibleExits = blockStats?.compatibleExits || getCompatibleExits(level, block);
    const exitIds = compatibleExits.map((exit) => exit.id);
    compatibleExitsByBlock.set(block.id, exitIds);
    compatibleExits.forEach((exit) => {
      const list = compatibleBlocksByExit.get(exit.id) || [];
      list.push(block.id);
      compatibleBlocksByExit.set(exit.id, list);
    });
  });

  const contestedExits = [];
  compatibleBlocksByExit.forEach((blockIds, exitId) => {
    const uniqueBlockIds = [...new Set(blockIds)];
    if (uniqueBlockIds.length >= 2) {
      contestedExits.push({ exitId, blockIds: uniqueBlockIds });
    }
  });

  const multiExitBlocks = [];
  compatibleExitsByBlock.forEach((exitIds, blockId) => {
    const uniqueExitIds = [...new Set(exitIds)];
    if (uniqueExitIds.length >= 2) {
      multiExitBlocks.push({ blockId, exitIds: uniqueExitIds });
    }
  });

  return {
    doorGroupCount: exits.length,
    doorSlotCount: exits.reduce((sum, exit) => sum + Math.max(0, exit.span), 0),
    doorCompetitionCount: contestedExits.length + multiExitBlocks.length,
    compatibleBlocksByExit,
    compatibleExitsByBlock,
  };
}

function createStateHash(level) {
  return createSharedStateHash(level);
}

function createLevelSignature(level) {
  return createSharedLevelSignature(level);
}

function getReachableAnchors(level, block) {
  const visited = new Set([`${block.x},${block.y}`]);
  const queue = [{ x: block.x, y: block.y }];
  const anchors = [{ x: block.x, y: block.y }];
  const candidates = getMoveDeltas(block.moveAxis);

  while (queue.length) {
    const current = queue.shift();
    for (const delta of candidates) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = `${next.x},${next.y}`;
      if (visited.has(key)) {
        continue;
      }
      if (!canPlace(level, block, next.x, next.y, block.id, getApproachDirFromDelta(delta))) {
        continue;
      }
      visited.add(key);
      anchors.push(next);
      queue.push(next);
    }
  }

  return anchors;
}

function getApproachDirFromDelta(delta = {}) {
  if (delta.x > 0) {
    return 'right';
  }
  if (delta.x < 0) {
    return 'left';
  }
  if (delta.y > 0) {
    return 'bottom';
  }
  if (delta.y < 0) {
    return 'top';
  }
  return '';
}

function findAnchorPath(level, block, targetAnchor) {
  if (!block) {
    return null;
  }
  if (targetAnchor.x === block.x && targetAnchor.y === block.y) {
    return [];
  }
  const queue = [{ x: block.x, y: block.y }];
  const visited = new Set([`${block.x},${block.y}`]);
  const parentByKey = new Map();
  const deltas = getMoveDeltas(block.moveAxis);
  while (queue.length) {
    const current = queue.shift();
    for (const delta of deltas) {
      const next = { x: current.x + delta.x, y: current.y + delta.y };
      const key = `${next.x},${next.y}`;
      if (visited.has(key)) {
        continue;
      }
      const approachDir = getApproachDirFromDelta(delta);
      if (!canPlace(level, block, next.x, next.y, block.id, approachDir)) {
        continue;
      }
      visited.add(key);
      parentByKey.set(key, {
        previousKey: `${current.x},${current.y}`,
        anchor: next,
        approachDir,
      });
      if (next.x === targetAnchor.x && next.y === targetAnchor.y) {
        const path = [];
        let cursor = key;
        while (cursor !== `${block.x},${block.y}`) {
          const step = parentByKey.get(cursor);
          if (!step) {
            break;
          }
          path.push({ ...step.anchor, approachDir: step.approachDir });
          cursor = step.previousKey;
        }
        return path.reverse();
      }
      queue.push(next);
    }
  }
  return null;
}

function scoreSearchBlock(level, block) {
  const exits = getCompatibleExits(level, block);
  const exitMatch = getExitMatch(level, block);
  const bestExitDistance = getBestExitDistance(level, block);
  let score = 0;
  score += block.shapeCells.length * 12;
  score += exitMatch ? 140 : 0;
  score += Number.isFinite(bestExitDistance) ? Math.max(0, 10 - bestExitDistance) * 14 : -24;
  score -= Math.max(0, exits.length - 1) * 6;
  return score;
}

function getSearchBlocks(level, options = {}) {
  const blocks = [...(level.blocks || [])];
  const maxBlocksPerState = Number.isFinite(options.maxBlocksPerState)
    ? Math.max(1, Math.floor(options.maxBlocksPerState))
    : Infinity;
  if (blocks.length <= maxBlocksPerState) {
    return blocks;
  }
  return blocks
    .map((block) => ({ block, score: scoreSearchBlock(level, block) }))
    .sort((left, right) => right.score - left.score || left.block.id.localeCompare(right.block.id))
    .slice(0, maxBlocksPerState)
    .map((entry) => entry.block);
}

function scoreSearchAnchor(level, block, anchor) {
  const preview = { ...block, x: anchor.x, y: anchor.y };
  const exitMatch = getExitMatch(level, preview);
  const bestExitDistance = getBestExitDistance(level, preview);
  const moveSpan = Math.abs(anchor.x - block.x) + Math.abs(anchor.y - block.y);
  let score = 0;
  score += exitMatch ? 180 : 0;
  score += Number.isFinite(bestExitDistance) ? Math.max(0, 10 - bestExitDistance) * 18 : -30;
  score += moveSpan * 4;
  return score;
}

function getInterestingAnchors(level, block, options = {}) {
  const anchors = getReachableAnchors(level, block);
  if (anchors.length <= 4) {
    return anchors;
  }

  const bucket = new Map();
  const add = (anchor) => {
    bucket.set(`${anchor.x},${anchor.y}`, anchor);
  };

  let minX = anchors[0];
  let maxX = anchors[0];
  let minY = anchors[0];
  let maxY = anchors[0];
  anchors.forEach((anchor) => {
    if (anchor.x < minX.x) minX = anchor;
    if (anchor.x > maxX.x) maxX = anchor;
    if (anchor.y < minY.y) minY = anchor;
    if (anchor.y > maxY.y) maxY = anchor;
  });

  add(minX);
  add(maxX);
  add(minY);
  add(maxY);
  add({ x: block.x, y: block.y });

  anchors.forEach((anchor) => {
    const preview = { ...block, x: anchor.x, y: anchor.y };
    const cells = getOccupiedCells(preview);
    if (cells.some((cell) => cell.x === 0 || cell.y === 0 || cell.x === level.board.cols - 1 || cell.y === level.board.rows - 1)) {
      add(anchor);
    }
    if (getExitMatch(level, preview)) {
      add(anchor);
    }
  });

  const deduped = [...bucket.values()];
  const maxAnchorsPerBlock = Number.isFinite(options.maxAnchorsPerBlock)
    ? Math.max(1, Math.floor(options.maxAnchorsPerBlock))
    : Infinity;
  if (deduped.length <= maxAnchorsPerBlock) {
    return deduped;
  }
  return deduped
    .map((anchor) => ({ anchor, score: scoreSearchAnchor(level, block, anchor) }))
    .sort((left, right) => right.score - left.score || left.anchor.y - right.anchor.y || left.anchor.x - right.anchor.x)
    .slice(0, maxAnchorsPerBlock)
    .map((entry) => entry.anchor);
}

function applyMoveResult(level, blockId, anchor) {
  const current = level.blocks.find((entry) => entry.id === blockId);
  if (!current) {
    return {
      level: clone(level),
      criticalEventChain: [],
      settleSummary: { cleared: false, exitId: null, events: [] },
    };
  }

  const path = findAnchorPath(level, current, anchor);
  const fallbackApproachDir = anchor.x > current.x
    ? 'right'
    : anchor.x < current.x
      ? 'left'
      : anchor.y > current.y
        ? 'bottom'
        : anchor.y < current.y
          ? 'top'
          : '';
  const steps = path && path.length
    ? path
    : [{ x: anchor.x, y: anchor.y, approachDir: fallbackApproachDir }];

  let workingLevel = clone(level);
  const aggregatedEvents = [];
  let latestSummary = { cleared: false, exitId: null, events: [] };

  for (const step of steps) {
    const result = settleLevelAction(workingLevel, {
      blockId,
      targetAnchor: { x: step.x, y: step.y },
      approachDir: step.approachDir || fallbackApproachDir,
    });
    if (!result.ok) {
      return {
        level: clone(level),
        criticalEventChain: [],
        settleSummary: { cleared: false, exitId: null, events: [] },
      };
    }
    workingLevel = result.level;
    latestSummary = result.settleSummary || latestSummary;
    aggregatedEvents.push(...(result.criticalEventChain || []));

    const movedBlock = workingLevel.blocks.find((entry) => entry.id === blockId);
    if (!movedBlock || latestSummary.cleared) {
      break;
    }
    if (movedBlock.x !== step.x || movedBlock.y !== step.y) {
      break;
    }
  }

  return {
    level: workingLevel,
    criticalEventChain: aggregatedEvents,
    settleSummary: latestSummary,
  };
}

function applyMove(level, blockId, anchor) {
  return applyMoveResult(level, blockId, anchor).level;
}

function reconstructPath(node) {
  const path = [];
  let current = node;
  while (current) {
    if (current.move) {
      path.push(current.move);
    }
    current = current.parent;
  }
  return path.reverse();
}

function serializeIssue(issue) {
  if (!issue) {
    return '';
  }
  return `${issue.type}:${issue.blockId || issue.exitId || issue.color || issue.detail || 'n/a'}`;
}

function getMobileViewportFit(level) {
  const cols = level.board?.cols || 0;
  const rows = level.board?.rows || 0;
  const matchesBoardSpec = cols === 6 && rows >= 8 && rows <= 12;
  const tier = !matchesBoardSpec
    ? (rows === 6 && cols >= 6 ? 'legacy-transition' : 'out-of-spec')
    : rows <= 10
      ? 'comfortable'
      : rows === 11
        ? 'tight'
        : 'extreme';
  const notes = [];
  if (cols !== 6) {
    notes.push('not-fixed-6-cols');
  }
  if (rows < 8 || rows > 12) {
    notes.push('rows-out-of-v2-range');
  }
  if (rows >= 11) {
    notes.push('requires-adaptive-camera');
  }
  return {
    matchesBoardSpec,
    tier,
    requiresAdaptiveCamera: rows >= 11,
    notes,
  };
}

function collectStructureReport(level) {
  const issues = [];
  const warnings = [];
  const unmatchedBlocks = [];
  const unusedExtraExits = [];
  const board = level.board || { cols: 0, rows: 0 };
  const footprintContext = createLevelFootprintContext(level);
  const doorMetrics = collectDoorMetrics(level, footprintContext);

  if (board.cols <= 0 || board.rows <= 0) {
    issues.push({ type: 'invalid_board', detail: `${board.cols}x${board.rows}` });
  }

  const mobileViewportFit = getMobileViewportFit(level);
  if (!mobileViewportFit.matchesBoardSpec) {
    warnings.push({ type: 'board_spec_warning', detail: `${board.cols}x${board.rows}` });
  }

  const unsupportedMechanicWarnings = collectUnsupportedMechanics(level);
  if ((level.tiles && level.tiles.length) || (level.gates && level.gates.length)) {
    if (unsupportedMechanicWarnings.length) {
      warnings.push(...unsupportedMechanicWarnings);
      warnings.push({ type: 'unsupported_mechanics', detail: `tiles:${level.tiles.length},gates:${level.gates.length}` });
    }
  }

  const blockIdSet = new Set();
  const occupancy = new Map();
  (level.blocks || []).forEach((block) => {
    if (blockIdSet.has(block.id)) {
      issues.push({ type: 'duplicate_block_id', blockId: block.id });
    }
    blockIdSet.add(block.id);

    if (block.role !== 'target') {
      warnings.push({ type: 'unsupported_block_role', blockId: block.id, detail: block.role });
    }
    if (!MOVE_AXIS_SET.has(block.moveAxis)) {
      issues.push({ type: 'invalid_move_axis', blockId: block.id, detail: block.moveAxis });
    }
    if (!block.style) {
      issues.push({ type: 'missing_block_style', blockId: block.id });
    }

    const blockStats = footprintContext.getBlockStats(block.id);
    const outOfBounds = [];
    (blockStats?.occupiedCells || getOccupiedCells(block)).forEach((cell) => {
      const key = `${cell.x},${cell.y}`;
      if (cell.x < 0 || cell.y < 0 || cell.x >= board.cols || cell.y >= board.rows) {
        outOfBounds.push(key);
        return;
      }
      const owner = occupancy.get(key);
      if (owner && owner !== block.id) {
        issues.push({ type: 'block_overlap', blockId: block.id, detail: `${owner}@${key}` });
      } else {
        occupancy.set(key, block.id);
      }
    });
    if (outOfBounds.length) {
      issues.push({ type: 'block_out_of_bounds', blockId: block.id, detail: outOfBounds.join('|') });
    }

    const compatibleExits = blockStats?.compatibleExits || getCompatibleExits(level, block);
    if (!compatibleExits.length) {
      unmatchedBlocks.push({
        blockId: block.id,
        style: block.style,
        minSpanByEdge: blockStats?.projectionLengthBySide || {
          left: getProjectionLength(block, 'left'),
          right: getProjectionLength(block, 'right'),
          top: getProjectionLength(block, 'top'),
          bottom: getProjectionLength(block, 'bottom'),
        },
      });
      issues.push({ type: 'unmatched_block_exit', blockId: block.id, color: block.style });
    }
  });

  const exitIdSet = new Set();
  (level.exits || []).forEach((exit) => {
    if (exitIdSet.has(exit.id)) {
      issues.push({ type: 'duplicate_exit_id', exitId: exit.id });
    }
    exitIdSet.add(exit.id);
    if (!EDGE_SET.has(exit.edge)) {
      issues.push({ type: 'invalid_exit_edge', exitId: exit.id, detail: exit.edge });
      return;
    }
    const axisLimit = exit.edge === 'left' || exit.edge === 'right' ? board.rows : board.cols;
    if (exit.span <= 0) {
      issues.push({ type: 'invalid_exit_span', exitId: exit.id, detail: exit.span });
    }
    if (exit.start < 0 || exit.start + exit.span > axisLimit) {
      issues.push({ type: 'exit_out_of_bounds', exitId: exit.id, detail: `${exit.start}:${exit.span}/${axisLimit}` });
    }
    if (!exit.acceptColor) {
      issues.push({ type: 'missing_exit_color', exitId: exit.id });
    }
  });

  const activeColors = new Set((level.blocks || []).map((block) => block.style).filter(Boolean));
  activeColors.forEach((color) => {
    const exitsForColor = (level.exits || []).filter((exit) => exit.acceptColor === color);
    if (!exitsForColor.length) {
      issues.push({ type: 'missing_color_exit', color });
    }
  });

  (level.exits || []).forEach((exit) => {
    const compatibleBlocks = doorMetrics.compatibleBlocksByExit.get(exit.id) || [];
    if (!compatibleBlocks.length) {
      unusedExtraExits.push({
        exitId: exit.id,
        acceptColor: exit.acceptColor,
        edge: exit.edge,
        start: exit.start,
        span: exit.span,
      });
    }
  });

  issues.push(...collectExitLayoutIssues(level.exits || []));

  return {
    issues,
    warnings,
    unmatchedBlocks,
    unusedExtraExits,
    mobileViewportFit,
    doorGroupCount: doorMetrics.doorGroupCount,
    doorSlotCount: doorMetrics.doorSlotCount,
    doorCompetitionCount: doorMetrics.doorCompetitionCount,
  };
}

function buildCriticalEventChain(path) {
  const chain = [];
  const movedSinceBoundary = [];
  const movedSet = new Set();

  const flushSetup = () => {
    if (!movedSinceBoundary.length) {
      return;
    }
    chain.push(`setup:${movedSinceBoundary.join(',')}`);
    movedSinceBoundary.length = 0;
    movedSet.clear();
  };

  path.forEach((step) => {
    if (!movedSet.has(step.blockId)) {
      movedSet.add(step.blockId);
      movedSinceBoundary.push(step.blockId);
    }

    const stepEvents = (step.criticalEventChain || []).filter((entry) => entry && !entry.startsWith('clear:'));
    if (stepEvents.length) {
      flushSetup();
      chain.push(...stepEvents);
    }

    if (step.cleared) {
      flushSetup();
      chain.push(`clear:${step.blockId}`);
    }
  });

  flushSetup();
  return chain;
}

function buildFamilySignature(criticalEventChain = [], clearOrder = []) {
  const signature = [];
  let currentIce = null;

  const flushIce = () => {
    if (!currentIce) {
      return;
    }
    signature.push(`ice:${currentIce.blockId}:${currentIce.count}`);
    currentIce = null;
  };

  criticalEventChain.forEach((entry) => {
    if (!entry) {
      return;
    }
    if (entry.startsWith('setup:')) {
      return;
    }
    if (entry.startsWith('ice:')) {
      const parts = entry.split(':');
      const blockId = parts[1] || 'block';
      if (currentIce && currentIce.blockId === blockId) {
        currentIce.count += 1;
      } else {
        flushIce();
        currentIce = { blockId, count: 1 };
      }
      return;
    }
    flushIce();
    if (entry.startsWith('clear:')) {
      signature.push(`clear:${entry.split(':')[1] || 'block'}`);
      return;
    }
    if (entry.startsWith('key:')) {
      const parts = entry.split(':');
      const gateId = (parts[1] || '').split('->')[1] || parts[1] || 'gate';
      signature.push(`key:${gateId}`);
      return;
    }
    if (entry.startsWith('toggle:')) {
      const parts = entry.split(':');
      signature.push(`toggle:${parts[1] || 'gate'}:${parts[2] || ''}`);
      return;
    }
    if (entry.startsWith('recolor:')) {
      const parts = entry.split(':');
      signature.push(`recolor:${parts[1] || 'block'}:${parts[2] || ''}`);
      return;
    }
    if (entry.startsWith('oneway:')) {
      const parts = entry.split(':');
      signature.push(`oneway:${parts[1] || 'block'}:${parts[2] || 'gate'}:${parts[3] || ''}`);
      return;
    }
    signature.push(entry);
  });

  flushIce();
  return signature.join('>') || clearOrder.join('>') || 'solved-empty';
}

function createSolutionSummary(path, hash) {
  const clearOrder = [];
  const clearStepIndexes = [];
  const setupSpans = [];
  let movesSinceLastClear = 0;

  path.forEach((step, index) => {
    movesSinceLastClear += 1;
    if (!step.cleared) {
      return;
    }
    clearOrder.push(step.blockId);
    clearStepIndexes.push(index + 1);
    setupSpans.push(Math.max(0, movesSinceLastClear - 1));
    movesSinceLastClear = 0;
  });

  const criticalEventChain = buildCriticalEventChain(path);
  const averageSetupSpan = setupSpans.length
    ? Number((setupSpans.reduce((sum, span) => sum + span, 0) / setupSpans.length).toFixed(2))
    : 0;

  return {
    moveCount: path.length,
    clearOrder,
    clearStepIndexes,
    firstClearMoveIndex: clearStepIndexes[0] ?? null,
    longestSetupSpan: setupSpans.length ? Math.max(...setupSpans) : 0,
    averageSetupSpan,
    criticalEventChain,
    familySignature: buildFamilySignature(criticalEventChain, clearOrder),
    stateHash: hash,
  };
}

function getEdgeDistance(level, block, edge) {
  const cells = getOccupiedCells(block);
  if (edge === 'left') {
    return Math.min(...cells.map((cell) => cell.x));
  }
  if (edge === 'right') {
    return level.board.cols - 1 - Math.max(...cells.map((cell) => cell.x));
  }
  if (edge === 'top') {
    return Math.min(...cells.map((cell) => cell.y));
  }
  return level.board.rows - 1 - Math.max(...cells.map((cell) => cell.y));
}


function getBestExitDistance(level, block) {
  const exits = getCompatibleExits(level, block);
  if (!exits.length) {
    return null;
  }
  return exits.reduce((best, exit) => Math.min(best, getEdgeDistance(level, block, exit.edge)), Number.POSITIVE_INFINITY);
}

function estimateExitPressure(level) {
  return (level.blocks || []).reduce((sum, block) => {
    const exits = getCompatibleExits(level, block);
    if (!exits.length) {
      return sum + 8;
    }
    let best = Infinity;
    exits.forEach((exit) => {
      best = Math.min(best, getEdgeDistance(level, block, exit.edge));
    });
    return sum + (Number.isFinite(best) ? best : 8);
  }, 0);
}

function getStatePriority(level, depth) {
  const remainingBlocks = (level.blocks || []).length;
  return (remainingBlocks * 1000) + (estimateExitPressure(level) * 10) + depth;
}

function enqueueByPriority(queue, node) {
  const priority = node.priority;
  let index = queue.length;
  while (index > 0 && queue[index - 1].priority > priority) {
    index -= 1;
  }
  queue.splice(index, 0, node);
}

function getOpeningActions(level) {
  const actions = [];
  (level.blocks || []).forEach((block) => {
    const anchors = getInterestingAnchors(level, block);
    anchors.forEach((anchor) => {
      if (anchor.x === block.x && anchor.y === block.y) {
        return;
      }
      const moveResult = applyMoveResult(level, block.id, anchor);
      const nextLevel = moveResult.level;
      actions.push({
        blockId: block.id,
        x: anchor.x,
        y: anchor.y,
        cleared: nextLevel.blocks.length < level.blocks.length,
        criticalEventChain: moveResult.criticalEventChain || [],
      });
    });
  });
  return actions;
}

function createOpeningStaticMetricsStub(level = null) {
  return {
    openingActionCountRaw: 0,
    openingMovableBlockCount: 0,
    directClearCount: 0,
    directLargeClearCount: 0,
    openingLargeBlockNearExitCount: 0,
    matchingEdgeTouchCount: 0,
    averageBestExitDistance: level?.blocks?.length ? 0 : null,
  };
}

export function collectOpeningStaticMetrics(sourceLevel = {}) {
  const level = normalizeLevel(sourceLevel);
  const blocks = level.blocks || [];
  const openingActions = getOpeningActions(level);
  const movableBlockIds = new Set();
  const directClearBlockIds = new Set();
  const blockById = new Map(blocks.map((block) => [block.id, block]));
  const exitDistances = [];
  let openingLargeBlockNearExitCount = 0;
  let matchingEdgeTouchCount = 0;

  openingActions.forEach((action) => {
    movableBlockIds.add(action.blockId);
    if (action.cleared) {
      directClearBlockIds.add(action.blockId);
    }
  });

  blocks.forEach((block) => {
    const distance = getBestExitDistance(level, block);
    if (Number.isFinite(distance)) {
      exitDistances.push(distance);
      if (block.shapeCells.length >= 3 && distance <= 1) {
        openingLargeBlockNearExitCount += 1;
      }
    }
    const touchesMatch = getCompatibleExits(level, block).some((exit) => blockTouchesMatchingExit(level, block, exit));
    if (touchesMatch) {
      matchingEdgeTouchCount += 1;
    }
  });

  const directLargeClearCount = [...directClearBlockIds].reduce((sum, blockId) => {
    const block = blockById.get(blockId);
    return sum + ((block?.shapeCells?.length || 0) >= 3 ? 1 : 0);
  }, 0);

  return {
    openingActionCountRaw: openingActions.length,
    openingMovableBlockCount: movableBlockIds.size,
    directClearCount: directClearBlockIds.size,
    directLargeClearCount,
    openingLargeBlockNearExitCount,
    matchingEdgeTouchCount,
    averageBestExitDistance: exitDistances.length ? Number(averageNumbers(exitDistances).toFixed(2)) : null,
  };
}

function calculateFirstClearReleaseGain(beforeLevel, afterLevel, clearedBlock, beforeMetrics = null, afterMetrics = null) {
  const currentMetrics = beforeMetrics || collectOpeningStaticMetrics(beforeLevel);
  const nextMetrics = afterMetrics || collectOpeningStaticMetrics(afterLevel);
  const clearedArea = clearedBlock?.shapeCells?.length || 0;
  const movableDelta = nextMetrics.openingMovableBlockCount - Math.max(0, currentMetrics.openingMovableBlockCount - 1);
  const actionDelta = nextMetrics.openingActionCountRaw - currentMetrics.openingActionCountRaw;
  return weightedAverage([
    [scoreFromBand(clearedArea, 1, 4), 0.36],
    [scoreFromBand(movableDelta, 0, 4), 0.24],
    [scoreFromBand(actionDelta, 0, 6), 0.18],
    [scoreFromBand(nextMetrics.directClearCount, 0, 3), 0.14],
    [scoreFromBand(nextMetrics.openingLargeBlockNearExitCount, 0, 2), 0.08],
  ]);
}

function calculatePostFirstClearCollapseScore(afterMetrics) {
  return weightedAverage([
    [scoreFromBand(afterMetrics.directClearCount, 0, 3), 0.40],
    [scoreFromBand(afterMetrics.openingActionCountRaw, 1, 8), 0.28],
    [scoreFromBand(afterMetrics.openingMovableBlockCount, 1, 6), 0.22],
    [scoreFromBand(afterMetrics.directLargeClearCount, 0, 2), 0.10],
  ]);
}

function createFirstClearSummary(rootLevel, currentLevel, movedLevel, node, clearedBlock, openingStaticMetrics) {
  const path = reconstructPath(node);
  const criticalEventChain = buildCriticalEventChain(path);
  const afterOpeningStaticMetrics = collectOpeningStaticMetrics(movedLevel);
  const bestFirstClearDepth = path.length;
  const bestFirstClearSetupDepth = Math.max(0, bestFirstClearDepth - 1);
  const firstClearArea = clearedBlock?.shapeCells?.length || 0;
  const firstClearReleaseGain = calculateFirstClearReleaseGain(
    currentLevel,
    movedLevel,
    clearedBlock,
    openingStaticMetrics,
    afterOpeningStaticMetrics,
  );
  const postFirstClearCollapseScore = calculatePostFirstClearCollapseScore(afterOpeningStaticMetrics);
  const firstClearKeynessScore = weightedAverage([
    [scoreFromBand(bestFirstClearSetupDepth, 0, 5), 0.24],
    [scoreFromBand(firstClearArea, 1, 4), 0.28],
    [firstClearReleaseGain, 0.36],
    [inverseScoreFromBand(postFirstClearCollapseScore, 20, 90), 0.12],
  ]);

  return {
    blockId: clearedBlock.id,
    bestFirstClearDepth,
    bestFirstClearSetupDepth,
    firstClearArea,
    firstClearReleaseGain,
    firstClearKeynessScore,
    postFirstClearCollapseScore,
    firstClearEdgeDistance: getBestExitDistance(rootLevel, clearedBlock),
    criticalEventChain,
    familySignature: buildFamilySignature(criticalEventChain, [clearedBlock.id]),
    afterOpeningStaticMetrics,
  };
}

function createFirstClearReportStub(level, reason = 'not_run', openingStaticMetrics = null) {
  return {
    reason,
    isFirstClearReachable: false,
    bestFirstClearDepth: null,
    bestFirstClearSetupDepth: null,
    firstClearBlockId: '',
    firstClearArea: null,
    firstClearReleaseGain: null,
    firstClearRouteCount: 0,
    falseFirstClearCount: 0,
    firstClearKeynessScore: null,
    postFirstClearCollapseScore: null,
    firstClearEdgeDistance: null,
    openingStaticMetrics: openingStaticMetrics || createOpeningStaticMetricsStub(level),
    expandedStates: 0,
    routeFamilySearchComplete: false,
  };
}

function runFirstClearSearch(level, options = {}, openingStaticMetrics = null) {
  const maxStates = Number.isFinite(options.firstClearMaxStates) ? Math.max(100, Math.floor(options.firstClearMaxStates)) : 600;
  const maxRoutes = Number.isFinite(options.firstClearMaxRoutes) ? Math.max(1, Math.floor(options.firstClearMaxRoutes)) : 6;
  const depthSlack = Number.isFinite(options.firstClearDepthSlack) ? Math.max(0, Math.floor(options.firstClearDepthSlack)) : 1;
  const routeFamilyCap = Number.isFinite(options.firstClearRouteFamilyCap) ? Math.max(1, Math.floor(options.firstClearRouteFamilyCap)) : 4;
  const initialHash = createStateHash(level);
  const baseOpeningStaticMetrics = openingStaticMetrics || collectOpeningStaticMetrics(level);
  const queue = [{ level, hash: initialHash, parent: null, move: null, depth: 0, priority: getStatePriority(level, 0) }];
  const seenDepth = new Map([[initialHash, 0]]);
  const routes = [];
  const routeFamilies = new Set();
  let bestDepth = null;
  let expandedStates = 0;
  let terminatedByLimit = false;
  let shouldStop = false;

  while (queue.length && !shouldStop) {
    const current = queue.shift();
    if (expandedStates >= maxStates) {
      terminatedByLimit = true;
      break;
    }
    if (bestDepth !== null && current.depth > bestDepth + depthSlack) {
      break;
    }

    expandedStates += 1;

    for (const block of getSearchBlocks(current.level, {
      maxBlocksPerState: options.firstClearMaxBlocksPerState,
    })) {
      const anchors = getInterestingAnchors(current.level, block, {
        maxAnchorsPerBlock: options.firstClearMaxAnchorsPerBlock,
      });
      for (const anchor of anchors) {
        if (anchor.x === block.x && anchor.y === block.y) {
          continue;
        }
        const moveResult = applyMoveResult(current.level, block.id, anchor);
        const movedLevel = moveResult.level;
        const nextDepth = current.depth + 1;
        const cleared = movedLevel.blocks.length < current.level.blocks.length;
        const nextNode = {
          level: movedLevel,
          hash: createStateHash(movedLevel),
          depth: nextDepth,
          priority: getStatePriority(movedLevel, nextDepth) - (cleared ? 250 : 0),
          parent: current,
          move: {
            blockId: block.id,
            x: anchor.x,
            y: anchor.y,
            cleared,
            criticalEventChain: moveResult.criticalEventChain || [],
          },
        };

        if (cleared) {
          const summary = createFirstClearSummary(level, current.level, movedLevel, nextNode, block, baseOpeningStaticMetrics);
          bestDepth = bestDepth == null ? summary.bestFirstClearDepth : Math.min(bestDepth, summary.bestFirstClearDepth);
          if (summary.bestFirstClearDepth <= bestDepth + depthSlack) {
            routes.push(summary);
            routeFamilies.add(summary.familySignature);
          }
          if (routes.length >= maxRoutes || routeFamilies.size >= routeFamilyCap) {
            shouldStop = true;
            break;
          }
          continue;
        }

        if (bestDepth !== null && nextDepth >= bestDepth + depthSlack) {
          continue;
        }

        const seenAt = seenDepth.get(nextNode.hash);
        if (seenAt !== undefined && seenAt <= nextDepth) {
          continue;
        }
        seenDepth.set(nextNode.hash, nextDepth);
        enqueueByPriority(queue, nextNode);
      }
      if (shouldStop) {
        break;
      }
    }
  }

  const primaryRoute = routes
    .sort((left, right) => {
      if (left.bestFirstClearDepth !== right.bestFirstClearDepth) {
        return left.bestFirstClearDepth - right.bestFirstClearDepth;
      }
      if (left.firstClearKeynessScore !== right.firstClearKeynessScore) {
        return right.firstClearKeynessScore - left.firstClearKeynessScore;
      }
      return right.firstClearReleaseGain - left.firstClearReleaseGain;
    })[0] || null;
  const routeFamilySearchComplete = !terminatedByLimit && (!!primaryRoute || !queue.length);
  const falseFirstClearCount = primaryRoute
    ? Math.max(0, new Set(routes.filter((route) => route.blockId !== primaryRoute.blockId).map((route) => route.blockId)).size)
    : 0;

  return {
    reason: primaryRoute ? 'first_clear_found' : (terminatedByLimit ? 'search_limit' : 'no_first_clear'),
    isFirstClearReachable: !!primaryRoute,
    bestFirstClearDepth: primaryRoute ? primaryRoute.bestFirstClearDepth : null,
    bestFirstClearSetupDepth: primaryRoute ? primaryRoute.bestFirstClearSetupDepth : null,
    firstClearBlockId: primaryRoute ? primaryRoute.blockId : '',
    firstClearArea: primaryRoute ? primaryRoute.firstClearArea : null,
    firstClearReleaseGain: primaryRoute ? primaryRoute.firstClearReleaseGain : null,
    firstClearRouteCount: routeFamilies.size,
    falseFirstClearCount,
    firstClearKeynessScore: primaryRoute ? primaryRoute.firstClearKeynessScore : null,
    postFirstClearCollapseScore: primaryRoute ? primaryRoute.postFirstClearCollapseScore : null,
    firstClearEdgeDistance: primaryRoute ? primaryRoute.firstClearEdgeDistance : null,
    openingStaticMetrics: baseOpeningStaticMetrics,
    expandedStates,
    routeFamilySearchComplete,
  };
}

function applySearchOptionDefaults(options = {}, defaults = {}) {
  const next = { ...options };
  Object.entries(defaults || {}).forEach(([key, value]) => {
    if (next[key] == null || !Number.isFinite(next[key])) {
      next[key] = value;
    }
  });
  return next;
}

function createSolveReportStub(level, reason = 'not_run') {
  return {
    reason,
    isSolvable: false,
    bestMoveCountEstimate: null,
    clearOrder: [],
    criticalEventChain: [],
    solutionFamilyCount: 0,
    openingActionCount: 0,
    dependencyDepth: null,
    averageSetupSpan: null,
    firstClearMoveIndex: null,
    firstClearSetupDepth: null,
    firstClearEdgeDistance: null,
    expandedStates: 0,
    stateHash: createStateHash(level),
    familySearchComplete: false,
  };
}

export function validateFirstClear(sourceLevel, options = {}) {
  const level = normalizeLevel(sourceLevel);
  const structure = collectStructureReport(level);
  const unsupportedMechanics = structure.warnings.some((warning) => warning.type === 'unsupported_mechanics' || warning.type === 'unsupported_tile_type' || warning.type === 'unsupported_gate_type');
  const openingStaticMetrics = structure.issues.length
    ? createOpeningStaticMetricsStub(level)
    : collectOpeningStaticMetrics(level);

  if (structure.issues.length) {
    return createFirstClearReportStub(level, 'invalid_structure', openingStaticMetrics);
  }
  if (unsupportedMechanics) {
    return createFirstClearReportStub(level, 'unsupported_mechanics', openingStaticMetrics);
  }

  return runFirstClearSearch(
    level,
    applySearchOptionDefaults(options, FIRST_CLEAR_FULL_OPTION_DEFAULTS),
    openingStaticMetrics,
  );
}

function buildValidationReport(level, structure, signature, solveReport, openingStaticMetrics, firstClearReport) {
  const structuralErrors = structure.issues.length;
  const difficulty = structuralErrors
    ? createEmptyDifficultyReport()
    : buildDifficultyReport(level, structure, solveReport, openingStaticMetrics, firstClearReport);
  const effectiveOpeningActionCount = Number.isFinite(solveReport.openingActionCount) && solveReport.openingActionCount > 0
    ? solveReport.openingActionCount
    : openingStaticMetrics.openingActionCountRaw;

  return {
    isStructurallyValid: structuralErrors === 0,
    isSolvable: solveReport.isSolvable,
    reason: solveReport.reason,
    bestMoveCountEstimate: solveReport.bestMoveCountEstimate,
    clearOrder: solveReport.clearOrder,
    criticalEventChain: solveReport.criticalEventChain,
    solutionFamilyCount: solveReport.solutionFamilyCount,
    openingActionCount: effectiveOpeningActionCount,
    openingActionCountRaw: openingStaticMetrics.openingActionCountRaw,
    openingMovableBlockCount: openingStaticMetrics.openingMovableBlockCount,
    directClearCount: openingStaticMetrics.directClearCount,
    directLargeClearCount: openingStaticMetrics.directLargeClearCount,
    openingLargeBlockNearExitCount: openingStaticMetrics.openingLargeBlockNearExitCount,
    matchingEdgeTouchCount: openingStaticMetrics.matchingEdgeTouchCount,
    averageBestExitDistance: openingStaticMetrics.averageBestExitDistance,
    openingStaticMetrics,
    dependencyDepth: solveReport.dependencyDepth,
    averageSetupSpan: solveReport.averageSetupSpan,
    firstClearMoveIndex: solveReport.firstClearMoveIndex,
    firstClearSetupDepth: solveReport.firstClearSetupDepth,
    firstClearEdgeDistance: solveReport.firstClearEdgeDistance,
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
    fastDifficultyScore: difficulty.fastDifficultyScore,
    solverDifficultyScore: difficulty.solverDifficultyScore,
    difficultyScore: difficulty.difficultyScore,
    difficultyTier: difficulty.difficultyTier,
    difficultyVector: difficulty.difficultyVector,
    expandedStates: solveReport.expandedStates,
    firstClearExpandedStates: firstClearReport.expandedStates,
    stateHash: solveReport.stateHash,
    signature,
    mobileViewportFit: structure.mobileViewportFit,
    doorGroupCount: structure.doorGroupCount,
    doorSlotCount: structure.doorSlotCount,
    doorCompetitionCount: structure.doorCompetitionCount,
    unmatchedBlocks: structure.unmatchedBlocks,
    unusedExtraExits: structure.unusedExtraExits,
    issues: structure.issues,
    warnings: structure.warnings,
    familySearchComplete: solveReport.familySearchComplete,
    routeFamilySearchComplete: firstClearReport.routeFamilySearchComplete,
  };
}

function validateLevelInternal(sourceLevel, options = {}, mode = 'full') {
  const level = normalizeLevel(sourceLevel);
  const signature = createLevelSignature(level);
  const structure = collectStructureReport(level);
  const unsupportedMechanics = structure.warnings.some((warning) => warning.type === 'unsupported_mechanics' || warning.type === 'unsupported_tile_type' || warning.type === 'unsupported_gate_type');
  const structuralErrors = structure.issues.length;
  const openingStaticMetrics = structuralErrors
    ? createOpeningStaticMetricsStub(level)
    : collectOpeningStaticMetrics(level);

  let solveReport = createSolveReportStub(
    level,
    structuralErrors ? 'invalid_structure' : (unsupportedMechanics ? 'unsupported_mechanics' : 'not_run'),
  );
  let firstClearReport = createFirstClearReportStub(
    level,
    structuralErrors ? 'invalid_structure' : (unsupportedMechanics ? 'unsupported_mechanics' : 'not_run'),
    openingStaticMetrics,
  );

  if (!structuralErrors && !unsupportedMechanics && mode !== 'static') {
    const firstClearDefaults = mode === 'quick'
      ? FIRST_CLEAR_QUICK_OPTION_DEFAULTS
      : mode === 'medium'
        ? FIRST_CLEAR_MEDIUM_OPTION_DEFAULTS
        : FIRST_CLEAR_FULL_OPTION_DEFAULTS;
    firstClearReport = runFirstClearSearch(level, applySearchOptionDefaults(options, firstClearDefaults), openingStaticMetrics);
    const defaults = mode === 'quick'
      ? QUICK_VALIDATE_OPTION_DEFAULTS
      : mode === 'medium'
        ? MEDIUM_VALIDATE_OPTION_DEFAULTS
        : FULL_VALIDATE_OPTION_DEFAULTS;
    solveReport = runSearch(level, applySearchOptionDefaults(options, defaults));
  }

  return buildValidationReport(level, structure, signature, solveReport, openingStaticMetrics, firstClearReport);
}

function runSearch(level, options = {}) {
  const maxStates = Number.isFinite(options.maxStates) ? Math.max(100, Math.floor(options.maxStates)) : DEFAULT_MAX_STATES;
  const maxSolutions = Number.isFinite(options.maxSolutions) ? Math.max(1, Math.floor(options.maxSolutions)) : DEFAULT_MAX_SOLUTIONS;
  const depthSlack = Number.isFinite(options.solutionDepthSlack) ? Math.max(0, Math.floor(options.solutionDepthSlack)) : DEFAULT_DEPTH_SLACK;
  const solutionFamilyCap = Number.isFinite(options.solutionFamilyCap) ? Math.max(1, Math.floor(options.solutionFamilyCap)) : DEFAULT_SOLUTION_FAMILY_CAP;
  const openingActions = getOpeningActions(level);
  const openingActionCount = openingActions.length;
  const initialHash = createStateHash(level);
  const queue = [{ level, hash: initialHash, parent: null, move: null, depth: 0, priority: getStatePriority(level, 0) }];
  const seenDepth = new Map([[initialHash, 0]]);
  const solutions = [];
  const solutionFamilies = new Set();
  let bestDepth = null;
  let expandedStates = 0;
  let terminatedByLimit = false;

  while (queue.length) {
    const current = queue.shift();
    if (expandedStates >= maxStates) {
      terminatedByLimit = true;
      break;
    }
    if (bestDepth !== null && current.depth > bestDepth + depthSlack) {
      break;
    }

    expandedStates += 1;

    if (!current.level.blocks.length) {
      const path = reconstructPath(current);
      const summary = createSolutionSummary(path, current.hash);
      bestDepth = bestDepth === null ? summary.moveCount : Math.min(bestDepth, summary.moveCount);
      if (summary.moveCount <= bestDepth + depthSlack) {
        solutions.push(summary);
        solutionFamilies.add(summary.familySignature);
      }
      if (solutions.length >= maxSolutions || solutionFamilies.size >= solutionFamilyCap) {
        break;
      }
      continue;
    }

    if (bestDepth !== null && current.depth >= bestDepth + depthSlack) {
      continue;
    }

    for (const block of getSearchBlocks(current.level, {
      maxBlocksPerState: options.maxBlocksPerState,
    })) {
      const anchors = getInterestingAnchors(current.level, block, {
        maxAnchorsPerBlock: options.maxAnchorsPerBlock,
      });
      for (const anchor of anchors) {
        if (anchor.x === block.x && anchor.y === block.y) {
          continue;
        }
        const moveResult = applyMoveResult(current.level, block.id, anchor);
        const movedLevel = moveResult.level;
        const hash = createStateHash(movedLevel);
        const nextDepth = current.depth + 1;
        const seenAt = seenDepth.get(hash);
        if (seenAt !== undefined && seenAt <= nextDepth) {
          continue;
        }
        seenDepth.set(hash, nextDepth);
        const cleared = movedLevel.blocks.length < current.level.blocks.length;
        enqueueByPriority(queue, {
          level: movedLevel,
          hash,
          depth: nextDepth,
          priority: getStatePriority(movedLevel, nextDepth) - (cleared ? 250 : 0),
          parent: current,
          move: {
            blockId: block.id,
            x: anchor.x,
            y: anchor.y,
            cleared,
            criticalEventChain: moveResult.criticalEventChain || [],
          },
        });
      }
    }
  }

  const primarySolution = solutions.sort((left, right) => left.moveCount - right.moveCount)[0] || null;
  const familySearchComplete = !terminatedByLimit && (!!primarySolution || !queue.length);
  const firstClearBlockId = primarySolution?.clearOrder?.[0] || '';
  const firstClearBlock = firstClearBlockId
    ? level.blocks.find((block) => block.id === firstClearBlockId)
    : null;
  return {
    reason: primarySolution ? 'solved' : (terminatedByLimit ? 'search_limit' : 'no_solution'),
    isSolvable: !!primarySolution,
    bestMoveCountEstimate: primarySolution ? primarySolution.moveCount : null,
    clearOrder: primarySolution ? primarySolution.clearOrder : [],
    criticalEventChain: primarySolution ? primarySolution.criticalEventChain : [],
    solutionFamilyCount: solutionFamilies.size,
    openingActionCount,
    dependencyDepth: primarySolution ? primarySolution.longestSetupSpan : null,
    averageSetupSpan: primarySolution ? primarySolution.averageSetupSpan : null,
    firstClearMoveIndex: primarySolution ? primarySolution.firstClearMoveIndex : null,
    firstClearSetupDepth: primarySolution && primarySolution.firstClearMoveIndex != null
      ? Math.max(0, primarySolution.firstClearMoveIndex - 1)
      : null,
    firstClearEdgeDistance: firstClearBlock ? getBestExitDistance(level, firstClearBlock) : null,
    expandedStates,
    stateHash: initialHash,
    familySearchComplete,
  };
}

export function validateLevelStatic(sourceLevel, options = {}) {
  return validateLevelInternal(sourceLevel, options, 'static');
}

export function validateLevelQuick(sourceLevel, options = {}) {
  return validateLevelInternal(sourceLevel, options, 'quick');
}

export function validateLevelMedium(sourceLevel, options = {}) {
  return validateLevelInternal(sourceLevel, options, 'medium');
}

export function validateLevelFull(sourceLevel, options = {}) {
  return validateLevelInternal(sourceLevel, options, 'full');
}

export function validateLevel(sourceLevel, options = {}) {
  const mode = String(options.validationMode || options.mode || '').trim().toLowerCase();
  if (mode === 'static') {
    return validateLevelStatic(sourceLevel, options);
  }
  if (mode === 'quick') {
    return validateLevelQuick(sourceLevel, options);
  }
  if (mode === 'medium') {
    return validateLevelMedium(sourceLevel, options);
  }
  return validateLevelFull(sourceLevel, options);
}

export function validateLevelCollection(levels = [], options = {}) {
  return (levels || []).map((level) => ({
    id: level.id,
    report: validateLevel(level, options),
  }));
}

export function solveLevel(sourceLevel, options = {}) {
  const report = validateLevelFull(sourceLevel, options);
  return {
    isSolvable: report.isSolvable,
    reason: report.reason,
    bestMoveCountEstimate: report.bestMoveCountEstimate,
    clearOrder: report.clearOrder,
    criticalEventChain: report.criticalEventChain,
    solutionFamilyCount: report.solutionFamilyCount,
    openingActionCount: report.openingActionCount,
    openingActionCountRaw: report.openingActionCountRaw,
    openingMovableBlockCount: report.openingMovableBlockCount,
    directClearCount: report.directClearCount,
    directLargeClearCount: report.directLargeClearCount,
    openingLargeBlockNearExitCount: report.openingLargeBlockNearExitCount,
    averageBestExitDistance: report.averageBestExitDistance,
    dependencyDepth: report.dependencyDepth,
    averageSetupSpan: report.averageSetupSpan,
    firstClearMoveIndex: report.firstClearMoveIndex,
    firstClearSetupDepth: report.firstClearSetupDepth,
    firstClearEdgeDistance: report.firstClearEdgeDistance,
    bestFirstClearDepth: report.bestFirstClearDepth,
    bestFirstClearSetupDepth: report.bestFirstClearSetupDepth,
    firstClearBlockId: report.firstClearBlockId,
    firstClearArea: report.firstClearArea,
    firstClearReleaseGain: report.firstClearReleaseGain,
    firstClearRouteCount: report.firstClearRouteCount,
    falseFirstClearCount: report.falseFirstClearCount,
    firstClearKeynessScore: report.firstClearKeynessScore,
    postFirstClearCollapseScore: report.postFirstClearCollapseScore,
    fastDifficultyScore: report.fastDifficultyScore,
    solverDifficultyScore: report.solverDifficultyScore,
    difficultyScore: report.difficultyScore,
    difficultyTier: report.difficultyTier,
    difficultyVector: report.difficultyVector,
    expandedStates: report.expandedStates,
    firstClearExpandedStates: report.firstClearExpandedStates,
    stateHash: report.stateHash,
    signature: report.signature,
    mobileViewportFit: report.mobileViewportFit,
    doorGroupCount: report.doorGroupCount,
    doorSlotCount: report.doorSlotCount,
    doorCompetitionCount: report.doorCompetitionCount,
    unmatchedBlocks: report.unmatchedBlocks,
    unusedExtraExits: report.unusedExtraExits,
    issues: report.issues,
    warnings: report.warnings,
    familySearchComplete: report.familySearchComplete,
    routeFamilySearchComplete: report.routeFamilySearchComplete,
  };
}

export function summarizeValidationIssues(report) {
  const issueKeys = [...(report.issues || []), ...(report.warnings || [])]
    .map((issue) => serializeIssue(issue))
    .filter(Boolean);
  return issueKeys.join('|');
}
