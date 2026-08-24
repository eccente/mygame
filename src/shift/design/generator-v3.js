import {
  TARGET_STYLE_POOL,
  createRng,
  getPresetAlias,
  getShapeCells,
  hashSeed,
  shuffle,
} from '../data/catalog.js?v=20260824112338';
import { getFootprintDescriptor, getLegalPlacementsForFootprint } from '../core/footprints.js?v=20260824112338';
import { CHAPTER_BANDS } from './chapter-bands.js?v=20260824112338';
import { SHAPE_POOLS } from './shape-pools.js?v=20260824112338';

const MOTIF_POOLS = {
  1: ['dense-interlock', 'shared-door-queue', 'hidden-first-clear'],
  2: ['corner-yield', 'shared-door-queue', 'hidden-first-clear'],
  3: ['central-knot', 'locked-spine', 'shared-door-queue', 'hidden-first-clear'],
  4: ['central-knot', 'gate-competition', 'dual-lane-race'],
  5: ['locked-spine', 'central-knot', 'phase-split', 'shared-door-queue'],
  6: ['axis-commit', 'dense-interlock', 'shared-door-queue'],
};

const MOTIF_BIAS = {
  'dense-interlock': {
    centerWeight: 1.1,
    edgePenalty: 0.9,
    adjacencyWeight: 1.4,
    laneBias: 0.2,
    spineBias: 0.1,
    hideOpeningWeight: 0.8,
  },
  'corner-yield': {
    centerWeight: 0.55,
    edgePenalty: 0.45,
    adjacencyWeight: 1.05,
    cornerYieldWeight: 1.35,
    laneBias: 0.25,
    hideOpeningWeight: 0.9,
  },
  'central-knot': {
    centerWeight: 1.6,
    edgePenalty: 1.15,
    adjacencyWeight: 1.5,
    spineBias: 0.75,
    hideOpeningWeight: 1.1,
  },
  'locked-spine': {
    centerWeight: 1.15,
    edgePenalty: 1.1,
    adjacencyWeight: 1.3,
    spineBias: 1.35,
    hideOpeningWeight: 1,
  },
  'shared-door-queue': {
    centerWeight: 0.8,
    edgePenalty: 0.65,
    adjacencyWeight: 1.2,
    laneBias: 0.9,
    hideOpeningWeight: 1.15,
  },
  'hidden-first-clear': {
    centerWeight: 1.1,
    edgePenalty: 1.4,
    adjacencyWeight: 1.05,
    hideOpeningWeight: 1.8,
  },
  'gate-competition': {
    centerWeight: 0.75,
    edgePenalty: 0.7,
    adjacencyWeight: 1.25,
    laneBias: 1.15,
    hideOpeningWeight: 1.1,
  },
  'dual-lane-race': {
    centerWeight: 0.7,
    edgePenalty: 0.72,
    adjacencyWeight: 1.15,
    laneBias: 1.45,
    hideOpeningWeight: 1,
  },
  'phase-split': {
    centerWeight: 1.1,
    edgePenalty: 0.95,
    adjacencyWeight: 1.25,
    spineBias: 0.9,
    hideOpeningWeight: 1.15,
  },
  'axis-commit': {
    centerWeight: 1,
    edgePenalty: 1,
    adjacencyWeight: 1.15,
    laneBias: 1.3,
    spineBias: 0.85,
    hideOpeningWeight: 1.1,
  },
};

const ROLE_BUDGET_BY_TIER = {
  hard: { anchor: 2, gatekeeper: 2, filler: 6, bait: 1 },
  expert: { anchor: 3, gatekeeper: 3, filler: 8, bait: 2 },
  brutal: { anchor: 4, gatekeeper: 4, filler: 10, bait: 3 },
  'endless-peak': { anchor: 4, gatekeeper: 4, filler: 10, bait: 3 },
};

