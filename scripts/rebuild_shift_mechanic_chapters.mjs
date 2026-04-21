import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  clone,
  createBlock,
  createExit,
  createRng,
  getBoundsFromCells,
  getShapeCells,
  hashSeed,
  mirrorEdgeX,
  mirrorEdgeY,
  shuffle,
  TARGET_STYLE_POOL,
} from '../web_frontend/src/shift/data/catalog.js';
import { validateLevelFull, validateLevelQuick } from '../web_frontend/src/shift/core/solver.js';
import { hasExitLayoutConflict, normalizeExitLayout } from '../web_frontend/src/shift/core/exit-rules.js';
import { CHAPTER_BANDS } from '../web_frontend/src/shift/design/chapter-bands.js';
import {
  CHAPTER_12_MECHANIC_SEQUENCE,
  getDirectionalSupportBand,
  getGeneratorChapterMeta,
  getGeneratorShapeWeights,
  getPrimaryMechanicForLevel,
  getSupportMechanicsForLevel,
} from '../web_frontend/src/shift/design/mainline-generator-profiles.js';
import { CAMPAIGN_CHAPTER_06 } from '../web_frontend/src/shift/data/campaign/chapter-06.js';
import { CAMPAIGN_CHAPTER_07 } from '../web_frontend/src/shift/data/campaign/chapter-07.js';
import { CAMPAIGN_CHAPTER_08 } from '../web_frontend/src/shift/data/campaign/chapter-08.js';
import { CAMPAIGN_CHAPTER_09 } from '../web_frontend/src/shift/data/campaign/chapter-09.js';
import { CAMPAIGN_CHAPTER_10 } from '../web_frontend/src/shift/data/campaign/chapter-10.js';
import { CAMPAIGN_CHAPTER_11 } from '../web_frontend/src/shift/data/campaign/chapter-11.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const CAMPAIGN_DIR = path.resolve(__dirname, '../web_frontend/src/shift/data/campaign');

const MECHANIC_SEED_LEVELS = {
  directional: CAMPAIGN_CHAPTER_06.levels[0],
  'lock-gate': CAMPAIGN_CHAPTER_07.levels[0],
  'one-way': CAMPAIGN_CHAPTER_08.levels[0],
  'toggle-gate': CAMPAIGN_CHAPTER_09.levels[0],
  recolor: CAMPAIGN_CHAPTER_10.levels[0],
  ice: CAMPAIGN_CHAPTER_11.levels[0],
};

const VARIANTS_BY_SHAPE = {
  mono: ['default'],
  domino: ['h', 'v'],
  bar3: ['h', 'v'],
  'square-2': ['default'],
  'L-3': ['ur', 'dr', 'dl', 'ul'],
  'L-4': ['ur', 'dr', 'dl', 'ul'],
  'T-4': ['up', 'right', 'down', 'left'],
};

const DEFAULT_ATTEMPTS = 14;
const FULL_VALIDATE_OPTIONS = {
  maxStates: 4200,
  maxSolutions: 6,
  solutionDepthSlack: 1,
  solutionFamilyCap: 3,
};
const QUICK_VALIDATE_OPTIONS = {
  maxStates: 1200,
  maxSolutions: 3,
  solutionDepthSlack: 0,
  solutionFamilyCap: 2,
};

function parseArgs(argv = []) {
  const options = {
    chapter: null,
    from: 1,
    to: null,
    attempts: DEFAULT_ATTEMPTS,
    write: false,
    json: false,
    quickOnly: false,
  };
  argv.forEach((arg) => {
    if (arg === '--write') {
      options.write = true;
      return;
    }
    if (arg === '--json') {
      options.json = true;
      return;
    }
    if (arg === '--quick-only') {
      options.quickOnly = true;
      return;
    }
    if (arg.startsWith('--chapter=')) {
      options.chapter = Number(arg.split('=')[1]) || null;
      return;
    }
    if (arg.startsWith('--from=')) {
      options.from = Math.max(1, Number(arg.split('=')[1]) || 1);
      return;
    }
    if (arg.startsWith('--to=')) {
      options.to = Math.max(1, Number(arg.split('=')[1]) || 1);
      return;
    }
    if (arg.startsWith('--attempts=')) {
      options.attempts = Math.max(1, Number(arg.split('=')[1]) || DEFAULT_ATTEMPTS);
    }
  });
  return options;
}

function quote(value) {
  return JSON.stringify(value);
}

function getChapterBand(chapterNumber = 6) {
  return CHAPTER_BANDS.find((entry) => entry.chapter === chapterNumber) || null;
}

