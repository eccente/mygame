export const STYLE_CONFIG = {
  red: { color: '#ff6252', accent: '#ffeae5' },
  blue: { color: '#35c2f3', accent: '#eafaff' },
  green: { color: '#5fdb45', accent: '#f1ffec' },
  yellow: { color: '#ffcf33', accent: '#fff6d8' },
  purple: { color: '#a96cff', accent: '#f5ebff' },
  orange: { color: '#ff9727', accent: '#ffeed7' },
  wood: { color: '#c48333', accent: '#f2d8ae' },
  stone: { color: '#889da8', accent: '#ebf3f6' },
  'metal-soft': { color: '#7e9cad', accent: '#e9f2f7' },
};

export const TARGET_STYLE_POOL = ['red', 'blue', 'green', 'yellow', 'purple', 'orange'];

export const SHAPE_LIBRARY = {
  mono: {
    default: [{ x: 0, y: 0 }],
  },
  domino: {
    h: [{ x: 0, y: 0 }, { x: 1, y: 0 }],
    v: [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  },
  bar3: {
    h: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
    v: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
  },
  'square-2': {
    default: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  },
  'L-3': {
    ur: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    dr: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    dl: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
    ul: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }],
  },
  'L-4': {
    ur: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
    dr: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
    dl: [{ x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
    ul: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  },
  'T-4': {
    up: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
    right: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 0, y: 2 }],
    down: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
    left: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 2 }],
  },
  'cross-5': {
    default: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 1, y: 2 }],
  },
};

const PRESET_ALIAS = {
  mono: 'mono',
  domino: {
    h: 'domino-h',
    v: 'domino-v',
  },
  bar3: {
    h: 'bar3-h',
    v: 'bar3-v',
  },
  'square-2': 'square-2',
  'L-3': 'L-3',
  'L-4': 'L-4',
  'T-4': 'T-4',
  'cross-5': 'cross-5',
};

export function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export function normalizeShapeCells(shapeCells) {
  if (!Array.isArray(shapeCells) || !shapeCells.length) {
    return [{ x: 0, y: 0 }];
  }
  const minX = Math.min(...shapeCells.map((cell) => Math.floor(cell.x || 0)));
  const minY = Math.min(...shapeCells.map((cell) => Math.floor(cell.y || 0)));
  const map = new Map();
  shapeCells.forEach((cell) => {
    const x = Math.floor(cell.x || 0) - minX;
    const y = Math.floor(cell.y || 0) - minY;
    map.set(`${x},${y}`, { x, y });
  });
  return [...map.values()].sort((a, b) => (a.y - b.y) || (a.x - b.x));
}

export function getShapeCells(shapeKey = 'mono', shapeVariant = 'default') {
  const family = SHAPE_LIBRARY[shapeKey] || SHAPE_LIBRARY.mono;
  const source = family[shapeVariant] || family.default || Object.values(family)[0];
  return normalizeShapeCells(source);
}

export function getPresetAlias(shapeKey = 'mono', shapeVariant = 'default') {
  const preset = PRESET_ALIAS[shapeKey] || 'mono';
  if (typeof preset === 'string') {
    return preset;
  }
  return preset[shapeVariant] || Object.values(preset)[0];
}

export function getBoundsFromCells(cells) {
  let maxX = 0;
  let maxY = 0;
  cells.forEach((cell) => {
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  });
  return {
    w: maxX + 1,
    h: maxY + 1,
  };
}

export function createExit(id, edge, start, span, acceptColor) {
  return {
    id,
    edge,
    start,
    span,
    acceptColor,
  };
}

export function createBlock(definition = {}) {
  const shapeKey = definition.shapeKey || 'mono';
  const shapeVariant = definition.shapeVariant || 'default';
  const shapeCells = normalizeShapeCells(definition.shapeCells || getShapeCells(shapeKey, shapeVariant));
  const bounds = getBoundsFromCells(shapeCells);
  return {
    id: definition.id,
    role: 'target',
    style: definition.style,
    x: definition.x,
    y: definition.y,
    shapePreset: definition.shapePreset || getPresetAlias(shapeKey, shapeVariant),
    shapeVariant,
    shapeCells,
    moveAxis: definition.moveAxis || 'both',
    baseMoveAxis: definition.baseMoveAxis || definition.moveAxis || 'both',
    w: bounds.w,
    h: bounds.h,
  };
}

