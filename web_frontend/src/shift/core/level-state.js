import { clone, getBoundsFromCells, normalizeShapeCells } from '../data/catalog.js';
import {
  getCompatibleExitsForFootprint,
  getExitMatchForFootprint,
  getFootprintOccupiedCells,
  getFootprintProjectionLength,
  getFootprintProjectionSpan,
} from './footprints.js';

export const EDGE_SET = new Set(['left', 'right', 'top', 'bottom']);
export const MOVE_AXIS_SET = new Set(['both', 'horizontal', 'vertical']);

const GATE_TYPE_ALIAS = {
  lock: 'lock',
  lock_gate: 'lock',
  one_way: 'one_way',
  one_way_gate: 'one_way',
  toggle: 'toggle',
  toggle_gate: 'toggle',
};

const TILE_TYPE_ALIAS = {
  key_pad: 'key_pad',
  toggle_switch: 'toggle_switch',
  recolor: 'recolor',
  ice: 'ice',
};

const SUPPORTED_GATE_TYPES = new Set(Object.values(GATE_TYPE_ALIAS));
const SUPPORTED_TILE_TYPES = new Set(Object.values(TILE_TYPE_ALIAS));

function normalizeInteger(value, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    return fallback;
  }
  return Math.floor(number);
}

function normalizeBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }
  if (value == null) {
    return fallback;
  }
  return !!value;
}

function normalizeDir(value = '') {
  const dir = String(value || '').trim().toLowerCase();
  return EDGE_SET.has(dir) ? dir : '';
}

function normalizeGateType(type = '') {
  return GATE_TYPE_ALIAS[String(type || '').trim().toLowerCase()] || '';
}

function normalizeTileType(type = '') {
  return TILE_TYPE_ALIAS[String(type || '').trim().toLowerCase()] || '';
}

function normalizeAreaCells(definition = {}, fallbackId = '') {
  if (Array.isArray(definition.cells) && definition.cells.length) {
    const unique = new Map();
    definition.cells.forEach((cell) => {
      const x = normalizeInteger(cell?.x, 0);
      const y = normalizeInteger(cell?.y, 0);
      unique.set(`${x},${y}`, { x, y });
    });
    return [...unique.values()].sort((left, right) => (left.y - right.y) || (left.x - right.x));
  }

  const x = normalizeInteger(definition.x, 0);
  const y = normalizeInteger(definition.y, 0);
  const width = Math.max(1, normalizeInteger(definition.w ?? definition.width, 1));
  const height = Math.max(1, normalizeInteger(definition.h ?? definition.height, 1));
  const cells = [];
  for (let row = 0; row < height; row += 1) {
    for (let col = 0; col < width; col += 1) {
      cells.push({ x: x + col, y: y + row });
    }
  }
  if (cells.length) {
    return cells;
  }
  return [{ x, y, id: fallbackId }];
}

function normalizeBlock(definition = {}, index = 0) {
  const shapeCells = normalizeShapeCells(definition.shapeCells);
  const bounds = getBoundsFromCells(shapeCells);
  const moveAxis = MOVE_AXIS_SET.has(definition.moveAxis) ? definition.moveAxis : 'both';
  const baseMoveAxis = MOVE_AXIS_SET.has(definition.baseMoveAxis) ? definition.baseMoveAxis : moveAxis;
  return {
    ...definition,
    id: definition.id || `block-${index + 1}`,
    role: definition.role || 'target',
    style: definition.style || '',
    x: normalizeInteger(definition.x, 0),
    y: normalizeInteger(definition.y, 0),
    shapeCells,
    moveAxis,
    baseMoveAxis,
    w: bounds.w,
    h: bounds.h,
    flags: clone(definition.flags || {}),
  };
}