function copyBand(band, fallback = null) {
  return Array.isArray(band) ? [...band] : fallback;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function getSegmentBias(segmentKey = '') {
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

function pickRangeValue(band = [0, 0], bias = 0.5) {
  const [min, max] = band;
  if (!Number.isFinite(min) || !Number.isFinite(max)) {
    return null;
  }
  if (max <= min) {
    return min;
  }
  return Math.round(min + ((max - min) * clamp(bias, 0, 1)));
}

function getChapterBand(chapterNumber = 1) {
  return CHAPTER_BANDS.find((entry) => entry.chapter === chapterNumber) || null;
}

function getEffectiveBand(chapterNumber = 1, levelIndex = 1) {
  const chapterBand = getChapterBand(chapterNumber);
  if (!chapterBand) {
    return null;
  }
  const segment = (chapterBand.segments || []).find((entry) => levelIndex >= entry.start && levelIndex <= entry.end) || null;
  return {
    ...chapterBand,
    ...(segment || {}),
    chapter: chapterBand.chapter,
    title: chapterBand.title,
    segmentKey: segment?.key || null,
  };
}

function getShapePoolWeights(chapterNumber = 1) {
  const key = `chapter${String(chapterNumber).padStart(2, '0')}`;
  return SHAPE_POOLS.campaign[key] || SHAPE_POOLS.campaign.chapter03 || {};
}

function normalizeShapeWhitelist(band = {}) {
  return [...new Set((band.shapes || []).filter(Boolean))];
}

function buildShapeQuota(shapeWhitelist = [], targetCells = 0, chapterNumber = 1) {
  const weights = getShapePoolWeights(chapterNumber);
  const weighted = shapeWhitelist.map((shapeKey) => {
    const weight = Number(weights[shapeKey]) || 0.01;
    const variants = shapeKey === 'domino' || shapeKey === 'bar3' ? 2 : shapeKey === 'L-3' || shapeKey === 'L-4' || shapeKey === 'T-4' ? 4 : 1;
    const area = getShapeCells(shapeKey, shapeKey === 'domino' || shapeKey === 'bar3' ? 'h' : 'default').length;
    return {
      shapeKey,
      weight,
      area,
      variants,
      desiredArea: 0,
      minCount: 0,
      targetCount: 0,
    };
  });
  const totalWeight = weighted.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  weighted.forEach((entry) => {
    entry.desiredArea = Math.max(entry.area, Math.round((targetCells * entry.weight) / totalWeight));
    entry.targetCount = Math.max(1, Math.round(entry.desiredArea / Math.max(1, entry.area)));
  });

  if (chapterNumber === 2) {
    weighted.forEach((entry) => {
      if (entry.shapeKey === 'L-3' || entry.shapeKey === 'L-4') {
        entry.minCount = Math.max(entry.minCount, 2);
        entry.targetCount = Math.max(entry.targetCount, 2);
      }
    });
  }
  if (chapterNumber >= 3) {
    weighted.forEach((entry) => {
      if (entry.shapeKey === 'T-4') {
        entry.minCount = Math.max(entry.minCount, 1);
        entry.targetCount = Math.max(entry.targetCount, chapterNumber >= 5 ? 2 : 1);
      }
      if (entry.shapeKey === 'cross-5' && chapterNumber >= 4) {
        entry.minCount = Math.max(entry.minCount, 1);
        entry.targetCount = Math.max(entry.targetCount, 1);
      }
    });
  }

  return weighted.sort((left, right) => right.weight - left.weight || right.area - left.area || left.shapeKey.localeCompare(right.shapeKey));
}

function buildRoleBudget(tier = 'hard') {
  return { ...(ROLE_BUDGET_BY_TIER[tier] || ROLE_BUDGET_BY_TIER.hard) };
}

function buildDependencySkeleton(contract = {}, motifKey = 'dense-interlock', roleBudget = {}) {
  const occupiedCellsTarget = contract.targetOccupiedCells || 0;
  const anchorCount = roleBudget.anchor || 0;
  const gatekeeperCount = roleBudget.gatekeeper || 0;
  const fillerCount = roleBudget.filler || 0;
  const baitCount = roleBudget.bait || 0;
  return {
    motifKey,
    mainChainLength: Math.max(3, anchorCount + gatekeeperCount + Math.max(1, Math.round(fillerCount * 0.35))),
    anchorCount,
    gatekeeperCount,
    fillerCount,
    baitCount,
    phaseCount: motifKey === 'phase-split' ? 2 : 1,
    desiredPressureEvents: Math.max(2, Math.round((anchorCount + gatekeeperCount + baitCount) * 0.75)),
    targetOccupiedCells: occupiedCellsTarget,
  };
}

function getMotifPool(chapterNumber = 1) {
  return MOTIF_POOLS[chapterNumber] || MOTIF_POOLS[3];
}

function buildPlacementBias(motifKey = 'dense-interlock') {
  return {
    motifKey,
    ...(MOTIF_BIAS[motifKey] || MOTIF_BIAS['dense-interlock']),
  };
}

export function createGeneratorV3CandidatePlan({ chapterNumber = 1, levelIndex = 1, attempt = 1 } = {}) {
  const band = getEffectiveBand(chapterNumber, levelIndex);
  if (!band) {
    return null;
  }
  const rng = createRng(hashSeed(`shift-v3-plan:${chapterNumber}:${levelIndex}:${attempt}`));
  const segmentBias = getSegmentBias(band.segmentKey);
  const rows = pickRangeValue(copyBand(band.rows, [8, 8]), segmentBias);
  const colors = pickRangeValue(copyBand(band.colors, [4, 4]), chapterNumber >= 3 ? Math.max(segmentBias, 0.75) : segmentBias);
  const occupancyTarget = Number((((band.occupancy?.[0] || 0.7) + (band.occupancy?.[1] || 0.76)) * 0.5).toFixed(3));
  const cols = 6;
  const boardCells = cols * rows;
  const targetOccupiedCells = Math.max(1, Math.round(boardCells * occupancyTarget));
  const motifPool = getMotifPool(chapterNumber);
  const motifKey = motifPool[Math.floor(rng() * motifPool.length)] || motifPool[0];
  const tier = band.difficultyTier || band.difficultyBand || 'hard';
  const roleBudget = buildRoleBudget(tier);
  const shapeWhitelist = normalizeShapeWhitelist(band);
  const shapeQuota = buildShapeQuota(shapeWhitelist, targetOccupiedCells, chapterNumber);
  const doorGroupsTarget = pickRangeValue(copyBand(band.doorGroups, [6, 8]), segmentBias);
  const doorSlotsTarget = pickRangeValue(copyBand(band.doorSlots, [8, 11]), Math.min(1, segmentBias + 0.08));
  const openingActionTarget = pickRangeValue(copyBand(band.openingActionBand, [1, 3]), segmentBias);
  const solutionFamilyMax = Number.isFinite(band.solutionFamilyMax) ? band.solutionFamilyMax : 3;
  const difficultyScoreTarget = pickRangeValue(copyBand(band.difficultyScoreBand, [60, 80]), segmentBias);

  const contract = {
    profileId: `mainline-c${String(chapterNumber).padStart(2, '0')}-v3`,
    chapterId: chapterNumber,
    levelIndex,
    tier,
    segmentKey: band.segmentKey || 'base',
    board: {
      cols,
      rowsMin: band.rows?.[0] || rows,
      rowsMax: band.rows?.[1] || rows,
      rows,
    },
    colors,
    occupancyBand: copyBand(band.occupancy, [occupancyTarget, occupancyTarget]),
    targetOccupiedCells,
    targetEmptyCells: Math.max(1, boardCells - targetOccupiedCells),
    shapeWhitelist,
    mechanicPool: [...(band.mechanics || [])],
    targetFamiliesMax: solutionFamilyMax,
    openingActionBand: copyBand(band.openingActionBand, [openingActionTarget, openingActionTarget]),
    difficultyScoreBand: copyBand(band.difficultyScoreBand, [difficultyScoreTarget, difficultyScoreTarget]),
    motifPool,
    doorGroupsTarget,
    doorSlotsTarget,
  };

  return {
    seedKey: `shift-v3-plan:${chapterNumber}:${levelIndex}:${attempt}`,
    rngSeedHint: hashSeed(`shift-v3-plan:${chapterNumber}:${levelIndex}:${attempt}`),
    contract,
    motif: {
      key: motifKey,
      pool: motifPool,
    },
    budgets: {
      roleBudget,
      shapeQuota,
      openingActionTarget,
      difficultyScoreTarget,
      doorCompetitionTarget: Math.max(1, band.doorCompetitionMin || 0),
    },
    dependencySkeleton: buildDependencySkeleton(contract, motifKey, roleBudget),
    placementBias: buildPlacementBias(motifKey),
    allowedColors: TARGET_STYLE_POOL.slice(0, colors),
  };
}

function getFootprintPrototype(shapeKey = 'mono', shapeVariant = 'default') {
  const shapeCells = getShapeCells(shapeKey, shapeVariant);
  return {
    shapeKey,
    shapeVariant,
    shapePreset: getPresetAlias(shapeKey, shapeVariant),
    shapeCells,
  };
}

function buildOccupiedSet(level = {}) {
  const occupied = new Set();
  (level.blocks || []).forEach((block) => {
    (block.shapeCells || []).forEach((cell) => {
      occupied.add(`${block.x + cell.x},${block.y + cell.y}`);
    });
  });
  return occupied;
}

function countAdjacency(anchor = { x: 0, y: 0 }, descriptor = null, occupied = new Set()) {
  if (!descriptor) {
    return 0;
  }
  let adjacency = 0;
  descriptor.cellOffsets.forEach((cell) => {
    const x = anchor.x + cell.x;
    const y = anchor.y + cell.y;
    [
      [x - 1, y],
      [x + 1, y],
      [x, y - 1],
      [x, y + 1],
    ].forEach(([nx, ny]) => {
      if (occupied.has(`${nx},${ny}`)) {
        adjacency += 1;
      }
    });
  });
  return adjacency;
}

function scoreAnchor(level, anchor, descriptor, plan, occupied, rng) {
  const rows = level.board?.rows || 0;
  const cols = level.board?.cols || 0;
  const maxX = Math.max(0, cols - descriptor.bbox.w);
  const maxY = Math.max(0, rows - descriptor.bbox.h);
  const centerX = (cols - 1) * 0.5;
  const centerY = (rows - 1) * 0.5;
  const shapeCenterX = anchor.x + ((descriptor.bbox.w - 1) * 0.5);
  const shapeCenterY = anchor.y + ((descriptor.bbox.h - 1) * 0.5);
  const centerDistance = Math.abs(shapeCenterX - centerX) + Math.abs(shapeCenterY - centerY);
  const normalizedCenterDistance = centerDistance / Math.max(1, centerX + centerY);
  const touchesEdge = anchor.x === 0 || anchor.y === 0 || anchor.x === maxX || anchor.y === maxY;
  const nearEdge = anchor.x <= 1 || anchor.y <= 1 || anchor.x >= Math.max(0, maxX - 1) || anchor.y >= Math.max(0, maxY - 1);
  const laneDistance = Math.min(
    Math.abs(anchor.x - 1),
    Math.abs(anchor.x - Math.max(1, maxX - 1)),
    Math.abs(anchor.x - Math.round(maxX * 0.5))
  );
  const verticalSpineDistance = Math.abs(shapeCenterX - centerX);
  const cornerPressure = Math.min(
    Math.abs(anchor.x - 1) + Math.abs(anchor.y - 1),
    Math.abs(anchor.x - Math.max(0, maxX - 1)) + Math.abs(anchor.y - 1),
    Math.abs(anchor.x - 1) + Math.abs(anchor.y - Math.max(0, maxY - 1)),
    Math.abs(anchor.x - Math.max(0, maxX - 1)) + Math.abs(anchor.y - Math.max(0, maxY - 1)),
  );
  const adjacency = countAdjacency(anchor, descriptor, occupied);
  const bias = plan?.placementBias || MOTIF_BIAS['dense-interlock'];

  let score = 0;
  score += (1 - normalizedCenterDistance) * 100 * (bias.centerWeight || 1);
  score += adjacency * 7 * (bias.adjacencyWeight || 1);
  score += (1 - clamp(laneDistance / Math.max(1, cols), 0, 1)) * 22 * (bias.laneBias || 0);
  score += (1 - clamp(verticalSpineDistance / Math.max(1, centerX + 0.5), 0, 1)) * 18 * (bias.spineBias || 0);
  score += (1 - clamp(cornerPressure / Math.max(1, cols + rows), 0, 1)) * 18 * (bias.cornerYieldWeight || 0);
  if (touchesEdge) {
    score -= 24 * (bias.edgePenalty || 1);
  } else if (nearEdge) {
    score -= 10 * (bias.edgePenalty || 1);
  }
  if (touchesEdge) {
    score -= 18 * (bias.hideOpeningWeight || 1);
  }
  score += (rng() - 0.5) * 0.75;
  return score;
}

export function getGeneratorV3PlacementAnchors(level = {}, shape = {}, rng = Math.random, plan = null, options = {}) {
  const shapeKey = shape.shapeKey || 'mono';
  const shapeVariant = shape.shapeVariant || 'default';
  const limit = Number.isFinite(options.limit) ? Math.max(1, Math.floor(options.limit)) : Infinity;
  const prototype = getFootprintPrototype(shapeKey, shapeVariant);
  const descriptor = getFootprintDescriptor(prototype);
  const occupied = buildOccupiedSet(level);
  const anchors = [...getLegalPlacementsForFootprint(prototype, level.board || { cols: 6, rows: 8 })];
  const ranked = shuffle(anchors, rng).map((anchor) => ({
    ...anchor,
    score: scoreAnchor(level, anchor, descriptor, plan, occupied, rng),
  }));
  ranked.sort((left, right) => right.score - left.score || left.y - right.y || left.x - right.x);
  return ranked.slice(0, limit).map(({ x, y }) => ({ x, y }));
}
