import {
  applyMirrorX,
  applyMirrorY,
  clone,
  createCampaignLevel,
  createRng,
  getBoundsFromCells,
  hashSeed,
  shuffle,
} from '../catalog.js';
import { CAMPAIGN_CHAPTER_02 } from './chapter-02.js';
import { CAMPAIGN_CHAPTER_02_PREVIEW_C02_RANDOM10 } from './chapter-02-preview-c02-random10.js';

const CHAPTER = 2;
const TITLE = 'L 形母版扩充 · 试玩';
const SHORT = 'L形扩充';
const TAGLINE = '以 2-03 / 正式 2-06 / 随机 6 为母版扩出的 30 关试玩包。';
const PALETTE = ['red', 'blue', 'green', 'yellow', 'purple'];

function getLevel(chapter, index) {
  return chapter.levels.find((level) => level.index === index);
}

const TEMPLATE_FAMILIES = [
  {
    key: 'door-queue',
    label: '门位缠斗',
    titleSeed: '正式 2-03',
    startIndex: 1,
    baseLevel: getLevel(CAMPAIGN_CHAPTER_02, 3),
    blockMoveBias: 'edges',
    exitMode: 'shuffle',
  },
  {
    key: 'hidden-first',
    label: '延迟首出',
    titleSeed: '正式 2-06',
    startIndex: 11,
    baseLevel: getLevel(CAMPAIGN_CHAPTER_02, 6),
    blockMoveBias: 'center',
    exitMode: 'flip',
  },
  {
    key: 'dense-lock',
    label: '密团互锁',
    titleSeed: '随机 6',
    startIndex: 21,
    baseLevel: getLevel(CAMPAIGN_CHAPTER_02_PREVIEW_C02_RANDOM10, 6),
    blockMoveBias: 'cluster',
    exitMode: 'mixed',
  },
];

function blockArea(block) {
  return Array.isArray(block.shapeCells) ? block.shapeCells.length : 1;
}

function getWorldCells(block, x = block.x, y = block.y) {
  return (block.shapeCells || []).map((cell) => ({ x: x + cell.x, y: y + cell.y }));
}

function getLevelColors(level) {
  const used = new Set();
  level.blocks.forEach((block) => {
    if (PALETTE.includes(block.style)) {
      used.add(block.style);
    }
  });
  level.exits.forEach((exit) => {
    if (PALETTE.includes(exit.acceptColor)) {
      used.add(exit.acceptColor);
    }
  });
  return PALETTE.filter((color) => used.has(color));
}

function applyColorShift(level, shift = 0) {
  const colors = getLevelColors(level);
  if (!colors.length || !shift) {
    return level;
  }
  const map = new Map();
  colors.forEach((color, index) => {
    map.set(color, colors[(index + shift) % colors.length]);
  });
  level.blocks.forEach((block) => {
    if (map.has(block.style)) {
      block.style = map.get(block.style);
    }
  });
  level.exits.forEach((exit) => {
    if (map.has(exit.acceptColor)) {
      exit.acceptColor = map.get(exit.acceptColor);
    }
  });
  return level;
}

function oppositeEdge(edge) {
  if (edge === 'top') {
    return 'bottom';
  }
  if (edge === 'bottom') {
    return 'top';
  }
  if (edge === 'left') {
    return 'right';
  }
  if (edge === 'right') {
    return 'left';
  }
  return edge;
}

function edgeLimit(level, edge) {
  return edge === 'top' || edge === 'bottom' ? level.board.cols : level.board.rows;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA < endB && startB < endA;
}

function canPlaceExit(level, exitIndex, edge, start, span) {
  if (start < 0 || span < 1 || start + span > edgeLimit(level, edge)) {
    return false;
  }
  for (let index = 0; index < level.exits.length; index += 1) {
    if (index === exitIndex) {
      continue;
    }
    const other = level.exits[index];
    if (other.edge !== edge) {
      continue;
    }
    if (rangesOverlap(start, start + span, other.start, other.start + other.span)) {
      return false;
    }
  }
  return true;
}

function buildOccupancy(level, ignoreId = '') {
  const occupied = new Set();
  level.blocks.forEach((block) => {
    if (block.id === ignoreId) {
      return;
    }
    getWorldCells(block).forEach((cell) => {
      occupied.add(`${cell.x},${cell.y}`);
    });
  });
  return occupied;
}

function canPlaceBlock(level, block, x, y) {
  const occupied = buildOccupancy(level, block.id);
  const bounds = getBoundsFromCells(block.shapeCells || [{ x: 0, y: 0 }]);
  if (x < 0 || y < 0 || x + bounds.w > level.board.cols || y + bounds.h > level.board.rows) {
    return false;
  }
  for (const cell of getWorldCells(block, x, y)) {
    if (occupied.has(`${cell.x},${cell.y}`)) {
      return false;
    }
  }
  return true;
}

