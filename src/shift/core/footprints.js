import {
  SHAPE_LIBRARY,
  getBoundsFromCells,
  getPresetAlias,
  normalizeShapeCells,
} from '../data/catalog.js?v=20260824112338';

export const FOOTPRINT_EDGE_SET = new Set(['left', 'right', 'top', 'bottom']);
export const FIXED_BOARD_COLS = 6;
export const FOOTPRINT_ROW_RANGE = Object.freeze([5, 6, 7, 8, 9, 10, 11, 12]);

const KNOWN_FOOTPRINTS_BY_KEY = new Map();
const KNOWN_FOOTPRINTS_BY_PRESET = new Map();
const KNOWN_FOOTPRINTS_BY_SIGNATURE = new Map();
const DYNAMIC_FOOTPRINT_CACHE = new Map();
const DYNAMIC_PLACEMENT_CACHE = new Map();

function createFootprintSignature(shapeCells = []) {
  return normalizeShapeCells(shapeCells)
    .map((cell) => `${cell.x},${cell.y}`)
    .join('|');
}

function freezePlacements(placements = []) {
  return Object.freeze(placements.map((anchor) => Object.freeze(anchor)));
}

function buildProjectionForSide(shapeCells = [], bounds = { w: 1, h: 1 }, edge = 'left') {
  const orthogonalCoords = shapeCells.map((cell) => (edge === 'left' || edge === 'right' ? cell.y : cell.x));
  const start = orthogonalCoords.length ? Math.min(...orthogonalCoords) : 0;
  const end = orthogonalCoords.length ? Math.max(...orthogonalCoords) + 1 : 0;
  const touchCoords = shapeCells
    .filter((cell) => {
      if (edge === 'left') {
        return cell.x === 0;
      }
      if (edge === 'right') {
        return cell.x === bounds.w - 1;
      }
      if (edge === 'top') {
        return cell.y === 0;
      }
      return cell.y === bounds.h - 1;
    })
    .map((cell) => (edge === 'left' || edge === 'right' ? cell.y : cell.x))
    .sort((left, right) => left - right);
  const uniqueTouchCoords = [...new Set(touchCoords)];
  return Object.freeze({
    span: Object.freeze({ start, end }),
    length: end - start,
    coords: Object.freeze([...new Set(orthogonalCoords)].sort((left, right) => left - right)),
    touchCoords: Object.freeze(uniqueTouchCoords),
    touchCount: uniqueTouchCoords.length,
  });
}

function buildExitProjectionBySide(shapeCells = [], bounds = { w: 1, h: 1 }) {
  return Object.freeze({
    left: buildProjectionForSide(shapeCells, bounds, 'left'),
    right: buildProjectionForSide(shapeCells, bounds, 'right'),
    top: buildProjectionForSide(shapeCells, bounds, 'top'),
    bottom: buildProjectionForSide(shapeCells, bounds, 'bottom'),
  });
}

function buildLegalPlacements(bounds = { w: 1, h: 1 }, cols = FIXED_BOARD_COLS, rows = 8) {
  if (!Number.isFinite(cols) || !Number.isFinite(rows) || cols <= 0 || rows <= 0) {
    return freezePlacements([]);
  }
  const maxX = cols - bounds.w;
  const maxY = rows - bounds.h;
  if (maxX < 0 || maxY < 0) {
    return freezePlacements([]);
  }
  const anchors = [];
  for (let y = 0; y <= maxY; y += 1) {
    for (let x = 0; x <= maxX; x += 1) {
      anchors.push({ x, y });
    }
  }
  return freezePlacements(anchors);
}

function buildLegalPlacementsByRows(bounds = { w: 1, h: 1 }, cols = FIXED_BOARD_COLS, rowRange = FOOTPRINT_ROW_RANGE) {
  const placementsByRows = {};
  (rowRange || []).forEach((rows) => {
    placementsByRows[rows] = buildLegalPlacements(bounds, cols, rows);
  });
  return Object.freeze(placementsByRows);
}

function createFootprintDescriptor({
  shapeKey = 'custom',
  shapeVariant = 'default',
  shapePreset = '',
  shapeCells = [],
  cols = FIXED_BOARD_COLS,
  rowRange = FOOTPRINT_ROW_RANGE,
} = {}) {
  const cellOffsets = Object.freeze(normalizeShapeCells(shapeCells));
  const bounds = Object.freeze(getBoundsFromCells(cellOffsets));
  const signature = createFootprintSignature(cellOffsets);
  return Object.freeze({
    libraryKey: `${shapeKey}:${shapeVariant}`,
    shapeKey,
    shapeVariant,
    shapePreset: shapePreset || getPresetAlias(shapeKey, shapeVariant),
    signature,
    cellOffsets,
    area: cellOffsets.length,
    bbox: bounds,
    exitProjectionBySide: buildExitProjectionBySide(cellOffsets, bounds),
    legalPlacementsByRows: buildLegalPlacementsByRows(bounds, cols, rowRange),
  });
}

