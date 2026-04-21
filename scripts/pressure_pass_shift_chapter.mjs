import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { clone, createBlock, createExit, getShapeCells } from '../web_frontend/src/shift/data/catalog.js';
import { validateLevelFull, validateLevelQuick } from '../web_frontend/src/shift/core/solver.js';
import { collectExitLayoutIssues, normalizeExitLayout } from '../web_frontend/src/shift/core/exit-rules.js';
import { CAMPAIGN_CHAPTER_01 } from '../web_frontend/src/shift/data/campaign/chapter-01.js';
import { CAMPAIGN_CHAPTER_02 } from '../web_frontend/src/shift/data/campaign/chapter-02.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAMPAIGN_DIR = path.resolve(__dirname, '../web_frontend/src/shift/data/campaign');

const CHAPTERS = {
  1: CAMPAIGN_CHAPTER_01,
  2: CAMPAIGN_CHAPTER_02,
};

const PRESSURE_PROFILE = {
  1: {
    title: '整块离场',
    occupancyBand: [0.77, 0.80],
    earlyMoves: [22, 28],
    midMoves: [24, 32],
    lateMoves: [26, 36],
    doorGroups: [5, 6],
    doorSlots: [8, 10],
    doorCompetitionMin: 3,
    allowedShapes: [
      ['square-2', 'default'],
      ['bar3', 'h'],
      ['bar3', 'v'],
      ['domino', 'h'],
      ['domino', 'v'],
    ],
  },
  2: {
    title: 'L 形借位',
    occupancyBand: [0.76, 0.82],
    earlyMoves: [24, 32],
    midMoves: [28, 38],
    lateMoves: [34, 48],
    doorGroups: [6, 9],
    doorSlots: [9, 13],
    doorCompetitionMin: 4,
    allowedShapes: [
      ['L-4', 'ur'],
      ['L-4', 'dr'],
      ['L-4', 'dl'],
      ['L-4', 'ul'],
      ['L-3', 'ur'],
      ['L-3', 'dr'],
      ['L-3', 'dl'],
      ['L-3', 'ul'],
      ['square-2', 'default'],
      ['bar3', 'h'],
      ['bar3', 'v'],
      ['domino', 'h'],
      ['domino', 'v'],
    ],
  },
};

function parseArgs(argv = []) {
  const options = {
    chapter: 1,
    from: 1,
    to: null,
    write: false,
  };
  argv.forEach((arg) => {
    if (arg === '--write') {
      options.write = true;
      return;
    }
    if (arg.startsWith('--chapter=')) {
      options.chapter = Number(arg.split('=')[1]) || 1;
      return;
    }
    if (arg.startsWith('--from=')) {
      options.from = Math.max(1, Number(arg.split('=')[1]) || 1);
      return;
    }
    if (arg.startsWith('--to=')) {
      options.to = Math.max(1, Number(arg.split('=')[1]) || 1);
    }
  });
  return options;
}

function getTargetForLevel(level) {
  const profile = PRESSURE_PROFILE[level.chapter];
  if (!profile) {
    return null;
  }
  const moveBand = level.index <= 10
    ? profile.earlyMoves
    : level.index <= 20
      ? profile.midMoves
      : profile.lateMoves;
  const occupancyBand = level.index >= 21
    ? [Math.max(profile.occupancyBand[0], 0.78), profile.occupancyBand[1]]
    : profile.occupancyBand;
  const doorSlots = level.index <= 10
    ? [9, 10]
    : profile.doorSlots;
  const doorCompetitionMin = level.index >= 21 ? 4 : profile.doorCompetitionMin;
  return {
    ...profile,
    moveBand,
    occupancyBand,
    doorSlots,
    doorCompetitionMin,
  };
}

function occupiedCells(level) {
  return (level.blocks || []).reduce((sum, block) => sum + block.shapeCells.length, 0);
}