function normalizeTile(definition = {}, index = 0) {
  const type = normalizeTileType(definition.type || definition.tileType);
  return {
    ...clone(definition),
    id: definition.id || `tile-${index + 1}`,
    type,
    cells: normalizeAreaCells(definition, `tile-${index + 1}`),
    switchIds: clone(definition.switchIds || []),
    toColor: definition.toColor || definition.acceptColor || definition.style || '',
  };
}

function normalizeGate(definition = {}, index = 0) {
  const type = normalizeGateType(definition.type || definition.gateType);
  return {
    ...clone(definition),
    id: definition.id || `gate-${index + 1}`,
    type,
    cells: normalizeAreaCells(definition, `gate-${index + 1}`),
    keyPadIds: clone(definition.keyPadIds || []),
    switchIds: clone(definition.switchIds || []),
    allowDir: normalizeDir(definition.allowDir),
    defaultOpen: normalizeBoolean(definition.defaultOpen, false),
    open: normalizeBoolean(definition.open, false),
    consumed: normalizeBoolean(definition.consumed, false),
    phase: normalizeInteger(definition.phase, 0),
  };
}

export function normalizeLevelStatic(sourceLevel = {}) {
  if (sourceLevel && sourceLevel.__normalizedLevelStatic) {
    return sourceLevel;
  }
  const level = clone(sourceLevel || {});
  return {
    ...level,
    __normalizedLevelStatic: true,
    board: {
      cols: normalizeInteger(level.board?.cols, 0),
      rows: normalizeInteger(level.board?.rows, 0),
      themeKey: level.board?.themeKey || 'toy-workshop',
    },
    exits: (level.exits || []).map((exit, index) => ({
      ...clone(exit),
      id: exit.id || `exit-${index + 1}`,
      edge: normalizeDir(exit.edge),
      start: normalizeInteger(exit.start, 0),
      span: normalizeInteger(exit.span, 0),
      acceptColor: exit.acceptColor || '',
    })),
    blocks: (level.blocks || []).map((block, index) => normalizeBlock(block, index)),
    tiles: (level.tiles || []).map((tile, index) => normalizeTile(tile, index)),
    gates: (level.gates || []).map((gate, index) => normalizeGate(gate, index)),
  };
}

export function createInitialLevelState(sourceLevel = {}, options = {}) {
  const level = normalizeLevelStatic(sourceLevel);
  const blocks = {};
  (level.blocks || []).forEach((block) => {
    const isLubricated = normalizeBoolean(block.flags?.isLubricated || block.isLubricated, false);
    blocks[block.id] = {
      anchor: { x: block.x, y: block.y },
      color: block.style || '',
      moveAxis: isLubricated ? 'both' : (MOVE_AXIS_SET.has(block.moveAxis) ? block.moveAxis : 'both'),
      cleared: normalizeBoolean(block.cleared, false),
      flags: {
        ...clone(block.flags || {}),
        isLubricated,
      },
    };
  });

  const gates = {};
  (level.gates || []).forEach((gate) => {
    gates[gate.id] = {
      open: gate.type === 'one_way' ? true : normalizeBoolean(gate.open, gate.defaultOpen),
      consumed: normalizeBoolean(gate.consumed, false),
      phase: normalizeInteger(gate.phase, 0),
    };
  });

  const state = {
    blocks,
    gates,
    session: {
      usedItems: clone(options.usedItems || sourceLevel.session?.usedItems || {}),
      moveCount: normalizeInteger(options.moveCount ?? sourceLevel.session?.moveCount, 0),
      chainSerial: normalizeInteger(options.chainSerial ?? sourceLevel.session?.chainSerial, 0),
      lastAction: clone(options.lastAction || sourceLevel.session?.lastAction || null),
    },
  };
  refreshReactiveGates(level, state);
  return state;
}

export function cloneLevelState(state = {}) {
  return clone(state || {});
}

function getBlockTemplate(level, blockId = '') {
  return (level.blocks || []).find((block) => block.id === blockId) || null;
}

function getBlockState(state = {}, blockId = '') {
  return state.blocks?.[blockId] || null;
}