function matchingExitTouchCount(level) {
  let count = 0;
  level.blocks.forEach((block) => {
    const cells = getWorldCells(block);
    const touched = level.exits.some((exit) => {
      if (exit.acceptColor !== block.style) {
        return false;
      }
      return cells.some((cell) => {
        if (exit.edge === 'top') {
          return cell.y === 0 && cell.x >= exit.start && cell.x < exit.start + exit.span;
        }
        if (exit.edge === 'bottom') {
          return cell.y === level.board.rows - 1 && cell.x >= exit.start && cell.x < exit.start + exit.span;
        }
        if (exit.edge === 'left') {
          return cell.x === 0 && cell.y >= exit.start && cell.y < exit.start + exit.span;
        }
        if (exit.edge === 'right') {
          return cell.x === level.board.cols - 1 && cell.y >= exit.start && cell.y < exit.start + exit.span;
        }
        return false;
      });
    });
    if (touched) {
      count += 1;
    }
  });
  return count;
}

function scorePlacement(level, block, x, y, bias, rng) {
  const bounds = getBoundsFromCells(block.shapeCells || [{ x: 0, y: 0 }]);
  const centerX = x + (bounds.w - 1) * 0.5;
  const centerY = y + (bounds.h - 1) * 0.5;
  const boardCenterX = (level.board.cols - 1) * 0.5;
  const boardCenterY = (level.board.rows - 1) * 0.5;
  const edgeDistance = Math.min(x, y, level.board.cols - (x + bounds.w), level.board.rows - (y + bounds.h));
  const centerDistance = Math.abs(centerX - boardCenterX) + Math.abs(centerY - boardCenterY);
  const shiftDistance = Math.abs(x - block.x) + Math.abs(y - block.y);
  if (bias === 'center') {
    return (10 - centerDistance * 1.6) + shiftDistance * 0.5 + rng() * 0.25;
  }
  if (bias === 'edges') {
    return edgeDistance * 1.6 + shiftDistance * 0.55 + rng() * 0.25;
  }
  return (8 - centerDistance) + edgeDistance * 0.8 + shiftDistance * 0.6 + rng() * 0.25;
}

function chooseCandidatePlacements(level, block, bias, rng) {
  const placements = [];
  for (let y = 0; y <= level.board.rows - block.h; y += 1) {
    for (let x = 0; x <= level.board.cols - block.w; x += 1) {
      if (x === block.x && y === block.y) {
        continue;
      }
      if (!canPlaceBlock(level, block, x, y)) {
        continue;
      }
      const shiftDistance = Math.abs(x - block.x) + Math.abs(y - block.y);
      if (shiftDistance < 1) {
        continue;
      }
      placements.push({
        x,
        y,
        score: scorePlacement(level, block, x, y, bias, rng),
      });
    }
  }
  return placements.sort((left, right) => right.score - left.score);
}

function moveSelectedBlocks(level, rng, config) {
  const majorBlocks = level.blocks.filter((block) => blockArea(block) >= 3);
  const minorBlocks = level.blocks.filter((block) => blockArea(block) <= 2);
  const ordered = [
    ...shuffle(minorBlocks, rng),
    ...shuffle(majorBlocks, rng),
  ];
  let moved = 0;
  for (const block of ordered) {
    if (moved >= config.moveCount) {
      break;
    }
    if (config.keepLargeStable && blockArea(block) >= 4 && moved < config.moveCount - 1) {
      continue;
    }
    const placements = chooseCandidatePlacements(level, block, config.blockMoveBias, rng);
    if (!placements.length) {
      continue;
    }
    const choice = placements[Math.min(placements.length - 1, Math.floor(rng() * Math.min(placements.length, 4)))];
    block.x = choice.x;
    block.y = choice.y;
    moved += 1;
  }
  return moved;
}

function mutateExits(level, rng, config) {
  const ordered = shuffle(level.exits.map((exit, index) => ({ exit, index })), rng);
  let moved = 0;
  for (const entry of ordered) {
    if (moved >= config.exitMoveCount) {
      break;
    }
    const exit = entry.exit;
    const candidateEdges = [exit.edge];
    if (config.exitMode === 'flip' || config.exitMode === 'mixed') {
      candidateEdges.push(oppositeEdge(exit.edge));
    }
    const placements = [];
    candidateEdges.forEach((edge) => {
      const limit = edgeLimit(level, edge);
      for (let start = 0; start <= limit - exit.span; start += 1) {
        if (edge === exit.edge && start === exit.start) {
          continue;
        }
        if (!canPlaceExit(level, entry.index, edge, start, exit.span)) {
          continue;
        }
        const center = start + (exit.span - 1) * 0.5;
        const boardCenter = (limit - 1) * 0.5;
        const score = (6 - Math.abs(center - boardCenter)) + (edge === exit.edge ? 0.4 : 1.1) + rng() * 0.35;
        placements.push({ edge, start, score });
      }
    });
    placements.sort((left, right) => right.score - left.score);
    if (!placements.length) {
      continue;
    }
    const pick = placements[Math.min(placements.length - 1, Math.floor(rng() * Math.min(placements.length, 4)))];
    exit.edge = pick.edge;
    exit.start = pick.start;
    moved += 1;
  }
  return moved;
}