function getEffectiveBand(chapterNumber = 6, levelIndex = 1) {
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

function getSegmentBias(segmentKey = '') {
  switch (segmentKey) {
    case 'hard':
      return 0.26;
    case 'expert':
      return 0.62;
    case 'brutal':
      return 0.9;
    default:
      return 0.5;
  }
}

function pickRangeValue(range, rng, options = {}) {
  const safeRange = Array.isArray(range) && range.length >= 2 ? range : [0, 0];
  const min = Number(safeRange[0]) || 0;
  const max = Number(safeRange[1]) || min;
  if (min === max) {
    return min;
  }
  const bias = Number.isFinite(options.bias) ? options.bias : 0.5;
  const mixed = ((rng() * 0.6) + (bias * 0.4));
  const value = min + ((max - min) * mixed);
  return options.integer === false ? value : Math.round(value);
}

function chooseRows(band, rng) {
  return pickRangeValue(band.rows || [9, 9], rng, { bias: getSegmentBias(band.segmentKey) });
}

function chooseOccupancyTarget(band, rng, soften = 1) {
  const base = pickRangeValue(band.occupancy || [0.74, 0.78], rng, {
    bias: getSegmentBias(band.segmentKey),
    integer: false,
  });
  return Number((base * soften).toFixed(3));
}

function chooseDoorGroupTarget(band, rng) {
  return pickRangeValue(band.doorGroups || [8, 8], rng, { bias: getSegmentBias(band.segmentKey) });
}

function chooseDoorSlotTarget(band, rng) {
  return pickRangeValue(band.doorSlots || [11, 11], rng, { bias: getSegmentBias(band.segmentKey) });
}

function collectAreaCells(definition = {}) {
  if (Array.isArray(definition.cells) && definition.cells.length) {
    const unique = new Map();
    definition.cells.forEach((cell) => {
      const x = Math.floor(Number(cell?.x) || 0);
      const y = Math.floor(Number(cell?.y) || 0);
      unique.set(`${x},${y}`, { x, y });
    });
    return [...unique.values()];
  }
  const x = Math.floor(Number(definition.x) || 0);
  const y = Math.floor(Number(definition.y) || 0);
  const width = Math.max(1, Math.floor(Number(definition.w ?? definition.width) || 1));
  const height = Math.max(1, Math.floor(Number(definition.h ?? definition.height) || 1));
  const cells = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      cells.push({ x: x + col, y: y + row });
    }
  }
  return cells;
}

function normalizeMechanicAreas(level) {
  const next = clone(level);
  next.tiles = (next.tiles || []).map((tile) => ({
    ...tile,
    cells: collectAreaCells(tile),
  }));
  next.gates = (next.gates || []).map((gate) => ({
    ...gate,
    cells: collectAreaCells(gate),
  }));
  return next;
}

function shiftLevelY(level, delta = 0) {
  if (!delta) {
    return level;
  }
  const next = clone(level);
  next.blocks = (next.blocks || []).map((block) => ({
    ...block,
    y: block.y + delta,
  }));
  next.exits = (next.exits || []).map((exit) => ({
    ...exit,
    start: exit.edge === 'left' || exit.edge === 'right' ? exit.start + delta : exit.start,
  }));
  next.tiles = (next.tiles || []).map((tile) => ({
    ...tile,
    cells: (tile.cells || []).map((cell) => ({ x: cell.x, y: cell.y + delta })),
  }));
  next.gates = (next.gates || []).map((gate) => ({
    ...gate,
    cells: (gate.cells || []).map((cell) => ({ x: cell.x, y: cell.y + delta })),
  }));
  return next;
}

function mirrorLevelX(level) {
  const next = clone(level);
  const cols = next.board.cols;
  next.blocks = (next.blocks || []).map((block) => {
    const bounds = getBoundsFromCells(block.shapeCells || getShapeCells('mono'));
    return {
      ...block,
      x: cols - block.x - bounds.w,
      shapeCells: (block.shapeCells || []).map((cell) => ({ x: bounds.w - cell.x - 1, y: cell.y })),
    };
  });
  next.exits = (next.exits || []).map((exit) => ({
    ...exit,
    edge: mirrorEdgeX(exit.edge),
    start: exit.edge === 'top' || exit.edge === 'bottom'
      ? cols - exit.start - exit.span
      : exit.start,
  }));
  next.tiles = (next.tiles || []).map((tile) => ({
    ...tile,
    cells: (tile.cells || []).map((cell) => ({ x: cols - cell.x - 1, y: cell.y })),
  }));
  next.gates = (next.gates || []).map((gate) => ({
    ...gate,
    cells: (gate.cells || []).map((cell) => ({ x: cols - cell.x - 1, y: cell.y })),
  }));
  return next;
}

function mirrorLevelY(level) {
  const next = clone(level);
  const rows = next.board.rows;
  next.blocks = (next.blocks || []).map((block) => {
    const bounds = getBoundsFromCells(block.shapeCells || getShapeCells('mono'));
    return {
      ...block,
      y: rows - block.y - bounds.h,
      shapeCells: (block.shapeCells || []).map((cell) => ({ x: cell.x, y: bounds.h - cell.y - 1 })),
    };
  });
  next.exits = (next.exits || []).map((exit) => ({
    ...exit,
    edge: mirrorEdgeY(exit.edge),
    start: exit.edge === 'left' || exit.edge === 'right'
      ? rows - exit.start - exit.span
      : exit.start,
  }));
  next.tiles = (next.tiles || []).map((tile) => ({
    ...tile,
    cells: (tile.cells || []).map((cell) => ({ x: cell.x, y: rows - cell.y - 1 })),
  }));
  next.gates = (next.gates || []).map((gate) => ({
    ...gate,
    cells: (gate.cells || []).map((cell) => ({ x: cell.x, y: rows - cell.y - 1 })),
  }));
  return next;
}