function getGateState(state = {}, gateId = '') {
  return state.gates?.[gateId] || null;
}

export function getOccupiedCells(block, anchor = null) {
  return getFootprintOccupiedCells(block, anchor);
}

function buildMaterializedBlock(level, state, blockId = '') {
  const template = getBlockTemplate(level, blockId);
  const blockState = getBlockState(state, blockId);
  if (!template || !blockState || blockState.cleared) {
    return null;
  }
  return {
    ...template,
    x: blockState.anchor?.x ?? template.x,
    y: blockState.anchor?.y ?? template.y,
    style: blockState.color || template.style,
    moveAxis: blockState.flags?.isLubricated ? 'both' : (blockState.moveAxis || template.moveAxis || 'both'),
    baseMoveAxis: template.baseMoveAxis || template.moveAxis || 'both',
    isLubricated: !!blockState.flags?.isLubricated,
    cleared: !!blockState.cleared,
    flags: {
      ...clone(template.flags || {}),
      ...clone(blockState.flags || {}),
    },
  };
}

export function materializeLevel(sourceLevel = {}, sourceState = null) {
  const level = normalizeLevelStatic(sourceLevel);
  const state = sourceState ? cloneLevelState(sourceState) : createInitialLevelState(level);
  refreshReactiveGates(level, state);
  const blocks = (level.blocks || [])
    .map((block) => buildMaterializedBlock(level, state, block.id))
    .filter(Boolean);
  const gates = (level.gates || []).map((gate) => ({
    ...gate,
    ...clone(getGateState(state, gate.id) || {}),
  }));
  return {
    ...clone(level),
    __normalizedLevelStatic: true,
    blocks,
    gates,
    session: clone(state.session || {}),
  };
}

export function createStateHash(sourceLevel = {}, sourceState = null) {
  const level = normalizeLevelStatic(sourceLevel);
  const state = sourceState ? cloneLevelState(sourceState) : createInitialLevelState(level);
  refreshReactiveGates(level, state);
  const blockSignature = (level.blocks || [])
    .map((block) => {
      const blockState = getBlockState(state, block.id);
      if (!blockState || blockState.cleared) {
        return `${block.id}:cleared`;
      }
      return [
        block.id,
        `${blockState.anchor?.x ?? block.x},${blockState.anchor?.y ?? block.y}`,
        blockState.color || block.style,
        blockState.flags?.isLubricated ? 'both' : (blockState.moveAxis || block.moveAxis || 'both'),
        blockState.flags?.isLubricated ? 'L1' : 'L0',
      ].join(':');
    })
    .sort()
    .join('|');
  const gateSignature = (level.gates || [])
    .map((gate) => {
      const gateState = getGateState(state, gate.id) || {};
      return `${gate.id}:${gate.type}:${gateState.open ? 1 : 0}:${gateState.phase ?? 0}:${gateState.consumed ? 1 : 0}`;
    })
    .sort()
    .join('|');
  return `${blockSignature}#${gateSignature}`;
}

export function createLevelSignature(sourceLevel = {}) {
  const level = normalizeLevelStatic(sourceLevel);
  const boardSig = `${level.board.cols}x${level.board.rows}`;
  const exitSig = (level.exits || [])
    .map((exit) => `${exit.acceptColor}:${exit.edge}:${exit.start}:${exit.span}`)
    .sort()
    .join('|');
  const tileSig = (level.tiles || [])
    .map((tile) => `${tile.id}:${tile.type}:${tile.cells.map((cell) => `${cell.x},${cell.y}`).join(';')}:${tile.toColor || ''}:${(tile.switchIds || []).join(',')}`)
    .sort()
    .join('|');
  const gateSig = (level.gates || [])
    .map((gate) => `${gate.id}:${gate.type}:${gate.cells.map((cell) => `${cell.x},${cell.y}`).join(';')}:${gate.allowDir || ''}:${(gate.keyPadIds || []).join(',')}:${(gate.switchIds || []).join(',')}`)
    .sort()
    .join('|');
  const blockSig = (level.blocks || [])
    .map((block) => `${block.id}:${block.style}:${block.baseMoveAxis || block.moveAxis}:${block.shapeCells.map((cell) => `${cell.x},${cell.y}`).join(';')}`)
    .sort()
    .join('|');
  return `${boardSig}#${exitSig}#${tileSig}#${gateSig}#${blockSig}`;
}