export function buildFootprintLibrary(options = {}) {
  const cols = Number.isFinite(options.cols) ? Math.max(1, Math.floor(options.cols)) : FIXED_BOARD_COLS;
  const rowRange = Array.isArray(options.rowRange) && options.rowRange.length
    ? options.rowRange.map((value) => Math.max(1, Math.floor(value)))
    : FOOTPRINT_ROW_RANGE;
  const descriptors = [];
  Object.entries(SHAPE_LIBRARY).forEach(([shapeKey, variants]) => {
    Object.entries(variants || {}).forEach(([shapeVariant, cells]) => {
      descriptors.push(createFootprintDescriptor({
        shapeKey,
        shapeVariant,
        shapePreset: getPresetAlias(shapeKey, shapeVariant),
        shapeCells: cells,
        cols,
        rowRange,
      }));
    });
  });
  return Object.freeze(descriptors);
}

export const FOOTPRINT_LIBRARY = buildFootprintLibrary();

FOOTPRINT_LIBRARY.forEach((descriptor) => {
  KNOWN_FOOTPRINTS_BY_KEY.set(descriptor.libraryKey, descriptor);
  KNOWN_FOOTPRINTS_BY_PRESET.set(descriptor.shapePreset, descriptor);
  KNOWN_FOOTPRINTS_BY_SIGNATURE.set(descriptor.signature, descriptor);
});

function getFootprintAnchor(blockLike = {}, anchor = null) {
  return {
    x: anchor?.x ?? blockLike.x ?? 0,
    y: anchor?.y ?? blockLike.y ?? 0,
  };
}

export function getFootprintDescriptor(blockLike = {}) {
  const shapeVariant = String(blockLike.shapeVariant || 'default');
  const normalizedCells = normalizeShapeCells(blockLike.shapeCells || []);
  const signature = createFootprintSignature(normalizedCells);
  const byPreset = blockLike.shapePreset ? KNOWN_FOOTPRINTS_BY_PRESET.get(blockLike.shapePreset) : null;
  if (byPreset && (!blockLike.shapeCells || byPreset.signature === signature)) {
    return byPreset;
  }
  const knownBySignature = KNOWN_FOOTPRINTS_BY_SIGNATURE.get(signature);
  if (knownBySignature) {
    return knownBySignature;
  }
  const cacheKey = `${blockLike.shapePreset || blockLike.shapeKey || 'custom'}:${shapeVariant}:${signature}`;
  if (!DYNAMIC_FOOTPRINT_CACHE.has(cacheKey)) {
    DYNAMIC_FOOTPRINT_CACHE.set(cacheKey, createFootprintDescriptor({
      shapeKey: blockLike.shapeKey || blockLike.shapePreset || 'custom',
      shapeVariant,
      shapePreset: blockLike.shapePreset || '',
      shapeCells: normalizedCells,
    }));
  }
  return DYNAMIC_FOOTPRINT_CACHE.get(cacheKey);
}

export function getFootprintOccupiedCells(blockLike = {}, anchor = null) {
  const descriptor = getFootprintDescriptor(blockLike);
  const origin = getFootprintAnchor(blockLike, anchor);
  return descriptor.cellOffsets.map((cell) => ({
    x: origin.x + cell.x,
    y: origin.y + cell.y,
  }));
}

export function touchesFootprintEdge(level = {}, blockLike = null, edge = '', anchor = null) {
  if (!blockLike || !FOOTPRINT_EDGE_SET.has(edge)) {
    return false;
  }
  const descriptor = getFootprintDescriptor(blockLike);
  const origin = getFootprintAnchor(blockLike, anchor);
  const cols = level.board?.cols || 0;
  const rows = level.board?.rows || 0;
  if (edge === 'left') {
    return origin.x === 0;
  }
  if (edge === 'right') {
    return origin.x + descriptor.bbox.w === cols;
  }
  if (edge === 'top') {
    return origin.y === 0;
  }
  return origin.y + descriptor.bbox.h === rows;
}

export function getExitProjectionBySide(blockLike = null, edge = '') {
  if (!blockLike || !FOOTPRINT_EDGE_SET.has(edge)) {
    return Object.freeze({ span: Object.freeze({ start: 0, end: 0 }), length: 0, coords: Object.freeze([]), touchCoords: Object.freeze([]), touchCount: 0 });
  }
  return getFootprintDescriptor(blockLike).exitProjectionBySide[edge];
}