function structuralCheck(level) {
  const occupied = new Set();
  for (const block of level.blocks) {
    for (const cell of getWorldCells(block)) {
      if (cell.x < 0 || cell.y < 0 || cell.x >= level.board.cols || cell.y >= level.board.rows) {
        return false;
      }
      const key = `${cell.x},${cell.y}`;
      if (occupied.has(key)) {
        return false;
      }
      occupied.add(key);
    }
  }
  for (let index = 0; index < level.exits.length; index += 1) {
    const exit = level.exits[index];
    if (!canPlaceExit(level, index, exit.edge, exit.start, exit.span)) {
      return false;
    }
  }
  const colors = new Set(level.blocks.map((block) => block.style));
  for (const color of colors) {
    if (!level.exits.some((exit) => exit.acceptColor === color)) {
      return false;
    }
  }
  return true;
}

function retagIds(level, variantKey) {
  level.id = `c02-${variantKey}`;
  level.exits = level.exits.map((exit, index) => ({
    ...exit,
    id: `${variantKey}-exit-${index + 1}`,
  }));
  level.blocks = level.blocks.map((block, index) => ({
    ...block,
    id: `${variantKey}-block-${index + 1}`,
  }));
  return level;
}

function buildVariantLevel(family, familyOffset, variantOffset) {
  const variantKey = `${family.key}-${String(variantOffset + 1).padStart(2, '0')}`;
  const rng = createRng(hashSeed(`shift-family30:${variantKey}`));
  const working = clone(family.baseLevel);
  if (variantOffset % 2 === 1) {
    Object.assign(working, applyMirrorX(working));
  }
  if (variantOffset % 3 === 2) {
    Object.assign(working, applyMirrorY(working));
  }
  applyColorShift(working, variantOffset % Math.max(1, getLevelColors(working).length));

  const baseTouch = matchingExitTouchCount(working);
  const attempts = Math.max(8, 14 - variantOffset);
  let best = clone(working);
  let bestScore = -Infinity;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const candidate = clone(working);
    const attemptRng = createRng(hashSeed(`shift-family30:${variantKey}:attempt:${attempt}`));
    const moveCount = variantOffset === 0 ? 0 : Math.min(4, 1 + (variantOffset % 4));
    const exitMoveCount = variantOffset === 0 ? 0 : Math.min(2, Math.floor((variantOffset + 1) / 3));
    moveSelectedBlocks(candidate, attemptRng, {
      moveCount,
      blockMoveBias: family.blockMoveBias,
      keepLargeStable: family.key !== 'dense-lock',
    });
    mutateExits(candidate, attemptRng, {
      exitMoveCount,
      exitMode: family.exitMode,
    });
    if (!structuralCheck(candidate)) {
      continue;
    }
    const touchScore = matchingExitTouchCount(candidate);
    const denseArea = candidate.blocks.reduce((sum, block) => sum + blockArea(block), 0);
    const score = denseArea * 0.2 - touchScore * 4 + attemptRng();
    if (touchScore <= baseTouch && score > bestScore) {
      best = candidate;
      bestScore = score;
    } else if (bestScore < 0 && score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  retagIds(best, variantKey);
  const levelIndex = family.startIndex + familyOffset;
  return createCampaignLevel({
    ...best,
    chapter: CHAPTER,
    index: levelIndex,
    title: `2-${String(levelIndex).padStart(2, '0')} · ${family.label} ${variantOffset + 1}`,
    chapterTitle: TITLE,
    chapterShortTitle: SHORT,
    chapterTagline: TAGLINE,
    cols: best.board.cols,
    rows: best.board.rows,
    difficultyBand: levelIndex <= 6 ? 'hard' : 'expert',
    tags: [
      'preview-only',
      'template-family',
      `family-${family.key}`,
      `seed-${family.titleSeed}`,
      variantOffset === 0 ? 'seed-original' : 'seed-variant',
    ],
    guideText: '',
  });
}

function buildFamilyLevels(family) {
  return Array.from({ length: 10 }, (_, variantOffset) => buildVariantLevel(family, variantOffset, variantOffset));
}

const levels = TEMPLATE_FAMILIES.flatMap((family) => buildFamilyLevels(family));

export const CAMPAIGN_CHAPTER_02_PREVIEW_C02_FAMILY30 = {
  id: 'chapter-02-c02-family30',
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels,
};