export function getMoveDeltas(moveAxis = 'both') {
  if (moveAxis === 'horizontal') {
    return [{ x: -1, y: 0 }, { x: 1, y: 0 }];
  }
  if (moveAxis === 'vertical') {
    return [{ x: 0, y: -1 }, { x: 0, y: 1 }];
  }
  if (moveAxis === 'both') {
    return [{ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 }];
  }
  return [];
}

function normalizeApproachDir(action = {}, currentAnchor = null) {
  const explicit = normalizeDir(action.approachDir);
  if (explicit) {
    return explicit;
  }
  const target = action.targetAnchor || action.anchor || null;
  if (!target || !currentAnchor) {
    return '';
  }
  const dx = normalizeInteger(target.x, currentAnchor.x) - currentAnchor.x;
  const dy = normalizeInteger(target.y, currentAnchor.y) - currentAnchor.y;
  if (Math.abs(dx) >= Math.abs(dy) && dx !== 0) {
    return dx > 0 ? 'right' : 'left';
  }
  if (dy !== 0) {
    return dy > 0 ? 'bottom' : 'top';
  }
  return '';
}

function buildOccupancy(level, state, ignoreId = '') {
  const occupancy = new Set();
  (level.blocks || []).forEach((block) => {
    if (block.id === ignoreId) {
      return;
    }
    const stateBlock = getBlockState(state, block.id);
    if (!stateBlock || stateBlock.cleared) {
      return;
    }
    getOccupiedCells(block, stateBlock.anchor).forEach((cell) => {
      occupancy.add(`${cell.x},${cell.y}`);
    });
  });
  return occupancy;
}

function gateBlocksAnchor(level, state, block, anchor, approachDir = '') {
  const occupiedCells = getOccupiedCells(block, anchor);
  const occupiedKeys = new Set(occupiedCells.map((cell) => `${cell.x},${cell.y}`));
  for (const gate of level.gates || []) {
    const overlaps = (gate.cells || []).some((cell) => occupiedKeys.has(`${cell.x},${cell.y}`));
    if (!overlaps) {
      continue;
    }
    const gateState = getGateState(state, gate.id) || {};
    if (gate.type === 'one_way') {
      if (gate.allowDir && approachDir && gate.allowDir !== approachDir) {
        return { blocked: true, reason: 'one_way_gate', gateId: gate.id };
      }
      continue;
    }
    if (!gateState.open) {
      return { blocked: true, reason: `${gate.type || 'closed'}_gate`, gateId: gate.id };
    }
  }
  return null;
}

function collectGateTraversalEvents(level, block, approachDir = '', events = [], seen = new Set()) {
  if (!approachDir) {
    return;
  }
  const occupiedKeys = new Set(getOccupiedCells(block).map((cell) => `${cell.x},${cell.y}`));
  (level.gates || []).forEach((gate) => {
    if (gate.type !== 'one_way' || !gate.allowDir || gate.allowDir !== approachDir) {
      return;
    }
    const overlaps = (gate.cells || []).some((cell) => occupiedKeys.has(`${cell.x},${cell.y}`));
    if (!overlaps) {
      return;
    }
    const eventKey = `oneway:${block.id}:${gate.id}:${gate.allowDir}`;
    if (seen.has(eventKey)) {
      return;
    }
    seen.add(eventKey);
    events.push(eventKey);
  });
}