export function createCampaignLevel(definition = {}) {
  const chapter = Number(definition.chapter) || 1;
  const index = Number(definition.index) || 1;
  const chapterNumber = String(chapter).padStart(2, '0');
  const levelNumber = String(index).padStart(2, '0');
  return {
    id: definition.id || `c${chapterNumber}-l${levelNumber}`,
    chapter,
    index,
    title: definition.title || `${chapter}-${index}`,
    rewardCoins: Number.isFinite(definition.rewardCoins) ? definition.rewardCoins : 80,
    board: {
      cols: definition.board?.cols || definition.cols || 5,
      rows: definition.board?.rows || definition.rows || 6,
      themeKey: definition.board?.themeKey || definition.themeKey || 'toy-workshop',
    },
    exits: (definition.exits || []).map((exit) => ({ ...exit })),
    blocks: (definition.blocks || []).map((block) => ({ ...block })),
    tiles: clone(definition.tiles || []),
    gates: clone(definition.gates || []),
    meta: {
      mode: 'campaign',
      chapterTitle: definition.chapterTitle || `第 ${chapter} 章`,
      chapterShortTitle: definition.chapterShortTitle || `第 ${chapter} 章`,
      chapterTagline: definition.chapterTagline || '',
      levelInChapter: index,
      difficultyBand: definition.difficultyBand || 'tutorial',
      tags: clone(definition.tags || []),
      guideText: definition.guideText || '',
      endlessEligible: !!definition.endlessEligible,
    },
  };
}

export function flattenCampaignChapters(chapters = []) {
  const normalizedChapters = chapters.map((chapter) => ({
    ...chapter,
    levelCount: (chapter.levels || []).length,
  }));
  let runningIndex = 0;
  normalizedChapters.forEach((chapter) => {
    chapter.startIndex = runningIndex;
    chapter.endIndex = runningIndex + chapter.levelCount - 1;
    runningIndex += chapter.levelCount;
  });

  const levels = [];
  normalizedChapters.forEach((chapter) => {
    (chapter.levels || []).forEach((level, levelOffset) => {
      levels.push({
        ...level,
        flatIndex: chapter.startIndex + levelOffset,
        meta: {
          ...clone(level.meta || {}),
          chapterTitle: chapter.title,
          chapterShortTitle: chapter.shortTitle || chapter.title,
          chapterTagline: chapter.tagline || '',
          levelInChapter: levelOffset + 1,
        },
      });
    });
  });

  return {
    chapters: normalizedChapters.map((chapter) => ({
      id: chapter.id,
      number: chapter.number,
      title: chapter.title,
      shortTitle: chapter.shortTitle || chapter.title,
      tagline: chapter.tagline || '',
      levelCount: chapter.levelCount,
      startIndex: chapter.startIndex,
      endIndex: chapter.endIndex,
    })),
    levels,
  };
}

export function hashSeed(text) {
  let hash = 2166136261;
  const source = String(text);
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export function createRng(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6D2B79F5;
    let result = value;
    result = Math.imul(result ^ (result >>> 15), result | 1);
    result ^= result + Math.imul(result ^ (result >>> 7), result | 61);
    return ((result ^ (result >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng) {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(rng() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
}

export function mirrorEdgeX(edge) {
  if (edge === 'left') {
    return 'right';
  }
  if (edge === 'right') {
    return 'left';
  }
  return edge;
}

export function mirrorEdgeY(edge) {
  if (edge === 'top') {
    return 'bottom';
  }
  if (edge === 'bottom') {
    return 'top';
  }
  return edge;
}

export function mirrorShapeCellsX(shapeCells) {
  const cells = clone(shapeCells);
  const bounds = getBoundsFromCells(cells);
  return cells.map((cell) => ({
    x: bounds.w - cell.x - 1,
    y: cell.y,
  }));
}

export function mirrorShapeCellsY(shapeCells) {
  const cells = clone(shapeCells);
  const bounds = getBoundsFromCells(cells);
  return cells.map((cell) => ({
    x: cell.x,
    y: bounds.h - cell.y - 1,
  }));
}

export function applyMirrorX(level) {
  const next = clone(level);
  const cols = next.board.cols;
  next.blocks = next.blocks.map((block) => {
    const bounds = getBoundsFromCells(block.shapeCells || getShapeCells('mono'));
    return {
      ...block,
      x: cols - block.x - bounds.w,
      shapeCells: mirrorShapeCellsX(block.shapeCells),
    };
  });
  next.exits = next.exits.map((exit) => ({
    ...exit,
    edge: mirrorEdgeX(exit.edge),
    start: exit.edge === 'top' || exit.edge === 'bottom'
      ? cols - exit.start - exit.span
      : exit.start,
  }));
  return next;
}

export function applyMirrorY(level) {
  const next = clone(level);
  const rows = next.board.rows;
  next.blocks = next.blocks.map((block) => {
    const bounds = getBoundsFromCells(block.shapeCells || getShapeCells('mono'));
    return {
      ...block,
      y: rows - block.y - bounds.h,
      shapeCells: mirrorShapeCellsY(block.shapeCells),
    };
  });
  next.exits = next.exits.map((exit) => ({
    ...exit,
    edge: mirrorEdgeY(exit.edge),
    start: exit.edge === 'left' || exit.edge === 'right'
      ? rows - exit.start - exit.span
      : exit.start,
  }));
  return next;
}