function getShapeKey(block = {}) {
  const preset = String(block.shapePreset || 'mono');
  if (preset.startsWith('domino')) {
    return 'domino';
  }
  if (preset.startsWith('bar3')) {
    return 'bar3';
  }
  if (preset.startsWith('square')) {
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
  return 'mono';
}

function getShapeFootprint(block = {}) {
  const bounds = getBoundsFromCells(block.shapeCells || getShapeCells('mono'));
  return { w: bounds.w, h: bounds.h };
}

function getProjectionLength(block = {}, edge = 'top') {
  const footprint = getShapeFootprint(block);
  return edge === 'left' || edge === 'right' ? footprint.h : footprint.w;
}

function uniqueColors(level) {
  return [...new Set((level.blocks || []).map((block) => block.style).filter(Boolean))];
}

function occupiedCellsCount(level) {
  return (level.blocks || []).reduce((sum, block) => sum + (block.shapeCells || []).length, 0);
}

function occupancyRate(level) {
  return occupiedCellsCount(level) / Math.max(1, (level.board.cols || 0) * (level.board.rows || 0));
}

function getOccupiedSet(level, ignoreId = '') {
  const occupied = new Set();
  (level.blocks || []).forEach((block) => {
    if (block.id === ignoreId) {
      return;
    }
    (block.shapeCells || []).forEach((cell) => {
      occupied.add(`${block.x + cell.x},${block.y + cell.y}`);
    });
  });
  return occupied;
}

function getReservedMechanicSet(level) {
  const reserved = new Set();
  (level.gates || []).forEach((gate) => {
    (gate.cells || []).forEach((cell) => reserved.add(`${cell.x},${cell.y}`));
  });
  (level.tiles || []).forEach((tile) => {
    (tile.cells || []).forEach((cell) => reserved.add(`${cell.x},${cell.y}`));
  });
  return reserved;
}

function canPlaceBlock(level, block, reserved = new Set(), ignoreId = '') {
  const occupied = getOccupiedSet(level, ignoreId || block.id);
  for (const cell of block.shapeCells || []) {
    const x = block.x + cell.x;
    const y = block.y + cell.y;
    if (x < 0 || y < 0 || x >= level.board.cols || y >= level.board.rows) {
      return false;
    }
    if (occupied.has(`${x},${y}`) || reserved.has(`${x},${y}`)) {
      return false;
    }
  }
  return true;
}

function pickWeightedShape(weights = {}, allowedShapes = [], rng) {
  const entries = allowedShapes
    .map((shapeKey) => ({ shapeKey, weight: Number(weights[shapeKey]) || 0 }))
    .filter((entry) => entry.weight > 0);
  const pool = entries.length ? entries : allowedShapes.map((shapeKey) => ({ shapeKey, weight: 1 }));
  const total = pool.reduce((sum, entry) => sum + entry.weight, 0) || 1;
  let cursor = rng() * total;
  for (const entry of pool) {
    cursor -= entry.weight;
    if (cursor <= 0) {
      return entry.shapeKey;
    }
  }
  return pool[pool.length - 1]?.shapeKey || 'mono';
}

function chooseShapeVariant(shapeKey = 'mono', rng) {
  const variants = VARIANTS_BY_SHAPE[shapeKey] || ['default'];
  return variants[Math.floor(rng() * variants.length)] || variants[0] || 'default';
}

function chooseColorForNextBlock(level, activeColors, rng) {
  const counts = new Map(activeColors.map((color) => [color, 0]));
  (level.blocks || []).forEach((block) => {
    counts.set(block.style, (counts.get(block.style) || 0) + 1);
  });
  const ordered = [...activeColors].sort((left, right) => (counts.get(left) || 0) - (counts.get(right) || 0));
  const top = ordered.slice(0, Math.max(2, Math.ceil(ordered.length / 2)));
  return top[Math.floor(rng() * top.length)] || activeColors[0];
}

function tryAddFillerBlock(level, options) {
  const {
    rng,
    activeColors,
    allowedShapes,
    shapeWeights,
    reserved,
    index,
  } = options;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const shapeKey = pickWeightedShape(shapeWeights, allowedShapes, rng);
    const shapeVariant = chooseShapeVariant(shapeKey, rng);
    const shapeCells = getShapeCells(shapeKey, shapeVariant);
    const bounds = getBoundsFromCells(shapeCells);
    const x = Math.floor(rng() * Math.max(1, level.board.cols - bounds.w + 1));
    const y = Math.floor(rng() * Math.max(1, level.board.rows - bounds.h + 1));
    const block = createBlock({
      id: `filler-${index}`,
      style: chooseColorForNextBlock(level, activeColors, rng),
      x,
      y,
      shapeKey,
      shapeVariant,
    });
    if (!canPlaceBlock(level, block, reserved, block.id)) {
      continue;
    }
    level.blocks.push(block);
    return true;
  }
  return false;
}

function collectLevelColors(level) {
  const tokens = new Set();
  (level.blocks || []).forEach((block) => tokens.add(block.style));
  (level.exits || []).forEach((exit) => tokens.add(exit.acceptColor));
  (level.tiles || []).forEach((tile) => {
    if (tile.toColor) {
      tokens.add(tile.toColor);
    }
  });
  return [...tokens].filter(Boolean);
}