export function canPlaceBlockAtAnchor(sourceLevel = {}, blockId = '', anchor = {}, options = {}) {
  const level = normalizeLevelStatic(sourceLevel);
  const state = options.state ? cloneLevelState(options.state) : createInitialLevelState(level);
  refreshReactiveGates(level, state);
  const block = getBlockTemplate(level, blockId);
  if (!block) {
    return false;
  }
  const occupancy = buildOccupancy(level, state, options.ignoreBlockId || blockId);
  for (const cell of block.shapeCells) {
    const targetX = normalizeInteger(anchor.x, 0) + cell.x;
    const targetY = normalizeInteger(anchor.y, 0) + cell.y;
    if (targetX < 0 || targetY < 0 || targetX >= level.board.cols || targetY >= level.board.rows) {
      return false;
    }
    if (occupancy.has(`${targetX},${targetY}`)) {
      return false;
    }
  }
  return !gateBlocksAnchor(level, state, block, anchor, options.approachDir);
}

export function getProjectionSpan(block, edge) {
  return getFootprintProjectionSpan(block, edge);
}

export function getProjectionLength(block, edge) {
  return getFootprintProjectionLength(block, edge);
}

export function getCompatibleExits(sourceLevel = {}, blockLike = null) {
  const level = normalizeLevelStatic(sourceLevel);
  return getCompatibleExitsForFootprint(level, blockLike);
}

export function getExitMatch(sourceLevel = {}, blockLike = null) {
  const level = normalizeLevelStatic(sourceLevel);
  return getExitMatchForFootprint(level, blockLike);
}

function getTouchedTiles(level, block) {
  const occupiedKeys = new Set(getOccupiedCells(block).map((cell) => `${cell.x},${cell.y}`));
  return (level.tiles || []).filter((tile) => (tile.cells || []).some((cell) => occupiedKeys.has(`${cell.x},${cell.y}`)));
}

function getOccupiedTileIds(level, state) {
  const occupiedCells = new Set();
  (level.blocks || []).forEach((block) => {
    const stateBlock = getBlockState(state, block.id);
    if (!stateBlock || stateBlock.cleared) {
      return;
    }
    getOccupiedCells(block, stateBlock.anchor).forEach((cell) => {
      occupiedCells.add(`${cell.x},${cell.y}`);
    });
  });
  const tileIds = new Set();
  (level.tiles || []).forEach((tile) => {
    const touched = (tile.cells || []).some((cell) => occupiedCells.has(`${cell.x},${cell.y}`));
    if (touched) {
      tileIds.add(tile.id);
    }
  });
  return tileIds;
}

function getLinkedSwitchTileIds(level, gate) {
  const direct = new Set(gate.switchIds || []);
  if (direct.size) {
    return [...direct];
  }
  return (level.tiles || [])
    .filter((tile) => tile.type === 'toggle_switch' && (tile.switchIds || []).includes(gate.id))
    .map((tile) => tile.id);
}

function refreshReactiveGates(level, state, events = []) {
  const occupiedTileIds = getOccupiedTileIds(level, state);
  (level.gates || []).forEach((gate) => {
    const gateState = getGateState(state, gate.id);
    if (!gateState) {
      return;
    }
    const previousOpen = !!gateState.open;
    let nextOpen = previousOpen;
    if (gate.type === 'one_way') {
      nextOpen = true;
    } else if (gate.type === 'lock' && (gate.keyPadIds || []).length) {
      const activePadId = (gate.keyPadIds || []).find((tileId) => occupiedTileIds.has(tileId)) || '';
      if (activePadId && !gateState.consumed) {
        gateState.consumed = true;
        events.push(`key:${activePadId}->${gate.id}`);
      }
      nextOpen = !!gateState.consumed || !!activePadId;
    } else if (gate.type === 'toggle') {
      const linkedSwitchIds = getLinkedSwitchTileIds(level, gate);
      if (linkedSwitchIds.length) {
        const activeSwitchId = linkedSwitchIds.find((tileId) => occupiedTileIds.has(tileId)) || linkedSwitchIds[0] || '';
        nextOpen = linkedSwitchIds.some((tileId) => occupiedTileIds.has(tileId));
        if (nextOpen !== previousOpen) {
          events.push(`toggle:${activeSwitchId}->${gate.id}:${nextOpen ? 'open' : 'closed'}`);
        }
      } else {
        nextOpen = normalizeBoolean(gate.open, gate.defaultOpen);
      }
    } else {
      nextOpen = normalizeBoolean(gate.open, gate.defaultOpen);
    }
    if (nextOpen !== previousOpen) {
      gateState.phase = normalizeInteger(gateState.phase, 0) + 1;
    }
    gateState.open = nextOpen;
    gateState.consumed = gate.type === 'lock' ? !!gateState.consumed : nextOpen;
  });
}

