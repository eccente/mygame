import {
  TARGET_STYLE_POOL,
  clone,
  createBlock,
  createExit,
  createRng,
  getBoundsFromCells,
  getShapeCells,
  hashSeed,
  shuffle,
} from '../data/catalog.js?v=20260824112338';
import { getExitMatchForFootprint, getFootprintProjectionLength } from '../core/footprints.js?v=20260824112338';
import { canPlaceBlockAtAnchor } from '../core/level-state.js?v=20260824112338';
import { validateLevelQuick } from '../core/solver.js?v=20260824112338';

export const ENDLESS_DIFFICULTIES = {
  brain: {
    id: 'brain',
    label: '动脑',
    rewardCoins: 88,
  },
};

const SHAPE_POOL = [
  { key: 'mono', variants: ['default'], area: 1, minRound: 1, weight: 0.4, maxCountByStage: [1, 1, 2], axisEligible: false },
  { key: 'domino', variants: ['h', 'v'], area: 2, minRound: 1, weight: 1.5, maxCountByStage: [2, 3, 3], axisEligible: true },
  { key: 'bar3', variants: ['h', 'v'], area: 3, minRound: 1, weight: 3.2, maxCountByStage: [3, 3, 4], axisEligible: true },
  { key: 'square-2', variants: ['default'], area: 4, minRound: 1, weight: 3.8, maxCountByStage: [3, 4, 4], axisEligible: false },
  { key: 'L-3', variants: ['ur', 'dr', 'dl', 'ul'], area: 3, minRound: 1, weight: 4.2, maxCountByStage: [4, 5, 5], axisEligible: true },
  { key: 'L-4', variants: ['ur', 'dr', 'dl', 'ul'], area: 4, minRound: 3, weight: 4.5, maxCountByStage: [3, 4, 5], axisEligible: true },
  { key: 'T-4', variants: ['up', 'right', 'down', 'left'], area: 4, minRound: 8, weight: 3.5, maxCountByStage: [0, 2, 4], axisEligible: false },
];

const GENERATION_CACHE = new Map();

const ENDLESS_MECHANIC_UNLOCKS = [
  { key: 'lock-gate', minRound: 4, weight: 1.05 },
  { key: 'toggle-gate', minRound: 10, weight: 1.18 },
  { key: 'recolor', minRound: 13, weight: 1.22 },
  { key: 'ice', minRound: 16, weight: 1.26 },
];

const ENDLESS_MECHANIC_SCORE_BONUS = {
  'directional-target': 4.5,
  'lock-gate': 6.5,
  'one-way-gate': 7,
  'toggle-gate': 7.5,
  recolor: 8.5,
  ice: 8,
};

function getApproachDirFromDelta(dx = 0, dy = 0) {
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return dx > 0 ? 'right' : 'left';
  }
  if (dy !== 0) {
    return dy > 0 ? 'bottom' : 'top';
  }
  return '';
}

function getBlockArea(block = {}) {
  if (Array.isArray(block.shapeCells) && block.shapeCells.length) {
    return block.shapeCells.length;
  }
  return Math.max(1, (block.w || 1) * (block.h || 1));
}

function getBlockCenter(block = {}) {
  return {
    x: (block.x || 0) + (((block.w || 1) - 1) * 0.5),
    y: (block.y || 0) + (((block.h || 1) - 1) * 0.5),
  };
}

function getCellsCenter(cells = []) {
  if (!Array.isArray(cells) || !cells.length) {
    return { x: 0, y: 0 };
  }
  const total = cells.reduce((sum, cell) => ({
    x: sum.x + (cell.x || 0),
    y: sum.y + (cell.y || 0),
  }), { x: 0, y: 0 });
  return {
    x: total.x / cells.length,
    y: total.y / cells.length,
  };
}

function buildPlacedBlockOccupancy(level = {}) {
  const occupied = new Set();
  (level.blocks || []).forEach((block) => {
    getBlockCells(block).forEach((cell) => {
      occupied.add(getCellKey(cell.x, cell.y));
    });
  });
  return occupied;
}

function buildReservedMechanicCells(level = {}) {
  const reserved = new Set();
  (level.tiles || []).forEach((tile) => {
    (tile.cells || (Number.isFinite(tile.x) && Number.isFinite(tile.y) ? [{ x: tile.x, y: tile.y }] : [])).forEach((cell) => {
      reserved.add(getCellKey(cell.x, cell.y));
    });
  });
  (level.gates || []).forEach((gate) => {
    (gate.cells || []).forEach((cell) => {
      reserved.add(getCellKey(cell.x, cell.y));
    });
  });
  return reserved;
}

function isBoardEdgeCell(level = {}, cell = {}) {
  const cols = level.board?.cols || 0;
  const rows = level.board?.rows || 0;
  return cell.x === 0 || cell.y === 0 || cell.x === cols - 1 || cell.y === rows - 1;
}

function countNeighborOccupancy(occupied = new Set(), cell = {}) {
  return [
    [cell.x - 1, cell.y],
    [cell.x + 1, cell.y],
    [cell.x, cell.y - 1],
    [cell.x, cell.y + 1],
  ].reduce((sum, [x, y]) => sum + (occupied.has(getCellKey(x, y)) ? 1 : 0), 0);
}

function scoreMechanicCell(level = {}, cell = {}, options = {}) {
  const occupied = options.occupied || buildPlacedBlockOccupancy(level);
  const boardCenterX = ((level.board?.cols || 1) - 1) * 0.5;
  const boardCenterY = ((level.board?.rows || 1) - 1) * 0.5;
  const focus = options.focus || null;
  const centerDistance = Math.abs((cell.x || 0) - boardCenterX) + Math.abs((cell.y || 0) - boardCenterY);
  const focusDistance = focus
    ? Math.abs((cell.x || 0) - (focus.x || 0)) + Math.abs((cell.y || 0) - (focus.y || 0))
    : 0;
  let score = countNeighborOccupancy(occupied, cell) * 3.2;
  score -= centerDistance * 0.9;
  score -= focusDistance * 0.65;
  if (isBoardEdgeCell(level, cell)) {
    score -= 4;
  }
  return score;
}

function collectEmptyCells(level = {}, options = {}) {
  const occupied = options.occupied || buildPlacedBlockOccupancy(level);
  const reserved = options.reserved || buildReservedMechanicCells(level);
  const includeEdges = !!options.includeEdges;
  const cells = [];
  for (let y = 0; y < (level.board?.rows || 0); y += 1) {
    for (let x = 0; x < (level.board?.cols || 0); x += 1) {
      const cell = { x, y };
      const key = getCellKey(x, y);
      if ((!includeEdges && isBoardEdgeCell(level, cell)) || occupied.has(key) || reserved.has(key)) {
        continue;
      }
      cells.push(cell);
    }
  }
  return cells;
}

function pickRankedCandidate(candidates = [], rng = Math.random, shortlistSize = 6) {
  if (!Array.isArray(candidates) || !candidates.length) {
    return null;
  }
  const shortlist = candidates
    .slice()
    .sort((left, right) => (right.score || 0) - (left.score || 0))
    .slice(0, Math.min(shortlistSize, candidates.length));
  return shortlist[Math.floor(rng() * shortlist.length)] || shortlist[0] || null;
}