export function getFootprintProjectionSpan(blockLike = null, edge = '', anchor = null) {
  if (!blockLike || !FOOTPRINT_EDGE_SET.has(edge)) {
    return { start: 0, end: 0 };
  }
  const descriptor = getFootprintDescriptor(blockLike);
  const origin = getFootprintAnchor(blockLike, anchor);
  const projection = descriptor.exitProjectionBySide[edge]?.span || { start: 0, end: 0 };
  const offset = edge === 'left' || edge === 'right' ? origin.y : origin.x;
  return {
    start: offset + projection.start,
    end: offset + projection.end,
  };
}

export function getFootprintProjectionLength(blockLike = null, edge = '') {
  if (!blockLike || !FOOTPRINT_EDGE_SET.has(edge)) {
    return 0;
  }
  return getFootprintDescriptor(blockLike).exitProjectionBySide[edge]?.length || 0;
}

export function getLegalPlacementsForFootprint(blockLike = null, board = {}) {
  if (!blockLike) {
    return freezePlacements([]);
  }
  const descriptor = getFootprintDescriptor(blockLike);
  const cols = Number.isFinite(board.cols) ? Math.max(1, Math.floor(board.cols)) : FIXED_BOARD_COLS;
  const rows = Number.isFinite(board.rows) ? Math.max(1, Math.floor(board.rows)) : 8;
  if (cols === FIXED_BOARD_COLS && descriptor.legalPlacementsByRows[rows]) {
    return descriptor.legalPlacementsByRows[rows];
  }
  const cacheKey = `${descriptor.signature}:${cols}x${rows}`;
  if (!DYNAMIC_PLACEMENT_CACHE.has(cacheKey)) {
    DYNAMIC_PLACEMENT_CACHE.set(cacheKey, buildLegalPlacements(descriptor.bbox, cols, rows));
  }
  return DYNAMIC_PLACEMENT_CACHE.get(cacheKey);
}

export function getCompatibleExitsForFootprint(level = {}, blockLike = null) {
  if (!blockLike || blockLike.role !== 'target') {
    return [];
  }
  return (level.exits || []).filter((exit) => (
    exit.acceptColor === blockLike.style
    && exit.span >= getFootprintProjectionLength(blockLike, exit.edge)
  ));
}

export function getExitMatchForFootprint(level = {}, blockLike = null) {
  if (!blockLike || blockLike.role !== 'target') {
    return null;
  }
  for (const exit of level.exits || []) {
    if (exit.acceptColor !== blockLike.style) {
      continue;
    }
    if (!touchesFootprintEdge(level, blockLike, exit.edge)) {
      continue;
    }
    const projection = getFootprintProjectionSpan(blockLike, exit.edge);
    const exitEnd = exit.start + exit.span;
    if (projection.start >= exit.start && projection.end <= exitEnd) {
      return exit;
    }
  }
  return null;
}

export function createLevelFootprintContext(level = {}) {
  const board = {
    cols: level.board?.cols || 0,
    rows: level.board?.rows || 0,
  };
  const exitsByColor = new Map();
  (level.exits || []).forEach((exit) => {
    if (!exit?.acceptColor) {
      return;
    }
    const list = exitsByColor.get(exit.acceptColor) || [];
    list.push(exit);
    exitsByColor.set(exit.acceptColor, list);
  });

  const blockStatsById = new Map();
  (level.blocks || []).forEach((block) => {
    const descriptor = getFootprintDescriptor(block);
    const projectionLengthBySide = {
      left: descriptor.exitProjectionBySide.left.length,
      right: descriptor.exitProjectionBySide.right.length,
      top: descriptor.exitProjectionBySide.top.length,
      bottom: descriptor.exitProjectionBySide.bottom.length,
    };
    const compatibleExits = block.role === 'target'
      ? (exitsByColor.get(block.style) || []).filter((exit) => exit.span >= projectionLengthBySide[exit.edge])
      : [];
    blockStatsById.set(block.id, {
      descriptor,
      occupiedCells: getFootprintOccupiedCells(block),
      compatibleExits,
      compatibleExitIds: compatibleExits.map((exit) => exit.id),
      projectionLengthBySide,
      projectionSpanBySide: {
        left: getFootprintProjectionSpan(block, 'left'),
        right: getFootprintProjectionSpan(block, 'right'),
        top: getFootprintProjectionSpan(block, 'top'),
        bottom: getFootprintProjectionSpan(block, 'bottom'),
      },
      legalPlacements: getLegalPlacementsForFootprint(block, board),
    });
  });

  return {
    board,
    boardKey: `${board.cols}x${board.rows}`,
    exitsByColor,
    blockStatsById,
    getBlockStats(blockId = '') {
      return blockStatsById.get(blockId) || null;
    },
  };
}