function applyTileEffects(level, state, blockId, events = []) {
  const block = buildMaterializedBlock(level, state, blockId);
  if (!block) {
    return;
  }
  const touchedTiles = getTouchedTiles(level, block);
  touchedTiles.forEach((tile) => {
    if (tile.type === 'recolor' && tile.toColor) {
      const stateBlock = getBlockState(state, blockId);
      if (stateBlock && stateBlock.color !== tile.toColor) {
        stateBlock.color = tile.toColor;
        events.push(`recolor:${blockId}:${tile.toColor}`);
      }
    }
  });
}

function continueIceSlide(level, state, blockId, approachDir, events = [], gateTraversalSeen = new Set()) {
  if (!approachDir) {
    return;
  }
  const delta = {
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
    top: { x: 0, y: -1 },
    bottom: { x: 0, y: 1 },
  }[approachDir];
  if (!delta) {
    return;
  }
  while (true) {
    const block = buildMaterializedBlock(level, state, blockId);
    if (!block) {
      return;
    }
    const touchedTiles = getTouchedTiles(level, block);
    const onIce = touchedTiles.some((tile) => tile.type === 'ice');
    if (!onIce) {
      return;
    }
    const nextAnchor = {
      x: block.x + delta.x,
      y: block.y + delta.y,
    };
    if (!canPlaceBlockAtAnchor(level, blockId, nextAnchor, { state, approachDir })) {
      return;
    }
    const stateBlock = getBlockState(state, blockId);
    stateBlock.anchor = nextAnchor;
    events.push(`ice:${blockId}:${nextAnchor.x},${nextAnchor.y}`);
    const slidedBlock = buildMaterializedBlock(level, state, blockId);
    if (slidedBlock) {
      collectGateTraversalEvents(level, slidedBlock, approachDir, events, gateTraversalSeen);
    }
    applyTileEffects(level, state, blockId, events);
    refreshReactiveGates(level, state, events);
    const afterSlide = buildMaterializedBlock(level, state, blockId);
    if (!afterSlide) {
      return;
    }
    const exit = getExitMatch(level, afterSlide);
    if (exit) {
      stateBlock.cleared = true;
      events.push(`clear:${blockId}:${exit.id}`);
      return;
    }
  }
}