function buildGateSegmentCandidates(level = {}, options = {}) {
  const occupied = options.occupied || buildPlacedBlockOccupancy(level);
  const reserved = options.reserved || buildReservedMechanicCells(level);
  const includeEdges = !!options.includeEdges;
  const minLen = Math.max(1, Number(options.minLen) || 1);
  const maxLen = Math.max(minLen, Number(options.maxLen) || minLen);
  const cols = level.board?.cols || 0;
  const rows = level.board?.rows || 0;
  const seen = new Set();
  const candidates = [];

  const pushCandidate = (cells = [], orientation = 'horizontal') => {
    if (!cells.length) {
      return;
    }
    if ((!includeEdges && cells.some((cell) => isBoardEdgeCell(level, cell)))
      || cells.some((cell) => occupied.has(getCellKey(cell.x, cell.y)) || reserved.has(getCellKey(cell.x, cell.y)))) {
      return;
    }
    const key = `${orientation}:${cells.map((cell) => getCellKey(cell.x, cell.y)).join(';')}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    const center = getCellsCenter(cells);
    const boardCenterX = ((cols || 1) - 1) * 0.5;
    const boardCenterY = ((rows || 1) - 1) * 0.5;
    const centerDistance = Math.abs(center.x - boardCenterX) + Math.abs(center.y - boardCenterY);
    const adjacency = cells.reduce((sum, cell) => sum + countNeighborOccupancy(occupied, cell), 0);
    let score = adjacency * 3.5 - centerDistance * 1.1 + (cells.length * 0.4);
    if (options.focus) {
      score -= (Math.abs(center.x - options.focus.x) + Math.abs(center.y - options.focus.y)) * 0.45;
    }
    candidates.push({ cells, orientation, score });
  };

  for (let len = minLen; len <= maxLen; len += 1) {
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x <= cols - len; x += 1) {
        pushCandidate(Array.from({ length: len }, (_, offset) => ({ x: x + offset, y })), 'horizontal');
      }
    }
    for (let x = 0; x < cols; x += 1) {
      for (let y = 0; y <= rows - len; y += 1) {
        pushCandidate(Array.from({ length: len }, (_, offset) => ({ x, y: y + offset })), 'vertical');
      }
    }
  }

  return candidates.sort((left, right) => right.score - left.score);
}

function getUnlockedInjectableMechanics(round = 1) {
  return ENDLESS_MECHANIC_UNLOCKS.filter((entry) => round >= entry.minRound);
}

function getUnlockedPrimaryMechanics(round = 1) {
  return [
    { key: 'directional-target', minRound: 1, weight: round >= 8 ? 1.15 : 1.35 },
    ...getUnlockedInjectableMechanics(round),
  ];
}

function choosePrimaryMechanic(round = 1, rng = Math.random) {
  const unlocked = getUnlockedPrimaryMechanics(round);
  if (!unlocked.length) {
    return 'directional-target';
  }
  const newest = unlocked[unlocked.length - 1] || null;
  const weighted = unlocked.map((entry) => ({
    ...entry,
    weight: Math.max(0.01, entry.weight || 1) + (entry.key === newest?.key ? 0.22 : 0),
  }));
  return pickFromWeightedPool(weighted, rng)?.key || 'directional-target';
}

function getDirectionalOptionsForBlock(block = {}, exits = []) {
  const options = [];
  if ((block.w || 1) > 1 && hasAxisCompatibleExitLane({ ...block, moveAxis: 'horizontal' }, exits)) {
    options.push('horizontal');
  }
  if ((block.h || 1) > 1 && hasAxisCompatibleExitLane({ ...block, moveAxis: 'vertical' }, exits)) {
    options.push('vertical');
  }
  return options;
}

function ensureDirectionalCoverage(level = {}, round = 1, rng = Math.random) {
  const desiredCount = round >= 16 ? 4 : (round >= 8 ? 3 : 2);
  let currentCount = (level.blocks || []).filter((block) => (block.moveAxis || 'both') !== 'both').length;
  if (currentCount >= desiredCount) {
    return currentCount;
  }
  const centerX = ((level.board?.cols || 1) - 1) * 0.5;
  const centerY = ((level.board?.rows || 1) - 1) * 0.5;
  const candidates = (level.blocks || [])
    .filter((block) => (block.moveAxis || 'both') === 'both')
    .map((block) => {
      const options = getDirectionalOptionsForBlock(block, level.exits || []);
      if (!options.length) {
        return null;
      }
      const center = getBlockCenter(block);
      const centerDistance = Math.abs(center.x - centerX) + Math.abs(center.y - centerY);
      return {
        block,
        options,
        score: getBlockArea(block) * 4.2 - centerDistance * 0.85 + (((block.w || 1) > 1 && (block.h || 1) > 1) ? 2.25 : 1),
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score);

  candidates.forEach((entry) => {
    if (currentCount >= desiredCount) {
      return;
    }
    const options = shuffle(entry.options, rng);
    entry.block.moveAxis = options[0] || entry.options[0] || 'both';
    entry.block.baseMoveAxis = entry.block.moveAxis;
    currentCount += 1;
  });

  return currentCount;
}

function collectOneStepLegalMoves(level = {}, block = {}) {
  const axis = block.moveAxis || 'both';
  const moves = [];
  const directions = [
    { dx: -1, dy: 0, dir: 'left', axis: 'horizontal' },
    { dx: 1, dy: 0, dir: 'right', axis: 'horizontal' },
    { dx: 0, dy: -1, dir: 'top', axis: 'vertical' },
    { dx: 0, dy: 1, dir: 'bottom', axis: 'vertical' },
  ];
  directions.forEach((entry) => {
    if (axis !== 'both' && axis !== entry.axis) {
      return;
    }
    const anchor = { x: (block.x || 0) + entry.dx, y: (block.y || 0) + entry.dy };
    if (canPlaceBlockAtAnchor(level, block.id, anchor, { approachDir: entry.dir })) {
      moves.push({ ...entry, anchor });
    }
  });
  return moves;
}

function normalizeEndlessMechanicKey(type = '') {
  switch (String(type || '').trim().toLowerCase()) {
    case 'lock':
    case 'lock_gate':
      return 'lock-gate';
    case 'one_way':
    case 'one_way_gate':
      return 'one-way-gate';
    case 'toggle':
    case 'toggle_gate':
      return 'toggle-gate';
    default:
      return String(type || '').trim().toLowerCase();
  }
}

function collectActiveMechanics(level = {}) {
  const active = [];
  if ((level.blocks || []).some((block) => (block.moveAxis || 'both') !== 'both')) {
    active.push('directional-target');
  }
  const gateKeys = new Set((level.gates || []).map((gate) => normalizeEndlessMechanicKey(gate.type)));
  if (gateKeys.has('lock-gate')) {
    active.push('lock-gate');
  }
  if (gateKeys.has('one-way-gate')) {
    active.push('one-way-gate');
  }
  if (gateKeys.has('toggle-gate')) {
    active.push('toggle-gate');
  }
  const tileKeys = new Set((level.tiles || []).map((tile) => String(tile.type || '').trim().toLowerCase()));
  if (tileKeys.has('recolor')) {
    active.push('recolor');
  }
  if (tileKeys.has('ice')) {
    active.push('ice');
  }
  return active;
}

function getMechanicScoreBonus(level = {}) {
  return collectActiveMechanics(level).reduce((sum, key) => sum + (ENDLESS_MECHANIC_SCORE_BONUS[key] || 0), 0);
}

function createMechanicId(level = {}, prefix = 'mechanic') {
  return `endless-${prefix}-${(level.tiles?.length || 0) + (level.gates?.length || 0) + 1}`;
}

function addLockGateMechanic(level = {}, rng = Math.random) {
  const gate = pickRankedCandidate(buildGateSegmentCandidates(level, { minLen: 2, maxLen: 4 }), rng, 6);
  if (!gate) {
    return false;
  }
  const focus = getCellsCenter(gate.cells);
  const tileCandidates = collectEmptyCells(level)
    .map((cell) => ({
      x: cell.x,
      y: cell.y,
      score: scoreMechanicCell(level, cell, { focus }),
      distance: Math.abs(cell.x - focus.x) + Math.abs(cell.y - focus.y),
    }))
    .filter((entry) => entry.distance >= 2);
  const pad = pickRankedCandidate(tileCandidates, rng, 8);
  if (!pad) {
    return false;
  }
  const padId = createMechanicId(level, 'key-pad');
  level.tiles.push({ id: padId, type: 'key_pad', x: pad.x, y: pad.y });
  level.gates.push({
    id: createMechanicId(level, 'lock-gate'),
    type: 'lock_gate',
    keyPadIds: [padId],
    cells: gate.cells,
  });
  return true;
}

function getOneWayAllowDir(level = {}, gate = {}) {
  const center = getCellsCenter(gate.cells || []);
  if (gate.orientation === 'horizontal') {
    return center.y <= (((level.board?.rows || 1) - 1) * 0.5) ? 'top' : 'bottom';
  }
  return center.x <= (((level.board?.cols || 1) - 1) * 0.5) ? 'left' : 'right';
}

function addOneWayGateMechanic(level = {}, rng = Math.random) {
  const gate = pickRankedCandidate(buildGateSegmentCandidates(level, { minLen: 2, maxLen: 3 }), rng, 6);
  if (!gate) {
    return false;
  }
  level.gates.push({
    id: createMechanicId(level, 'one-way-gate'),
    type: 'one_way_gate',
    allowDir: getOneWayAllowDir(level, gate),
    cells: gate.cells,
  });
  return true;
}

function addToggleGateMechanic(level = {}, rng = Math.random) {
  const gate = pickRankedCandidate(buildGateSegmentCandidates(level, { minLen: 1, maxLen: 2 }), rng, 6);
  if (!gate) {
    return false;
  }
  const focus = getCellsCenter(gate.cells);
  const reserved = buildReservedMechanicCells(level);
  const support = pickRankedCandidate((level.blocks || [])
    .map((block) => {
      if (getExitMatchForFootprint(level, block)) {
        return null;
      }
      const cells = getBlockCells(block).filter((cell) => !reserved.has(getCellKey(cell.x, cell.y)));
      if (!cells.length) {
        return null;
      }
      const center = getBlockCenter(block);
      const centerDistance = Math.abs(center.x - focus.x) + Math.abs(center.y - focus.y);
      return {
        block,
        cells,
        score: (5.5 - Math.min(5.5, centerDistance)) + (Math.max(0, 5 - getBlockArea(block)) * 1.2),
      };
    })
    .filter(Boolean), rng, 6);
  if (!support) {
    return false;
  }
  const switchCell = support.cells
    .slice()
    .sort((left, right) => {
      const leftDistance = Math.abs(left.x - focus.x) + Math.abs(left.y - focus.y);
      const rightDistance = Math.abs(right.x - focus.x) + Math.abs(right.y - focus.y);
      return leftDistance - rightDistance;
    })[0];
  if (!switchCell) {
    return false;
  }
  const switchId = createMechanicId(level, 'toggle-switch');
  level.tiles.push({
    id: switchId,
    type: 'toggle_switch',
    x: switchCell.x,
    y: switchCell.y,
  });
  level.gates.push({
    id: createMechanicId(level, 'toggle-gate'),
    type: 'toggle_gate',
    defaultOpen: false,
    open: false,
    switchIds: [switchId],
    cells: gate.cells,
  });
  return true;
}

function getFootprintCellsAtAnchor(block = {}, anchor = { x: 0, y: 0 }) {
  return (block.shapeCells || []).map((cell) => ({
    x: anchor.x + cell.x,
    y: anchor.y + cell.y,
  }));
}

function addRecolorMechanic(level = {}, rng = Math.random) {
  const exitColors = new Set((level.exits || []).map((exit) => exit.acceptColor));
  const reserved = buildReservedMechanicCells(level);
  const candidates = (level.blocks || [])
    .filter((block) => (block.moveAxis || block.baseMoveAxis || 'both') === 'both')
    .map((block) => {
      const moves = collectOneStepLegalMoves(level, block);
      if (!moves.length) {
        return null;
      }
      const originalColor = block.style;
      const sourceColor = TARGET_STYLE_POOL.find((color) => color !== originalColor && !exitColors.has(color)) || '';
      if (!sourceColor) {
        return null;
      }
      const originalCells = new Set(getBlockCells(block).map((cell) => getCellKey(cell.x, cell.y)));
      const moveCandidate = pickRankedCandidate(moves
        .map((move) => {
          const footprintCells = getFootprintCellsAtAnchor(block, move.anchor).filter((cell) => !originalCells.has(getCellKey(cell.x, cell.y)) && !reserved.has(getCellKey(cell.x, cell.y)));
          if (!footprintCells.length) {
            return null;
          }
          const tile = pickRankedCandidate(footprintCells.map((cell) => ({
            x: cell.x,
            y: cell.y,
            score: scoreMechanicCell(level, cell, { focus: getBlockCenter(block) }),
          })), rng, 4);
          if (!tile) {
            return null;
          }
          return {
            tile,
            score: tile.score + (getBlockArea(block) * 1.8),
          };
        })
        .filter(Boolean), rng, 4);
      if (!moveCandidate) {
        return null;
      }
      return {
        block,
        sourceColor,
        targetColor: originalColor,
        tile: moveCandidate.tile,
        score: moveCandidate.score,
      };
    })
    .filter(Boolean);

  const pick = pickRankedCandidate(candidates, rng, 5);
  if (!pick) {
    return false;
  }
  pick.block.style = pick.sourceColor;
  level.tiles.push({
    id: createMechanicId(level, 'recolor'),
    type: 'recolor',
    x: pick.tile.x,
    y: pick.tile.y,
    toColor: pick.targetColor,
    style: pick.targetColor,
  });
  return true;
}

function addIceMechanic(level = {}, rng = Math.random) {
  const reserved = buildReservedMechanicCells(level);
  const candidates = [];
  (level.blocks || []).forEach((block) => {
    collectOneStepLegalMoves(level, block).forEach((move) => {
      const anchors = [];
      let current = { ...move.anchor };
      while (anchors.length < 3) {
        anchors.push({ ...current });
        const next = { x: current.x + move.dx, y: current.y + move.dy };
        if (!canPlaceBlockAtAnchor(level, block.id, next, { approachDir: move.dir })) {
          break;
        }
        current = next;
      }
      if (anchors.length < 2) {
        return;
      }
      const cells = [];
      const seen = new Set();
      anchors.slice(0, -1).forEach((anchor) => {
        getFootprintCellsAtAnchor(block, anchor).forEach((cell) => {
          const key = getCellKey(cell.x, cell.y);
          if (!reserved.has(key) && !seen.has(key)) {
            seen.add(key);
            cells.push(cell);
          }
        });
      });
      if (!cells.length) {
        return;
      }
      const center = getBlockCenter(block);
      const centerDistance = Math.abs(center.x - (((level.board?.cols || 1) - 1) * 0.5)) + Math.abs(center.y - (((level.board?.rows || 1) - 1) * 0.5));
      candidates.push({
        cells,
        score: (anchors.length * 5.5) + (getBlockArea(block) * 1.25) - centerDistance * 0.6,
      });
    });
  });
  const pick = pickRankedCandidate(candidates, rng, 6);
  if (!pick) {
    return false;
  }
  level.tiles.push({
    id: createMechanicId(level, 'ice'),
    type: 'ice',
    cells: pick.cells,
  });
  return true;
}

const ENDLESS_MECHANIC_APPLIERS = {
  'lock-gate': addLockGateMechanic,
  'one-way-gate': addOneWayGateMechanic,
  'toggle-gate': addToggleGateMechanic,
  recolor: addRecolorMechanic,
  ice: addIceMechanic,
};

function clearDirectionalMechanic(level = {}) {
  (level.blocks || []).forEach((block) => {
    block.moveAxis = 'both';
    block.baseMoveAxis = 'both';
    block.isLubricated = false;
  });
}

function applyPrimaryMechanic(level = {}, primaryMechanic = 'directional-target', round = 1, profile = null, rng = Math.random) {
  if (primaryMechanic === 'directional-target') {
    ensureDirectionalCoverage(level, round, rng);
    ensureAxisCompatibleExits(level, profile, rng);
    return ['directional-target'];
  }
  clearDirectionalMechanic(level);
  const applier = ENDLESS_MECHANIC_APPLIERS[primaryMechanic];
  if (applier && applier(level, rng)) {
    return [primaryMechanic];
  }
  ensureDirectionalCoverage(level, round, rng);
  ensureAxisCompatibleExits(level, profile, rng);
  return ['directional-target'];
}


function getEndlessStage(round) {
  if (round <= 5) {
    return {
      stageIndex: 0,
      rows: 8,
      colorCount: 4,
      minOcc: 0.68,
      maxOcc: 0.73,
      maxCandidates: 6,
      quickPassCount: 2,
      minBigBlockCount: 6,
      extraExitCount: [1, 2],
      directionalChance: 0.08,
      summary: '四色高密度基础异形盘',
    };
  }
  if (round <= 14) {
    return {
      stageIndex: 1,
      rows: 9,
      colorCount: 5,
      minOcc: 0.70,
      maxOcc: 0.74,
      maxCandidates: 12,
      quickPassCount: 2,
      minBigBlockCount: 7,
      extraExitCount: [2, 3],
      directionalChance: 0.14,
      summary: '五色互锁盘',
    };
  }
  return {
    stageIndex: 2,
    rows: 9,
    colorCount: 6,
    minOcc: 0.71,
    maxOcc: 0.75,
    maxCandidates: 10,
    quickPassCount: 4,
    minBigBlockCount: 8,
    extraExitCount: [2, 4],
    directionalChance: 0.2,
    summary: '六色高压盘',
  };
}

export function getEndlessDifficulty(difficultyId = 'brain') {
  return ENDLESS_DIFFICULTIES[difficultyId] || ENDLESS_DIFFICULTIES.brain;
}

function randomInt(min, max, rng) {
  const safeMin = Math.min(min, max);
  const safeMax = Math.max(min, max);
  return safeMin + Math.floor(rng() * (safeMax - safeMin + 1));
}

function pickFromWeightedPool(entries, rng) {
  const totalWeight = entries.reduce((sum, entry) => sum + Math.max(0, entry.weight || 0), 0);
  if (totalWeight <= 0) {
    return entries[0] || null;
  }
  let ticket = rng() * totalWeight;
  for (const entry of entries) {
    ticket -= Math.max(0, entry.weight || 0);
    if (ticket <= 0) {
      return entry;
    }
  }
  return entries[entries.length - 1] || null;
}

function buildShapeEntry(shapeDef, rng) {
  const shapeVariant = shapeDef.variants[Math.floor(rng() * shapeDef.variants.length)] || shapeDef.variants[0];
  const shapeCells = getShapeCells(shapeDef.key, shapeVariant);
  const bounds = getBoundsFromCells(shapeCells);
  return {
    shapeKey: shapeDef.key,
    shapeVariant,
    shapeCells,
    area: shapeDef.area,
    w: bounds.w,
    h: bounds.h,
    axisEligible: shapeDef.axisEligible,
  };
}

function getMoveAxis(shapeEntry, profile, rng) {
  if (!shapeEntry.axisEligible || rng() > profile.directionalChance) {
    return 'both';
  }
  if (shapeEntry.w === 1 && shapeEntry.h > 1) {
    return 'vertical';
  }
  if (shapeEntry.h === 1 && shapeEntry.w > 1) {
    return 'horizontal';
  }
  return rng() > 0.5 ? 'horizontal' : 'vertical';
}

function createOccupancy(cols, rows) {
  return {
    cols,
    rows,
    cells: new Set(),
  };
}

function getCellKey(x, y) {
  return `${x},${y}`;
}

function canPlaceShape(occupancy, shapeCells, x, y) {
  for (const cell of shapeCells) {
    const worldX = x + cell.x;
    const worldY = y + cell.y;
    if (worldX < 0 || worldY < 0 || worldX >= occupancy.cols || worldY >= occupancy.rows) {
      return false;
    }
    if (occupancy.cells.has(getCellKey(worldX, worldY))) {
      return false;
    }
  }
  return true;
}

function occupyCells(occupancy, shapeCells, x, y) {
  shapeCells.forEach((cell) => {
    occupancy.cells.add(getCellKey(x + cell.x, y + cell.y));
  });
}

function countAdjacency(occupancy, shapeCells, x, y) {
  let adjacency = 0;
  for (const cell of shapeCells) {
    const worldX = x + cell.x;
    const worldY = y + cell.y;
    const neighbors = [
      [worldX + 1, worldY],
      [worldX - 1, worldY],
      [worldX, worldY + 1],
      [worldX, worldY - 1],
    ];
    neighbors.forEach(([nextX, nextY]) => {
      if (occupancy.cells.has(getCellKey(nextX, nextY))) {
        adjacency += 1;
      }
    });
  }
  return adjacency;
}

function countEdgeCells(shapeCells, x, y, cols, rows) {
  let edgeCount = 0;
  shapeCells.forEach((cell) => {
    const worldX = x + cell.x;
    const worldY = y + cell.y;
    if (worldX === 0 || worldY === 0 || worldX === cols - 1 || worldY === rows - 1) {
      edgeCount += 1;
    }
  });
  return edgeCount;
}

function scorePlacement(occupancy, blueprint, x, y) {
  const area = blueprint.area;
  const centerX = x + (blueprint.w - 1) * 0.5;
  const centerY = y + (blueprint.h - 1) * 0.5;
  const boardCenterX = (occupancy.cols - 1) * 0.5;
  const boardCenterY = (occupancy.rows - 1) * 0.5;
  const centerDistance = Math.abs(centerX - boardCenterX) + Math.abs(centerY - boardCenterY);
  const adjacency = countAdjacency(occupancy, blueprint.shapeCells, x, y);
  const edgeCells = countEdgeCells(blueprint.shapeCells, x, y, occupancy.cols, occupancy.rows);
  const edgeDistance = Math.min(x, y, occupancy.cols - (x + blueprint.w), occupancy.rows - (y + blueprint.h));

  let score = adjacency * 3.2;
  if (area >= 4) {
    score += 7 - centerDistance * 1.4 + edgeDistance * 0.8;
  } else if (area === 3) {
    score += 4.5 - centerDistance * 0.7 + edgeDistance * 0.5;
  } else {
    score += 1.5 + edgeDistance * 1.4 - edgeCells * 1.9 - centerDistance * 0.2;
  }
  if (blueprint.moveAxis !== 'both') {
    score += 0.8 + adjacency * 0.35;
  }
  return score;
}

function choosePlacement(occupancy, blueprint, rng) {
  const candidates = [];
  for (let y = 0; y <= occupancy.rows - blueprint.h; y += 1) {
    for (let x = 0; x <= occupancy.cols - blueprint.w; x += 1) {
      if (!canPlaceShape(occupancy, blueprint.shapeCells, x, y)) {
        continue;
      }
      candidates.push({ x, y, score: scorePlacement(occupancy, blueprint, x, y) + rng() * 0.25 });
    }
  }
  if (!candidates.length) {
    return null;
  }
  candidates.sort((left, right) => right.score - left.score);
  const shortlist = candidates.slice(0, Math.min(8, candidates.length));
  return shortlist[Math.floor(rng() * shortlist.length)] || shortlist[0];
}

function getShapeStageLimit(shapeDef, stageIndex) {
  const limits = shapeDef.maxCountByStage || [];
  return Number.isFinite(limits[stageIndex]) ? limits[stageIndex] : limits[limits.length - 1] || Infinity;
}

function pickBlueprint(profile, remainingArea, shapeCounts, rng, options = {}) {
  const isSeed = !!options.isSeed;
  const forceLarge = !!options.forceLarge;
  const eligible = SHAPE_POOL.filter((shapeDef) => {
    if (shapeDef.minRound > options.round) {
      return false;
    }
    if (shapeCounts[shapeDef.key] >= getShapeStageLimit(shapeDef, profile.stageIndex)) {
      return false;
    }
    if (isSeed && shapeDef.area < 3) {
      return false;
    }
    if (forceLarge && shapeDef.area < 3) {
      return false;
    }
    if (remainingArea <= 0) {
      return false;
    }
    if (remainingArea < shapeDef.area) {
      return remainingArea === 1 && shapeDef.area === 1;
    }
    return true;
  }).map((shapeDef) => ({
    ...shapeDef,
    weight: shapeDef.weight + (remainingArea <= 3 && shapeDef.area === remainingArea ? 4 : 0),
  }));

  const selected = pickFromWeightedPool(eligible, rng);
  return selected ? buildShapeEntry(selected, rng) : null;
}

function pickColor(colors, colorArea, rng) {
  const ranked = [...colors].sort((left, right) => {
    const delta = (colorArea.get(left) || 0) - (colorArea.get(right) || 0);
    if (delta !== 0) {
      return delta;
    }
    return rng() > 0.5 ? 1 : -1;
  });
  return ranked[0] || colors[0];
}

function buildBlockBlueprints(profile, round, rng, options = {}) {
  const totalCells = 6 * profile.rows;
  const minArea = Math.ceil(totalCells * profile.minOcc);
  const maxArea = Math.floor(totalCells * profile.maxOcc);
  const targetArea = randomInt(minArea, maxArea, rng);
  const colors = shuffle(TARGET_STYLE_POOL, rng).slice(0, profile.colorCount);
  const shapeCounts = {};
  const colorArea = new Map(colors.map((color) => [color, 0]));
  const blueprints = [];
  let usedArea = 0;
  let bigBlockCount = 0;

  colors.forEach((color) => {
    const shape = pickBlueprint(profile, targetArea - usedArea, shapeCounts, rng, {
      isSeed: true,
      forceLarge: true,
      round,
    });
    if (!shape) {
      return;
    }
    shapeCounts[shape.shapeKey] = (shapeCounts[shape.shapeKey] || 0) + 1;
    colorArea.set(color, (colorArea.get(color) || 0) + shape.area);
    usedArea += shape.area;
    if (shape.area >= 3) {
      bigBlockCount += 1;
    }
    blueprints.push({
      style: color,
      moveAxis: options.enableDirectional ? getMoveAxis(shape, profile, rng) : 'both',
      ...shape,
    });
  });

  let guard = 0;
  while (usedArea < minArea && guard < 64) {
    const remainingArea = targetArea - usedArea;
    const forceLarge = bigBlockCount < profile.minBigBlockCount;
    const shape = pickBlueprint(profile, remainingArea, shapeCounts, rng, {
      forceLarge,
      round,
    });
    if (!shape) {
      break;
    }
    const color = pickColor(colors, colorArea, rng);
    shapeCounts[shape.shapeKey] = (shapeCounts[shape.shapeKey] || 0) + 1;
    colorArea.set(color, (colorArea.get(color) || 0) + shape.area);
    usedArea += shape.area;
    if (shape.area >= 3) {
      bigBlockCount += 1;
    }
    blueprints.push({
      style: color,
      moveAxis: options.enableDirectional ? getMoveAxis(shape, profile, rng) : 'both',
      ...shape,
    });
    guard += 1;
  }

  if (usedArea < minArea || bigBlockCount < profile.minBigBlockCount) {
    return null;
  }

  if (options.enableDirectional) {
    const desiredDirectionalCount = round >= 16 ? 4 : (round >= 8 ? 3 : 2);
    let directionalCount = blueprints.filter((blueprint) => blueprint.moveAxis !== 'both').length;
    blueprints
      .filter((blueprint) => blueprint.moveAxis === 'both' && blueprint.axisEligible)
      .sort((left, right) => right.area - left.area || ((right.w * right.h) - (left.w * left.h)))
      .forEach((blueprint) => {
        if (directionalCount >= desiredDirectionalCount) {
          return;
        }
        if (blueprint.w === 1 && blueprint.h > 1) {
          blueprint.moveAxis = 'vertical';
        } else if (blueprint.h === 1 && blueprint.w > 1) {
          blueprint.moveAxis = 'horizontal';
        } else {
          blueprint.moveAxis = rng() > 0.5 ? 'horizontal' : 'vertical';
        }
        directionalCount += 1;
      });
  }

  return {
    colors,
    usedArea,
    targetArea,
    blueprints: blueprints.sort((left, right) => right.area - left.area || (left.moveAxis === 'both' ? 1 : -1)),
  };
}

function placeBlueprints(profile, blueprintPack, rng) {
  const occupancy = createOccupancy(6, profile.rows);
  const blocks = [];
  for (let index = 0; index < blueprintPack.blueprints.length; index += 1) {
    const blueprint = blueprintPack.blueprints[index];
    const placement = choosePlacement(occupancy, blueprint, rng);
    if (!placement) {
      return null;
    }
    occupyCells(occupancy, blueprint.shapeCells, placement.x, placement.y);
    blocks.push(createBlock({
      id: `endless-block-${index + 1}`,
      style: blueprint.style,
      x: placement.x,
      y: placement.y,
      shapeKey: blueprint.shapeKey,
      shapeVariant: blueprint.shapeVariant,
      shapeCells: blueprint.shapeCells,
      moveAxis: blueprint.moveAxis,
    }));
  }
  return blocks;
}

function getBlockCells(block) {
  return (block.shapeCells || []).map((cell) => ({ x: block.x + cell.x, y: block.y + cell.y }));
}

function getBlockProjectionSpan(block, edge) {
  const values = getBlockCells(block).map((cell) => (edge === 'left' || edge === 'right' ? cell.y : cell.x));
  const start = values.length ? Math.min(...values) : 0;
  const end = values.length ? Math.max(...values) + 1 : 0;
  return { start, end, span: Math.max(1, end - start) };
}

function getAllowedAxisEdges(block) {
  const axis = block.moveAxis || 'both';
  if (axis === 'horizontal') {
    return ['left', 'right'];
  }
  if (axis === 'vertical') {
    return ['top', 'bottom'];
  }
  return ['left', 'right', 'top', 'bottom'];
}

function hasAxisCompatibleExitLane(block, exits = []) {
  if (!block || (block.moveAxis || 'both') === 'both') {
    return true;
  }
  const allowedEdges = getAllowedAxisEdges(block);
  return (exits || []).some((exit) => {
    if (exit.acceptColor !== block.style || !allowedEdges.includes(exit.edge)) {
      return false;
    }
    const projection = getBlockProjectionSpan(block, exit.edge);
    return projection.start >= exit.start && projection.end <= exit.start + exit.span;
  });
}

function exitOverlaps(left, right) {
  if (left.edge !== right.edge) {
    return false;
  }
  return left.start < right.start + right.span && right.start < left.start + left.span;
}

function createsAdjacentSingleExit(exits, candidate, color) {
  if (candidate.span !== 1) {
    return false;
  }
  return exits.some((exit) => exit.acceptColor === color
    && exit.edge === candidate.edge
    && exit.span === 1
    && Math.abs(exit.start - candidate.start) === 1);
}

function buildAxisCompatibleExitCandidates(block, edge, limit) {
  const projection = getBlockProjectionSpan(block, edge);
  const candidates = [];
  const minSpan = Math.max(1, projection.span);
  const maxSpan = Math.min(limit, projection.span + 2);
  for (let span = minSpan; span <= maxSpan; span += 1) {
    const minStart = Math.max(0, projection.end - span);
    const maxStart = Math.min(limit - span, projection.start);
    for (let start = minStart; start <= maxStart; start += 1) {
      candidates.push({
        edge,
        start,
        span,
        score: (span === projection.span ? 4 : 0) - Math.abs(start - projection.start) * 0.65 - (span - projection.span) * 0.8,
      });
    }
  }
  candidates.sort((left, right) => right.score - left.score || left.span - right.span || left.start - right.start);
  return candidates;
}

function ensureAxisCompatibleExits(level, profile = null, rng = Math.random) {
  const exits = level.exits || [];
  const rowCount = profile?.rows || level.board?.rows || 0;
  const axisLockedBlocks = shuffle((level.blocks || []).filter((block) => (block.moveAxis || 'both') !== 'both'), rng);
  axisLockedBlocks.forEach((block) => {
    if (hasAxisCompatibleExitLane(block, exits)) {
      return;
    }
    const allowedEdges = shuffle(getAllowedAxisEdges(block), rng);
    let placed = false;
    for (const allowAdjacentSingles of [false, true]) {
      if (placed) {
        break;
      }
      for (const edge of allowedEdges) {
        const limit = edge === 'top' || edge === 'bottom' ? 6 : rowCount;
        const candidates = buildAxisCompatibleExitCandidates(block, edge, limit);
        const pick = candidates.find((candidate) => {
          if (candidate.start < 0 || candidate.start + candidate.span > limit) {
            return false;
          }
          if (exits.some((exit) => exitOverlaps(exit, candidate))) {
            return false;
          }
          if (!allowAdjacentSingles && createsAdjacentSingleExit(exits, candidate, block.style)) {
            return false;
          }
          return true;
        }) || null;
        if (!pick) {
          continue;
        }
        exits.push(createExit(`endless-exit-${exits.length + 1}`, pick.edge, pick.start, pick.span, block.style));
        placed = true;
        break;
      }
    }
    if (!hasAxisCompatibleExitLane(block, exits)) {
      block.moveAxis = 'both';
      block.baseMoveAxis = 'both';
    }
  });
  level.exits = exits;
}

function getExitTouchCount(blocks, color, exit, rows) {
  let touchCount = 0;
  let matchingTouchCount = 0;
  let minDistance = Infinity;
  blocks.forEach((block) => {
    const cells = getBlockCells(block);
    cells.forEach((cell) => {
      let matchesSlot = false;
      let edgeDistance = Infinity;
      if (exit.edge === 'top') {
        matchesSlot = cell.y === 0 && cell.x >= exit.start && cell.x < exit.start + exit.span;
        edgeDistance = cell.y + Math.abs((exit.start + (exit.span - 1) * 0.5) - cell.x);
      } else if (exit.edge === 'bottom') {
        matchesSlot = cell.y === rows - 1 && cell.x >= exit.start && cell.x < exit.start + exit.span;
        edgeDistance = (rows - 1 - cell.y) + Math.abs((exit.start + (exit.span - 1) * 0.5) - cell.x);
      } else if (exit.edge === 'left') {
        matchesSlot = cell.x === 0 && cell.y >= exit.start && cell.y < exit.start + exit.span;
        edgeDistance = cell.x + Math.abs((exit.start + (exit.span - 1) * 0.5) - cell.y);
      } else if (exit.edge === 'right') {
        matchesSlot = cell.x === 5 && cell.y >= exit.start && cell.y < exit.start + exit.span;
        edgeDistance = (5 - cell.x) + Math.abs((exit.start + (exit.span - 1) * 0.5) - cell.y);
      }
      if (matchesSlot) {
        touchCount += 1;
        if (block.style === color) {
          matchingTouchCount += 1;
        }
      }
      if (block.style === color) {
        minDistance = Math.min(minDistance, edgeDistance);
      }
    });
  });
  return {
    touchCount,
    matchingTouchCount,
    minDistance: Number.isFinite(minDistance) ? minDistance : 99,
  };
}

function getRequiredSpanByEdge(blocks, color) {
  const sameColorBlocks = blocks.filter((block) => block.style === color);
  return {
    top: Math.max(1, ...sameColorBlocks.map((block) => getFootprintProjectionLength(block, 'top'))),
    bottom: Math.max(1, ...sameColorBlocks.map((block) => getFootprintProjectionLength(block, 'bottom'))),
    left: Math.max(1, ...sameColorBlocks.map((block) => getFootprintProjectionLength(block, 'left'))),
    right: Math.max(1, ...sameColorBlocks.map((block) => getFootprintProjectionLength(block, 'right'))),
  };
}

function chooseExits(blocks, colors, profile, rng) {
  const exits = [];
  const primaryColors = shuffle(colors, rng);
  const requiredSpanByColor = new Map(colors.map((color) => [color, getRequiredSpanByEdge(blocks, color)]));

  function buildCandidates(color, options = {}) {
    const required = requiredSpanByColor.get(color) || { top: 1, bottom: 1, left: 1, right: 1 };
    const edgeOrder = shuffle(['top', 'bottom', 'left', 'right'], rng);
    const candidates = [];
    edgeOrder.forEach((edge) => {
      const span = Math.max(1, options.fixedSpan || required[edge] || 1);
      const limit = edge === 'top' || edge === 'bottom' ? 6 : profile.rows;
      if (span > limit) {
        return;
      }
      for (let start = 0; start <= limit - span; start += 1) {
        const candidate = { edge, start, span };
        if (exits.some((exit) => exitOverlaps(exit, candidate))) {
          continue;
        }
        if (createsAdjacentSingleExit(exits, candidate, color)) {
          continue;
        }
        const metrics = getExitTouchCount(blocks, color, candidate, profile.rows);
        if (!options.loosen && metrics.matchingTouchCount > 0) {
          continue;
        }
        const distanceScore = Math.min(9, metrics.minDistance) * 1.2;
        const congestionPenalty = metrics.touchCount * 0.85;
        const spanPenalty = span * (options.preferCompact ? 1.1 : 0.55);
        candidates.push({
          ...candidate,
          score: distanceScore - congestionPenalty - spanPenalty + rng() * 0.25,
        });
      }
    });
    return candidates.sort((left, right) => right.score - left.score);
  }

  function placeExitForColor(color, options = {}) {
    const candidates = buildCandidates(color, options);
    const shortlist = candidates.slice(0, Math.min(4, candidates.length));
    const pick = shortlist[Math.floor(rng() * shortlist.length)] || candidates[0] || null;
    if (!pick) {
      return false;
    }
    exits.push(createExit(`endless-exit-${exits.length + 1}`, pick.edge, pick.start, pick.span, color));
    return true;
  }

  primaryColors.forEach((color) => {
    placeExitForColor(color, { loosen: false });
  });

  if (exits.length < colors.length) {
    primaryColors.forEach((color) => {
      if (!exits.some((exit) => exit.acceptColor === color)) {
        placeExitForColor(color, { loosen: true });
      }
    });
  }

  if (exits.length < colors.length) {
    return null;
  }

  const axisLockedBlocks = shuffle(blocks.filter((block) => (block.moveAxis || 'both') !== 'both'), rng);
  axisLockedBlocks.forEach((block) => {
    if (hasAxisCompatibleExitLane(block, exits)) {
      return;
    }
    const allowedEdges = shuffle(getAllowedAxisEdges(block), rng);
    for (const edge of allowedEdges) {
      const projection = getBlockProjectionSpan(block, edge);
      const candidate = { edge, start: projection.start, span: projection.span };
      const limit = edge === 'top' || edge === 'bottom' ? 6 : profile.rows;
      if (candidate.start < 0 || candidate.start + candidate.span > limit) {
        continue;
      }
      if (exits.some((exit) => exitOverlaps(exit, candidate))) {
        continue;
      }
      if (createsAdjacentSingleExit(exits, candidate, block.style)) {
        continue;
      }
      exits.push(createExit(`endless-exit-${exits.length + 1}`, candidate.edge, candidate.start, candidate.span, block.style));
      break;
    }
  });

  const extraExitTotal = randomInt(profile.extraExitCount[0], profile.extraExitCount[1], rng);
  for (let index = 0; index < extraExitTotal; index += 1) {
    const color = colors[Math.floor(rng() * colors.length)] || colors[0];
    if (!placeExitForColor(color, { loosen: false, preferCompact: true, fixedSpan: 1 })) {
      placeExitForColor(color, { loosen: true, preferCompact: true, fixedSpan: 1 });
    }
  }

  return exits;
}

function buildBlockOccupancy(level, ignoreBlockId = "") {
  const occupied = new Set();
  (level.blocks || []).forEach((block) => {
    if (block.id === ignoreBlockId) {
      return;
    }
    getBlockCells(block).forEach((cell) => {
      occupied.add(getCellKey(cell.x, cell.y));
    });
  });
  return occupied;
}

function canMoveBlockBy(level, block, dx, dy) {
  const occupied = buildBlockOccupancy(level, block.id);
  for (const cell of block.shapeCells || []) {
    const nextX = block.x + cell.x + dx;
    const nextY = block.y + cell.y + dy;
    if (nextX < 0 || nextY < 0 || nextX >= level.board.cols || nextY >= level.board.rows) {
      return false;
    }
    if (occupied.has(getCellKey(nextX, nextY))) {
      return false;
    }
  }
  return true;
}

function getOneStepMoves(level, block) {
  const moves = [];
  const axis = block.moveAxis || "both";
  if (axis === "both" || axis === "horizontal") {
    if (canMoveBlockBy(level, block, -1, 0)) {
      moves.push([-1, 0]);
    }
    if (canMoveBlockBy(level, block, 1, 0)) {
      moves.push([1, 0]);
    }
  }
  if (axis === "both" || axis === "vertical") {
    if (canMoveBlockBy(level, block, 0, -1)) {
      moves.push([0, -1]);
    }
    if (canMoveBlockBy(level, block, 0, 1)) {
      moves.push([0, 1]);
    }
  }
  return moves;
}

function collectStructuralMetrics(level) {
  const totalCells = Math.max(1, (level.board?.cols || 0) * (level.board?.rows || 0));
  const occupiedCells = (level.blocks || []).reduce((sum, block) => sum + (block.shapeCells?.length || 0), 0);
  const directClearBlocks = (level.blocks || []).filter((block) => !!getExitMatchForFootprint(level, block));
  const movableBlocks = [];
  let edgeSmallCount = 0;
  let centerHeavyCount = 0;
  let axisLockedCount = 0;
  let axisLockedOrphanCount = 0;
  (level.blocks || []).forEach((block) => {
    const moves = getOneStepMoves(level, block);
    if (moves.length) {
      movableBlocks.push(block);
    }
    const area = block.shapeCells?.length || 0;
    if ((block.moveAxis || 'both') !== 'both') {
      axisLockedCount += 1;
      if (!hasAxisCompatibleExitLane(block, level.exits || [])) {
        axisLockedOrphanCount += 1;
      }
    }
    const touchesEdge = getBlockCells(block).some((cell) => cell.x === 0 || cell.y === 0 || cell.x === level.board.cols - 1 || cell.y === level.board.rows - 1);
    if (area <= 2 && touchesEdge) {
      edgeSmallCount += 1;
    }
    if (area >= 3) {
      const centerX = block.x + ((block.w || 1) - 1) * 0.5;
      const centerY = block.y + ((block.h || 1) - 1) * 0.5;
      const insideCore = centerX >= 1 && centerX <= level.board.cols - 2 && centerY >= 1 && centerY <= level.board.rows - 2;
      if (insideCore) {
        centerHeavyCount += 1;
      }
    }
  });
  return {
    occupancyRate: occupiedCells / totalCells,
    directClearCount: directClearBlocks.length,
    openingMovableBlockCount: movableBlocks.length,
    openingLargeMovableBlockCount: movableBlocks.filter((block) => (block.shapeCells?.length || 0) >= 3).length,
    edgeSmallCount,
    centerHeavyCount,
    axisLockedCount,
    axisLockedOrphanCount,
    doorCompetitionCount: Math.max(0, (level.exits || []).length - new Set((level.exits || []).map((exit) => exit.acceptColor)).size),
  };
}

function evaluateCandidate(level) {
  const structural = collectStructuralMetrics(level);
  const occupancyScore = structural.occupancyRate * 100;
  let score = occupancyScore;
  score += getMechanicScoreBonus(level);
  score += structural.centerHeavyCount * 6.5;
  score += structural.openingLargeMovableBlockCount * 5;
  score += structural.doorCompetitionCount * 3.5;
  score += structural.axisLockedCount * 1.5;
  score -= structural.edgeSmallCount * 3.5;
  score -= structural.axisLockedOrphanCount * 120;
  score -= structural.directClearCount * 80;
  score -= Math.abs(structural.openingMovableBlockCount - 4) * 4.5;

  const structuralAccepted = structural.directClearCount === 0
    && structural.occupancyRate >= 0.78
    && structural.openingMovableBlockCount >= 2
    && structural.openingMovableBlockCount <= 7
    && structural.openingLargeMovableBlockCount >= 1
    && structural.centerHeavyCount >= 4
    && structural.axisLockedOrphanCount === 0;

  let report = {
    isStructurallyValid: true,
    reason: structuralAccepted ? "structural_only" : "structural_reject",
    isSolvable: false,
    directClearCount: structural.directClearCount,
    openingMovableBlockCount: structural.openingMovableBlockCount,
    openingActionCount: structural.openingMovableBlockCount,
    firstClearSetupDepth: null,
    bestFirstClearSetupDepth: null,
    firstClearArea: null,
    doorCompetitionCount: structural.doorCompetitionCount,
    issues: structural.axisLockedOrphanCount > 0 ? [{ type: 'axis_locked_without_exit_lane', count: structural.axisLockedOrphanCount }] : [],
    difficultyScore: null,
    fastDifficultyScore: score,
  };

  if (structuralAccepted) {
    report = validateLevelQuick(level, {
      maxVisited: 180,
      maxQueue: 140,
      maxTimeMs: 5,
      maxBlocksPerState: 5,
      maxAnchorsPerBlock: 3,
      firstClearMaxStates: 120,
      firstClearMaxRoutes: 1,
      firstClearDepthSlack: 0,
      firstClearRouteFamilyCap: 1,
      firstClearMaxBlocksPerState: 5,
      firstClearMaxAnchorsPerBlock: 3,
    });
    if (Number.isFinite(report.fastDifficultyScore)) {
      score += report.fastDifficultyScore * 0.2;
    }
    if (report.isSolvable) {
      score += 10;
    }
    if (Number.isFinite(report.firstClearSetupDepth)) {
      score += report.firstClearSetupDepth * 6;
    }
    if (Number.isFinite(report.bestFirstClearSetupDepth)) {
      score += report.bestFirstClearSetupDepth * 3;
    }
    if (Number.isFinite(report.firstClearArea) && report.firstClearArea >= 3) {
      score += 6;
    }
    if ((report.directClearCount || 0) > 0) {
      score -= 50;
    }
  }

  const accepted = report.isSolvable
    && (report.directClearCount || 0) === 0;

  return {
    accepted,
    score,
    report,
    structural,
  };
}
function buildCandidate(profile, round, seedKey) {
  const rng = createRng(hashSeed(seedKey));
  const primaryMechanic = choosePrimaryMechanic(round, rng);
  const blueprintPack = buildBlockBlueprints(profile, round, rng, {
    enableDirectional: primaryMechanic === 'directional-target',
  });
  if (!blueprintPack) {
    return null;
  }
  const blocks = placeBlueprints(profile, blueprintPack, rng);
  if (!blocks) {
    return null;
  }
  const exits = chooseExits(blocks, blueprintPack.colors, profile, rng);
  if (!exits) {
    return null;
  }
  const candidate = {
    id: `endless-candidate-${hashSeed(seedKey)}`,
    title: '无限模式',
    rewardCoins: ENDLESS_DIFFICULTIES.brain.rewardCoins,
    board: {
      cols: 6,
      rows: profile.rows,
      themeKey: 'toy-workshop',
    },
    exits,
    blocks,
    tiles: [],
    gates: [],
    meta: {
      mode: 'endless',
    },
  };
  const injectedMechanics = applyPrimaryMechanic(candidate, primaryMechanic, round, profile, rng);
  candidate.meta = {
    ...candidate.meta,
    primaryMechanic,
    injectedMechanics,
    activeMechanics: collectActiveMechanics(candidate),
  };
  return candidate;
}

function chooseBestCandidate(round, baseSeed, options = {}) {
  const profile = getEndlessStage(round);
  const candidateResults = [];
  const candidateBudget = Number.isFinite(options.candidateCount)
    ? Math.max(1, Math.floor(options.candidateCount))
    : profile.maxCandidates;
  const seedPrefix = options.seedPrefix || 'endless';
  for (let index = 0; index < candidateBudget; index += 1) {
    const candidate = buildCandidate(profile, round, `${seedPrefix}:${baseSeed}:${round}:${index}`);
    if (!candidate) {
      continue;
    }
    candidateResults.push({
      candidate,
      evaluated: evaluateCandidate(candidate),
    });
  }
  const accepted = candidateResults.filter((entry) => entry.evaluated.accepted);
  const structuralAccepted = candidateResults.filter((entry) => entry.evaluated.structural.directClearCount === 0);
  const preferredPool = accepted.length ? accepted : (structuralAccepted.length ? structuralAccepted : candidateResults);
  preferredPool.sort((left, right) => right.evaluated.score - left.evaluated.score);
  return {
    best: preferredPool[0] || candidateResults[0] || null,
    profile,
    attempts: candidateResults.length,
    budget: candidateBudget,
  };
}

function chooseRecoveredCandidate(round, baseSeed, profile = getEndlessStage(round)) {
  const recoveryBudget = Math.max((profile.maxCandidates || 8) * 4, 24);
  return chooseBestCandidate(round, hashSeed(`recovery:${baseSeed}:${round}`), {
    candidateCount: recoveryBudget,
    seedPrefix: 'endless-recovery',
  });
}

function createFallbackLevel(difficulty, baseSeed, round) {
  const profile = getEndlessStage(round);
  const stageIndex = profile.stageIndex || 0;
  const layout = stageIndex <= 0
    ? {
      board: { cols: 6, rows: 8, themeKey: 'toy-workshop' },
      exits: [
        ['fallback-exit-1', 'bottom', 2, 2, 'red'],
        ['fallback-exit-2', 'bottom', 0, 2, 'blue'],
        ['fallback-exit-3', 'right', 4, 2, 'green'],
        ['fallback-exit-4', 'left', 1, 2, 'yellow'],
      ],
      blocks: [
        { id: 'fallback-b1', style: 'red', x: 0, y: 0, shapeKey: 'square-2' },
        { id: 'fallback-b2', style: 'blue', x: 2, y: 0, shapeKey: 'square-2' },
        { id: 'fallback-b3', style: 'green', x: 4, y: 0, shapeKey: 'domino', shapeVariant: 'v' },
        { id: 'fallback-b4', style: 'yellow', x: 5, y: 0, shapeKey: 'domino', shapeVariant: 'v' },
        { id: 'fallback-b5', style: 'green', x: 0, y: 2, shapeKey: 'square-2' },
        { id: 'fallback-b6', style: 'yellow', x: 2, y: 2, shapeKey: 'square-2' },
        { id: 'fallback-b7', style: 'red', x: 4, y: 2, shapeKey: 'domino', shapeVariant: 'v' },
        { id: 'fallback-b8', style: 'blue', x: 5, y: 2, shapeKey: 'domino', shapeVariant: 'v' },
        { id: 'fallback-b9', style: 'red', x: 0, y: 4, shapeKey: 'bar3', shapeVariant: 'h' },
        { id: 'fallback-b10', style: 'blue', x: 3, y: 4, shapeKey: 'bar3', shapeVariant: 'h' },
        { id: 'fallback-b11', style: 'green', x: 0, y: 5, shapeKey: 'square-2' },
        { id: 'fallback-b12', style: 'yellow', x: 2, y: 5, shapeKey: 'square-2' },
        { id: 'fallback-b13', style: 'red', x: 4, y: 5, shapeKey: 'domino', shapeVariant: 'v' },
        { id: 'fallback-b14', style: 'blue', x: 5, y: 5, shapeKey: 'domino', shapeVariant: 'v' },
      ],
    }
    : (stageIndex == 1
      ? {
        board: { cols: 6, rows: 9, themeKey: 'toy-workshop' },
        exits: [
          ['fallback-exit-1', 'bottom', 2, 2, 'red'],
          ['fallback-exit-2', 'bottom', 0, 2, 'blue'],
          ['fallback-exit-3', 'right', 4, 2, 'green'],
          ['fallback-exit-4', 'left', 1, 2, 'yellow'],
          ['fallback-exit-5', 'top', 3, 2, 'purple'],
        ],
        blocks: [
          { id: 'fallback-b1', style: 'red', x: 0, y: 0, shapeKey: 'square-2' },
          { id: 'fallback-b2', style: 'blue', x: 2, y: 0, shapeKey: 'square-2' },
          { id: 'fallback-b3', style: 'green', x: 4, y: 0, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b4', style: 'yellow', x: 5, y: 0, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b5', style: 'green', x: 0, y: 2, shapeKey: 'square-2' },
          { id: 'fallback-b6', style: 'yellow', x: 2, y: 2, shapeKey: 'square-2' },
          { id: 'fallback-b7', style: 'red', x: 4, y: 2, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b8', style: 'blue', x: 5, y: 2, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b9', style: 'red', x: 0, y: 4, shapeKey: 'bar3', shapeVariant: 'h' },
          { id: 'fallback-b10', style: 'blue', x: 3, y: 4, shapeKey: 'bar3', shapeVariant: 'h' },
          { id: 'fallback-b11', style: 'green', x: 0, y: 5, shapeKey: 'square-2' },
          { id: 'fallback-b12', style: 'yellow', x: 2, y: 5, shapeKey: 'square-2' },
          { id: 'fallback-b13', style: 'red', x: 4, y: 5, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b14', style: 'blue', x: 5, y: 5, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b15', style: 'purple', x: 4, y: 7, shapeKey: 'square-2' },
        ],
      }
      : {
        board: { cols: 6, rows: 9, themeKey: 'toy-workshop' },
        exits: [
          ['fallback-exit-1', 'bottom', 2, 2, 'red'],
          ['fallback-exit-2', 'bottom', 0, 2, 'blue'],
          ['fallback-exit-3', 'right', 4, 2, 'green'],
          ['fallback-exit-4', 'left', 1, 2, 'yellow'],
          ['fallback-exit-5', 'top', 2, 2, 'purple'],
          ['fallback-exit-6', 'top', 4, 2, 'orange'],
        ],
        blocks: [
          { id: 'fallback-b1', style: 'red', x: 0, y: 0, shapeKey: 'square-2' },
          { id: 'fallback-b2', style: 'blue', x: 2, y: 0, shapeKey: 'square-2' },
          { id: 'fallback-b3', style: 'green', x: 4, y: 0, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b4', style: 'yellow', x: 5, y: 0, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b5', style: 'green', x: 0, y: 2, shapeKey: 'square-2' },
          { id: 'fallback-b6', style: 'yellow', x: 2, y: 2, shapeKey: 'square-2' },
          { id: 'fallback-b7', style: 'red', x: 4, y: 2, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b8', style: 'blue', x: 5, y: 2, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b9', style: 'red', x: 0, y: 4, shapeKey: 'bar3', shapeVariant: 'h' },
          { id: 'fallback-b10', style: 'blue', x: 3, y: 4, shapeKey: 'bar3', shapeVariant: 'h' },
          { id: 'fallback-b11', style: 'green', x: 0, y: 5, shapeKey: 'square-2' },
          { id: 'fallback-b12', style: 'yellow', x: 2, y: 5, shapeKey: 'square-2' },
          { id: 'fallback-b13', style: 'red', x: 4, y: 5, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b14', style: 'blue', x: 5, y: 5, shapeKey: 'domino', shapeVariant: 'v' },
          { id: 'fallback-b15', style: 'purple', x: 0, y: 7, shapeKey: 'square-2' },
          { id: 'fallback-b16', style: 'orange', x: 4, y: 7, shapeKey: 'square-2' },
        ],
      });

  return {
    id: `endless-${difficulty.id}-${baseSeed}-${round}-fallback`,
    title: `无限模式 · ${difficulty.label} · 第 ${round} 局`,
    rewardCoins: difficulty.rewardCoins,
    board: layout.board,
    exits: layout.exits.map(([id, edge, start, span, color]) => createExit(id, edge, start, span, color)),
    blocks: layout.blocks.map((block) => createBlock(block)),
    tiles: [],
    gates: [],
    meta: {
      mode: 'endless',
      difficultyId: difficulty.id,
      difficultyLabel: difficulty.label,
      round,
      baseSeed,
      seed: hashSeed(`fallback:${difficulty.id}:${baseSeed}:${round}`),
      templateId: 'fallback-dense-v2',
      familyId: 'fallback-dense-v2',
      stageSummary: `${profile.summary} · fallback`,
      generationAttempts: 0,
    },
  };
}

export function createEndlessLevel(options = {}) {
  const difficulty = getEndlessDifficulty(options.difficultyId);
  const round = Math.max(1, Number(options.round) || 1);
  const baseSeed = Number.isFinite(options.baseSeed) ? (options.baseSeed >>> 0) : hashSeed(`${difficulty.id}:${round}:preview`);
  const cacheKey = `${difficulty.id}:${baseSeed}:${round}`;
  if (GENERATION_CACHE.has(cacheKey)) {
    return clone(GENERATION_CACHE.get(cacheKey));
  }

  const selected = chooseBestCandidate(round, baseSeed);
  const recovered = !selected.best ? chooseRecoveredCandidate(round, baseSeed, selected.profile) : null;
  const resolved = selected.best ? selected : recovered;
  if (!resolved?.best) {
    const fallback = createFallbackLevel(difficulty, baseSeed, round);
    GENERATION_CACHE.set(cacheKey, fallback);
    return clone(fallback);
  }

  const recoveryUsed = !selected.best && !!recovered?.best;
  const bestLevel = clone(resolved.best.candidate);
  bestLevel.id = `endless-${difficulty.id}-${baseSeed}-${round}-${hashSeed(`${cacheKey}:best`)}`;
  bestLevel.title = `无限模式 · ${difficulty.label} · 第 ${round} 局`;
  bestLevel.rewardCoins = difficulty.rewardCoins;
  bestLevel.meta = {
    ...bestLevel.meta,
    mode: 'endless',
    difficultyId: difficulty.id,
    difficultyLabel: difficulty.label,
    round,
    baseSeed,
    seed: hashSeed(`${cacheKey}:level`),
    templateId: recoveryUsed ? 'random-filtered-v1-recovery' : 'random-filtered-v1',
    familyId: recoveryUsed ? 'random-filtered-v1-recovery' : 'random-filtered-v1',
    stageSummary: resolved.profile.summary,
    generationAttempts: (selected.attempts || 0) + (recoveryUsed ? (recovered?.attempts || 0) : 0),
    generationBudget: (selected.budget || 0) + (recoveryUsed ? (recovered?.budget || 0) : 0),
    recoveryUsed,
    difficultyScore: resolved.best.evaluated.report.difficultyScore,
    fastDifficultyScore: resolved.best.evaluated.report.fastDifficultyScore,
    quickReason: resolved.best.evaluated.report.reason,
    quickSolvable: resolved.best.evaluated.report.isSolvable,
  };
  GENERATION_CACHE.set(cacheKey, bestLevel);
  return clone(bestLevel);
}