function remapLevelColors(level, activeColors, rng, primaryMechanic = '') {
  const tokens = collectLevelColors(level);
  const palette = shuffle(activeColors, rng);
  const map = new Map();
  tokens.forEach((token, index) => {
    map.set(token, palette[index % palette.length] || activeColors[index % activeColors.length] || activeColors[0]);
  });
  const next = clone(level);
  next.blocks = (next.blocks || []).map((block) => ({
    ...block,
    style: map.get(block.style) || block.style,
  }));
  next.exits = (next.exits || []).map((exit) => ({
    ...exit,
    acceptColor: map.get(exit.acceptColor) || exit.acceptColor,
  }));
  next.tiles = (next.tiles || []).map((tile) => ({
    ...tile,
    toColor: tile.toColor ? (map.get(tile.toColor) || tile.toColor) : tile.toColor,
  }));
  if (primaryMechanic === 'recolor' && next.blocks.length && next.tiles?.length) {
    const firstBlock = next.blocks[0];
    const recolorTile = next.tiles.find((tile) => tile.type === 'recolor');
    if (firstBlock && recolorTile && recolorTile.toColor === firstBlock.style) {
      const alternative = activeColors.find((color) => color !== firstBlock.style) || firstBlock.style;
      recolorTile.toColor = alternative;
    }
  }
  return next;
}

function renameLevelEntities(level, chapterNumber, levelIndex) {
  const chapterLabel = String(chapterNumber).padStart(2, '0');
  const levelLabel = String(levelIndex).padStart(2, '0');
  const prefix = `c${chapterLabel}-l${levelLabel}`;
  const idMap = new Map();
  const next = clone(level);

  next.id = prefix;
  next.title = `${chapterNumber}-${levelLabel}`;
  next.chapter = chapterNumber;
  next.index = levelIndex;

  next.blocks = (next.blocks || []).map((block, index) => {
    const id = `${prefix}-b${index + 1}`;
    idMap.set(block.id, id);
    return { ...block, id };
  });
  next.exits = (next.exits || []).map((exit, index) => {
    const id = `exit-${prefix}-${index + 1}`;
    idMap.set(exit.id, id);
    return { ...exit, id };
  });
  next.tiles = (next.tiles || []).map((tile, index) => {
    const id = `${prefix}-t${index + 1}`;
    idMap.set(tile.id, id);
    return { ...tile, id };
  });
  next.gates = (next.gates || []).map((gate, index) => {
    const id = `${prefix}-g${index + 1}`;
    idMap.set(gate.id, id);
    return { ...gate, id };
  });
  next.tiles = next.tiles.map((tile) => ({
    ...tile,
    switchIds: (tile.switchIds || []).map((id) => idMap.get(id) || id),
  }));
  next.gates = next.gates.map((gate) => ({
    ...gate,
    keyPadIds: (gate.keyPadIds || []).map((id) => idMap.get(id) || id),
    switchIds: (gate.switchIds || []).map((id) => idMap.get(id) || id),
  }));
  return next;
}

function rewardCoinsForLevel(chapterNumber, band) {
  const base = 120 + ((chapterNumber - 6) * 8);
  if (band?.segmentKey === 'expert') {
    return base + 15;
  }
  if (band?.segmentKey === 'brutal') {
    return base + 30;
  }
  return base;
}

function buildSeedLevel(chapterNumber, levelIndex, band, primaryMechanic, rng, activeColors) {
  const seed = clone(MECHANIC_SEED_LEVELS[primaryMechanic] || MECHANIC_SEED_LEVELS.directional);
  const rows = chooseRows(band, rng);
  let level = normalizeMechanicAreas(seed);
  level.board.cols = 6;
  level.board.rows = rows;
  const slack = Math.max(0, rows - (seed.board?.rows || 8));
  if (slack) {
    level = shiftLevelY(level, Math.floor(rng() * (slack + 1)));
  }
  if (rng() > 0.5) {
    level = mirrorLevelX(level);
  }
  if (rng() > 0.5) {
    level = mirrorLevelY(level);
  }
  level = remapLevelColors(level, activeColors, rng, primaryMechanic);
  level = renameLevelEntities(level, chapterNumber, levelIndex);
  level.rewardCoins = rewardCoinsForLevel(chapterNumber, band);
  level.meta = {
    ...(level.meta || {}),
    mode: 'campaign',
    difficultyBand: band?.difficultyBand || 'hard',
    tags: ['generated', `mechanic-${primaryMechanic}`, `segment-${band?.segmentKey || 'base'}`],
    guideText: '',
    levelInChapter: levelIndex,
  };
  level.exits = [];
  return level;
}

function densifyLevel(level, chapterNumber, band, primaryMechanic, rng, activeColors, soften = 1) {
  const allowedShapes = [...(band.shapes || ['mono', 'domino', 'bar3', 'square-2'])];
  const shapeWeights = getGeneratorShapeWeights(chapterNumber, primaryMechanic);
  const targetRate = chooseOccupancyTarget(band, rng, soften);
  const targetCells = Math.round(level.board.cols * level.board.rows * targetRate);
  const reserved = getReservedMechanicSet(level);
  let fillerIndex = 1;
  let deadStreak = 0;

  while (occupiedCellsCount(level) < targetCells && deadStreak < 32) {
    const placed = tryAddFillerBlock(level, {
      rng,
      activeColors,
      allowedShapes,
      shapeWeights,
      reserved,
      index: fillerIndex,
    });
    fillerIndex += 1;
    if (placed) {
      deadStreak = 0;
    } else {
      deadStreak += 1;
    }
  }
}