export function settleLevelAction(sourceLevel = {}, action = {}, options = {}) {
  const level = normalizeLevelStatic(sourceLevel);
  const state = options.state ? cloneLevelState(options.state) : createInitialLevelState(level);
  const blockId = action.blockId || '';
  const template = getBlockTemplate(level, blockId);
  const stateBlock = getBlockState(state, blockId);
  if (!template || !stateBlock || stateBlock.cleared) {
    return {
      ok: false,
      reason: 'missing_block',
      state,
      level: materializeLevel(level, state),
      criticalEventChain: [],
      settleSummary: { cleared: false, exitId: null, events: [] },
    };
  }

  const targetAnchor = {
    x: normalizeInteger(action.targetAnchor?.x ?? action.x, stateBlock.anchor?.x ?? template.x),
    y: normalizeInteger(action.targetAnchor?.y ?? action.y, stateBlock.anchor?.y ?? template.y),
  };
  const approachDir = normalizeApproachDir(action, stateBlock.anchor || { x: template.x, y: template.y });
  const currentMoveAxis = stateBlock.flags?.isLubricated ? 'both' : (stateBlock.moveAxis || template.moveAxis || 'both');
  const deltaX = targetAnchor.x - (stateBlock.anchor?.x ?? template.x);
  const deltaY = targetAnchor.y - (stateBlock.anchor?.y ?? template.y);
  const horizontalOnly = currentMoveAxis === 'horizontal' && deltaY !== 0;
  const verticalOnly = currentMoveAxis === 'vertical' && deltaX !== 0;
  if (horizontalOnly || verticalOnly) {
    return {
      ok: false,
      reason: 'axis_locked',
      state,
      level: materializeLevel(level, state),
      criticalEventChain: [],
      settleSummary: { cleared: false, exitId: null, events: [] },
    };
  }

  if (!canPlaceBlockAtAnchor(level, blockId, targetAnchor, { state, approachDir })) {
    return {
      ok: false,
      reason: 'blocked',
      state,
      level: materializeLevel(level, state),
      criticalEventChain: [],
      settleSummary: { cleared: false, exitId: null, events: [] },
    };
  }

  const events = [];
  const gateTraversalSeen = new Set();
  refreshReactiveGates(level, state);
  stateBlock.anchor = targetAnchor;
  state.session = state.session || {};
  state.session.moveCount = normalizeInteger(state.session.moveCount, 0) + 1;
  state.session.chainSerial = normalizeInteger(state.session.chainSerial, 0) + 1;
  state.session.lastAction = {
    blockId,
    targetAnchor: clone(targetAnchor),
    approachDir,
  };

  let materializedBlock = buildMaterializedBlock(level, state, blockId);
  if (materializedBlock) {
    collectGateTraversalEvents(level, materializedBlock, approachDir, events, gateTraversalSeen);
  }
  applyTileEffects(level, state, blockId, events);
  refreshReactiveGates(level, state, events);
  materializedBlock = buildMaterializedBlock(level, state, blockId);
  let exit = materializedBlock ? getExitMatch(level, materializedBlock) : null;
  if (exit && stateBlock) {
    stateBlock.cleared = true;
    events.push(`clear:${blockId}:${exit.id}`);
  }

  if (!exit) {
    continueIceSlide(level, state, blockId, approachDir, events, gateTraversalSeen);
    materializedBlock = buildMaterializedBlock(level, state, blockId);
    exit = materializedBlock ? getExitMatch(level, materializedBlock) : null;
    if (exit && stateBlock && !stateBlock.cleared) {
      stateBlock.cleared = true;
      events.push(`clear:${blockId}:${exit.id}`);
    }
  }

  refreshReactiveGates(level, state, events);

  return {
    ok: true,
    reason: 'settled',
    state,
    level: materializeLevel(level, state),
    criticalEventChain: events,
    settleSummary: {
      cleared: !!stateBlock.cleared,
      exitId: exit?.id || null,
      events,
    },
  };
}

export function collectUnsupportedMechanics(sourceLevel = {}) {
  const level = normalizeLevelStatic(sourceLevel);
  const unsupportedTiles = (level.tiles || []).filter((tile) => !SUPPORTED_TILE_TYPES.has(tile.type));
  const unsupportedGates = (level.gates || []).filter((gate) => !SUPPORTED_GATE_TYPES.has(gate.type));
  const warnings = [];
  unsupportedTiles.forEach((tile) => {
    warnings.push({ type: 'unsupported_tile_type', tileId: tile.id, detail: tile.type || 'unknown' });
  });
  unsupportedGates.forEach((gate) => {
    warnings.push({ type: 'unsupported_gate_type', gateId: gate.id, detail: gate.type || 'unknown' });
  });
  return warnings;
}