function occupancyRate(level) {
  return occupiedCells(level) / Math.max(1, (level.board.cols || 0) * (level.board.rows || 0));
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
  const byExit = new Map(exits.map((exit) => [exit.id, []]));
  let multiExitBlocks = 0;
  blocks.forEach((block) => {
    const compatibles = getCompatibleExits(level, block);
    if (compatibles.length >= 2) {
      multiExitBlocks += 1;
    }
    compatibles.forEach((exit) => {
      const list = byExit.get(exit.id) || [];
      list.push(block.id);
      byExit.set(exit.id, list);
    });
  });
  let contestedExits = 0;
  byExit.forEach((ids) => {
    if (new Set(ids).size >= 2) {
      contestedExits += 1;
    }
  });
  return {
    doorGroupCount: exits.length,
    doorSlotCount: exits.reduce((sum, exit) => sum + Math.max(0, exit.span), 0),
    doorCompetitionCount: contestedExits + multiExitBlocks,
  };
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

function validateQuick(level) {
  return validateLevelQuick(level, {
    maxStates: 1800,
    maxSolutions: 5,
    solutionDepthSlack: 1,
    solutionFamilyCap: 4,
  });
}

function validateOpeningCandidate(level) {
  return validateLevelQuick(level, {
    maxStates: 900,
    maxSolutions: 3,
    solutionDepthSlack: 0,
    solutionFamilyCap: 2,
  });
}

function validateFull(level) {
  return validateLevelFull(level, {
    maxStates: 6500,
    maxSolutions: 6,
    solutionDepthSlack: 1,
    solutionFamilyCap: 4,
  });
}

function getEdgeDistance(level, block, edge) {
  const cells = block.shapeCells.map((cell) => ({ x: block.x + cell.x, y: block.y + cell.y }));
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

function getOpeningProfile(level, report = validateQuick(level)) {
  const chain = report.criticalEventChain || [];
  const firstSetupEntry = chain.find((entry) => entry.startsWith('setup:')) || '';
  const firstClearEntry = chain.find((entry) => entry.startsWith('clear:')) || '';
  const firstSetupBlocks = firstSetupEntry
    ? firstSetupEntry.slice('setup:'.length).split(',').filter(Boolean)
    : [];
  const firstClearBlockId = firstClearEntry ? firstClearEntry.slice('clear:'.length) : '';
  const firstClearBlock = firstClearBlockId ? level.blocks.find((block) => block.id === firstClearBlockId) : null;
  const matchingEdgeTouchCount = level.blocks.reduce((sum, block) => {
    const touchesMatch = getCompatibleExits(level, block).some((exit) => blockTouchesMatchingExit(level, block, exit));
    return sum + (touchesMatch ? 1 : 0);
  }, 0);
  return {
    report,
    firstSetupBlocks,
    firstSetupCount: firstSetupBlocks.length,
    firstClearBlockId,
    firstClearEdgeDistance: firstClearBlock ? getBestExitDistance(level, firstClearBlock) : null,
    matchingEdgeTouchCount,
  };
}

function getOpeningSetupTarget(level) {
  if (level.index <= 2) {
    return 3;
  }
  if (level.index <= 20) {
    return 4;
  }
  return 5;
}

function getOpeningEdgeDistanceTarget(level) {
  return level.index <= 10 ? 2 : 3;
}

function getBlockFootprint(block) {
  const xs = block.shapeCells.map((cell) => cell.x);
  const ys = block.shapeCells.map((cell) => cell.y);
  return {
    w: Math.max(...xs) + 1,
    h: Math.max(...ys) + 1,
  };
}

function buildHidePositions(level, block) {
  const centerX = (level.board.cols - 1) * 0.5;
  const centerY = (level.board.rows - 1) * 0.5;
  const footprint = getBlockFootprint(block);
  const positions = [];
  for (let y = 0; y < level.board.rows; y += 1) {
    for (let x = 0; x < level.board.cols; x += 1) {
      if (x === block.x && y === block.y) {
        continue;
      }
      const preview = { ...block, x, y };
      const bestExitDistance = getBestExitDistance(level, preview);
      if (bestExitDistance == null) {
        continue;
      }
      const blockCenterX = x + footprint.w * 0.5 - 0.5;
      const blockCenterY = y + footprint.h * 0.5 - 0.5;
      positions.push({
        x,
        y,
        bestExitDistance,
        centerDistance: Math.abs(blockCenterX - centerX) + Math.abs(blockCenterY - centerY),
        edgePenalty: isEdgeBlock(level, preview) ? 1 : 0,
        travelDistance: Math.abs(x - block.x) + Math.abs(y - block.y),
      });
    }
  }
  return positions.sort((left, right) => (
    right.bestExitDistance - left.bestExitDistance
    || left.edgePenalty - right.edgePenalty
    || left.centerDistance - right.centerDistance
    || left.travelDistance - right.travelDistance
  ));
}

function scoreHiddenOpeningCandidate(baseProfile, nextProfile, target, candidateLevel, blockId) {
  const doors = collectDoorMetrics(candidateLevel);
  const setupTarget = getOpeningSetupTarget(candidateLevel);
  const edgeTarget = getOpeningEdgeDistanceTarget(candidateLevel);
  let score = 0;
  score += (nextProfile.firstSetupCount - baseProfile.firstSetupCount) * 34;
  score += ((nextProfile.firstClearEdgeDistance ?? 0) - (baseProfile.firstClearEdgeDistance ?? 0)) * 16;
  score += ((nextProfile.report.bestMoveCountEstimate || 0) - (baseProfile.report.bestMoveCountEstimate || 0)) * 6;
  score += Math.min(doors.doorCompetitionCount, target.doorCompetitionMin + 2) * 2;
  score -= Math.max(0, nextProfile.matchingEdgeTouchCount - baseProfile.matchingEdgeTouchCount) * 18;
  score -= Math.max(0, (nextProfile.report.solutionFamilyCount || 0) - (baseProfile.report.solutionFamilyCount || 0)) * 5;
  if (baseProfile.firstSetupCount < setupTarget && nextProfile.firstSetupCount <= baseProfile.firstSetupCount) {
    score -= 80;
  }
  if ((baseProfile.firstClearEdgeDistance ?? 0) < edgeTarget && (nextProfile.firstClearEdgeDistance ?? 0) <= (baseProfile.firstClearEdgeDistance ?? 0)) {
    score -= 30;
  }
  if (baseProfile.matchingEdgeTouchCount > 0 && nextProfile.matchingEdgeTouchCount >= baseProfile.matchingEdgeTouchCount) {
    score -= 35;
  }
  if (nextProfile.firstSetupCount >= setupTarget) {
    score += 18;
  }
  if ((nextProfile.firstClearEdgeDistance ?? 0) >= edgeTarget) {
    score += 12;
  }
  if (nextProfile.firstClearBlockId && nextProfile.firstClearBlockId !== blockId) {
    score += 5;
  }
  if ((nextProfile.report.bestMoveCountEstimate || 0) >= target.moveBand[0]) {
    score += 8;
  }
  return score;
}

function repositionBlockForOpening(level, blockId, target, baseProfile) {
  const source = level.blocks.find((block) => block.id === blockId);
  if (!source) {
    return null;
  }
  const currentDistance = blockId === baseProfile.firstClearBlockId ? (baseProfile.firstClearEdgeDistance ?? 0) : 0;
  const positions = buildHidePositions(level, source)
    .filter((pos) => pos.bestExitDistance >= currentDistance)
    .slice(0, 14);
  let best = null;
  for (const pos of positions) {
    const candidate = clone(level);
    const block = candidate.blocks.find((entry) => entry.id === blockId);
    block.x = pos.x;
    block.y = pos.y;
    if (!canPlace(candidate, block)) {
      continue;
    }
    const report = validateOpeningCandidate(candidate);
    if (!report.isStructurallyValid || !report.isSolvable) {
      continue;
    }
    const nextProfile = getOpeningProfile(candidate, report);
    const score = scoreHiddenOpeningCandidate(baseProfile, nextProfile, target, candidate, blockId);
    if (!best || score > best.score) {
      best = { level: candidate, report, profile: nextProfile, score };
    }
  }
  return best;
}

function hideOpening(level, target) {
  let report = validateQuick(level);
  let profile = getOpeningProfile(level, report);
  let pass = 0;
  while (pass < 3) {
    pass += 1;
    const needsMoreSetup = profile.firstSetupCount < getOpeningSetupTarget(level);
    const needsMoreEdgeDistance = (profile.firstClearEdgeDistance ?? 0) < getOpeningEdgeDistanceTarget(level);
    const needsEdgeCleanup = profile.matchingEdgeTouchCount > 0;
    if (!needsMoreSetup && !needsMoreEdgeDistance && !needsEdgeCleanup) {
      break;
    }
    const candidateIds = [
      profile.firstClearBlockId,
      ...profile.firstSetupBlocks,
      ...level.blocks
        .filter((block) => (getBestExitDistance(level, block) ?? 99) <= getOpeningEdgeDistanceTarget(level))
        .sort((left, right) => (getBestExitDistance(level, left) ?? 99) - (getBestExitDistance(level, right) ?? 99))
        .map((block) => block.id),
    ].filter((blockId, index, list) => blockId && list.indexOf(blockId) === index);
    let best = null;
    for (const blockId of candidateIds.slice(0, 5)) {
      const attempt = repositionBlockForOpening(level, blockId, target, profile);
      if (attempt && (!best || attempt.score > best.score)) {
        best = attempt;
      }
    }
    if (!best || best.score <= 0) {
      break;
    }
    level = best.level;
    report = best.report;
    profile = best.profile;
  }
  return level;
}


function repositionBlockForOpeningHeavy(level, blockId, target, baseProfile) {
  const source = level.blocks.find((block) => block.id === blockId);
  if (!source) {
    return null;
  }
  const positions = buildHidePositions(level, source).slice(0, 28);
  let best = null;
  for (const pos of positions) {
    const candidate = clone(level);
    const block = candidate.blocks.find((entry) => entry.id === blockId);
    block.x = pos.x;
    block.y = pos.y;
    if (!canPlace(candidate, block)) {
      continue;
    }
    const report = validateQuick(candidate);
    if (!report.isStructurallyValid || !report.isSolvable) {
      continue;
    }
    const nextProfile = getOpeningProfile(candidate, report);
    const score = scoreHiddenOpeningCandidate(baseProfile, nextProfile, target, candidate, blockId);
    if (!best || score > best.score) {
      best = { level: candidate, report, profile: nextProfile, score };
    }
  }
  return best;
}

function hideOpeningHeavy(level, target) {
  let report = validateQuick(level);
  let profile = getOpeningProfile(level, report);
  let pass = 0;
  while (pass < 4) {
    pass += 1;
    const needsMoreSetup = profile.firstSetupCount < getOpeningSetupTarget(level);
    const needsMoreEdgeDistance = (profile.firstClearEdgeDistance ?? 0) < getOpeningEdgeDistanceTarget(level);
    const needsEdgeCleanup = profile.matchingEdgeTouchCount > 0;
    if (!needsMoreSetup && !needsMoreEdgeDistance && !needsEdgeCleanup) {
      break;
    }
    const candidateIds = [
      profile.firstClearBlockId,
      ...profile.firstSetupBlocks,
      ...level.blocks
        .filter((block) => (getBestExitDistance(level, block) ?? 99) <= getOpeningEdgeDistanceTarget(level) + 1)
        .sort((left, right) => (getBestExitDistance(level, left) ?? 99) - (getBestExitDistance(level, right) ?? 99))
        .map((block) => block.id),
    ].filter((blockId, index, list) => blockId && list.indexOf(blockId) === index);
    let best = null;
    for (const blockId of candidateIds.slice(0, 8)) {
      const attempt = repositionBlockForOpeningHeavy(level, blockId, target, profile);
      if (attempt && (!best || attempt.score > best.score)) {
        best = attempt;
      }
    }
    if (!best || best.score <= 0) {
      break;
    }
    level = best.level;
    report = best.report;
    profile = best.profile;
  }
  return level;
}

function getCurrentStats(level) {
  const report = validateFull(level);
  return {
    report,
    occupancy: Number(occupancyRate(level).toFixed(3)),
    doors: collectDoorMetrics(level),
    opening: getOpeningProfile(level, report),
  };
}

function buildPriorityPositions(level) {
  const centerX = (level.board.cols - 1) / 2;
  const centerY = (level.board.rows - 1) / 2;
  const positions = [];
  for (let y = 0; y < level.board.rows; y += 1) {
    for (let x = 0; x < level.board.cols; x += 1) {
      positions.push({ x, y, score: Math.abs(x - centerX) + Math.abs(y - centerY) });
    }
  }
  return positions.sort((left, right) => left.score - right.score || left.y - right.y || left.x - right.x);
}

function getColorPriority(level) {
  const counts = new Map();
  (level.blocks || []).forEach((block) => {
    counts.set(block.style, (counts.get(block.style) || 0) + 1);
  });
  return [...counts.keys()].sort((left, right) => (counts.get(left) || 0) - (counts.get(right) || 0) || left.localeCompare(right));
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

function moveBlockOffImmediateExit(level, baseReport) {
  const inwardDeltaByEdge = {
    left: { x: 1, y: 0 },
    right: { x: -1, y: 0 },
    top: { x: 0, y: 1 },
    bottom: { x: 0, y: -1 },
  };
  let working = clone(level);
  let report = baseReport;
  let moved = true;
  let guard = 0;
  while (moved && guard < 6) {
    moved = false;
    guard += 1;
    for (const block of working.blocks) {
      const compatibleExits = getCompatibleExits(working, block).filter((exit) => blockTouchesMatchingExit(working, block, exit));
      let accepted = null;
      for (const exit of compatibleExits) {
        const delta = inwardDeltaByEdge[exit.edge];
        if (!delta) {
          continue;
        }
        for (const distance of [2, 1]) {
          const candidate = clone(working);
          const target = candidate.blocks.find((entry) => entry.id === block.id);
          target.x += delta.x * distance;
          target.y += delta.y * distance;
          if (!canPlace(candidate, target)) {
            continue;
          }
          const nextReport = validateQuick(candidate);
          if (!nextReport.isStructurallyValid || !nextReport.isSolvable) {
            continue;
          }
          if ((nextReport.bestMoveCountEstimate || 0) + 1 < (report.bestMoveCountEstimate || 0)) {
            continue;
          }
          accepted = { level: candidate, report: nextReport };
          break;
        }
        if (accepted) {
          break;
        }
      }
      if (accepted) {
        working = accepted.level;
        report = accepted.report;
        moved = true;
        break;
      }
    }
  }
  return working;
}

function trimDuplicateExits(level, target) {
  let changed = true;
  while (changed) {
    changed = false;
    const metrics = collectDoorMetrics(level);
    if (metrics.doorGroupCount <= target.doorGroups[1] && metrics.doorSlotCount <= target.doorSlots[1]) {
      return level;
    }
    const exitCounts = new Map();
    (level.exits || []).forEach((exit) => {
      exitCounts.set(exit.acceptColor, (exitCounts.get(exit.acceptColor) || 0) + 1);
    });
    const removable = (level.exits || [])
      .filter((exit) => (exitCounts.get(exit.acceptColor) || 0) >= 2)
      .sort((left, right) => right.span - left.span || left.id.localeCompare(right.id));
    for (const exit of removable) {
      const candidate = clone(level);
      candidate.exits = normalizeExitLayout(candidate.exits.filter((entry) => entry.id !== exit.id));
      if (collectExitLayoutIssues(candidate.exits).length) {
        continue;
      }
      if (candidate.blocks.some((block) => getCompatibleExits(candidate, block).length === 0)) {
        continue;
      }
      const report = validateQuick(candidate);
      if (!report.isStructurallyValid || !report.isSolvable) {
        continue;
      }
      level.exits = candidate.exits;
      changed = true;
      break;
    }
    if (changed) {
      continue;
    }
    const shrinkable = (level.exits || [])
      .filter((exit) => exit.span >= 2)
      .sort((left, right) => right.span - left.span || left.id.localeCompare(right.id));
    for (const exit of shrinkable) {
      const candidates = [];
      if (exit.edge === 'top' || exit.edge === 'bottom') {
        candidates.push({ ...exit, span: exit.span - 1 });
        candidates.push({ ...exit, start: exit.start + 1, span: exit.span - 1 });
      } else {
        candidates.push({ ...exit, span: exit.span - 1 });
        candidates.push({ ...exit, start: exit.start + 1, span: exit.span - 1 });
      }
      let accepted = null;
      for (const nextExit of candidates) {
        if (nextExit.span <= 0) {
          continue;
        }
        const candidate = clone(level);
        const targetExit = candidate.exits.find((entry) => entry.id === exit.id);
        targetExit.start = nextExit.start;
        targetExit.span = nextExit.span;
        candidate.exits = normalizeExitLayout(candidate.exits);
        if (collectExitLayoutIssues(candidate.exits).length) {
          continue;
        }
        if (candidate.blocks.some((block) => getCompatibleExits(candidate, block).length === 0)) {
          continue;
        }
        const report = validateQuick(candidate);
        if (!report.isStructurallyValid || !report.isSolvable) {
          continue;
        }
        accepted = candidate;
        break;
      }
      if (accepted) {
        level.exits = accepted.exits;
        changed = true;
        break;
      }
    }
  }
  return level;
}

function scoreAddition(baseReport, report, target, candidateLevel) {
  const occupancy = occupancyRate(candidateLevel);
  const doors = collectDoorMetrics(candidateLevel);
  let score = 0;
  score += ((report.bestMoveCountEstimate || 0) - (baseReport.bestMoveCountEstimate || 0)) * 8;
  score += (occupancy - target.occupancyBand[0]) * 80;
  score += Math.min(doors.doorCompetitionCount, target.doorCompetitionMin) * 3;
  score -= Math.max(0, doors.doorGroupCount - target.doorGroups[1]) * 6;
  score -= Math.max(0, doors.doorSlotCount - target.doorSlots[1]) * 3;
  if ((report.bestMoveCountEstimate || 0) >= target.moveBand[0]) {
    score += 12;
  }
  return score;
}

function isEdgeBlock(level, block) {
  return block.shapeCells.some((cell) => {
    const x = block.x + cell.x;
    const y = block.y + cell.y;
    return x === 0 || y === 0 || x === level.board.cols - 1 || y === level.board.rows - 1;
  });
}

function upgradeLightBlocks(level, target) {
  let report = validateQuick(level);
  const blocks = [...level.blocks].sort((left, right) => left.shapeCells.length - right.shapeCells.length || left.id.localeCompare(right.id));
  for (const source of blocks) {
    if (source.shapeCells.length >= 4) {
      continue;
    }
    const heavierShapes = target.allowedShapes.filter(([shapeKey, shapeVariant]) => {
      return getShapeSize(shapeKey, shapeVariant) > source.shapeCells.length;
    });
    let best = null;
    for (const [shapeKey, shapeVariant] of heavierShapes) {
      for (const dx of [0, -1, 1]) {
        for (const dy of [0, -1, 1]) {
          const candidate = clone(level);
          const block = candidate.blocks.find((entry) => entry.id === source.id);
          block.shapePreset = shapeKey === 'domino' ? `domino-${shapeVariant}` : shapeKey === 'bar3' ? `bar3-${shapeVariant}` : shapeKey;
          block.shapeVariant = shapeVariant;
          block.shapeCells = getShapeCells(shapeKey, shapeVariant);
          block.x += dx;
          block.y += dy;
          if (!canPlace(candidate, block)) {
            continue;
          }
          if (getCompatibleExits(candidate, block).length === 0) {
            continue;
          }
          const nextReport = validateQuick(candidate);
          if (!nextReport.isStructurallyValid || !nextReport.isSolvable) {
            continue;
          }
          const nextOcc = occupancyRate(candidate);
          const nextDoors = collectDoorMetrics(candidate);
          let score = 0;
          score += (nextReport.bestMoveCountEstimate || 0) - (report.bestMoveCountEstimate || 0);
          score += (nextOcc - occupancyRate(level)) * 100;
          score += Math.min(nextDoors.doorCompetitionCount, target.doorCompetitionMin) * 2;
          if (isEdgeBlock(level, source) && !isEdgeBlock(candidate, block)) {
            score += 4;
          }
          if (!best || score > best.score) {
            best = { candidate, report: nextReport, score };
          }
        }
      }
    }
    if (best && (occupancyRate(best.candidate) > occupancyRate(level) || (best.report.bestMoveCountEstimate || 0) > (report.bestMoveCountEstimate || 0))) {
      level.blocks = best.candidate.blocks;
      report = best.report;
      if (occupancyRate(level) >= target.occupancyBand[0] && (report.bestMoveCountEstimate || 0) >= target.moveBand[0]) {
        break;
      }
    }
  }
  return level;
}

function getShapeSize(shapeKey, shapeVariant) {
  return getShapeCells(shapeKey, shapeVariant).length;
}

function addPressureBlocks(level, target) {
  const positions = buildPriorityPositions(level).slice(0, 16);
  const colors = getColorPriority(level);
  let report = validateQuick(level);
  let guard = 0;
  while (guard < 3) {
    guard += 1;
    const occupancy = occupancyRate(level);
    const doorMetrics = collectDoorMetrics(level);
    const moveCount = report.bestMoveCountEstimate || 0;
    if (occupancy >= target.occupancyBand[0] && moveCount >= target.moveBand[0] && doorMetrics.doorCompetitionCount >= target.doorCompetitionMin) {
      break;
    }
    let best = null;
    for (const [shapeKey, shapeVariant] of target.allowedShapes) {
      for (const pos of positions) {
        for (const color of colors) {
          const block = createBlock({
            id: `pressure-${level.id}-${guard}-${shapeKey}-${shapeVariant}-${color}`,
            style: color,
            x: pos.x,
            y: pos.y,
            shapeKey,
            shapeVariant,
          });
          if (!canPlace(level, block)) {
            continue;
          }
          if (occupancy + (block.shapeCells.length / (level.board.cols * level.board.rows)) > target.occupancyBand[1] + 0.005) {
            continue;
          }
          if (getCompatibleExits(level, block).length === 0) {
            continue;
          }
          const candidate = clone(level);
          candidate.blocks.push(block);
          const nextReport = validateQuick(candidate);
          if (!nextReport.isStructurallyValid || !nextReport.isSolvable) {
            continue;
          }
          const score = scoreAddition(report, nextReport, target, candidate);
          if (!best || score > best.score) {
            best = { candidate, report: nextReport, score };
          }
        }
      }
    }
    if (!best) {
      break;
    }
    level.blocks = best.candidate.blocks;
    report = best.report;
  }
  return level;
}

function pressurePassLevel(sourceLevel) {
  const target = getTargetForLevel(sourceLevel);
  if (!target) {
    return { level: clone(sourceLevel), report: validateFull(sourceLevel) };
  }
  let level = clone(sourceLevel);
  level.exits = normalizeExitLayout(level.exits || []);
  level.meta = {
    ...(level.meta || {}),
    difficultyBand: level.meta?.difficultyBand || 'expert',
    tags: [...new Set([...(level.meta?.tags || []), 'pressure-pass'])],
  };
  const initial = validateFull(level);
  const initialOpening = getOpeningProfile(level, initial);
  level = moveBlockOffImmediateExit(level, initial);
  level = trimDuplicateExits(level, target);
  level = upgradeLightBlocks(level, target);
  level = addPressureBlocks(level, target);
  level = moveBlockOffImmediateExit(level, validateQuick(level));
  level = trimDuplicateExits(level, target);
  level = hideOpening(level, target);
  const openingAfterLight = getOpeningProfile(level, validateQuick(level));
  if (sourceLevel.chapter === 1 && openingAfterLight.firstSetupCount < getOpeningSetupTarget(level)) {
    level = hideOpeningHeavy(level, target);
  }
  level = moveBlockOffImmediateExit(level, validateQuick(level));
  level = trimDuplicateExits(level, target);
  level.exits = normalizeExitLayout(level.exits || []);
  const finalReport = validateFull(level);
  const finalOpening = getOpeningProfile(level, finalReport);
  const openingImproved = finalOpening.firstSetupCount > initialOpening.firstSetupCount
    || (finalOpening.firstClearEdgeDistance ?? 0) > (initialOpening.firstClearEdgeDistance ?? 0)
    || finalOpening.matchingEdgeTouchCount < initialOpening.matchingEdgeTouchCount;
  const movesRegressedTooMuch = (finalReport.bestMoveCountEstimate || 0) + 4 < (initial.bestMoveCountEstimate || 0);
  const failedOpeningGoal = initialOpening.firstSetupCount < getOpeningSetupTarget(level)
    && finalOpening.firstSetupCount < getOpeningSetupTarget(level)
    && !openingImproved;
  if (movesRegressedTooMuch || failedOpeningGoal) {
    return { level: clone(sourceLevel), report: initial, target };
  }
  return { level, report: finalReport, target };
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
  lines.push(`      difficultyBand: ${quote(level.meta?.difficultyBand || 'expert')},`);
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

function renderChapterModule(chapter, levels) {
  const chapterNumber = chapter.number;
  const constName = `CAMPAIGN_CHAPTER_${String(chapterNumber).padStart(2, '0')}`;
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
  const options = parseArgs(process.argv.slice(2));
  const chapter = CHAPTERS[options.chapter];
  if (!chapter) {
    throw new Error(`Unsupported chapter: ${options.chapter}`);
  }
  const from = Math.max(1, Math.min(chapter.levels.length, options.from));
  const to = options.to ? Math.max(from, Math.min(chapter.levels.length, options.to)) : chapter.levels.length;
  const updatedLevels = chapter.levels.map((level) => clone(level));

  for (let index = from; index <= to; index += 1) {
    const sourceLevel = updatedLevels[index - 1];
    const before = getCurrentStats(sourceLevel);
    const result = pressurePassLevel(sourceLevel);
    const after = getCurrentStats(result.level);
    updatedLevels[index - 1] = result.level;
    console.log(`${sourceLevel.id} occ ${before.occupancy} -> ${after.occupancy} | moves ${before.report.bestMoveCountEstimate ?? 'n/a'} -> ${after.report.bestMoveCountEstimate ?? 'n/a'} | doors ${before.doors.doorGroupCount}/${before.doors.doorSlotCount}/${before.doors.doorCompetitionCount} -> ${after.doors.doorGroupCount}/${after.doors.doorSlotCount}/${after.doors.doorCompetitionCount} | opening ${before.opening.firstSetupCount}/${before.opening.firstClearEdgeDistance ?? 'n/a'}/${before.opening.matchingEdgeTouchCount} -> ${after.opening.firstSetupCount}/${after.opening.firstClearEdgeDistance ?? 'n/a'}/${after.opening.matchingEdgeTouchCount} | solvable=${after.report.isSolvable}`);
  }

  if (options.write && from === 1 && to === chapter.levels.length) {
    const filename = path.join(CAMPAIGN_DIR, `chapter-${String(chapter.number).padStart(2, '0')}.js`);
    await fs.writeFile(filename, renderChapterModule(chapter, updatedLevels), 'utf8');
    console.log(`wrote ${filename}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