function ensureColorCoverage(level, activeColors, rng) {
  const counts = new Map(activeColors.map((color) => [color, 0]));
  (level.blocks || []).forEach((block) => counts.set(block.style, (counts.get(block.style) || 0) + 1));
  const missing = activeColors.filter((color) => (counts.get(color) || 0) === 0);
  if (!missing.length) {
    return;
  }
  const candidates = [...(level.blocks || [])]
    .sort((left, right) => (left.shapeCells.length - right.shapeCells.length) || left.id.localeCompare(right.id));
  missing.forEach((color, index) => {
    const candidate = candidates[index % candidates.length];
    if (!candidate) {
      return;
    }
    candidate.style = color;
  });
  shuffle(level.blocks || [], rng);
}

function inferAxisForBlock(block, rng) {
  const footprint = getShapeFootprint(block);
  if (footprint.w > footprint.h) {
    return 'horizontal';
  }
  if (footprint.h > footprint.w) {
    return 'vertical';
  }
  return rng() > 0.5 ? 'horizontal' : 'vertical';
}

function applyDirectionalSupport(level, chapterNumber, band, rng, primaryMechanic) {
  const supportBand = getDirectionalSupportBand(chapterNumber);
  const supportCount = pickRangeValue(supportBand, rng, { bias: getSegmentBias(band?.segmentKey) });
  if (supportCount <= 0) {
    return;
  }
  const seededDirectional = new Set(
    (level.blocks || [])
      .filter((block) => block.moveAxis === 'horizontal' || block.moveAxis === 'vertical')
      .map((block) => block.id)
  );
  const candidates = [...(level.blocks || [])]
    .filter((block, index) => {
      if (seededDirectional.has(block.id)) {
        return false;
      }
      if (primaryMechanic === 'ice' && getShapeKey(block) !== 'mono' && getShapeKey(block) !== 'domino' && getShapeKey(block) !== 'bar3' && getShapeKey(block) !== 'square-2') {
        return false;
      }
      return index > 0;
    })
    .sort((left, right) => right.shapeCells.length - left.shapeCells.length || left.id.localeCompare(right.id));
  const take = Math.min(supportCount, candidates.length);
  for (let index = 0; index < take; index += 1) {
    const block = candidates[index];
    const axis = inferAxisForBlock(block, rng);
    block.moveAxis = axis;
    block.baseMoveAxis = axis;
  }
}

function getCompatibleExitOptions(level, block, exits = []) {
  const options = [];
  ['top', 'right', 'bottom', 'left'].forEach((edge) => {
    const span = getProjectionLength(block, edge);
    const boardLength = edge === 'top' || edge === 'bottom' ? level.board.cols : level.board.rows;
    if (span < 1 || span > 3 || span > boardLength) {
      return;
    }
    for (let start = 0; start + span <= boardLength; start += 1) {
      const candidate = createExit(`tmp-${block.id}-${edge}-${start}`, edge, start, span, block.style);
      if (hasExitLayoutConflict(exits, candidate)) {
        continue;
      }
      options.push(candidate);
    }
  });
  return options;
}

function chooseExitCandidate(level, block, exits, rng, preferCompetition = false) {
  const options = getCompatibleExitOptions(level, block, exits);
  if (!options.length) {
    return null;
  }
  const scored = options.map((option) => {
    const compatibleCount = (level.blocks || []).filter((candidate) => candidate.style === block.style && getProjectionLength(candidate, option.edge) <= option.span).length;
    const edgeBias = option.edge === 'top' || option.edge === 'bottom' ? 1 : 0.8;
    const competitionBias = preferCompetition ? compatibleCount * 6 : compatibleCount * 3;
    const center = option.start + (option.span * 0.5);
    const boardCenter = (option.edge === 'top' || option.edge === 'bottom' ? level.board.cols : level.board.rows) * 0.5;
    const centerBias = 6 - Math.abs(center - boardCenter);
    return {
      option,
      score: competitionBias + (edgeBias * 2) + centerBias + (rng() * 2),
    };
  }).sort((left, right) => right.score - left.score);
  return scored[0]?.option || options[Math.floor(rng() * options.length)] || null;
}

function rebuildExits(level, band, rng) {
  const exits = [];
  const colors = uniqueColors(level);
  const blocksByColor = new Map(colors.map((color) => [color, (level.blocks || []).filter((block) => block.style === color)]));
  colors.forEach((color) => {
    const blocks = [...(blocksByColor.get(color) || [])].sort((left, right) => right.shapeCells.length - left.shapeCells.length);
    const anchorBlock = blocks[0];
    if (!anchorBlock) {
      return;
    }
    const exit = chooseExitCandidate(level, anchorBlock, exits, rng, false);
    if (exit) {
      exit.id = `seed-exit-${exits.length + 1}`;
      exits.push(exit);
    }
  });

  const targetGroups = chooseDoorGroupTarget(band, rng);
  const targetSlots = chooseDoorSlotTarget(band, rng);
  let tries = 0;
  while ((exits.length < targetGroups || exits.reduce((sum, exit) => sum + exit.span, 0) < targetSlots) && tries < 80) {
    tries += 1;
    const block = (level.blocks || [])[Math.floor(rng() * (level.blocks || []).length)];
    if (!block) {
      break;
    }
    const exit = chooseExitCandidate(level, block, exits, rng, true);
    if (!exit) {
      continue;
    }
    exit.id = `seed-exit-${exits.length + 1}`;
    exits.push(exit);
  }
  level.exits = normalizeExitLayout(exits);
}

function bandPenalty(value, band, scale = 1) {
  if (!band || band.length < 2 || value == null || Number.isNaN(value)) {
    return 0;
  }
  const low = Number(band[0]);
  const high = Number(band[1]);
  if (value < low) {
    return (low - value) * scale;
  }
  if (value > high) {
    return (value - high) * scale;
  }
  return Math.abs(value - ((low + high) * 0.5)) * scale * 0.12;
}

function evaluateCandidate(level, band, report) {
  const occupancy = occupancyRate(level);
  const colors = uniqueColors(level).length;
  let penalty = 0;
  penalty += bandPenalty(level.board.rows, band.rows, 120);
  penalty += bandPenalty(occupancy, band.occupancy, 2400);
  penalty += bandPenalty(colors, band.colors, 280);
  penalty += bandPenalty(report.bestMoveCountEstimate, band.solutionBand, 34);
  penalty += bandPenalty(report.doorGroupCount, band.doorGroups, 70);
  penalty += bandPenalty(report.doorSlotCount, band.doorSlots, 64);
  penalty += bandPenalty(report.difficultyScore, band.difficultyScoreBand, 12);
  penalty += Math.max(0, (report.solutionFamilyCount || 0) - (band.solutionFamilyMax || 99)) * 200;
  penalty += Math.max(0, (band.doorCompetitionMin || 0) - (report.doorCompetitionCount || 0)) * 90;
  if (!report.isStructurallyValid) {
    penalty += 5000;
  }
  if (!report.isSolvable) {
    penalty += 4500;
  }
  if (report.reason === 'search_limit') {
    penalty += 1800;
  }
  if (report.mobileViewportFit?.matchesBoardSpec === false) {
    penalty += 3000;
  }
  if (band.difficultyTier && report.isSolvable && report.difficultyTier && report.difficultyTier !== band.difficultyTier && report.difficultyTier !== 'unrated') {
    penalty += 260;
  }
  const score = Number((10000 - penalty + (report.difficultyScore || 0) + ((report.bestMoveCountEstimate || 0) * 2)).toFixed(2));
  return {
    score,
    penalty: Number(penalty.toFixed(2)),
    occupancy: Number(occupancy.toFixed(3)),
    colors,
    checks: {
      structure: report.isStructurallyValid,
      solvable: report.isSolvable,
      viewport: report.mobileViewportFit?.matchesBoardSpec !== false,
      rows: bandPenalty(level.board.rows, band.rows, 1) < 1,
      occupancy: bandPenalty(occupancy, band.occupancy, 1) < 0.02,
      colors: bandPenalty(colors, band.colors, 1) < 0.5,
      moves: bandPenalty(report.bestMoveCountEstimate, band.solutionBand, 1) < 1,
      family: (report.solutionFamilyCount || 0) <= (band.solutionFamilyMax || 99),
      doorGroups: bandPenalty(report.doorGroupCount, band.doorGroups, 1) < 1,
      doorSlots: bandPenalty(report.doorSlotCount, band.doorSlots, 1) < 1,
      doorCompetition: (report.doorCompetitionCount || 0) >= (band.doorCompetitionMin || 0),
      difficulty: !band.difficultyScoreBand || bandPenalty(report.difficultyScore, band.difficultyScoreBand, 1) < 1,
    },
  };
}

function validateQuick(level) {
  return validateLevelQuick(level, QUICK_VALIDATE_OPTIONS);
}

function validateFull(level) {
  return validateLevelFull(level, FULL_VALIDATE_OPTIONS);
}

function buildCandidate(chapterNumber, levelIndex, attempt, mode = 'quick') {
  const band = getEffectiveBand(chapterNumber, levelIndex);
  const chapterMeta = getGeneratorChapterMeta(chapterNumber);
  const primaryMechanic = getPrimaryMechanicForLevel(chapterNumber, levelIndex);
  const supportMechanics = getSupportMechanicsForLevel(chapterNumber, levelIndex);
  const rng = createRng(hashSeed(`shift-mech:${chapterNumber}:${levelIndex}:${attempt}`));
  const activeColorCount = Math.max(1, band?.colors?.[1] || band?.colors?.[0] || 6);
  const activeColors = shuffle(TARGET_STYLE_POOL.slice(0, activeColorCount), rng).slice(0, activeColorCount);
  let level = buildSeedLevel(chapterNumber, levelIndex, band, primaryMechanic, rng, activeColors);
  const soften = attempt >= 11 ? 0.95 : attempt >= 7 ? 0.975 : 1;
  densifyLevel(level, chapterNumber, band, primaryMechanic, rng, activeColors, soften);
  ensureColorCoverage(level, activeColors, rng);
  if (supportMechanics.includes('directional') || primaryMechanic === 'directional') {
    applyDirectionalSupport(level, chapterNumber, band, rng, primaryMechanic);
  }
  rebuildExits(level, band, rng);
  level.meta = {
    ...(level.meta || {}),
    chapterTitle: chapterMeta?.title || level.meta?.chapterTitle || '',
    chapterShortTitle: chapterMeta?.shortTitle || level.meta?.chapterShortTitle || '',
    chapterTagline: chapterMeta?.tagline || level.meta?.chapterTagline || '',
    difficultyBand: band?.difficultyBand || level.meta?.difficultyBand || 'hard',
    tags: [...new Set([...(level.meta?.tags || []), `primary-${primaryMechanic}`])],
  };

  const report = mode === 'full' ? validateFull(level) : validateQuick(level);
  const evaluation = evaluateCandidate(level, band, report);
  const failedChecks = Object.entries(evaluation.checks).filter(([, value]) => !value).map(([key]) => key);
  return {
    ok: failedChecks.length === 0 && report.isStructurallyValid && report.isSolvable,
    level,
    report,
    evaluation,
    band,
    primaryMechanic,
    score: evaluation.score,
    reason: report.reason,
    failedChecks,
  };
}

function rankQuickCandidate(candidate = null) {
  if (!candidate) {
    return -Infinity;
  }
  let bonus = 0;
  if (candidate.report?.isStructurallyValid) {
    bonus += 180;
  }
  if (candidate.report?.isSolvable) {
    bonus += 320;
  }
  bonus += Math.max(0, 180 - ((candidate.failedChecks || []).length * 40));
  return candidate.score + bonus;
}

function promoteCandidateWithFullValidate(candidate) {
  if (!candidate?.level || !candidate?.band) {
    return candidate;
  }
  const report = validateFull(candidate.level);
  const evaluation = evaluateCandidate(candidate.level, candidate.band, report);
  const failedChecks = Object.entries(evaluation.checks).filter(([, value]) => !value).map(([key]) => key);
  return {
    ...candidate,
    ok: failedChecks.length === 0 && report.isStructurallyValid && report.isSolvable,
    report,
    evaluation,
    score: evaluation.score,
    reason: report.reason,
    failedChecks,
  };
}

function selectBestCandidate(chapterNumber, levelIndex, attempts = DEFAULT_ATTEMPTS, options = {}) {
  let bestQuick = null;
  const quickPool = [];
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const candidate = buildCandidate(chapterNumber, levelIndex, attempt, 'quick');
    quickPool.push(candidate);
    if (!bestQuick || rankQuickCandidate(candidate) > rankQuickCandidate(bestQuick)) {
      bestQuick = candidate;
    }
    if (candidate.ok) {
      break;
    }
  }

  if (options.quickOnly) {
    return bestQuick;
  }

  const finalists = [...quickPool]
    .sort((left, right) => rankQuickCandidate(right) - rankQuickCandidate(left))
    .slice(0, Math.min(3, quickPool.length));
  let bestFull = null;
  finalists.forEach((candidate) => {
    const fullCandidate = promoteCandidateWithFullValidate(candidate);
    if (!bestFull || fullCandidate.score > bestFull.score) {
      bestFull = fullCandidate;
    }
  });
  return bestFull || bestQuick;
}

function renderShapeCells(shapeCells = []) {
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
    `shapeCells: ${renderShapeCells(block.shapeCells || [])}`,
  ];
  if (block.moveAxis && block.moveAxis !== 'both') {
    fields.push(`moveAxis: ${quote(block.moveAxis)}`);
  }
  if (block.baseMoveAxis && block.baseMoveAxis !== block.moveAxis && block.baseMoveAxis !== 'both') {
    fields.push(`baseMoveAxis: ${quote(block.baseMoveAxis)}`);
  }
  return `        createBlock({ ${fields.join(', ')} })`;
}

function renderCells(cells = []) {
  return `[
${cells.map((cell) => `          { x: ${cell.x}, y: ${cell.y} }`).join(',\n')}
        ]`;
}

function renderTile(tile) {
  const fields = [
    `id: ${quote(tile.id)}`,
    `type: ${quote(tile.type)}`,
    `cells: ${renderCells(tile.cells || [])}`,
  ];
  if ((tile.switchIds || []).length) {
    fields.push(`switchIds: ${quote(tile.switchIds)}`);
  }
  if (tile.toColor) {
    fields.push(`toColor: ${quote(tile.toColor)}`);
  }
  return `        { ${fields.join(', ')} }`;
}

function renderGate(gate) {
  const fields = [
    `id: ${quote(gate.id)}`,
    `type: ${quote(gate.type)}`,
    `cells: ${renderCells(gate.cells || [])}`,
  ];
  if ((gate.keyPadIds || []).length) {
    fields.push(`keyPadIds: ${quote(gate.keyPadIds)}`);
  }
  if ((gate.switchIds || []).length) {
    fields.push(`switchIds: ${quote(gate.switchIds)}`);
  }
  if (gate.allowDir) {
    fields.push(`allowDir: ${quote(gate.allowDir)}`);
  }
  if (gate.defaultOpen) {
    fields.push(`defaultOpen: true`);
  }
  if (gate.open) {
    fields.push(`open: true`);
  }
  return `        { ${fields.join(', ')} }`;
}

function renderLevel(level) {
  const lines = [];
  lines.push(`    level(${level.index}, {`);
  lines.push(`      title: ${quote(level.title)},`);
  if (level.board.rows !== 9) {
    lines.push(`      rows: ${level.board.rows},`);
  }
  if (level.rewardCoins) {
    lines.push(`      rewardCoins: ${level.rewardCoins},`);
  }
  lines.push(`      difficultyBand: ${quote(level.meta?.difficultyBand || 'hard')},`);
  if ((level.meta?.tags || []).length) {
    lines.push(`      tags: ${quote(level.meta.tags)},`);
  }
  lines.push('      exits: [');
  lines.push((level.exits || []).map(renderExit).join(',\n'));
  lines.push('      ],');
  lines.push('      blocks: [');
  lines.push((level.blocks || []).map(renderBlock).join(',\n'));
  lines.push('      ],');
  if ((level.tiles || []).length) {
    lines.push('      tiles: [');
    lines.push((level.tiles || []).map(renderTile).join(',\n'));
    lines.push('      ],');
  }
  if ((level.gates || []).length) {
    lines.push('      gates: [');
    lines.push((level.gates || []).map(renderGate).join(',\n'));
    lines.push('      ],');
  }
  lines.push('    })');
  return lines.join('\n');
}

function renderChapterModule(chapterMeta, levels) {
  const constName = `CAMPAIGN_CHAPTER_${String(chapterMeta.number).padStart(2, '0')}`;
  return `import { createBlock, createCampaignLevel, createExit } from '../catalog.js';

const CHAPTER = ${chapterMeta.number};
const TITLE = ${quote(chapterMeta.title)};
const SHORT = ${quote(chapterMeta.shortTitle)};
const TAGLINE = ${quote(chapterMeta.tagline)};

function level(index, definition) {
  return createCampaignLevel({
    chapter: CHAPTER,
    index,
    chapterTitle: TITLE,
    chapterShortTitle: SHORT,
    chapterTagline: TAGLINE,
    cols: 6,
    rows: definition.rows || 9,
    ...definition,
  });
}

export const ${constName} = {
  id: ${quote(chapterMeta.id)},
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
  const chapters = [6, 7, 8, 9, 10, 11, 12].filter((chapter) => !options.chapter || options.chapter === chapter);
  const summaries = [];

  for (const chapterNumber of chapters) {
    const chapterMeta = getGeneratorChapterMeta(chapterNumber);
    const chapterBand = getChapterBand(chapterNumber);
    const levelCount = chapterBand?.levelCount || (chapterNumber === 12 ? CHAPTER_12_MECHANIC_SEQUENCE.length : 30);
    const from = Math.max(1, Math.min(levelCount, options.from));
    const to = options.to ? Math.max(from, Math.min(levelCount, options.to)) : levelCount;
    const levels = [];
    console.log(`generating mechanic chapter ${chapterNumber} (${chapterMeta?.title || ''}) levels ${from}-${to}...`);
    for (let levelIndex = from; levelIndex <= to; levelIndex += 1) {
      const candidate = selectBestCandidate(chapterNumber, levelIndex, options.attempts, options);
      if (!candidate?.level) {
        summaries.push({ id: `c${String(chapterNumber).padStart(2, '0')}-l${String(levelIndex).padStart(2, '0')}`, ok: false, reason: 'candidate_not_built' });
        continue;
      }
      levels.push(candidate.level);
      const summary = {
        id: candidate.level.id,
        chapter: chapterNumber,
        index: levelIndex,
        mechanic: candidate.primaryMechanic,
        ok: !!candidate.ok,
        reason: candidate.reason,
        rows: candidate.level.board.rows,
        occupancy: candidate.evaluation.occupancy,
        colors: candidate.evaluation.colors,
        doorGroups: candidate.report.doorGroupCount,
        doorSlots: candidate.report.doorSlotCount,
        doorCompetition: candidate.report.doorCompetitionCount,
        moves: candidate.report.bestMoveCountEstimate,
        families: candidate.report.solutionFamilyCount,
        difficulty: candidate.report.difficultyScore,
        score: candidate.score,
        failed: candidate.failedChecks || Object.entries(candidate.evaluation?.checks || {}).filter(([, value]) => !value).map(([key]) => key),
      };
      summaries.push(summary);
      console.log(`${summary.id} ${summary.ok ? 'ok' : 'best_effort'} mech=${summary.mechanic} rows=${summary.rows} occ=${summary.occupancy} doors=${summary.doorGroups}/${summary.doorSlots}/${summary.doorCompetition} moves=${summary.moves ?? 'n/a'} families=${summary.families} diff=${summary.difficulty ?? 'n/a'} score=${summary.score}${summary.failed.length ? ` failed=${summary.failed.join('|')}` : ''}`);
    }

    if (options.write && from === 1 && to === levelCount && levels.length === levelCount) {
      const filename = path.join(CAMPAIGN_DIR, `chapter-${String(chapterNumber).padStart(2, '0')}.js`);
      await fs.writeFile(filename, renderChapterModule(chapterMeta, levels), 'utf8');
    }
  }

  if (options.json) {
    console.log(JSON.stringify(summaries, null, 2));
  }

  const failed = summaries.filter((entry) => !entry.ok);
  if (failed.length) {
    console.log(`failed=${failed.length}`);
    process.exitCode = 1;
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
