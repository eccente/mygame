import * as THREE from '../../vendor/three/three.module.js';
import { CAMPAIGN_CHAPTERS, ENDLESS_DIFFICULTIES, SHIFT_LEVELS, STYLE_CONFIG, createEndlessLevel, formatCampaignLevelLabel, getCampaignChapterByIndex, getEndlessDifficulty } from './levels.js';
import { clearResume, loadSaveData, normalizeSaveData, saveSaveData } from './storage.js';
import { canPlaceBlockAtAnchor, cloneLevelState, createInitialLevelState, materializeLevel, normalizeLevelStatic, settleLevelAction } from './core/level-state.js';

const CELL_SIZE = 1;
const BOARD_HEIGHT = 0.38;
const BLOCK_HEIGHT = 0.5;
const BLOCK_VISUAL_SCALE = 0.82;
const BLOCK_FOOTPRINT_INSET = (CELL_SIZE - BLOCK_VISUAL_SCALE) * 0.5;
const BLOCK_CORNER_RADIUS = 0.22;
const BLOCK_STUD_SCALE = 0.92;
const BOARD_EDGE_NEUTRAL_COLOR = '#556272';
const DRAG_THRESHOLD = 0.16;
const DRAG_STEP_THRESHOLD = 0.46;
const MAX_DRAG_ADVANCE_STEPS = 24;
const DRAG_BLOCKED_NUDGE = 0.11;
const DRAG_BLOCKED_SQUASH = 0.08;
const DRAG_BLOCKED_DECAY = 8.5;
const MASTER_KEY_COST = 120;
const LUBRICANT_COST = 140;
const GOLD_FINGER_COST = 180;
const CLEAR_GOLD_FINGER_REWARD = 2;
const EXIT_DEPTH = 0.22;
const EXIT_HEIGHT = 0.18;
const SNAP_SPEED = 13;
const CLEAR_SPEED = 6.8;
const IMPACT_SPEED = 9.5;
const GATE_SWITCH_SPEED = 9;
const CAMERA_PADDING = 2.15;
const EXIT_OUTER_MARGIN = 0.58;
const MENU_PREVIEW_SEED = 20260311;
const AUDIO_POOL_SIZES = Object.freeze({ tap: 2, move: 4, success: 3, win: 2 });
const AUDIO_GAIN_BY_KIND = Object.freeze({ tap: 0.72, move: 0.88, success: 1.22, win: 1 });
const BGM_GAIN = 0.52;
const MOVE_VIBRATION_PATTERN = [16];
const EXIT_VIBRATION_PATTERN = [24];
const WIN_VIBRATION_PATTERN = [28, 48, 28];

const SHOP_ITEMS = {
  masterKey: {
    id: 'masterKey',
    label: '万能钥匙',
    icon: '🗝️',
    price: MASTER_KEY_COST,
    description: '打开一扇锁门，本局持续生效。',
  },
  lubricant: {
    id: 'lubricant',
    label: '润滑油',
    icon: '🛢',
    price: LUBRICANT_COST,
    description: '让一个方向块在本局恢复自由移动。',
  },
  goldFinger: {
    id: 'goldFinger',
    label: '金手指',
    icon: '☝️',
    price: GOLD_FINGER_COST,
    description: '直接移除一个可移动目标方块。',
  },
};

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function trySetPointerCapture(element, pointerId) {
  if (!element?.setPointerCapture || typeof pointerId !== 'number') {
    return;
  }
  try {
    element.setPointerCapture(pointerId);
  } catch (_error) {
    // Ignore synthetic-pointer and browser-specific capture failures.
  }
}

function tryReleasePointerCapture(element, pointerId) {
  if (!element?.releasePointerCapture || typeof pointerId !== 'number') {
    return;
  }
  try {
    element.releasePointerCapture(pointerId);
  } catch (_error) {
    // Ignore synthetic-pointer and browser-specific capture failures.
  }
}

function createManagedAudio(src = '') {
  if (typeof Audio === 'undefined') {
    return null;
  }
  const audio = new Audio();
  audio.preload = 'auto';
  audio.playsInline = true;
  if (src) {
    audio.src = src;
  }
  return audio;
}

function decodeAudioDataCompat(audioContext, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const safeBuffer = arrayBuffer.slice(0);
    const onResolve = (decodedBuffer) => resolve(decodedBuffer);
    const onReject = (error) => reject(error);
    try {
      const maybePromise = audioContext.decodeAudioData(safeBuffer, onResolve, onReject);
      if (maybePromise && typeof maybePromise.then === 'function') {
        maybePromise.then(resolve).catch(reject);
      }
    } catch (error) {
      reject(error);
    }
  });
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function isAxisLimited(axis) {
  return axis === 'horizontal' || axis === 'vertical';
}

function resolveBlockIdFromObject(object) {
  let current = object;
  while (current) {
    if (current.userData?.blockId) {
      return current.userData.blockId;
    }
    current = current.parent || null;
  }
  return '';
}

function drawRoundedRect(ctx, x, y, width, height, radius) {
  const safeRadius = Math.min(radius, width * 0.5, height * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + safeRadius, y);
  ctx.lineTo(x + width - safeRadius, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + safeRadius);
  ctx.lineTo(x + width, y + height - safeRadius);
  ctx.quadraticCurveTo(x + width, y + height, x + width - safeRadius, y + height);
  ctx.lineTo(x + safeRadius, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - safeRadius);
  ctx.lineTo(x, y + safeRadius);
  ctx.quadraticCurveTo(x, y, x + safeRadius, y);
  ctx.closePath();
}

function createRoundedRectShape(width, height, radius) {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const safeRadius = Math.min(radius, halfWidth, halfHeight);
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + safeRadius, -halfHeight);
  shape.lineTo(halfWidth - safeRadius, -halfHeight);
  shape.absarc(halfWidth - safeRadius, -halfHeight + safeRadius, safeRadius, -Math.PI * 0.5, 0, false);
  shape.lineTo(halfWidth, halfHeight - safeRadius);
  shape.absarc(halfWidth - safeRadius, halfHeight - safeRadius, safeRadius, 0, Math.PI * 0.5, false);
  shape.lineTo(-halfWidth + safeRadius, halfHeight);
  shape.absarc(-halfWidth + safeRadius, halfHeight - safeRadius, safeRadius, Math.PI * 0.5, Math.PI, false);
  shape.lineTo(-halfWidth, -halfHeight + safeRadius);
  shape.absarc(-halfWidth + safeRadius, -halfHeight + safeRadius, safeRadius, Math.PI, Math.PI * 1.5, false);
  shape.closePath();
  return shape;
}

function getRoundedPanelGeometry(geometryCache, key, width, height, depth, radius, options = {}) {
  if (!geometryCache.has(key)) {
    const bevelSize = Math.min(
      options.bevelSize ?? 0.05,
      radius * 0.5,
      width * 0.12,
      height * 0.12
    );
    const bevelThickness = Math.min(options.bevelThickness ?? depth * 0.24, depth * 0.45);
    const shape = createRoundedRectShape(width, height, radius);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      curveSegments: options.curveSegments ?? 10,
      steps: 1,
      bevelEnabled: bevelSize > 0.001,
      bevelSegments: options.bevelSegments ?? 3,
      bevelSize,
      bevelThickness,
    });
    geometry.rotateX(-Math.PI * 0.5);
    geometry.translate(0, -depth * 0.5, 0);
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}


function getRoundedTopPlateGeometry(geometryCache, key, width, height, radius, curveSegments = 20) {
  if (!geometryCache.has(key)) {
    const geometry = new THREE.ShapeGeometry(createRoundedRectShape(width, height, radius), curveSegments);
    geometry.rotateX(-Math.PI * 0.5);
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}

function createCorneredRectShape(width, height, radii = {}) {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const normalized = typeof radii === 'number'
    ? { tl: radii, tr: radii, br: radii, bl: radii }
    : {
        tl: radii.tl || 0,
        tr: radii.tr || 0,
        br: radii.br || 0,
        bl: radii.bl || 0,
      };
  const safe = {
    tl: Math.min(normalized.tl, halfWidth, halfHeight),
    tr: Math.min(normalized.tr, halfWidth, halfHeight),
    br: Math.min(normalized.br, halfWidth, halfHeight),
    bl: Math.min(normalized.bl, halfWidth, halfHeight),
  };

  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth + safe.tl, -halfHeight);
  shape.lineTo(halfWidth - safe.tr, -halfHeight);
  if (safe.tr > 0.0001) {
    shape.absarc(halfWidth - safe.tr, -halfHeight + safe.tr, safe.tr, -Math.PI * 0.5, 0, false);
  } else {
    shape.lineTo(halfWidth, -halfHeight);
  }
  shape.lineTo(halfWidth, halfHeight - safe.br);
  if (safe.br > 0.0001) {
    shape.absarc(halfWidth - safe.br, halfHeight - safe.br, safe.br, 0, Math.PI * 0.5, false);
  } else {
    shape.lineTo(halfWidth, halfHeight);
  }
  shape.lineTo(-halfWidth + safe.bl, halfHeight);
  if (safe.bl > 0.0001) {
    shape.absarc(-halfWidth + safe.bl, halfHeight - safe.bl, safe.bl, Math.PI * 0.5, Math.PI, false);
  } else {
    shape.lineTo(-halfWidth, halfHeight);
  }
  shape.lineTo(-halfWidth, -halfHeight + safe.tl);
  if (safe.tl > 0.0001) {
    shape.absarc(-halfWidth + safe.tl, -halfHeight + safe.tl, safe.tl, Math.PI, Math.PI * 1.5, false);
  } else {
    shape.lineTo(-halfWidth, -halfHeight);
  }
  shape.closePath();
  return shape;
}

function getCorneredPanelGeometry(geometryCache, key, width, height, depth, radii, options = {}) {
  if (!geometryCache.has(key)) {
    const radiusValues = typeof radii === 'number'
      ? [radii]
      : [radii.tl || 0, radii.tr || 0, radii.br || 0, radii.bl || 0];
    const maxRadius = Math.max(0, ...radiusValues);
    const bevelSize = Math.min(
      options.bevelSize ?? 0.05,
      maxRadius * 0.5,
      width * 0.12,
      height * 0.12
    );
    const bevelThickness = Math.min(options.bevelThickness ?? depth * 0.24, depth * 0.45);
    const shape = createCorneredRectShape(width, height, radii);
    const geometry = new THREE.ExtrudeGeometry(shape, {
      depth,
      curveSegments: options.curveSegments ?? 10,
      steps: 1,
      bevelEnabled: bevelSize > 0.001,
      bevelSegments: options.bevelSegments ?? 3,
      bevelSize,
      bevelThickness,
    });
    geometry.rotateX(-Math.PI * 0.5);
    geometry.translate(0, -depth * 0.5, 0);
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}


function getCorneredTopPlateGeometry(geometryCache, key, width, height, radii, curveSegments = 20) {
  if (!geometryCache.has(key)) {
    const geometry = new THREE.ShapeGeometry(createCorneredRectShape(width, height, radii), curveSegments);
    geometry.rotateX(-Math.PI * 0.5);
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}

function createQuarterCornerShape(size) {
  const half = size * 0.5;
  const shape = new THREE.Shape();
  shape.moveTo(-half, -half);
  shape.lineTo(half, -half);
  shape.lineTo(half, half);
  shape.absarc(half, -half, size, Math.PI * 0.5, Math.PI, false);
  shape.closePath();
  return shape;
}

function getQuarterCornerGeometry(geometryCache, key, size, depth, options = {}) {
  if (!geometryCache.has(key)) {
    const bevelSize = Math.min(options.bevelSize ?? 0.04, size * 0.14, depth * 0.28);
    const bevelThickness = Math.min(options.bevelThickness ?? depth * 0.22, depth * 0.42);
    const geometry = new THREE.ExtrudeGeometry(createQuarterCornerShape(size), {
      depth,
      curveSegments: options.curveSegments ?? 18,
      steps: 1,
      bevelEnabled: bevelSize > 0.001,
      bevelSegments: options.bevelSegments ?? 4,
      bevelSize,
      bevelThickness,
    });
    geometry.rotateX(-Math.PI * 0.5);
    geometry.translate(0, -depth * 0.5, 0);
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}


function getQuarterCornerTopPlateGeometry(geometryCache, key, size, curveSegments = 24) {
  if (!geometryCache.has(key)) {
    const geometry = new THREE.ShapeGeometry(createQuarterCornerShape(size), curveSegments);
    geometry.rotateX(-Math.PI * 0.5);
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}


function createToyEnvironmentMap(renderer) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  const sky = ctx.createLinearGradient(0, 0, 0, canvas.height);
  sky.addColorStop(0, '#c6f7ff');
  sky.addColorStop(0.24, '#9be2ff');
  sky.addColorStop(0.58, '#72c9f0');
  sky.addColorStop(1, '#f0d69b');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const drawGlow = (x, y, width, height, alpha) => {
    const gradient = ctx.createRadialGradient(x, y, 8, x, y, width * 0.5);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.42, `rgba(255,255,255,${alpha * 0.52})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.ellipse(x, y, width * 0.5, height * 0.5, 0, 0, Math.PI * 2);
    ctx.fill();
  };

  const drawStrip = (x, y, width, height, alpha, rotation = 0) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(rotation);
    const gradient = ctx.createLinearGradient(0, -height * 0.5, 0, height * 0.5);
    gradient.addColorStop(0, `rgba(255,255,255,${alpha * 0.05})`);
    gradient.addColorStop(0.2, `rgba(255,255,255,${alpha})`);
    gradient.addColorStop(0.55, `rgba(255,255,255,${alpha * 0.62})`);
    gradient.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = gradient;
    drawRoundedRect(ctx, -width * 0.5, -height * 0.5, width, height, Math.min(width, height) * 0.44);
    ctx.fill();
    ctx.restore();
  };

  drawGlow(94, 32, 180, 76, 0.38);
  drawGlow(286, 52, 224, 94, 0.28);
  drawGlow(438, 106, 158, 60, 0.16);
  drawGlow(244, 182, 312, 104, 0.14);

  drawStrip(112, 70, 54, 168, 0.34, -0.06);
  drawStrip(264, 84, 44, 156, 0.28, 0.04);
  drawStrip(388, 100, 56, 150, 0.24, 0.08);
  drawStrip(188, 46, 148, 28, 0.22, -0.08);

  const horizon = ctx.createLinearGradient(0, canvas.height * 0.54, 0, canvas.height);
  horizon.addColorStop(0, 'rgba(255, 255, 255, 0)');
  horizon.addColorStop(0.52, 'rgba(255, 242, 205, 0.18)');
  horizon.addColorStop(1, 'rgba(255, 218, 160, 0.4)');
  ctx.fillStyle = horizon;
  ctx.fillRect(0, canvas.height * 0.5, canvas.width, canvas.height * 0.5);

  ctx.strokeStyle = 'rgba(255,255,255,0.26)';
  ctx.lineWidth = 10;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(58, 92);
  ctx.quadraticCurveTo(164, 68, 300, 92);
  ctx.quadraticCurveTo(392, 108, 470, 90);
  ctx.stroke();

  const source = new THREE.CanvasTexture(canvas);
  source.colorSpace = THREE.SRGBColorSpace;
  source.mapping = THREE.EquirectangularReflectionMapping;
  source.needsUpdate = true;

  const pmremGenerator = new THREE.PMREMGenerator(renderer);
  pmremGenerator.compileEquirectangularShader?.();
  const renderTarget = pmremGenerator.fromEquirectangular(source);
  source.dispose();
  pmremGenerator.dispose();
  return renderTarget.texture;
}

function getToyEnvironmentMap(textureCache, renderer) {
  const key = 'toy-environment-map';
  if (!textureCache.has(key)) {
    textureCache.set(key, createToyEnvironmentMap(renderer));
  }
  return textureCache.get(key);
}

function createBoardGridTexture(cols, rows) {
  const cellSize = 128;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(64, cols * cellSize);
  canvas.height = Math.max(64, rows * cellSize);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#5d73b2';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  for (let row = 0; row < rows; row += 1) {
    for (let col = 0; col < cols; col += 1) {
      const inset = 7;
      const x = col * cellSize + inset;
      const y = row * cellSize + inset;
      const size = cellSize - inset * 2;
      const gradient = ctx.createLinearGradient(x, y, x, y + size);
      gradient.addColorStop(0, (row + col) % 2 === 0 ? '#8ba7f2' : '#7d98e9');
      gradient.addColorStop(1, (row + col) % 2 === 0 ? '#6f88d4' : '#6982cb');

      ctx.save();
      ctx.shadowColor = 'rgba(31, 53, 103, 0.28)';
      ctx.shadowBlur = 7;
      ctx.shadowOffsetY = 7;
      ctx.fillStyle = gradient;
      drawRoundedRect(ctx, x, y, size, size, 18);
      ctx.fill();
      ctx.restore();

      ctx.save();
      const sheen = ctx.createLinearGradient(x, y, x, y + size * 0.58);
      sheen.addColorStop(0, 'rgba(255, 255, 255, 0.26)');
      sheen.addColorStop(1, 'rgba(255, 255, 255, 0)');
      ctx.fillStyle = sheen;
      drawRoundedRect(ctx, x + 2, y + 2, size - 4, size * 0.58, 16);
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.strokeStyle = 'rgba(234, 242, 255, 0.78)';
      ctx.lineWidth = 3;
      drawRoundedRect(ctx, x + 1.5, y + 1.5, size - 3, size - 3, 16);
      ctx.stroke();
      ctx.restore();
    }
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  if (transparentBase) {
    texture.generateMipmaps = false;
    texture.minFilter = THREE.LinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.needsUpdate = true;
  }
  return texture;
}

function getBoardGridTexture(textureCache, cols, rows) {
  const key = `board-grid:${cols}x${rows}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, createBoardGridTexture(cols, rows));
  }
  return textureCache.get(key);
}


const LEGACY_STYLE_ALIASES = {
  'red-dot': 'red',
  'blue-stripe': 'blue',
  'green-triangle': 'green',
  'yellow-star': 'yellow',
  'neutral-wood': 'wood',
  'neutral-stone': 'stone',
};

const STYLE_LABELS = {
  red: '红色',
  blue: '蓝色',
  green: '绿色',
  yellow: '黄色',
  purple: '紫色',
  orange: '橙色',
  wood: '木块',
  stone: '石块',
  'metal-soft': '金属块',
  'red-dot': '红色',
  'blue-stripe': '蓝色',
  'green-triangle': '绿色',
  'yellow-star': '黄色',
  'neutral-wood': '木块',
  'neutral-stone': '石块',
};

const SHAPE_PRESETS = {
  mono: [{ x: 0, y: 0 }],
  'domino-h': [{ x: 0, y: 0 }, { x: 1, y: 0 }],
  'domino-v': [{ x: 0, y: 0 }, { x: 0, y: 1 }],
  'bar3-h': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }],
  'bar3-v': [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }],
  'square-2': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  'L-3': [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  'L-4': [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 0, y: 2 }, { x: 1, y: 2 }],
  'T-4': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }],
  'Z-4': [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  'S-4': [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
};


function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeStyleKey(styleKey) {
  return LEGACY_STYLE_ALIASES[styleKey] || styleKey || 'stone';
}

function getStyleDisplayName(styleKey) {
  return STYLE_LABELS[normalizeStyleKey(styleKey)] || styleKey;
}

function createRunSeed() {
  if (window.crypto?.getRandomValues) {
    const buffer = new Uint32Array(1);
    window.crypto.getRandomValues(buffer);
    return buffer[0] >>> 0;
  }
  return ((Date.now() & 0xffffffff) ^ Math.floor(Math.random() * 0xffffffff)) >>> 0;
}

function normalizeShapeCells(shapeCells) {
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

function createRectShape(width = 1, height = 1) {
  const cells = [];
  for (let y = 0; y < Math.max(1, height); y += 1) {
    for (let x = 0; x < Math.max(1, width); x += 1) {
      cells.push({ x, y });
    }
  }
  return cells;
}

function getShapeCells(source) {
  if (Array.isArray(source?.shapeCells) && source.shapeCells.length) {
    return normalizeShapeCells(source.shapeCells);
  }
  if (source?.shapePreset && SHAPE_PRESETS[source.shapePreset]) {
    return normalizeShapeCells(SHAPE_PRESETS[source.shapePreset]);
  }
  return normalizeShapeCells(createRectShape(source?.w || 1, source?.h || 1));
}

function getShapeBounds(shapeCells) {
  let maxX = 0;
  let maxY = 0;
  shapeCells.forEach((cell) => {
    maxX = Math.max(maxX, cell.x);
    maxY = Math.max(maxY, cell.y);
  });
  return {
    w: maxX + 1,
    h: maxY + 1,
  };
}

function inferShapePreset(shapeCells, bounds) {
  const cellCount = shapeCells.length;
  if (cellCount === 1) {
    return 'mono';
  }
  if (cellCount === 2 && bounds.w === 2 && bounds.h === 1) {
    return 'domino-h';
  }
  if (cellCount === 2 && bounds.w === 1 && bounds.h === 2) {
    return 'domino-v';
  }
  if (cellCount === 3 && bounds.w === 3 && bounds.h === 1) {
    return 'bar3-h';
  }
  if (cellCount === 3 && bounds.w === 1 && bounds.h === 3) {
    return 'bar3-v';
  }
  if (cellCount === 4 && bounds.w === 2 && bounds.h === 2) {
    return 'square-2';
  }
  return 'poly';
}

function getOccupiedCells(block, originX = block.x, originY = block.y) {
  return block.shapeCells.map((cell) => ({
    x: originX + cell.x,
    y: originY + cell.y,
  }));
}


function getPointKey(point) {
  return `${point.x},${point.y}`;
}

function makeEdgeKey(a, b) {
  const aKey = getPointKey(a);
  const bKey = getPointKey(b);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function simplifyLoopPoints(points) {
  if (points.length <= 2) {
    return points;
  }
  return points.filter((point, index, list) => {
    const prev = list[(index - 1 + list.length) % list.length];
    const next = list[(index + 1) % list.length];
    const vertical = prev.x === point.x && point.x === next.x;
    const horizontal = prev.y === point.y && point.y === next.y;
    return !(vertical || horizontal);
  });
}

function getLoopArea(points) {
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += (current.x * next.y) - (next.x * current.y);
  }
  return area * 0.5;
}

function getPolyominoOutline(shapeCells) {
  const edges = new Map();
  const registerEdge = (ax, ay, bx, by) => {
    const a = { x: ax, y: ay };
    const b = { x: bx, y: by };
    const key = makeEdgeKey(a, b);
    if (edges.has(key)) {
      edges.delete(key);
    } else {
      edges.set(key, { a, b });
    }
  };

  shapeCells.forEach((cell) => {
    registerEdge(cell.x, cell.y, cell.x + 1, cell.y);
    registerEdge(cell.x + 1, cell.y, cell.x + 1, cell.y + 1);
    registerEdge(cell.x + 1, cell.y + 1, cell.x, cell.y + 1);
    registerEdge(cell.x, cell.y + 1, cell.x, cell.y);
  });

  const adjacency = new Map();
  const linkPoint = (from, to) => {
    const key = getPointKey(from);
    if (!adjacency.has(key)) {
      adjacency.set(key, []);
    }
    adjacency.get(key).push(to);
  };

  edges.forEach(({ a, b }) => {
    linkPoint(a, b);
    linkPoint(b, a);
  });

  const start = [...adjacency.keys()]
    .map((key) => {
      const [x, y] = key.split(',').map(Number);
      return { x, y };
    })
    .sort((left, right) => (left.y - right.y) || (left.x - right.x))[0] || { x: 0, y: 0 };

  const firstNeighbors = [...(adjacency.get(getPointKey(start)) || [])].sort((left, right) => (left.x - right.x) || (left.y - right.y));
  if (!firstNeighbors.length) {
    return [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
  }

  const loop = [start];
  let prev = start;
  let current = firstNeighbors[0];
  let guard = 0;
  while (current && !(current.x === start.x && current.y === start.y) && guard < 256) {
    loop.push(current);
    const neighbors = adjacency.get(getPointKey(current)) || [];
    const next = (neighbors[0] && neighbors[0].x === prev.x && neighbors[0].y === prev.y) ? neighbors[1] : neighbors[0];
    prev = current;
    current = next || null;
    guard += 1;
  }

  const simplified = simplifyLoopPoints(loop);
  return getLoopArea(simplified) < 0 ? [...simplified].reverse() : simplified;
}

function getShapeSignature(shapeCells, bounds) {
  return `${bounds.w}x${bounds.h}:${shapeCells.map((cell) => `${cell.x},${cell.y}`).join(';')}`;
}

function isComplexPolyominoShape(shapeCells, bounds) {
  return (shapeCells?.length || 0) !== Math.max(1, (bounds?.w || 1) * (bounds?.h || 1));
}

function getCenteredPolyominoOutline(shapeCells, bounds) {
  return getPolyominoOutline(shapeCells).map((point) => new THREE.Vector2(
    (point.x - bounds.w * 0.5) * CELL_SIZE,
    (point.y - bounds.h * 0.5) * CELL_SIZE
  ));
}

function intersectInsetLines(lineAStart, lineAEnd, lineBStart, lineBEnd) {
  const x1 = lineAStart.x;
  const y1 = lineAStart.y;
  const x2 = lineAEnd.x;
  const y2 = lineAEnd.y;
  const x3 = lineBStart.x;
  const y3 = lineBStart.y;
  const x4 = lineBEnd.x;
  const y4 = lineBEnd.y;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(denom) < 0.000001) {
    return lineAEnd.clone();
  }
  const detA = x1 * y2 - y1 * x2;
  const detB = x3 * y4 - y3 * x4;
  return new THREE.Vector2(
    (detA * (x3 - x4) - (x1 - x2) * detB) / denom,
    (detA * (y3 - y4) - (y1 - y2) * detB) / denom
  );
}

function insetOrthogonalOutline(points, inset = BLOCK_FOOTPRINT_INSET) {
  if (!points.length) {
    return [];
  }
  if (inset <= 0.000001) {
    return points.map((point) => point.clone());
  }
  return points.map((current, index, list) => {
    const prev = list[(index - 1 + list.length) % list.length];
    const next = list[(index + 1) % list.length];
    const prevDir = current.clone().sub(prev).normalize();
    const nextDir = next.clone().sub(current).normalize();
    const prevNormal = new THREE.Vector2(-prevDir.y, prevDir.x).multiplyScalar(inset);
    const nextNormal = new THREE.Vector2(-nextDir.y, nextDir.x).multiplyScalar(inset);
    const prevOffsetStart = prev.clone().add(prevNormal);
    const prevOffsetEnd = current.clone().add(prevNormal);
    const nextOffsetStart = current.clone().add(nextNormal);
    const nextOffsetEnd = next.clone().add(nextNormal);
    return intersectInsetLines(prevOffsetStart, prevOffsetEnd, nextOffsetStart, nextOffsetEnd);
  });
}

function createRoundedShapeFromPoints(points, radius = BLOCK_CORNER_RADIUS) {
  const shape = new THREE.Shape();
  if (!points.length) {
    return shape;
  }

  const pointCount = points.length;
  const corners = [];
  for (let index = 0; index < pointCount; index += 1) {
    const prev = points[(index - 1 + pointCount) % pointCount];
    const current = points[index];
    const next = points[(index + 1) % pointCount];
    const edgeIn = current.clone().sub(prev);
    const edgeOut = next.clone().sub(current);
    const cross = edgeIn.x * edgeOut.y - edgeIn.y * edgeOut.x;
    const canRound = cross > 0.0001;
    if (!canRound) {
      corners.push({ point: current.clone(), start: current.clone(), end: current.clone(), rounded: false });
      continue;
    }
    const localRadius = Math.min(radius, edgeIn.length() * 0.46, edgeOut.length() * 0.46);
    if (localRadius <= 0.0001) {
      corners.push({ point: current.clone(), start: current.clone(), end: current.clone(), rounded: false });
      continue;
    }
    const dirIn = edgeIn.clone().normalize();
    const dirOut = edgeOut.clone().normalize();
    const start = current.clone().sub(dirIn.multiplyScalar(localRadius));
    const end = current.clone().add(dirOut.multiplyScalar(localRadius));
    corners.push({ point: current.clone(), start, end, rounded: true });
  }

  shape.moveTo(corners[0].start.x, corners[0].start.y);
  corners.forEach((corner, index) => {
    if (index > 0) {
      shape.lineTo(corner.start.x, corner.start.y);
    }
    if (corner.rounded) {
      shape.quadraticCurveTo(corner.point.x, corner.point.y, corner.end.x, corner.end.y);
    } else {
      shape.lineTo(corner.point.x, corner.point.y);
    }
  });
  shape.closePath();
  return shape;
}

function createRoundedPolyominoShape(shapeCells, bounds, radius = BLOCK_CORNER_RADIUS) {
  const rawOutline = getCenteredPolyominoOutline(shapeCells, bounds);
  const insetOutline = insetOrthogonalOutline(rawOutline, BLOCK_FOOTPRINT_INSET);
  return createRoundedShapeFromPoints(insetOutline, radius);
}

function getRoundedPolyominoPoints(shapeCells, bounds, radius = BLOCK_CORNER_RADIUS) {
  const shape = createRoundedPolyominoShape(shapeCells, bounds, radius);
  const points = shape.extractPoints(20).shape.map((point) => point.clone());
  if (points.length > 1 && points[0].distanceToSquared(points[points.length - 1]) < 0.000001) {
    points.pop();
  }
  return points;
}

function getFootprintUv(point, bounds) {
  const width = Math.max(0.0001, bounds.w * CELL_SIZE);
  const height = Math.max(0.0001, bounds.h * CELL_SIZE);
  return {
    u: clamp((point.x + width * 0.5) / width, 0, 1),
    v: clamp((point.y + height * 0.5) / height, 0, 1),
  };
}

function createSolidBlockGeometry(shapeCells, bounds) {
  const outline = getRoundedPolyominoPoints(shapeCells, bounds, BLOCK_CORNER_RADIUS);
  const ringSize = outline.length;
  if (!ringSize) {
    return new THREE.BoxGeometry(BLOCK_VISUAL_SCALE, BLOCK_HEIGHT, BLOCK_VISUAL_SCALE);
  }

  const halfHeight = BLOCK_HEIGHT * 0.5;
  const sideLayers = [
    { y: -halfHeight, scale: 1.0 },
    { y: -halfHeight + 0.055, scale: 1.018 },
    { y: -halfHeight + 0.14, scale: 1.03 },
    { y: halfHeight - 0.16, scale: 1.03 },
    { y: halfHeight - 0.075, scale: 1.014 },
    { y: halfHeight - 0.028, scale: 1.006 },
  ];
  const topCap = { y: halfHeight, scale: 1.006 };
  const bottomCap = { y: -halfHeight, scale: 1.0 };

  const positions = [];
  const uvs = [];
  const indices = [];
  const scaledRings = sideLayers.map((layer) => outline.map((point) => point.clone().multiplyScalar(layer.scale)));

  scaledRings.forEach((ring, layerIndex) => {
    ring.forEach((point) => {
      positions.push(point.x, sideLayers[layerIndex].y, point.y);
      uvs.push(0, 0);
    });
  });

  for (let layerIndex = 0; layerIndex < scaledRings.length - 1; layerIndex += 1) {
    const base = layerIndex * ringSize;
    const nextBase = (layerIndex + 1) * ringSize;
    for (let index = 0; index < ringSize; index += 1) {
      const nextIndex = (index + 1) % ringSize;
      const a = base + index;
      const b = base + nextIndex;
      const c = nextBase + nextIndex;
      const d = nextBase + index;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  const capTriangles = THREE.ShapeUtils.triangulateShape(outline, []);
  const sideIndexCount = indices.length;

  const topOffset = positions.length / 3;
  outline.forEach((point) => {
    positions.push(point.x * topCap.scale, topCap.y, point.y * topCap.scale);
    const uv = getFootprintUv(point, bounds);
    uvs.push(uv.u, uv.v);
  });
  capTriangles.forEach(([a, b, c]) => {
    indices.push(topOffset + a, topOffset + c, topOffset + b);
  });

  const topIndexCount = indices.length - sideIndexCount;
  const bottomOffset = positions.length / 3;
  outline.forEach((point) => {
    positions.push(point.x * bottomCap.scale, bottomCap.y, point.y * bottomCap.scale);
    const uv = getFootprintUv(point, bounds);
    uvs.push(uv.u, uv.v);
  });
  capTriangles.forEach(([a, b, c]) => {
    indices.push(bottomOffset + a, bottomOffset + b, bottomOffset + c);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.clearGroups();
  geometry.addGroup(0, sideIndexCount, 1);
  geometry.addGroup(sideIndexCount, topIndexCount, 0);
  geometry.addGroup(sideIndexCount + topIndexCount, indices.length - sideIndexCount - topIndexCount, 0);
  geometry.computeVertexNormals();
  return geometry;
}


const CONTACT_SHADOW_Y = 0.026;
const CONTACT_SHADOW_OUTER_SCALE = 1.2;
const CONTACT_SHADOW_INNER_SCALE = 1.08;
const CONTACT_SHADOW_OUTER_OPACITY = 0;
const CONTACT_SHADOW_INNER_OPACITY = 0.18;

function createContactShadowGeometry(shapeCells, bounds) {
  const shape = createRoundedPolyominoShape(shapeCells, bounds, BLOCK_CORNER_RADIUS - 0.02);
  const geometry = new THREE.ShapeGeometry(shape, 24);
  geometry.rotateX(-Math.PI * 0.5);
  geometry.scale(1.02, 1, 1.02);
  geometry.computeVertexNormals();
  return geometry;
}


function createPolyominoTopCapGeometry(shapeCells, bounds, scale = 1, radius = BLOCK_CORNER_RADIUS) {
  const shape = createRoundedPolyominoShape(shapeCells, bounds, radius);
  const geometry = new THREE.ShapeGeometry(shape, 24);
  geometry.rotateX(-Math.PI * 0.5);
  geometry.scale(scale, 1, scale);
  geometry.computeVertexNormals();
  return geometry;
}

function supportsStylizedTopCap(block) {
  return ['mono', 'domino-h', 'domino-v', 'bar3-h', 'bar3-v', 'square-2'].includes(block.shapePreset);
}

function syncContactShadowMeshes(view) {
  if (!view?.mesh) {
    return;
  }
  const lift = Math.max(0, view.mesh.position.y - BLOCK_HEIGHT * 0.5);
  const fade = lift > 0.03 ? 0 : clamp(1 - lift * 16, 0, 1);
  const spread = 1 + Math.min(lift, 0.02) * 1.8;
  const scaleX = (view.mesh.scale?.x || 1) * spread;
  const scaleZ = (view.mesh.scale?.z || 1) * spread;

  if (view.shadowOuter) {
    view.shadowOuter.position.set(view.mesh.position.x, CONTACT_SHADOW_Y, view.mesh.position.z);
    view.shadowOuter.scale.set(scaleX * CONTACT_SHADOW_OUTER_SCALE, 1, scaleZ * CONTACT_SHADOW_OUTER_SCALE);
    view.shadowOuter.material.opacity = CONTACT_SHADOW_OUTER_OPACITY * fade;
  }
  if (view.shadowInner) {
    view.shadowInner.position.set(view.mesh.position.x, CONTACT_SHADOW_Y + 0.002, view.mesh.position.z);
    view.shadowInner.scale.set(scaleX * CONTACT_SHADOW_INNER_SCALE, 1, scaleZ * CONTACT_SHADOW_INNER_SCALE);
    view.shadowInner.material.opacity = CONTACT_SHADOW_INNER_OPACITY * fade;
  }
}

function drawArrow(ctx, fromX, fromY, toX, toY, headSize) {
  const angle = Math.atan2(toY - fromY, toX - fromX);
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.lineTo(toX, toY);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - Math.cos(angle - Math.PI / 6) * headSize, toY - Math.sin(angle - Math.PI / 6) * headSize);
  ctx.moveTo(toX, toY);
  ctx.lineTo(toX - Math.cos(angle + Math.PI / 6) * headSize, toY - Math.sin(angle + Math.PI / 6) * headSize);
  ctx.stroke();
}

const TOY_EDGE_PALETTES = {
  top: ['#4365dd', '#9a58ee', '#2fcbbb', '#3aba62', '#4365dd', '#9a58ee', '#2fcbbb'],
  right: ['#35b65d', '#f0545f', '#f3cd49', '#35b65d', '#f0545f', '#f3cd49', '#35b65d'],
  bottom: ['#8f57ef', '#f28a33', '#f0c648', '#e94f57', '#26c1c7', '#8f57ef', '#f28a33'],
  left: ['#f2ca4a', '#28c5c3', '#ee5059', '#f2ca4a', '#28c5c3', '#ee5059', '#f2ca4a'],
};

function getToyEdgeColor(edge, index) {
  const palette = TOY_EDGE_PALETTES[edge] || TOY_EDGE_PALETTES.top;
  return palette[index % palette.length];
}

function drawTriangleMarker(ctx, direction, color = '#ffffff') {
  const centerX = 64;
  const centerY = 64;
  const size = 18;
  ctx.save();
  ctx.shadowColor = 'rgba(10, 24, 32, 0.28)';
  ctx.shadowBlur = 10;
  ctx.fillStyle = color;
  ctx.beginPath();
  if (direction === 'up') {
    ctx.moveTo(centerX, centerY - size);
    ctx.lineTo(centerX - size, centerY + size * 0.7);
    ctx.lineTo(centerX + size, centerY + size * 0.7);
  } else if (direction === 'down') {
    ctx.moveTo(centerX, centerY + size);
    ctx.lineTo(centerX - size, centerY - size * 0.7);
    ctx.lineTo(centerX + size, centerY - size * 0.7);
  } else if (direction === 'left') {
    ctx.moveTo(centerX - size, centerY);
    ctx.lineTo(centerX + size * 0.7, centerY - size);
    ctx.lineTo(centerX + size * 0.7, centerY + size);
  } else {
    ctx.moveTo(centerX + size, centerY);
    ctx.lineTo(centerX - size * 0.7, centerY - size);
    ctx.lineTo(centerX - size * 0.7, centerY + size);
  }
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function createEdgeArrowTexture(direction) {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawTriangleMarker(ctx, direction, '#ffffff');
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getEdgeArrowTexture(textureCache, direction) {
  const key = `edge-arrow:${direction}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, createEdgeArrowTexture(direction));
  }
  return textureCache.get(key);
}

function getExitForEdgeCell(exits, edge, index) {
  return exits.find((exit) => exit.edge === edge && index >= exit.start && index < exit.start + exit.span) || null;
}

function getStudGeometry(geometryCache) {
  const key = 'toy-stud';
  if (!geometryCache.has(key)) {
    const geometry = new THREE.CylinderGeometry(0.115, 0.115, 0.095, 30, 1, false);
    geometry.translate(0, 0.0475, 0);
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}

function createAxisOverlayTexture(axis, isLubricated = false) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.lineWidth = 16;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = isLubricated ? '#efffff' : '#ffffff';
  ctx.shadowColor = isLubricated ? 'rgba(108, 223, 239, 0.48)' : 'rgba(15, 34, 42, 0.28)';
  ctx.shadowBlur = 18;

  if (axis === 'horizontal' || axis === 'both') {
    drawArrow(ctx, 46, 128, 210, 128, 28);
    drawArrow(ctx, 210, 128, 46, 128, 28);
  }
  if (axis === 'vertical' || axis === 'both') {
    drawArrow(ctx, 128, 210, 128, 46, 28);
    drawArrow(ctx, 128, 46, 128, 210, 28);
  }

  if (isLubricated) {
    ctx.shadowBlur = 0;
    ctx.fillStyle = 'rgba(231, 255, 255, 0.3)';
    drawRoundedRect(ctx, 28, 28, 200, 200, 52);
    ctx.strokeStyle = 'rgba(232, 255, 255, 0.86)';
    ctx.lineWidth = 7;
    ctx.stroke();
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getAxisOverlayTexture(textureCache, axis, isLubricated = false) {
  const key = `axis-overlay:${axis}:${isLubricated ? 'wet' : 'dry'}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, createAxisOverlayTexture(axis, isLubricated));
  }
  return textureCache.get(key);
}

function createTopShadeTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = '#f8fbff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sweep = ctx.createLinearGradient(34, 28, 220, 214);
  sweep.addColorStop(0, 'rgba(255, 255, 255, 0)');
  sweep.addColorStop(0.4, 'rgba(255, 255, 255, 0)');
  sweep.addColorStop(0.8, 'rgba(42, 60, 96, 0.05)');
  sweep.addColorStop(1, 'rgba(18, 30, 52, 0.08)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const edgeShade = ctx.createRadialGradient(128, 128, 92, 128, 128, 160);
  edgeShade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edgeShade.addColorStop(0.78, 'rgba(0, 0, 0, 0)');
  edgeShade.addColorStop(0.94, 'rgba(17, 28, 52, 0.045)');
  edgeShade.addColorStop(1, 'rgba(12, 21, 38, 0.09)');
  ctx.fillStyle = edgeShade;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getTopShadeTexture(textureCache) {
  const key = 'block-top-shade';
  if (!textureCache.has(key)) {
    textureCache.set(key, createTopShadeTexture());
  }
  return textureCache.get(key);
}

function createTopGlossTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sweep = ctx.createLinearGradient(36, 30, 174, 160);
  sweep.addColorStop(0, 'rgba(255, 255, 255, 0.72)');
  sweep.addColorStop(0.12, 'rgba(255, 255, 255, 0.24)');
  sweep.addColorStop(0.28, 'rgba(255, 255, 255, 0.05)');
  sweep.addColorStop(0.46, 'rgba(255, 255, 255, 0.01)');
  sweep.addColorStop(0.64, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = sweep;
  drawRoundedRect(ctx, 26, 24, 126, 102, 40);
  ctx.fill();

  const hotspot = ctx.createRadialGradient(86, 72, 10, 86, 72, 54);
  hotspot.addColorStop(0, 'rgba(255, 255, 255, 0.56)');
  hotspot.addColorStop(0.24, 'rgba(255, 255, 255, 0.18)');
  hotspot.addColorStop(0.58, 'rgba(255, 255, 255, 0.03)');
  hotspot.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = hotspot;
  drawRoundedRect(ctx, 28, 24, 110, 90, 36);
  ctx.fill();

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getTopGlossTexture(textureCache) {
  const key = 'block-top-gloss';
  if (!textureCache.has(key)) {
    textureCache.set(key, createTopGlossTexture());
  }
  return textureCache.get(key);
}


function createBoardPlayfieldOverlayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(238, 214, 24, 256, 236, 244);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.024)');
  glow.addColorStop(0.38, 'rgba(255, 255, 255, 0.012)');
  glow.addColorStop(0.72, 'rgba(255, 255, 255, 0.003)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const edgeShade = ctx.createRadialGradient(256, 256, 176, 256, 256, 332);
  edgeShade.addColorStop(0, 'rgba(0, 0, 0, 0)');
  edgeShade.addColorStop(0.8, 'rgba(0, 0, 0, 0)');
  edgeShade.addColorStop(0.94, 'rgba(18, 33, 72, 0.032)');
  edgeShade.addColorStop(1, 'rgba(13, 25, 58, 0.06)');
  ctx.fillStyle = edgeShade;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getBoardPlayfieldOverlayTexture(textureCache) {
  const key = 'board-playfield-overlay';
  if (!textureCache.has(key)) {
    textureCache.set(key, createBoardPlayfieldOverlayTexture());
  }
  return textureCache.get(key);
}

function createBoardSlotOverlayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sweep = ctx.createLinearGradient(28, 30, 222, 218);
  sweep.addColorStop(0, 'rgba(255, 255, 255, 0.015)');
  sweep.addColorStop(0.24, 'rgba(255, 255, 255, 0.006)');
  sweep.addColorStop(0.58, 'rgba(255, 255, 255, 0.001)');
  sweep.addColorStop(1, 'rgba(19, 35, 79, 0.035)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const rim = ctx.createRadialGradient(128, 128, 96, 128, 128, 148);
  rim.addColorStop(0, 'rgba(0, 0, 0, 0)');
  rim.addColorStop(0.9, 'rgba(0, 0, 0, 0)');
  rim.addColorStop(1, 'rgba(17, 28, 68, 0.045)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getBoardSlotOverlayTexture(textureCache) {
  const key = 'board-slot-overlay';
  if (!textureCache.has(key)) {
    textureCache.set(key, createBoardSlotOverlayTexture());
  }
  return textureCache.get(key);
}

function createRailSurfaceOverlayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const sweep = ctx.createLinearGradient(28, 28, 212, 214);
  sweep.addColorStop(0, 'rgba(255, 255, 255, 0.11)');
  sweep.addColorStop(0.26, 'rgba(255, 255, 255, 0.045)');
  sweep.addColorStop(0.56, 'rgba(255, 255, 255, 0.008)');
  sweep.addColorStop(1, 'rgba(9, 16, 24, 0.14)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getRailSurfaceOverlayTexture(textureCache) {
  const key = 'rail-surface-overlay';
  if (!textureCache.has(key)) {
    textureCache.set(key, createRailSurfaceOverlayTexture());
  }
  return textureCache.get(key);
}

function createExitSurfaceOverlayTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const glow = ctx.createRadialGradient(92, 84, 12, 102, 94, 120);
  glow.addColorStop(0, 'rgba(255, 255, 255, 0.34)');
  glow.addColorStop(0.3, 'rgba(255, 255, 255, 0.16)');
  glow.addColorStop(0.66, 'rgba(255, 255, 255, 0.03)');
  glow.addColorStop(1, 'rgba(255, 255, 255, 0)');
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const sweep = ctx.createLinearGradient(18, 24, 222, 220);
  sweep.addColorStop(0, 'rgba(255, 255, 255, 0.24)');
  sweep.addColorStop(0.22, 'rgba(255, 255, 255, 0.11)');
  sweep.addColorStop(0.48, 'rgba(255, 255, 255, 0.02)');
  sweep.addColorStop(1, 'rgba(20, 32, 66, 0.16)');
  ctx.fillStyle = sweep;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 2;
  return texture;
}

function getExitSurfaceOverlayTexture(textureCache) {
  const key = 'exit-surface-overlay';
  if (!textureCache.has(key)) {
    textureCache.set(key, createExitSurfaceOverlayTexture());
  }
  return textureCache.get(key);
}

function createAxisBadge(block, textureCache) {
  const badgeAxis = block.isLubricated
    ? 'both'
    : (isAxisLimited(block.moveAxis) ? block.moveAxis : block.baseMoveAxis);
  if (!isAxisLimited(badgeAxis) && !(block.isLubricated && badgeAxis === 'both')) {
    return null;
  }
  const badge = new THREE.Mesh(
    new THREE.PlaneGeometry(Math.max(0.74, block.w * 0.82), Math.max(0.74, block.h * 0.82)),
    new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: getAxisOverlayTexture(textureCache, badgeAxis, !!block.isLubricated),
      transparent: true,
      opacity: 1,
      alphaTest: 0.001,
      depthWrite: false,
      depthTest: false,
    })
  );
  badge.rotation.x = -Math.PI * 0.5;
  badge.position.y = BLOCK_HEIGHT * 0.5 + 0.2;
  badge.renderOrder = 10;
  badge.userData.blockId = block.id;
  badge.userData.ignoreRaycast = true;
  badge.raycast = () => {};
  return badge;
}

function getMechanicAreaBounds(cells = []) {
  if (!Array.isArray(cells) || !cells.length) {
    return { minX: 0, minY: 0, maxX: 0, maxY: 0, w: 1, h: 1 };
  }
  const xs = cells.map((cell) => Number(cell?.x) || 0);
  const ys = cells.map((cell) => Number(cell?.y) || 0);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    minX,
    minY,
    maxX,
    maxY,
    w: maxX - minX + 1,
    h: maxY - minY + 1,
  };
}

function getMechanicMarkerDetailColor(styleKey = 'stone') {
  const config = STYLE_CONFIG[normalizeStyleKey(styleKey)] || STYLE_CONFIG.stone;
  return config.color || config.accent || '#ffffff';
}

function getMechanicMarkerSymbol(definition = {}, kind = 'tile') {
  if (kind === 'gate' && definition.type === 'one_way') {
    return {
      left: '←',
      right: '→',
      top: '↑',
      bottom: '↓',
    }[definition.allowDir] || '→';
  }
  const symbols = {
    key_pad: '◆',
    toggle_switch: '⟳',
    recolor: '●',
    ice: '✦',
    lock: '▣',
    toggle: '◎',
    one_way: '→',
  };
  return symbols[definition.type] || '●';
}

function getMechanicMarkerPalette(definition = {}, kind = 'tile') {
  if (kind === 'gate') {
    if (definition.type === 'lock') {
      return definition.open
        ? { base: '#e4bc63', edge: '#fff4d4', icon: '#624400' }
        : { base: '#8a5c14', edge: '#f7d788', icon: '#fff4d3' };
    }
    if (definition.type === 'toggle') {
      return definition.open
        ? { base: '#bf87ff', edge: '#f5eaff', icon: '#ffffff' }
        : { base: '#7a45e8', edge: '#eadbff', icon: '#ffffff' };
    }
    if (definition.type === 'one_way') {
      return { base: '#1998ff', edge: '#e7f7ff', icon: '#ffffff' };
    }
    return { base: '#5a6470', edge: '#f4f8ff', icon: '#ffffff' };
  }
  if (definition.type === 'key_pad') {
    return { base: '#8a5c14', edge: '#f7d788', icon: '#fff4d3' };
  }
  if (definition.type === 'toggle_switch') {
    return { base: '#7a45e8', edge: '#eadbff', icon: '#ffffff' };
  }
  if (definition.type === 'recolor') {
    const detailColor = getMechanicMarkerDetailColor(definition.toColor || definition.acceptColor || definition.style);
    return { base: detailColor, edge: '#ffffff', icon: '#ffffff' };
  }
  if (definition.type === 'ice') {
    return { base: '#97e5ff', edge: '#f1fdff', icon: '#29718e' };
  }
  return { base: '#6d7893', edge: '#edf3ff', icon: '#ffffff' };
}

function drawMechanicChevron(ctx, centerX, centerY, size, direction = 'right', color = '#ffffff', alpha = 1) {
  ctx.save();
  ctx.translate(centerX, centerY);
  const rotation = {
    right: 0,
    bottom: Math.PI * 0.5,
    left: Math.PI,
    top: -Math.PI * 0.5,
  }[direction] || 0;
  ctx.rotate(rotation);
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(-size * 0.55, -size * 0.42);
  ctx.lineTo(size * 0.16, -size * 0.42);
  ctx.lineTo(size * 0.62, 0);
  ctx.lineTo(size * 0.16, size * 0.42);
  ctx.lineTo(-size * 0.55, size * 0.42);
  ctx.lineTo(-size * 0.06, 0);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

function drawLockGlyph(ctx, centerX, centerY, scale = 1, color = '#ffffff') {
  const bodyW = 56 * scale;
  const bodyH = 44 * scale;
  const bodyX = centerX - bodyW * 0.5;
  const bodyY = centerY - bodyH * 0.08;
  ctx.save();
  ctx.fillStyle = color;
  drawRoundedRect(ctx, bodyX, bodyY, bodyW, bodyH, 12 * scale);
  ctx.fill();
  ctx.lineWidth = 10 * scale;
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(centerX, bodyY + 6 * scale, 20 * scale, Math.PI, 0);
  ctx.stroke();
  ctx.restore();
}

function drawSwitchGlyph(ctx, centerX, centerY, scale = 1, color = '#ffffff') {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 9 * scale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(centerX, centerY, 28 * scale, Math.PI * 0.18, Math.PI * 1.82);
  ctx.stroke();
  drawMechanicChevron(ctx, centerX + 20 * scale, centerY - 15 * scale, 22 * scale, 'right', color, 1);
  drawMechanicChevron(ctx, centerX - 20 * scale, centerY + 15 * scale, 22 * scale, 'left', color, 1);
  ctx.restore();
}

function drawIceGlyph(ctx, centerX, centerY, scale = 1, color = '#ffffff', shadowColor = 'rgba(13,36,48,0.24)') {
  const drawLayer = (offsetX, offsetY, fillStyle, alpha = 1) => {
    const outer = 54 * scale;
    const inner = 18 * scale;
    const diagonalOuter = 36 * scale;
    const diagonalInner = 12 * scale;
    ctx.save();
    ctx.translate(centerX + offsetX, centerY + offsetY);
    ctx.fillStyle = fillStyle;
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    ctx.moveTo(0, -outer);
    ctx.lineTo(inner, -inner);
    ctx.lineTo(diagonalOuter, -diagonalInner);
    ctx.lineTo(inner, 0);
    ctx.lineTo(diagonalOuter, diagonalInner);
    ctx.lineTo(inner, inner);
    ctx.lineTo(0, outer);
    ctx.lineTo(-inner, inner);
    ctx.lineTo(-diagonalOuter, diagonalInner);
    ctx.lineTo(-inner, 0);
    ctx.lineTo(-diagonalOuter, -diagonalInner);
    ctx.lineTo(-inner, -inner);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, 11 * scale, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  };

  drawLayer(4 * scale, 5 * scale, shadowColor, 0.82);
  drawLayer(0, 0, color, 1);
}

function drawKeyPadGlyph(ctx, centerX, centerY, scale = 1, color = '#ffffff') {
  ctx.save();
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(centerX - 6 * scale, centerY - 8 * scale, 16 * scale, 0, Math.PI * 2);
  ctx.fill();
  drawRoundedRect(ctx, centerX + 2 * scale, centerY - 11 * scale, 42 * scale, 10 * scale, 5 * scale);
  ctx.fill();
  drawRoundedRect(ctx, centerX + 28 * scale, centerY - 24 * scale, 8 * scale, 14 * scale, 3 * scale);
  ctx.fill();
  drawRoundedRect(ctx, centerX + 14 * scale, centerY - 2 * scale, 8 * scale, 14 * scale, 3 * scale);
  ctx.fill();
  ctx.restore();
}

function drawToggleGateGlyph(ctx, centerX, centerY, scale = 1, color = '#ffffff', open = false) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 8 * scale;
  ctx.lineCap = 'round';
  const offsets = open ? [-22, 22] : [-24, 0, 24];
  offsets.forEach((offset) => {
    ctx.beginPath();
    ctx.moveTo(centerX + offset * scale, centerY - 24 * scale);
    ctx.lineTo(centerX + offset * scale, centerY + 24 * scale);
    ctx.stroke();
  });
  ctx.restore();
}

function drawRecolorGlyph(ctx, centerX, centerY, scale = 1, targetColor = '#ff6252') {
  const bucketCenterX = centerX;
  const bucketTopY = centerY - 42 * scale;
  const bucketBottomY = centerY + 28 * scale;
  const bucketTopW = 86 * scale;
  const bucketBottomW = 58 * scale;
  const halfTop = bucketTopW * 0.5;
  const halfBottom = bucketBottomW * 0.5;

  ctx.save();
  ctx.shadowColor = 'rgba(12, 30, 44, 0.24)';
  ctx.shadowBlur = 12 * scale;
  ctx.shadowOffsetY = 5 * scale;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 9 * scale;
  ctx.beginPath();
  ctx.moveTo(bucketCenterX - halfTop, bucketTopY);
  ctx.lineTo(bucketCenterX + halfTop, bucketTopY);
  ctx.lineTo(bucketCenterX + halfBottom, bucketBottomY);
  ctx.lineTo(bucketCenterX - halfBottom, bucketBottomY);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.shadowColor = 'transparent';

  ctx.fillStyle = targetColor;
  ctx.beginPath();
  ctx.ellipse(bucketCenterX, bucketTopY + 6 * scale, 28 * scale, 10 * scale, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 7 * scale;
  ctx.beginPath();
  ctx.arc(bucketCenterX, centerY - 14 * scale, 48 * scale, Math.PI * 1.06, Math.PI * 1.94);
  ctx.stroke();
  ctx.restore();
}

function createMechanicMarkerTexture(definition = {}, kind = 'tile', options = {}) {
  const spanX = Math.max(1, Math.floor(options.spanX || 1));
  const spanY = Math.max(1, Math.floor(options.spanY || 1));
  const transparentBase = options.transparentBase === true;
  const unit = 132;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(220, Math.min(1024, spanX * unit));
  canvas.height = Math.max(220, Math.min(1024, spanY * unit));
  const ctx = canvas.getContext('2d');
  const palette = getMechanicMarkerPalette(definition, kind);
  const width = canvas.width;
  const height = canvas.height;
  const pad = Math.max(18, Math.min(width, height) * 0.08);
  const innerW = width - pad * 2;
  const innerH = height - pad * 2;
  const radius = Math.max(18, Math.min(innerW, innerH) * (kind === 'gate' ? 0.18 : 0.24));
  ctx.clearRect(0, 0, width, height);

  if (!transparentBase) {
    const fill = ctx.createLinearGradient(pad, pad, width - pad, height - pad);
    fill.addColorStop(0, palette.edge);
    fill.addColorStop(kind === 'gate' ? 0.14 : 0.24, palette.base);
    fill.addColorStop(1, palette.base);
    ctx.fillStyle = fill;
    drawRoundedRect(ctx, pad, pad, innerW, innerH, radius);
    ctx.fill();

    ctx.strokeStyle = kind === 'gate' ? 'rgba(255,255,255,0.88)' : 'rgba(255,255,255,0.94)';
    ctx.lineWidth = kind === 'gate' ? 10 : 8;
    drawRoundedRect(ctx, pad + 4, pad + 4, innerW - 8, innerH - 8, Math.max(16, radius - 4));
    ctx.stroke();

    const sheen = ctx.createLinearGradient(pad, pad, pad, pad + innerH * 0.5);
    sheen.addColorStop(0, 'rgba(255,255,255,0.34)');
    sheen.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = sheen;
    drawRoundedRect(ctx, pad + 12, pad + 8, innerW - 24, innerH * 0.34, Math.max(12, radius - 12));
    ctx.fill();
  }

  const centerX = width * 0.5;
  const centerY = height * 0.5;
  const scale = Math.min(width / 256, height / 256);

  if (kind === 'gate' && definition.type === 'one_way') {
    const count = Math.max(2, spanX >= spanY ? spanX : spanY);
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const x = spanX >= spanY ? (pad + innerW * (0.14 + t * 0.72)) : centerX;
      const y = spanY > spanX ? (pad + innerH * (0.14 + t * 0.72)) : centerY;
      drawMechanicChevron(ctx, x, y, 34 * scale, definition.allowDir || 'right', '#ffffff', index === Math.floor(count / 2) ? 1 : 0.72);
    }
  } else if (kind === 'gate' && definition.type === 'lock') {
    const count = Math.max(2, Math.min(4, spanX >= spanY ? spanX : spanY));
    for (let index = 0; index < count; index += 1) {
      const t = count === 1 ? 0.5 : index / (count - 1);
      const x = spanX >= spanY ? (pad + innerW * (0.18 + t * 0.64)) : centerX;
      const y = spanY > spanX ? (pad + innerH * (0.18 + t * 0.64)) : centerY;
      drawLockGlyph(ctx, x, y, 0.7 * scale, '#fff5d3');
    }
  } else if (kind === 'gate' && definition.type === 'toggle') {
    drawToggleGateGlyph(ctx, centerX, centerY, 1 * scale, '#ffffff', !!definition.open);
    drawSwitchGlyph(ctx, centerX, centerY, 0.74 * scale, '#ffffff');
  } else if (definition.type === 'key_pad') {
    drawKeyPadGlyph(ctx, centerX + 2 * scale, centerY + 3 * scale, 1.08 * scale, 'rgba(13,36,48,0.34)');
    drawKeyPadGlyph(ctx, centerX, centerY, 1.08 * scale, '#ffffff');
  } else if (definition.type === 'toggle_switch') {
    drawSwitchGlyph(ctx, centerX + 2 * scale, centerY + 3 * scale, 1.02 * scale, 'rgba(13,36,48,0.34)');
    drawSwitchGlyph(ctx, centerX, centerY, 1.02 * scale, '#ffffff');
  } else if (definition.type === 'recolor') {
    drawRecolorGlyph(ctx, centerX, centerY, 1.02 * scale, getMechanicMarkerDetailColor(definition.toColor || definition.acceptColor || definition.style));
  } else if (definition.type === 'ice') {
    drawIceGlyph(ctx, centerX, centerY, 0.92 * scale, '#ffffff', 'rgba(13,36,48,0.26)');
  } else {
    ctx.fillStyle = palette.icon;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `900 ${Math.round(112 * scale)}px 'Arial Unicode MS', 'PingFang SC', sans-serif`;
    ctx.fillText(getMechanicMarkerSymbol(definition, kind), centerX, centerY + 8 * scale);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 4;
  return texture;
}

function getMechanicMarkerTexture(textureCache, definition = {}, kind = 'tile', options = {}) {
  const spanX = Math.max(1, Math.floor(options.spanX || 1));
  const spanY = Math.max(1, Math.floor(options.spanY || 1));
  const detail = kind === 'gate'
    ? `${definition.type}:${definition.allowDir || ''}:${definition.open ? 1 : 0}:${spanX}x${spanY}`
    : `${definition.type}:${definition.toColor || definition.acceptColor || definition.style || ''}:${spanX}x${spanY}`;
  const key = `mechanic-marker:${kind}:${detail}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, createMechanicMarkerTexture(definition, kind, { spanX, spanY }));
  }
  return textureCache.get(key);
}

function getMechanicGlyphTexture(textureCache, definition = {}, kind = 'tile', options = {}) {
  const spanX = Math.max(1, Math.floor(options.spanX || 1));
  const spanY = Math.max(1, Math.floor(options.spanY || 1));
  const detail = kind === 'gate'
    ? `${definition.type}:${definition.allowDir || ''}:${definition.open ? 1 : 0}:${spanX}x${spanY}`
    : `${definition.type}:${definition.toColor || definition.acceptColor || definition.style || ''}:${spanX}x${spanY}`;
  const key = `mechanic-glyph:${kind}:${detail}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, createMechanicMarkerTexture(definition, kind, {
      spanX,
      spanY,
      transparentBase: true,
    }));
  }
  return textureCache.get(key);
}

function createMechanicBillboardTexture(definition = {}, options = {}) {
  const spanX = Math.max(1, Math.floor(options.spanX || 1));
  const spanY = Math.max(1, Math.floor(options.spanY || 1));
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (definition.type === 'key_pad') {
    ctx.font = "900 178px 'Apple Color Emoji', 'Segoe UI Emoji', 'PingFang SC', sans-serif";
    ctx.fillStyle = 'rgba(8,22,32,0.34)';
    ctx.fillText('🔑', 134, 138);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('🔑', 128, 132);
  } else if (definition.type === 'toggle_switch') {
    ctx.font = "900 176px 'Avenir Next', 'PingFang SC', sans-serif";
    ctx.fillStyle = 'rgba(8,22,32,0.34)';
    ctx.fillText('⇄', 134, 138);
    ctx.fillStyle = '#ffffff';
    ctx.fillText('⇄', 128, 132);
  } else if (definition.type === 'recolor') {
    drawRecolorGlyph(ctx, 128, 138, 0.88, getMechanicMarkerDetailColor(definition.toColor || definition.acceptColor || definition.style));
  } else if (definition.type === 'ice') {
    drawIceGlyph(ctx, 128, 130, 0.46, '#ffffff', 'rgba(29,98,126,0.28)');
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.26)';
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(58, 82);
    ctx.lineTo(198, 82);
    ctx.moveTo(46, 186);
    ctx.lineTo(210, 186);
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.font = "900 132px 'Arial Unicode MS', 'PingFang SC', sans-serif";
    ctx.fillStyle = '#ffffff';
    ctx.fillText(getMechanicMarkerSymbol(definition, 'tile'), 128, 132);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function getMechanicBillboardTexture(textureCache, definition = {}, options = {}) {
  const spanX = Math.max(1, Math.floor(options.spanX || 1));
  const spanY = Math.max(1, Math.floor(options.spanY || 1));
  const key = `mechanic-billboard:${definition.type || 'tile'}:${definition.toColor || definition.acceptColor || definition.style || ''}:${spanX}x${spanY}`;
  if (!textureCache.has(key)) {
    textureCache.set(key, createMechanicBillboardTexture(definition, { spanX, spanY }));
  }
  return textureCache.get(key);
}

function isEmbeddedMechanicTile(definition = {}) {
  return definition.type === 'key_pad' || definition.type === 'toggle_switch' || definition.type === 'recolor';
}

function isBoardReplacingMechanicTile(definition = {}) {
  return isEmbeddedMechanicTile(definition) || definition.type === 'ice';
}

function getMechanicCellKeySet(definitions = [], predicate = null) {
  const keys = new Set();
  (definitions || []).forEach((definition) => {
    if (predicate && !predicate(definition)) {
      return;
    }
    (definition.cells || []).forEach((cell) => {
      keys.add(`${cell.x},${cell.y}`);
    });
  });
  return keys;
}

function getMechanicGateOpacity(definition = {}) {
  if (definition.type === 'one_way') {
    return 1;
  }
  if (definition.type === 'lock') {
    return definition.open ? 0.34 : 0.96;
  }
  if (definition.type === 'toggle') {
    return definition.open ? 0.38 : 0.94;
  }
  return 0.9;
}

function isSinkableGateType(type = '') {
  return type === 'lock' || type === 'toggle';
}

function getMechanicGateTargetYOffset(viewLike = {}, open = false) {
  if (!isSinkableGateType(viewLike.type)) {
    return 0;
  }
  const travel = Math.max(0.56, Number(viewLike.travelDepth) || 0.64);
  return open ? -travel : 0;
}

function createArrowIconShape(width = 0.16, height = 0.12) {
  const halfWidth = width * 0.5;
  const halfHeight = height * 0.5;
  const shaftHalf = height * 0.22;
  const headX = halfWidth - height * 0.44;
  const shape = new THREE.Shape();
  shape.moveTo(-halfWidth, -shaftHalf);
  shape.lineTo(headX, -shaftHalf);
  shape.lineTo(headX, -halfHeight);
  shape.lineTo(halfWidth, 0);
  shape.lineTo(headX, halfHeight);
  shape.lineTo(headX, shaftHalf);
  shape.lineTo(-halfWidth, shaftHalf);
  shape.closePath();
  return shape;
}

function getArrowIconGeometry(geometryCache, key = 'mechanic-arrow-icon') {
  if (!geometryCache.has(key)) {
    const geometry = new THREE.ShapeGeometry(createArrowIconShape(0.16, 0.12), 12);
    geometry.rotateX(-Math.PI * 0.5);
    geometry.computeVertexNormals();
    geometryCache.set(key, geometry);
  }
  return geometryCache.get(key);
}

function createEmbeddedMechanicIcon(definition = {}, geometryCache, textureCache = null) {
  const createIconMaterial = () => new THREE.MeshPhongMaterial({
    color: '#ffffff',
    emissive: new THREE.Color('#ffffff').multiplyScalar(0.18),
    specular: new THREE.Color('#ffffff').multiplyScalar(0.76),
    shininess: 120,
    toneMapped: false,
  });

  if (definition.type === 'key_pad') {
    const group = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.075, 0.024, 14, 28), createIconMaterial());
    ring.rotation.x = Math.PI * 0.5;
    ring.position.set(-0.07, 0, 0);
    group.add(ring);

    const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.022, 0.05), createIconMaterial());
    shaft.position.set(0.05, 0, 0);
    group.add(shaft);

    const toothA = new THREE.Mesh(new THREE.BoxGeometry(0.045, 0.022, 0.038), createIconMaterial());
    toothA.position.set(0.13, 0, 0.044);
    group.add(toothA);

    const toothB = new THREE.Mesh(new THREE.BoxGeometry(0.036, 0.022, 0.032), createIconMaterial());
    toothB.position.set(0.08, 0, -0.04);
    group.add(toothB);
    group.scale.setScalar(1.5);
    return group;
  }

  if (definition.type === 'toggle_switch') {
    const group = new THREE.Group();
    const bezelMaterial = new THREE.MeshPhongMaterial({
      color: '#f4fbff',
      emissive: new THREE.Color('#ffffff').multiplyScalar(0.1),
      specular: new THREE.Color('#ffffff').multiplyScalar(0.9),
      shininess: 150,
      toneMapped: false,
    });
    const capMaterial = new THREE.MeshPhongMaterial({
      color: '#ffffff',
      emissive: new THREE.Color('#ffffff').multiplyScalar(0.18),
      specular: new THREE.Color('#ffffff').multiplyScalar(1),
      shininess: 170,
      toneMapped: false,
    });
    const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.106, 0.024, 28), bezelMaterial);
    bezel.position.y = 0.006;
    group.add(bezel);

    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.072, 0.078, 0.042, 28), capMaterial);
    button.position.y = 0.026;
    group.add(button);

    const highlight = new THREE.Mesh(new THREE.CylinderGeometry(0.046, 0.05, 0.012, 24), new THREE.MeshPhongMaterial({
      color: '#ffffff',
      emissive: new THREE.Color('#ffffff').multiplyScalar(0.24),
      specular: new THREE.Color('#ffffff').multiplyScalar(1),
      shininess: 200,
      transparent: true,
      opacity: 0.94,
      toneMapped: false,
    }));
    highlight.position.y = 0.05;
    group.add(highlight);
    group.scale.setScalar(2);
    return group;
  }

  if (definition.type === 'recolor') {
    const group = new THREE.Group();
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: getMechanicBillboardTexture(textureCache, { ...definition, type: 'recolor' }),
      transparent: true,
      depthWrite: false,
      toneMapped: false,
    }));
    sprite.scale.set(1.18, 1.18, 1);
    group.add(sprite);
    return group;
  }

  return null;
}

function applyGateViewVisualState(view, open, offsetY = null) {
  if (!view) {
    return;
  }
  const targetY = Number.isFinite(offsetY) ? offsetY : getMechanicGateTargetYOffset(view, open);
  const bodyOpacity = getMechanicGateOpacity({ type: view.type, open });
  if (view.group) {
    view.group.position.y = targetY;
  }
  if (view.body?.material) {
    view.body.material.transparent = bodyOpacity < 0.985;
    view.body.material.opacity = bodyOpacity;
    if (view.body.material.emissive) {
      view.body.material.emissive.copy(view.baseColor.clone().multiplyScalar(open ? 0.14 : 0.05));
    }
    view.body.castShadow = bodyOpacity >= 0.72;
  }
  if (view.topPlate?.material) {
    view.topPlate.material.opacity = isSinkableGateType(view.type) ? (open ? 0 : 1) : 1;
  }
  view.open = !!open;
}
const TOY_STYLE_PALETTES = {
  red: { top: '#ff4d41', inset: '#ff887a', side: '#d72419', stud: '#b1150d', exit: '#ff5649', exitInset: '#ff9082' },
  blue: { top: '#17b8ff', inset: '#78e0ff', side: '#056fe0', stud: '#014cb5', exit: '#21beff', exitInset: '#84e5ff' },
  green: { top: '#57da31', inset: '#9bf26e', side: '#2eaf12', stud: '#1b8b0a', exit: '#61e03a', exitInset: '#a4f77a' },
  yellow: { top: '#ffd93a', inset: '#ffef84', side: '#f0a20a', stud: '#c97d00', exit: '#ffdb41', exitInset: '#fff18c' },
  purple: { top: '#9d50ff', inset: '#ca8dff', side: '#711fdf', stud: '#500eb7', exit: '#a557ff', exitInset: '#d298ff' },
  orange: { top: '#ff9b12', inset: '#ffc667', side: '#e36a00', stud: '#b94b00', exit: '#ffa319', exitInset: '#ffcd73' },
  wood: { top: '#d5ad4c', inset: '#ecd28b', side: '#a7751b', stud: '#7a5107', exit: '#dfb552', exitInset: '#f1d891' },
  stone: { top: '#8caabb', inset: '#bfd6df', side: '#5b7482', stud: '#445764', exit: '#93b2c4', exitInset: '#c7dde6' },
  'metal-soft': { top: '#82abbf', inset: '#bbd6e4', side: '#567687', stud: '#415c6b', exit: '#89b3c9', exitInset: '#c4dce7' },
  'red-dot': { top: '#ff5851', inset: '#ff938c', side: '#d6352e', stud: '#b71f18', exit: '#ff625a', exitInset: '#ff9c95' },
  'blue-stripe': { top: '#26c1ff', inset: '#7be1ff', side: '#0a84db', stud: '#0563b2', exit: '#30c7ff', exitInset: '#88e7ff' },
  'green-triangle': { top: '#5fe046', inset: '#a1f27d', side: '#39b524', stud: '#248e15', exit: '#67e74f', exitInset: '#abf586' },
  'yellow-star': { top: '#ffd94b', inset: '#fff08b', side: '#e3a614', stud: '#be8605', exit: '#ffdc52', exitInset: '#fff194' },
};

function getBoostedToyColor(styleKey, saturationBoost = 0.1, lightnessBoost = 0, variant = 'top') {
  const normalized = normalizeStyleKey(styleKey);
  const palette = TOY_STYLE_PALETTES[normalized];
  if (palette?.[variant]) {
    return new THREE.Color(palette[variant]);
  }
  const config = STYLE_CONFIG[normalized] || STYLE_CONFIG.stone;
  return new THREE.Color(config.color).offsetHSL(0, saturationBoost, lightnessBoost);
}

function createBlockMaterials(styleKey, textureCache, options = {}) {
  const topColor = getBoostedToyColor(styleKey, 0.24, -0.008, 'top');
  const sideColor = getBoostedToyColor(styleKey, 0.2, -0.05, 'side');
  const studColor = topColor.clone().offsetHSL(0, -0.015, -0.02);
  const surface = new THREE.MeshBasicMaterial({
    color: topColor,
    map: getTopShadeTexture(textureCache),
    toneMapped: false,
  });
  const side = new THREE.MeshPhongMaterial({
    color: sideColor,
    emissive: sideColor.clone().multiplyScalar(0.03),
    specular: new THREE.Color('#fff8ea').multiplyScalar(0.26),
    shininess: 32,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
  const stud = new THREE.MeshPhongMaterial({
    color: studColor,
    emissive: studColor.clone().multiplyScalar(0.06),
    specular: new THREE.Color('#fffef3').multiplyScalar(0.58),
    shininess: 118,
    toneMapped: false,
  });
  return { surface, side, stud, cap: null, gloss: null };
}

function normalizeBlock(block) {
  const moveAxis = block.moveAxis || 'both';
  const style = normalizeStyleKey(block.style);
  const shapeCells = getShapeCells(block);
  const bounds = getShapeBounds(shapeCells);
  return {
    id: block.id,
    role: block.role === 'blocker' ? 'blocker' : 'target',
    style,
    x: block.x,
    y: block.y,
    w: bounds.w,
    h: bounds.h,
    shapePreset: block.shapePreset || inferShapePreset(shapeCells, bounds),
    shapeCells,
    moveAxis,
    baseMoveAxis: block.baseMoveAxis || moveAxis,
    isLubricated: !!block.isLubricated,
  };
}


function createRuntimeLogicLevel(level) {
  return normalizeLevelStatic({
    ...deepClone(level),
    exits: (level.exits || []).map((exit) => ({
      ...deepClone(exit),
      acceptColor: normalizeStyleKey(exit.acceptColor || exit.acceptStyle || exit.style),
    })),
    blocks: (level.blocks || []).map((block) => ({
      ...deepClone(block),
      style: normalizeStyleKey(block.style),
      flags: {
        ...(deepClone(block.flags || {})),
        isLubricated: !!block.isLubricated,
      },
    })),
    tiles: (level.tiles || []).map((tile) => ({
      ...deepClone(tile),
      toColor: tile.toColor ? normalizeStyleKey(tile.toColor) : tile.toColor,
      acceptColor: tile.acceptColor ? normalizeStyleKey(tile.acceptColor) : tile.acceptColor,
      style: tile.style ? normalizeStyleKey(tile.style) : tile.style,
    })),
    gates: deepClone(level.gates || []),
    session: deepClone(level.session || {}),
  });
}

function rebuildRuntimeLogicState(level, stateOverride = null) {
  if (!level) {
    return null;
  }
  const logicBaseLevel = level.logicBaseLevel || createRuntimeLogicLevel(level);
  level.logicBaseLevel = logicBaseLevel;
  if (stateOverride) {
    level.logicState = cloneLevelState(stateOverride);
    return level.logicState;
  }
  const seedBlocks = (level.blocks || []).map((block) => ({
    ...deepClone(block),
    style: normalizeStyleKey(block.style),
    flags: {
      ...(deepClone(block.flags || {})),
      isLubricated: !!block.isLubricated,
    },
  }));
  level.logicState = createInitialLevelState({
    ...logicBaseLevel,
    blocks: seedBlocks,
    gates: deepClone(level.gates || []),
    session: deepClone(level.session || logicBaseLevel.session || {}),
  });
  return level.logicState;
}

function syncRuntimeLevelFromLogic(level, options = {}) {
  if (!level) {
    return null;
  }
  if (!level.logicBaseLevel) {
    level.logicBaseLevel = createRuntimeLogicLevel(level);
  }
  if (!level.logicState) {
    rebuildRuntimeLogicState(level);
  }
  const materialized = materializeLevel(level.logicBaseLevel, level.logicState);
  const preserveBlockId = options.preserveBlockId || '';
  const nextBlocks = (materialized.blocks || []).map(normalizeBlock);
  if (preserveBlockId) {
    const current = (level.blocks || []).find((block) => block.id === preserveBlockId);
    const stateBlock = level.logicState?.blocks?.[preserveBlockId];
    if (current && stateBlock) {
      nextBlocks.push(normalizeBlock({
        ...deepClone(current),
        style: normalizeStyleKey(stateBlock.color || current.style),
        x: stateBlock.anchor?.x ?? current.x,
        y: stateBlock.anchor?.y ?? current.y,
        moveAxis: stateBlock.flags?.isLubricated ? 'both' : (stateBlock.moveAxis || current.moveAxis || 'both'),
        baseMoveAxis: current.baseMoveAxis || current.moveAxis || 'both',
        isLubricated: !!stateBlock.flags?.isLubricated,
      }));
    }
  }
  const order = new Map((level.logicBaseLevel.blocks || []).map((block, index) => [block.id, index]));
  nextBlocks.sort((left, right) => {
    const leftOrder = order.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = order.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    return leftOrder - rightOrder;
  });
  level.board = deepClone(materialized.board);
  level.exits = deepClone(materialized.exits || []);
  level.tiles = deepClone(materialized.tiles || []);
  level.gates = deepClone(materialized.gates || []);
  level.blocks = nextBlocks;
  level.session = deepClone(materialized.session || {});
  return materialized;
}

function getApproachDirFromAnchors(fromAnchor = {}, toAnchor = {}) {
  const deltaX = Math.round((toAnchor.x ?? 0) - (fromAnchor.x ?? 0));
  const deltaY = Math.round((toAnchor.y ?? 0) - (fromAnchor.y ?? 0));
  if (Math.abs(deltaX) >= Math.abs(deltaY) && deltaX !== 0) {
    return deltaX > 0 ? 'right' : 'left';
  }
  if (deltaY !== 0) {
    return deltaY > 0 ? 'bottom' : 'top';
  }
  return '';
}

function createRuntimeLevel(level) {
  const logicBaseLevel = createRuntimeLogicLevel(level);
  const logicState = createInitialLevelState(logicBaseLevel);
  const materialized = materializeLevel(logicBaseLevel, logicState);
  return {
    id: logicBaseLevel.id,
    title: logicBaseLevel.title,
    rewardCoins: logicBaseLevel.rewardCoins,
    board: deepClone(materialized.board),
    exits: deepClone(materialized.exits || []),
    blocks: (materialized.blocks || []).map(normalizeBlock),
    tiles: deepClone(materialized.tiles || []),
    gates: deepClone(materialized.gates || []),
    meta: deepClone(level.meta || {}),
    session: deepClone(materialized.session || {}),
    logicBaseLevel,
    logicState,
    completed: false,
    rewardGranted: false,
    usedTools: false,
    perfectClear: false,
  };
}

function makeOccupancy(level, ignoreId = '') {
  const map = new Map();
  level.blocks.forEach((block) => {
    if (block.id === ignoreId) {
      return;
    }
    getOccupiedCells(block).forEach((cell) => {
      map.set(`${cell.x},${cell.y}`, block.id);
    });
  });
  return map;
}

function canPlace(level, block, x, y, ignoreId = '') {
  if (!level || !block) {
    return false;
  }
  const sourceLevel = level.logicBaseLevel || createRuntimeLogicLevel(level);
  const state = level.logicState || rebuildRuntimeLogicState(level);
  return canPlaceBlockAtAnchor(sourceLevel, block.id, { x, y }, {
    state,
    ignoreBlockId: ignoreId || block.id,
    approachDir: getApproachDirFromAnchors({ x: block.x, y: block.y }, { x, y }),
  });
}

function getLegalAnchors(level, block) {
  const anchors = [];
  if (!level || !block) {
    return anchors;
  }
  const minX = 0;
  const maxX = level.board.cols - block.w;
  const minY = 0;
  const maxY = level.board.rows - block.h;

  if (block.moveAxis === 'horizontal') {
    for (let x = minX; x <= maxX; x += 1) {
      if (canPlace(level, block, x, block.y, block.id)) {
        anchors.push({ x, y: block.y });
      }
    }
    return anchors;
  }

  if (block.moveAxis === 'vertical') {
    for (let y = minY; y <= maxY; y += 1) {
      if (canPlace(level, block, block.x, y, block.id)) {
        anchors.push({ x: block.x, y });
      }
    }
    return anchors;
  }

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if (canPlace(level, block, x, y, block.id)) {
        anchors.push({ x, y });
      }
    }
  }
  return anchors;
}

function findNearestLegalAnchor(anchors, desiredX, desiredY, fallbackAnchor) {
  if (!anchors.length) {
    return { ...fallbackAnchor };
  }
  let bestAnchor = anchors[0];
  let bestScore = Number.POSITIVE_INFINITY;
  anchors.forEach((anchor) => {
    const dx = anchor.x - desiredX;
    const dy = anchor.y - desiredY;
    const score = (dx * dx) + (dy * dy);
    if (score < bestScore) {
      bestScore = score;
      bestAnchor = anchor;
    }
  });
  return { x: bestAnchor.x, y: bestAnchor.y };
}

function getDragAxisAttempts(currentAnchor, desiredAnchor, moveAxis) {
  const deltaX = desiredAnchor.x - currentAnchor.x;
  const deltaY = desiredAnchor.y - currentAnchor.y;
  const attempts = [];

  const tryPushX = () => {
    if (Math.abs(deltaX) >= DRAG_STEP_THRESHOLD) {
      attempts.push({ x: Math.sign(deltaX), y: 0 });
    }
  };

  const tryPushY = () => {
    if (Math.abs(deltaY) >= DRAG_STEP_THRESHOLD) {
      attempts.push({ x: 0, y: Math.sign(deltaY) });
    }
  };

  if (moveAxis === 'horizontal') {
    tryPushX();
    return attempts;
  }

  if (moveAxis === 'vertical') {
    tryPushY();
    return attempts;
  }

  if (Math.abs(deltaX) >= Math.abs(deltaY)) {
    tryPushX();
    tryPushY();
  } else {
    tryPushY();
    tryPushX();
  }

  return attempts.filter((attempt, index, list) => list.findIndex((candidate) => candidate.x === attempt.x && candidate.y === attempt.y) === index);
}

function resolveDraggedAnchor(level, block, currentAnchor, desiredAnchor, previewState = null) {
  if (!level || !block) {
    return { anchor: { ...currentAnchor }, blockedAttempt: null, pathSteps: [], previewState };
  }
  const sourceLevel = level.logicBaseLevel || createRuntimeLogicLevel(level);
  let workingState = previewState
    ? cloneLevelState(previewState)
    : cloneLevelState(level.logicState || rebuildRuntimeLogicState(level));
  if (workingState?.blocks?.[block.id]) {
    workingState.blocks[block.id].cleared = false;
    workingState.blocks[block.id].anchor = { ...currentAnchor };
  }
  let anchor = { ...currentAnchor };
  let blockedAttempt = null;
  let stoppedByExit = false;
  const pathSteps = [];
  for (let step = 0; step < MAX_DRAG_ADVANCE_STEPS; step += 1) {
    const attempts = getDragAxisAttempts(anchor, desiredAnchor, block.moveAxis);
    if (!attempts.length) {
      break;
    }
    let moved = false;
    let firstBlocked = null;
    for (const attempt of attempts) {
      const nextAnchor = {
        x: anchor.x + attempt.x,
        y: anchor.y + attempt.y,
      };
      const approachDir = getApproachDirFromAnchors(anchor, nextAnchor);
      const result = settleLevelAction(sourceLevel, {
        blockId: block.id,
        targetAnchor: nextAnchor,
        approachDir,
      }, {
        state: workingState,
      });
      if (!result.ok) {
        if (!firstBlocked) {
          firstBlocked = attempt;
        }
        continue;
      }
      workingState = cloneLevelState(result.state);
      if (workingState?.blocks?.[block.id]) {
        workingState.blocks[block.id].cleared = false;
        workingState.blocks[block.id].anchor = { ...nextAnchor };
      }
      const previousAnchor = { ...anchor };
      anchor = nextAnchor;
      pathSteps.push({
        x: nextAnchor.x,
        y: nextAnchor.y,
        approachDir: getApproachDirFromAnchors(previousAnchor, anchor),
      });
      moved = true;
      if (result.settleSummary?.cleared) {
        stoppedByExit = true;
      }
      break;
    }
    if (!moved) {
      blockedAttempt = firstBlocked;
      break;
    }
    blockedAttempt = null;
    if (stoppedByExit) {
      break;
    }
  }
  return { anchor, blockedAttempt, pathSteps, previewState: workingState };
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

function getExitProjectionSpan(block, edge) {
  const coords = getOccupiedCells(block).map((cell) => (edge === 'left' || edge === 'right' ? cell.y : cell.x));
  return {
    start: Math.min(...coords),
    end: Math.max(...coords) + 1,
  };
}

function getExitMatch(level, block) {
  if (!level || block.role !== 'target') {
    return null;
  }
  for (const exit of level.exits) {
    if (exit.acceptColor !== block.style) {
      continue;
    }
    if (!touchesExitEdge(level, block, exit.edge)) {
      continue;
    }
    const projection = getExitProjectionSpan(block, exit.edge);
    const exitEnd = exit.start + exit.span;
    if (projection.start >= exit.start && projection.end <= exitEnd) {
      return exit;
    }
  }
  return null;
}

function getEdgeFromAttempt(attempt) {
  if (!attempt) {
    return '';
  }
  if (attempt.x < 0) {
    return 'left';
  }
  if (attempt.x > 0) {
    return 'right';
  }
  if (attempt.y < 0) {
    return 'top';
  }
  if (attempt.y > 0) {
    return 'bottom';
  }
  return '';
}

function getSwipeEdgeFromWorldDelta(deltaX, deltaZ) {
  if (Math.max(Math.abs(deltaX), Math.abs(deltaZ)) < DRAG_THRESHOLD) {
    return '';
  }
  if (Math.abs(deltaX) >= Math.abs(deltaZ)) {
    return deltaX < 0 ? 'left' : 'right';
  }
  return deltaZ < 0 ? 'top' : 'bottom';
}

function countTargets(level) {
  return level.blocks.filter((block) => block.role === 'target').length;
}

function hasLockGates(level) {
  return Array.isArray(level?.gates) && level.gates.length > 0;
}

function gridToWorld(level, x, y, w = 1, h = 1) {
  const left = -level.board.cols * CELL_SIZE * 0.5;
  const top = -level.board.rows * CELL_SIZE * 0.5;
  return {
    x: left + (x + w * 0.5) * CELL_SIZE,
    z: top + (y + h * 0.5) * CELL_SIZE,
  };
}

function getRewardForLevel(saveData, level) {
  return saveData.progression.completed[level.id] ? 30 : level.rewardCoins;
}

function getCampaignPlayableLimit() {
  return Math.max(0, SHIFT_LEVELS.length - 1);
}

function getMechanicTestStartIndex() {
  return CAMPAIGN_CHAPTERS.find((chapter) => chapter.number === 6)?.startIndex ?? 0;
}

function getCameraFrustum(level, aspect = 1) {
  const board = level?.board || { cols: 5, rows: 5 };
  const safeAspect = Math.max(0.5, aspect);
  const requiredWidth = board.cols + 1.08;
  const requiredHeight = board.rows + 1.02;
  return Math.max(requiredHeight, requiredWidth / safeAspect) + 0.12;
}

function getFallbackSceneBounds(level) {
  const board = level?.board || { cols: 5, rows: 5 };
  const halfWidth = board.cols * CELL_SIZE * 0.5 + EXIT_OUTER_MARGIN + 0.7;
  const halfDepth = board.rows * CELL_SIZE * 0.5 + EXIT_OUTER_MARGIN + 0.7;
  return new THREE.Box3(
    new THREE.Vector3(-halfWidth, -0.28, -halfDepth),
    new THREE.Vector3(halfWidth, BLOCK_HEIGHT + 0.28, halfDepth)
  );
}

function getCameraFitPoints(bounds) {
  const points = [];
  [bounds.min.x, bounds.max.x].forEach((x) => {
    [bounds.min.y, bounds.max.y].forEach((y) => {
      [bounds.min.z, bounds.max.z].forEach((z) => {
        points.push(new THREE.Vector3(x, y, z));
      });
    });
  });
  return points;
}

function getPerspectiveCameraTarget(bounds) {
  const center = bounds.getCenter(new THREE.Vector3());
  return new THREE.Vector3(center.x, THREE.MathUtils.lerp(bounds.min.y, bounds.max.y, 0.34), center.z);
}

function getPerspectiveCameraDirection(aspect = 1) {
  const safeAspect = Math.max(0.52, aspect);
  const vertical = safeAspect < 0.72 ? 1.04 : 1.02;
  const depth = Math.tan(THREE.MathUtils.degToRad(20));
  return new THREE.Vector3(0, vertical, depth).normalize();
}

function getModeLabel(mode) {
  return mode === 'endless' ? '无限模式' : '主线样例';
}

function getEndlessBonus(streak) {
  if (streak > 0 && streak % 10 === 0) {
    return 500;
  }
  if (streak > 0 && streak % 5 === 0) {
    return 200;
  }
  return 0;
}

function createEndlessRunState(difficultyId, overrides = {}) {
  return {
    difficultyId: getEndlessDifficulty(difficultyId).id,
    baseSeed: Number.isFinite(overrides.baseSeed) ? (overrides.baseSeed >>> 0) : createRunSeed(),
    round: Number.isFinite(overrides.round) ? Math.max(1, Math.floor(overrides.round)) : 1,
    streak: Number.isFinite(overrides.streak) ? Math.max(0, Math.floor(overrides.streak)) : 0,
    totalEarned: Number.isFinite(overrides.totalEarned) ? Math.max(0, Math.floor(overrides.totalEarned)) : 0,
  };
}

export class ShiftPrototypeGame {
  constructor(options) {
    this.canvas = options.canvas;
    this.elements = options.elements;
    this.stageSurface = this.canvas?.parentElement || null;
    this.renderer = null;
    this.scene = null;
    this.camera = null;
    this.raycaster = new THREE.Raycaster();
    this.pointerNdc = new THREE.Vector2();
    this.boardPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
    this.textureCache = new Map();
    this.geometryCache = new Map();
    this.blockViews = new Map();
    this.gateViews = new Map();
    this.exitViews = [];
    this.boardGroup = null;
    this.levelGroup = null;
    this.drag = null;
    this.animations = [];
    this.lastFrameTs = 0;
    this.isRunning = true;
    this.toastTimer = null;
    this.saveData = loadSaveData();
    this.levelIndex = clamp(this.saveData.progression.lastLevelIndex || 0, 0, SHIFT_LEVELS.length - 1);
    this.runtimeLevel = null;
    this.previewLevel = null;
    this.endlessRun = this.saveData.endless.activeRun ? deepClone(this.saveData.endless.activeRun) : null;
    this.currentMode = null;
    this.currentScreen = 'home';
    this.currentModal = null;
    this.pendingShopTool = null;
    this.menuModeFocus = 'endless';
    this.selectedCampaignIndex = clamp(this.saveData.progression.lastLevelIndex || 0, 0, SHIFT_LEVELS.length - 1);
    this.selectedEndlessDifficulty = this.saveData.endless.lastDifficulty || this.endlessRun?.difficultyId || 'brain';
    this.useMasterKeyMode = false;
    this.useGoldFingerMode = false;
    this.useLubricantMode = false;
    this.compatFailed = false;
    this.pointerEnabled = true;
    this.audioContext = null;
    this.audioUnlocked = false;
    this.musicAudio = null;
    this.musicTrackIndex = -1;
    this.sfxBuffers = new Map();
    this.sfxBufferPromises = new Map();
    this.sfxFallbackPools = new Map();
    this.activeSfxNodes = new Set();
    this.sfxMasterGain = null;
    this.audioSources = {
      move: new URL('../../assets/audio/move.wav', import.meta.url).href,
      success: new URL('../../assets/audio/get_door.wav', import.meta.url).href,
      win: new URL('../../assets/audio/win.ogg', import.meta.url).href,
      bgm: [
        new URL('../../assets/audio/bgm.ogg', import.meta.url).href,
        new URL('../../assets/audio/bgm2.ogg', import.meta.url).href,
      ],
    };

    this.handleResize = this.handleResize.bind(this);
    this.handlePointerDown = this.handlePointerDown.bind(this);
    this.handlePointerMove = this.handlePointerMove.bind(this);
    this.handlePointerUp = this.handlePointerUp.bind(this);
    this.handleKeyDown = this.handleKeyDown.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);
    this.handleShellViewChange = this.handleShellViewChange.bind(this);
    this.handleBackupImported = this.handleBackupImported.bind(this);
    this.handleStageBrowserUi = this.handleStageBrowserUi.bind(this);
    this.unlockAudio = this.unlockAudio.bind(this);
    this.animate = this.animate.bind(this);
  }

  init() {
    if (!this.initRenderer()) {
      this.showCompatibility();
      return;
    }
    this.initScene();
    this.bindUI();
    this.prepareAudio();
    this.installTestHooks();
    this.restoreMenuState();
    this.updateHud();
    this.syncAudioSettings();
    window.addEventListener('resize', this.handleResize);
    window.addEventListener('keydown', this.handleKeyDown);
    window.addEventListener('keydown', this.unlockAudio);
    window.addEventListener('click', this.unlockAudio);
    window.addEventListener('pointerdown', this.unlockAudio, { passive: true });
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    window.addEventListener('mygame:view-change', this.handleShellViewChange);
    window.addEventListener('mygame:backup-imported', this.handleBackupImported);
    this.canvas.addEventListener('pointerdown', this.handlePointerDown);
    this.canvas.addEventListener('pointermove', this.handlePointerMove);
    this.canvas.addEventListener('pointerup', this.handlePointerUp);
    this.canvas.addEventListener('pointercancel', this.handlePointerUp);
    this.canvas.addEventListener('lostpointercapture', this.handlePointerUp);
    this.stageSurface = this.canvas?.parentElement || this.stageSurface || null;
    const gestureSurfaces = [...new Set([this.stageSurface, this.canvas].filter(Boolean))];
    gestureSurfaces.forEach((surface) => {
      surface.addEventListener('contextmenu', this.handleStageBrowserUi);
      surface.addEventListener('selectstart', this.handleStageBrowserUi);
      surface.addEventListener('dragstart', this.handleStageBrowserUi);
      surface.addEventListener('dblclick', this.handleStageBrowserUi);
    });
    this.handleResize();
    this.lastFrameTs = performance.now();
    requestAnimationFrame(this.animate);
  }

  initRenderer() {
    try {
      this.renderer = new THREE.WebGLRenderer({
        canvas: this.canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      });
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      this.renderer.outputColorSpace = THREE.SRGBColorSpace;
      this.renderer.toneMapping = THREE.NoToneMapping;
      this.renderer.toneMappingExposure = 1.0;
      this.renderer.shadowMap.enabled = true;
      this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
      this.renderer.setClearColor(0x000000, 0);
      return true;
    } catch (_err) {
      return false;
    }
  }

  showCompatibility() {
    this.compatFailed = true;
    this.showScreen('home');
    this.openModal('compat');
    this.showToast('当前环境无法初始化 WebGL 原型。');
  }

  initScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.environment = getToyEnvironmentMap(this.textureCache, this.renderer);
    this.camera = new THREE.PerspectiveCamera(21, 1, 0.1, 80);
    this.camera.position.set(0, 11.4, 4.2);
    this.camera.lookAt(0, 0.12, 0.03);

    const ambient = new THREE.AmbientLight('#fffef8', 0.42);
    this.scene.add(ambient);

    const hemi = new THREE.HemisphereLight('#eefcff', '#6684a1', 0.34);
    hemi.position.set(0, 8, 0);
    this.scene.add(hemi);

    const keyLight = new THREE.DirectionalLight('#fff0d4', 1.36);
    keyLight.position.set(6.8, 15.5, 10.5);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 2048;
    keyLight.shadow.mapSize.height = 2048;
    keyLight.shadow.camera.near = 1;
    keyLight.shadow.camera.far = 34;
    keyLight.shadow.camera.left = -10;
    keyLight.shadow.camera.right = 10;
    keyLight.shadow.camera.top = 10;
    keyLight.shadow.camera.bottom = -10;
    keyLight.shadow.bias = -0.00045;
    keyLight.shadow.normalBias = 0.018;
    this.scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight('#a7ecff', 0.78);
    rimLight.position.set(-8.4, 9.2, -6.8);
    this.scene.add(rimLight);

    const fillLight = new THREE.DirectionalLight('#fff9ef', 0.16);
    fillLight.position.set(-1.4, 7.8, 8.6);
    this.scene.add(fillLight);

    const sparkle = new THREE.PointLight('#ffffff', 0.14, 24, 2);
    sparkle.position.set(0.6, 6.4, 4.8);
    this.scene.add(sparkle);

    const bounce = new THREE.PointLight('#ffd7a8', 0.08, 18, 2);
    bounce.position.set(0, 1.8, -0.8);
    this.scene.add(bounce);

    this.boardGroup = new THREE.Group();
    this.levelGroup = new THREE.Group();
    this.scene.add(this.boardGroup);
    this.scene.add(this.levelGroup);
  }

  bindUI() {
    this.elements.homeCampaign.addEventListener('click', () => this.showLevelList('campaign'));
    this.elements.homeEndless.addEventListener('click', () => this.showLevelList('endless'));
    this.elements.homeContinue.addEventListener('click', () => this.continueSavedRun());
    this.elements.listBackHome.addEventListener('click', () => this.showHomeScreen());
    this.elements.tabCampaign.addEventListener('click', () => this.showLevelList('campaign'));
    this.elements.tabEndless.addEventListener('click', () => this.showLevelList('endless'));
    this.elements.listPrimary.addEventListener('click', () => this.enterSelectedListItem());
    this.elements.listSecondary.addEventListener('click', () => this.handleListSecondaryAction());
    this.elements.next.addEventListener('click', () => this.goToNextLevel());
    this.elements.replay.addEventListener('click', () => this.handleReplay());
    this.elements.reset.addEventListener('click', () => {
      this.closeActiveModal();
      this.resetLevel();
    });
    this.elements.settingsList.addEventListener('click', () => {
      this.closeActiveModal();
      this.returnToCurrentList();
    });
    this.elements.settingsHome.addEventListener('click', () => {
      this.closeActiveModal();
      this.showHomeScreen();
    });
    this.elements.settingsVolume?.addEventListener('input', () => this.handleSettingsVolumeInput());
    this.elements.settingsMusic?.addEventListener('change', () => this.handleSettingsToggle('musicEnabled', this.elements.settingsMusic.checked));
    this.elements.settingsSfx?.addEventListener('change', () => this.handleSettingsToggle('sfxEnabled', this.elements.settingsSfx.checked));
    this.elements.settingsVibration?.addEventListener('change', () => this.handleSettingsToggle('vibrationEnabled', this.elements.settingsVibration.checked));
    this.elements.resultList.addEventListener('click', () => {
      this.closeActiveModal();
      this.returnToCurrentList();
    });
    this.elements.shopBuy.addEventListener('click', () => this.buyPendingShopItem());
    this.elements.shopQuantityMinus?.addEventListener('click', () => this.adjustShopQuantity(-1));
    this.elements.shopQuantityPlus?.addEventListener('click', () => this.adjustShopQuantity(1));
    this.elements.shopQuantityPresets?.forEach((button) => {
      button.addEventListener('click', () => this.setShopQuantity(Number(button.dataset.shiftShopQuantity) || 1));
    });
    this.elements.useMasterKey.addEventListener('click', () => this.handleToolSlot('masterKey'));
    this.elements.useGoldFinger.addEventListener('click', () => this.handleToolSlot('goldFinger'));
    this.elements.useLubricant.addEventListener('click', () => this.handleToolSlot('lubricant'));
    this.elements.openSettingsButtons.forEach((button) => {
      button.addEventListener('click', () => this.openModal('settings'));
    });
    this.elements.openRulesButtons.forEach((button) => {
      button.addEventListener('click', () => this.openModal('rules'));
    });
    this.elements.closeButtons.forEach((button) => {
      button.addEventListener('click', () => this.closeActiveModal());
    });
    this.elements.overlays.forEach((overlay) => {
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) {
          this.closeActiveModal();
        }
      });
    });
  }

  shouldSuppressBrowserUi(event) {
    if (this.currentScreen !== 'play') {
      return false;
    }
    const target = event?.target;
    if (!(target instanceof Element)) {
      return true;
    }
    if (target.closest('.shift-modal-card, button, input, select, textarea, label, a')) {
      return false;
    }
    return true;
  }

  handleStageBrowserUi(event) {
    if (!this.shouldSuppressBrowserUi(event)) {
      return;
    }
    if (event.cancelable) {
      event.preventDefault();
    }
  }

  installTestHooks() {
    window.render_game_to_text = () => this.renderGameToText();
    window.advanceTime = (ms = 16) => {
      const totalMs = Math.max(0, Number(ms) || 0);
      const steps = Math.max(1, Math.round(totalMs / (1000 / 60)));
      for (let index = 0; index < steps; index += 1) {
        this.update(1 / 60);
      }
      this.render();
      return true;
    };
  }

  getSceneLevel() {
    return this.runtimeLevel || this.previewLevel || null;
  }

  showScreen(screenName) {
    this.currentScreen = screenName;
    this.elements.homeScreen.classList.toggle('is-hidden', screenName !== 'home');
    this.elements.listScreen.classList.toggle('is-hidden', screenName !== 'levels');
    this.elements.playScreen.classList.toggle('is-hidden', screenName !== 'play');
  }

  syncUiLockState() {
    const loadingVisible = !!this.elements.loading && !this.elements.loading.classList.contains('is-hidden');
    document.body.classList.toggle('shift-modal-open', !!this.currentModal || loadingVisible);
  }

  setLoadingState(visible, options = {}) {
    if (!this.elements.loading) {
      return;
    }
    if (visible) {
      if (this.elements.loadingTitle) {
        this.elements.loadingTitle.textContent = options.title || '正在生成无限局';
      }
      if (this.elements.loadingCopy) {
        this.elements.loadingCopy.textContent = options.copy || '正在整理高密度随机盘面，请稍候。';
      }
      this.elements.loading.classList.remove('is-hidden');
    } else {
      this.elements.loading.classList.add('is-hidden');
    }
    this.syncUiLockState();
  }

  waitForNextPaint(frames = 2) {
    const totalFrames = Math.max(1, Math.floor(frames));
    return new Promise((resolve) => {
      const tick = (remaining) => {
        if (remaining <= 0) {
          resolve();
          return;
        }
        requestAnimationFrame(() => tick(remaining - 1));
      };
      tick(totalFrames);
    });
  }

  openModal(modalName) {
    const modalMap = {
      compat: this.elements.compat,
      settings: this.elements.settingsModal,
      rules: this.elements.rulesModal,
      shop: this.elements.shopModal,
      win: this.elements.win,
    };
    Object.values(modalMap).forEach((element) => {
      element?.classList.add('is-hidden');
    });
    const activeModal = modalMap[modalName] || null;
    if (!activeModal) {
      this.closeActiveModal();
      return;
    }
    if (modalName === 'settings') {
      this.syncSettingsModal();
    }
    activeModal.classList.remove('is-hidden');
    this.currentModal = modalName;
    this.syncUiLockState();
  }

  closeActiveModal() {
    [
      this.elements.compat,
      this.elements.settingsModal,
      this.elements.rulesModal,
      this.elements.shopModal,
      this.elements.win,
    ].forEach((element) => {
      element?.classList.add('is-hidden');
    });
    this.currentModal = null;
    this.pendingShopTool = null;
    this.pendingShopQuantity = 1;
    this.syncUiLockState();
  }

  syncSettingsModal() {
    const canReset = this.currentScreen === 'play' && !!this.runtimeLevel;
    const settings = this.saveData.settings || { volume: 0.7, musicEnabled: true, sfxEnabled: true, vibrationEnabled: true };
    const volumePercent = Math.round((settings.volume ?? 0.7) * 100);
    this.elements.reset.disabled = !canReset;
    this.elements.settingsList.disabled = false;
    this.elements.settingsList.textContent = this.currentScreen === 'levels' ? '☰ 当前就在关卡列表' : '☰ 返回关卡列表';
    if (this.elements.settingsVolume) {
      this.elements.settingsVolume.value = String(volumePercent);
    }
    if (this.elements.settingsVolumeValue) {
      this.elements.settingsVolumeValue.textContent = `${volumePercent}%`;
    }
    if (this.elements.settingsMusic) {
      this.elements.settingsMusic.checked = settings.musicEnabled !== false;
    }
    if (this.elements.settingsSfx) {
      this.elements.settingsSfx.checked = !!settings.sfxEnabled;
    }
    if (this.elements.settingsVibration) {
      this.elements.settingsVibration.checked = !!settings.vibrationEnabled;
      this.elements.settingsVibration.disabled = !('vibrate' in navigator);
    }
  }

  handleSettingsVolumeInput() {
    const rawValue = Number(this.elements.settingsVolume?.value || 70);
    const volume = clamp(rawValue / 100, 0, 1);
    this.saveData.settings.volume = volume;
    if (this.elements.settingsVolumeValue) {
      this.elements.settingsVolumeValue.textContent = `${Math.round(volume * 100)}%`;
    }
    this.persistSave();
    this.syncAudioSettings();
    this.playUiSound('tap');
  }

  handleSettingsToggle(key, value) {
    this.saveData.settings[key] = !!value;
    this.persistSave();
    this.syncAudioSettings();
    if (key === 'vibrationEnabled' && value) {
      this.triggerVibration([12]);
    }
    this.playUiSound('tap');
    this.syncSettingsModal();
  }

  ensureAudioContext() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return null;
    }
    if (!this.audioContext) {
      try {
        this.audioContext = new AudioContextClass({ latencyHint: 'interactive' });
      } catch (_error) {
        try {
          this.audioContext = new AudioContextClass();
        } catch (_innerError) {
          return null;
        }
      }
    }
    return this.audioContext;
  }

  ensureSfxMasterGain() {
    const ctx = this.ensureAudioContext();
    if (!ctx) {
      return null;
    }
    if (!this.sfxMasterGain) {
      this.sfxMasterGain = ctx.createGain();
      this.sfxMasterGain.gain.value = 0;
      this.sfxMasterGain.connect(ctx.destination);
    }
    return this.sfxMasterGain;
  }

  getSfxUrl(kind) {
    if (kind === 'success') {
      return this.audioSources.success;
    }
    if (kind === 'win') {
      return this.audioSources.win;
    }
    return this.audioSources.move;
  }

  prepareAudio() {
    this.ensureMusicAudio();
    this.ensureSfxMasterGain();
    ['tap', 'move', 'success', 'win'].forEach((kind) => {
      this.primeSfxBuffer(kind);
      this.ensureSfxFallbackPool(kind);
    });
  }

  primeSfxBuffer(kind) {
    if (this.sfxBuffers.has(kind)) {
      return Promise.resolve(this.sfxBuffers.get(kind));
    }
    if (this.sfxBufferPromises.has(kind)) {
      return this.sfxBufferPromises.get(kind);
    }
    const ctx = this.ensureAudioContext();
    if (!ctx) {
      return Promise.resolve(null);
    }
    const promise = fetch(this.getSfxUrl(kind))
      .then((response) => {
        if (!response.ok) {
          throw new Error(`SFX fetch failed: ${response.status}`);
        }
        return response.arrayBuffer();
      })
      .then((arrayBuffer) => decodeAudioDataCompat(ctx, arrayBuffer))
      .then((decodedBuffer) => {
        this.sfxBuffers.set(kind, decodedBuffer);
        this.sfxBufferPromises.delete(kind);
        return decodedBuffer;
      })
      .catch(() => {
        this.sfxBufferPromises.delete(kind);
        return null;
      });
    this.sfxBufferPromises.set(kind, promise);
    return promise;
  }

  ensureSfxFallbackPool(kind) {
    if (this.sfxFallbackPools.has(kind)) {
      return this.sfxFallbackPools.get(kind);
    }
    const source = this.getSfxUrl(kind);
    const pool = {
      index: 0,
      players: Array.from({ length: AUDIO_POOL_SIZES[kind] || 2 }, () => createManagedAudio(source)).filter(Boolean),
    };
    pool.players.forEach((audio) => {
      try {
        audio.load();
      } catch (_error) {
        // Ignore eager preload issues.
      }
    });
    this.sfxFallbackPools.set(kind, pool);
    return pool;
  }

  ensureMusicAudio() {
    if (this.musicAudio) {
      return this.musicAudio;
    }
    const audio = createManagedAudio();
    if (!audio) {
      return null;
    }
    audio.loop = false;
    audio.addEventListener('ended', () => {
      this.startMusicPlayback(true);
    });
    this.musicAudio = audio;
    return this.musicAudio;
  }

  stopAllSfx() {
    this.activeSfxNodes.forEach(({ source }) => {
      try {
        source.stop();
      } catch (_error) {
        // Ignore already-stopped nodes.
      }
    });
    this.activeSfxNodes.clear();
    this.sfxFallbackPools.forEach((pool) => {
      pool.players.forEach((audio) => {
        audio.pause();
        audio.currentTime = 0;
      });
    });
  }

  pickNextMusicTrackIndex() {
    const trackCount = this.audioSources.bgm.length;
    if (!trackCount) {
      return -1;
    }
    if (trackCount === 1) {
      return 0;
    }
    let nextIndex = Math.floor(Math.random() * trackCount);
    if (nextIndex === this.musicTrackIndex) {
      nextIndex = (nextIndex + 1 + Math.floor(Math.random() * (trackCount - 1))) % trackCount;
    }
    return nextIndex;
  }

  startMusicPlayback(forceNext = false) {
    const settings = this.saveData.settings || {};
    if (!settings.musicEnabled || !this.audioUnlocked || document.hidden) {
      return;
    }
    const audio = this.ensureMusicAudio();
    if (!audio) {
      return;
    }
    if (forceNext || this.musicTrackIndex < 0 || !audio.src) {
      this.musicTrackIndex = this.pickNextMusicTrackIndex();
      if (this.musicTrackIndex < 0) {
        return;
      }
      audio.pause();
      audio.currentTime = 0;
      audio.src = this.audioSources.bgm[this.musicTrackIndex];
      try {
        audio.load();
      } catch (_error) {
        // Ignore eager preload issues.
      }
    }
    audio.volume = clamp((settings.volume ?? 0.7) * BGM_GAIN, 0, 1);
    const playPromise = audio.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
  }

  syncAudioSettings() {
    const settings = this.saveData.settings || {};
    const volume = clamp(settings.volume ?? 0.7, 0, 1);
    const musicAudio = this.ensureMusicAudio();
    if (musicAudio) {
      musicAudio.volume = clamp(volume * BGM_GAIN, 0, 1);
      if (!settings.musicEnabled || !this.audioUnlocked || document.hidden) {
        musicAudio.pause();
      } else {
        this.startMusicPlayback(false);
      }
    }

    const masterGain = this.ensureSfxMasterGain();
    if (masterGain) {
      const ctx = this.ensureAudioContext();
      const now = ctx?.currentTime || 0;
      const nextGain = settings.sfxEnabled ? volume : 0;
      masterGain.gain.cancelScheduledValues(now);
      masterGain.gain.setValueAtTime(masterGain.gain.value, now);
      masterGain.gain.linearRampToValueAtTime(nextGain, now + 0.02);
    }

    if (!settings.sfxEnabled) {
      this.stopAllSfx();
      return;
    }

    this.sfxFallbackPools.forEach((pool, kind) => {
      pool.players.forEach((audio) => {
        audio.volume = clamp(volume * (AUDIO_GAIN_BY_KIND[kind] || 1), 0, 1);
      });
    });
  }

  handleVisibilityChange() {
    this.syncAudioSettings();
  }

  handleShellViewChange(event) {
    const targetView = String(event?.detail?.view || '').toLowerCase();
    const shouldBeActive = !targetView || targetView === 'shift';
    if (!shouldBeActive) {
      this.isRunning = false;
      this.ensureMusicAudio()?.pause();
      return;
    }
    if (!this.isRunning && !this.compatFailed) {
      this.isRunning = true;
      this.lastFrameTs = performance.now();
      requestAnimationFrame(this.animate);
    }
    this.syncAudioSettings();
  }

  handleBackupImported(event) {
    const importedProviders = Array.isArray(event?.detail?.importedProviders)
      ? event.detail.importedProviders.map((item) => String(item || '').toLowerCase())
      : null;
    if (importedProviders && importedProviders.length > 0 && !importedProviders.includes('shift')) {
      return;
    }
    this.reloadSaveDataFromStorage();
  }

  reloadSaveDataFromStorage() {
    this.saveData = loadSaveData();
    this.levelIndex = clamp(this.saveData.progression.lastLevelIndex || 0, 0, SHIFT_LEVELS.length - 1);
    this.runtimeLevel = null;
    this.previewLevel = null;
    this.endlessRun = this.saveData.endless.activeRun ? deepClone(this.saveData.endless.activeRun) : null;
    this.currentMode = null;
    this.currentModal = null;
    this.menuModeFocus = 'endless';
    this.selectedCampaignIndex = clamp(this.saveData.progression.lastLevelIndex || 0, 0, SHIFT_LEVELS.length - 1);
    this.selectedEndlessDifficulty = this.saveData.endless.lastDifficulty || this.endlessRun?.difficultyId || 'brain';
    this.useMasterKeyMode = false;
    this.useGoldFingerMode = false;
    this.useLubricantMode = false;
    this.closeActiveModal();
    this.clearLevelMeshes();
    this.restoreMenuState();
    this.syncAudioSettings();
    this.render();
  }

  unlockAudio() {
    if (!this.audioUnlocked) {
      this.audioUnlocked = true;
    }
    const ctx = this.ensureAudioContext();
    if (ctx?.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    ['tap', 'move', 'success', 'win'].forEach((kind) => {
      this.primeSfxBuffer(kind);
    });
    this.syncAudioSettings();
  }

  playFallbackUiSound(kind, volume) {
    const pool = this.ensureSfxFallbackPool(kind);
    if (!pool?.players?.length) {
      return;
    }
    let player = pool.players.find((audio) => audio.paused || audio.ended);
    if (!player) {
      player = pool.players[pool.index];
      pool.index = (pool.index + 1) % pool.players.length;
    }
    player.pause();
    player.currentTime = 0;
    player.volume = volume;
    const playPromise = player.play();
    if (playPromise?.catch) {
      playPromise.catch(() => {});
    }
  }

  playUiSound(kind = 'tap') {
    const settings = this.saveData.settings || {};
    if (!settings.sfxEnabled) {
      return;
    }
    if (!this.audioUnlocked) {
      this.unlockAudio();
    }
    const safeKind = kind === 'move' || kind === 'success' || kind === 'win' ? kind : 'tap';
    const volume = clamp((settings.volume ?? 0.7) * (AUDIO_GAIN_BY_KIND[safeKind] || 1), 0, 1);
    const ctx = this.ensureAudioContext();
    if (ctx?.state === 'suspended') {
      ctx.resume().catch(() => {});
    }
    const decodedBuffer = this.sfxBuffers.get(safeKind);
    const masterGain = this.ensureSfxMasterGain();
    if (ctx && decodedBuffer && masterGain && ctx.state !== 'closed') {
      const source = ctx.createBufferSource();
      const gainNode = ctx.createGain();
      gainNode.gain.value = AUDIO_GAIN_BY_KIND[safeKind] || 1;
      source.buffer = decodedBuffer;
      source.connect(gainNode);
      gainNode.connect(masterGain);
      const activeNode = { source, gainNode };
      this.activeSfxNodes.add(activeNode);
      source.onended = () => {
        this.activeSfxNodes.delete(activeNode);
        source.disconnect();
        gainNode.disconnect();
      };
      try {
        source.start();
        return;
      } catch (_error) {
        this.activeSfxNodes.delete(activeNode);
        try {
          source.disconnect();
          gainNode.disconnect();
        } catch (_disconnectError) {
          // Ignore cleanup errors.
        }
      }
    }
    this.primeSfxBuffer(safeKind);
    this.playFallbackUiSound(safeKind, volume);
  }

  triggerVibration(pattern = [12]) {
    if (!this.saveData.settings?.vibrationEnabled || !('vibrate' in navigator)) {
      return false;
    }
    try {
      navigator.vibrate(0);
      return navigator.vibrate(pattern);
    } catch (_error) {
      return false;
    }
  }

  setMenuModeFocus(mode) {
    this.menuModeFocus = mode === 'endless' ? 'endless' : 'campaign';
    this.updateMenuSummary();
    this.showMenuPreview();
    this.updateHud();
  }

  selectEndlessDifficulty(difficultyId) {
    this.selectedEndlessDifficulty = getEndlessDifficulty(difficultyId).id;
    this.menuModeFocus = 'endless';
    this.updateMenuSummary();
    this.showMenuPreview();
    this.updateHud();
  }

  syncDifficultyButtons() {
    if (this.currentScreen === 'levels' && this.menuModeFocus === 'endless') {
      this.renderEndlessList();
    }
  }

  syncMenuCards() {
    this.elements.tabCampaign?.classList.toggle('is-active', this.menuModeFocus === 'campaign');
    this.elements.tabEndless?.classList.toggle('is-active', this.menuModeFocus === 'endless');
    this.elements.campaignPanel?.classList.toggle('is-hidden', this.menuModeFocus !== 'campaign');
    this.elements.endlessPanel?.classList.toggle('is-hidden', this.menuModeFocus !== 'endless');
  }

  getContinueDescriptor() {
    const campaignResume = this.saveData.resume.campaign;
    const endlessResume = this.saveData.resume.endless;
    const endlessRun = this.saveData.endless.activeRun;
    const preferEndless = this.saveData.session.lastMode === 'endless';
    const hasCampaign = !!campaignResume?.levelId;
    const hasEndless = !!endlessResume?.levelId || !!endlessRun;

    if (preferEndless && hasEndless) {
      const source = endlessResume || endlessRun;
      const difficulty = getEndlessDifficulty(source.difficultyId);
      return {
        mode: 'endless',
        buttonText: `继续无限 · ${difficulty.label}`,
        copy: `回到 ${difficulty.label} · 第 ${source.round} 局，当前已连过 ${source.streak || 0} 局。`,
      };
    }

    if (hasCampaign) {
      const level = SHIFT_LEVELS[campaignResume.levelIndex] || SHIFT_LEVELS.find((entry) => entry.id === campaignResume.levelId) || SHIFT_LEVELS[0];
      return {
        mode: 'campaign',
        buttonText: `继续主线 · ${formatCampaignLevelLabel(campaignResume.levelIndex || 0)}`,
        copy: `回到 ${level?.title || '最近一关'}。`,
      };
    }

    if (hasEndless) {
      const source = endlessResume || endlessRun;
      const difficulty = getEndlessDifficulty(source.difficultyId);
      return {
        mode: 'endless',
        buttonText: `继续无限 · ${difficulty.label}`,
        copy: `回到 ${difficulty.label} · 第 ${source.round} 局。`,
      };
    }

    return null;
  }

  updateMenuSummary() {
    const descriptor = this.getContinueDescriptor();
    const unlockedCount = Math.max(1, Math.min(getCampaignPlayableLimit() + 1, SHIFT_LEVELS.length));
    const lastCampaignLevel = SHIFT_LEVELS[clamp(this.saveData.progression.lastLevelIndex || 0, 0, SHIFT_LEVELS.length - 1)] || SHIFT_LEVELS[0];
    const activeRun = this.saveData.endless.activeRun;
    const selectedDifficulty = getEndlessDifficulty(this.selectedEndlessDifficulty);

    this.elements.homeCampaignCopy.textContent = `主线暂缓打磨 · 已开放 ${unlockedCount} / ${SHIFT_LEVELS.length}`;
    this.elements.homeEndlessCopy.textContent = activeRun
      ? `${getEndlessDifficulty(activeRun.difficultyId).label} · 第 ${activeRun.round} 局`
      : '随机生成 · 单档动脑';
    this.elements.homeContinue.disabled = !descriptor;
    this.elements.homeContinueLabel.textContent = descriptor ? descriptor.buttonText : '继续游玩';
    this.elements.homeContinueCopy.textContent = descriptor ? '回到上次进度。' : '暂无进行中的进度。';
    this.elements.homeHint.textContent = '无限模式优先：随机生成高密度盘面，尽量过滤白给开局。';

    this.syncMenuCards();
    if (this.currentScreen === 'levels') {
      if (this.menuModeFocus === 'endless') {
        this.renderEndlessList();
      } else {
        this.renderCampaignList();
      }
    }
  }

  showHomeScreen() {
    this.currentMode = null;
    this.runtimeLevel = null;
    this.useMasterKeyMode = false;
    this.useGoldFingerMode = false;
    this.useLubricantMode = false;
    this.closeActiveModal();
    this.showScreen('home');
    this.updateMenuSummary();
    this.showMenuPreview();
    this.updateHud();
  }

  showLevelList(mode = this.menuModeFocus, options = {}) {
    this.menuModeFocus = mode === 'endless' ? 'endless' : 'campaign';
    if (Number.isFinite(options.levelIndex)) {
      this.selectedCampaignIndex = clamp(options.levelIndex, 0, SHIFT_LEVELS.length - 1);
    } else if (this.menuModeFocus === 'campaign') {
      const mechanicStartIndex = getMechanicTestStartIndex();
      const fallbackLevel = this.currentMode === 'campaign' ? this.levelIndex : this.saveData.progression.lastLevelIndex;
      const shouldJumpToMechanicSamples = !this.currentMode
        && (this.saveData.progression.lastLevelIndex || 0) < mechanicStartIndex;
      const preferredLevel = shouldJumpToMechanicSamples
        ? mechanicStartIndex
        : (this.selectedCampaignIndex ?? fallbackLevel ?? mechanicStartIndex);
      this.selectedCampaignIndex = clamp(preferredLevel, 0, SHIFT_LEVELS.length - 1);
    } else {
      const fallbackLevel = this.currentMode === 'campaign' ? this.levelIndex : this.saveData.progression.lastLevelIndex;
      this.selectedCampaignIndex = clamp(this.selectedCampaignIndex ?? fallbackLevel ?? 0, 0, SHIFT_LEVELS.length - 1);
    }
    if (options.difficultyId) {
      this.selectedEndlessDifficulty = getEndlessDifficulty(options.difficultyId).id;
    }
    this.currentMode = null;
    this.runtimeLevel = null;
    this.useMasterKeyMode = false;
    this.useGoldFingerMode = false;
    this.useLubricantMode = false;
    this.closeActiveModal();
    this.showScreen('levels');
    this.updateMenuSummary();
    this.showMenuPreview();
    this.updateHud();
  }

  renderCampaignList() {
    const unlockedLimit = getCampaignPlayableLimit();
    const currentSelectionCompleted = this.saveData.progression.completed[SHIFT_LEVELS[this.selectedCampaignIndex]?.id || ''];
    if (!currentSelectionCompleted && this.selectedCampaignIndex > unlockedLimit) {
      this.selectedCampaignIndex = unlockedLimit;
    }

    this.elements.campaignGrid.innerHTML = SHIFT_LEVELS.map((level, index) => {
      const record = this.saveData.progression.completed[level.id] || null;
      const unlocked = index <= unlockedLimit || !!record?.cleared;
      const stateIcon = unlocked ? (record?.perfect ? '★' : (record?.cleared ? '✓' : '○')) : '锁';
      const classes = [
        'shift-level-card',
        index === this.selectedCampaignIndex ? 'is-selected' : '',
        index === (this.currentMode === 'campaign' ? this.levelIndex : this.saveData.progression.lastLevelIndex) ? 'is-current' : '',
        record?.cleared ? 'is-cleared' : '',
        record?.perfect ? 'is-perfect' : '',
        unlocked ? '' : 'is-locked',
      ].filter(Boolean).join(' ');
      const label = formatCampaignLevelLabel(index);
      return `
        <button
          class="${classes}"
          type="button"
          data-shift-campaign-level="${index}"
          ${unlocked ? '' : 'disabled'}
        >
          <span class="shift-level-card-top">
            <span class="shift-level-card-num">${escapeHtml(label)}</span>
            <span class="shift-level-card-state">${stateIcon}</span>
          </span>
          <p class="shift-level-card-title">${unlocked ? escapeHtml(level.title) : '未解锁'}</p>
          <p class="shift-level-card-sub">${unlocked ? escapeHtml(level.meta?.chapterShortTitle || '') : ''}</p>
        </button>
      `;
    }).join('');

    Array.from(this.elements.campaignGrid.querySelectorAll('[data-shift-campaign-level]')).forEach((button) => {
      button.addEventListener('click', () => {
        this.selectedCampaignIndex = clamp(Number(button.dataset.shiftCampaignLevel) || 0, 0, SHIFT_LEVELS.length - 1);
        this.showMenuPreview();
        this.renderCampaignList();
        this.updateHud();
      });
    });

    const selectedLevel = SHIFT_LEVELS[this.selectedCampaignIndex] || SHIFT_LEVELS[0];
    const selectedRecord = this.saveData.progression.completed[selectedLevel.id] || null;
    const unlockedCount = Math.max(1, Math.min(unlockedLimit + 1, SHIFT_LEVELS.length));
    const chapter = getCampaignChapterByIndex(this.selectedCampaignIndex);
    this.elements.campaignHeading.textContent = chapter?.title || '主线';
    this.elements.campaignProgress.textContent = `测试阶段 · 已开放 ${unlockedCount} / ${SHIFT_LEVELS.length}`;
    this.elements.listModeLabel.textContent = '主线模式';
    this.elements.listSubtitle.textContent = `${chapter?.title || '主线'} · ${formatCampaignLevelLabel(this.selectedCampaignIndex)}`;
    this.elements.listMeta.textContent = selectedLevel.meta?.chapterTagline || '';
    this.elements.listSummary.textContent = selectedRecord?.perfect
      ? '已点亮星标'
      : selectedRecord?.cleared
        ? '已通关'
        : `首通 ${selectedLevel.rewardCoins} 金币 + ${CLEAR_GOLD_FINGER_REWARD} 金手指 · 不用道具可得星标`;
    this.elements.listPrimary.textContent = `进入 ${formatCampaignLevelLabel(this.selectedCampaignIndex)}`;
    this.elements.listSecondary.classList.add('is-hidden');
  }

  renderEndlessList() {
    const activeRun = this.saveData.endless.activeRun;
    const resume = this.saveData.resume.endless;
    const difficulty = getEndlessDifficulty(this.selectedEndlessDifficulty);
    const selectedRun = resume?.difficultyId === difficulty.id
      ? resume
      : activeRun?.difficultyId === difficulty.id
        ? activeRun
        : null;

    this.elements.endlessGrid.innerHTML = `
      <button class="shift-endless-card is-selected" type="button" data-shift-endless-difficulty="${difficulty.id}">
        <span class="shift-endless-card-head">
          <span class="shift-endless-card-title">∞ ${escapeHtml(difficulty.label)}</span>
          <span class="shift-endless-card-tag">${selectedRun ? '续' : '新'}</span>
        </span>
        <p>随机生成高密度盘面，尽量过滤白给开局。</p>
        <span class="shift-endless-card-foot">
          <span class="shift-endless-meta">${escapeHtml(selectedRun ? `第 ${selectedRun.round} 局 · 连过 ${selectedRun.streak || 0} 局` : `${difficulty.rewardCoins} 金币 + ${CLEAR_GOLD_FINGER_REWARD} 金手指 / 局`)}</span>
          <span class="shift-endless-meta">${selectedRun ? '继续本轮' : '开始新局'}</span>
        </span>
      </button>
    `;

    this.elements.endlessGrid.querySelector('[data-shift-endless-difficulty]')?.addEventListener('click', () => {
      this.selectEndlessDifficulty(difficulty.id);
    });

    this.elements.endlessHeading.textContent = '动脑局';
    this.elements.endlessProgress.textContent = selectedRun
      ? `当前第 ${selectedRun.round} 局 · 连过 ${selectedRun.streak || 0} 局`
      : '随机生成 · 不限制步数和时间';
    this.elements.listModeLabel.textContent = '无限模式';
    this.elements.listSubtitle.textContent = selectedRun
      ? `动脑 · 第 ${selectedRun.round} 局`
      : '动脑 · 随机生成';
    this.elements.listMeta.textContent = '';
    this.elements.listSummary.textContent = selectedRun
      ? `回到第 ${selectedRun.round} 局继续动脑。`
      : '随机生成高密度盘面，尽量过滤白给开局。';
    this.elements.listPrimary.textContent = selectedRun
      ? `继续第 ${selectedRun.round} 局`
      : '开始动脑局';
    this.elements.listSecondary.textContent = '重开本轮';
    this.elements.listSecondary.classList.toggle('is-hidden', !selectedRun);
  }
  enterSelectedListItem() {
    if (this.menuModeFocus === 'endless') {
      this.enterSelectedEndlessLevel();
      return;
    }
    this.startCampaignLevel(this.selectedCampaignIndex);
  }

  handleListSecondaryAction() {
    if (this.menuModeFocus === 'endless') {
      this.startNewEndlessRun(this.selectedEndlessDifficulty);
    }
  }

  handleToolSlot(toolId) {
    if (!this.runtimeLevel) {
      this.showToast('先进入一局，再决定要不要用道具。');
      return;
    }
    if (toolId === 'masterKey') {
      if (!hasLockGates(this.runtimeLevel)) {
        this.showToast('当前章节还没有锁门，万能钥匙先留到后面章节。');
        return;
      }
      if (this.saveData.inventory.masterKey > 0) {
        this.toggleMasterKey();
      } else {
        this.openShopForTool('masterKey');
      }
      return;
    }
    if (toolId === 'goldFinger') {
      if (this.saveData.inventory.goldFinger > 0) {
        this.toggleGoldFinger();
      } else {
        this.openShopForTool('goldFinger');
      }
      return;
    }
    if (toolId === 'lubricant') {
      if (this.saveData.inventory.lubricant > 0) {
        this.toggleLubricant();
      } else {
        this.openShopForTool('lubricant');
      }
    }
  }

  getPendingShopItem() {
    return this.pendingShopTool ? SHOP_ITEMS[this.pendingShopTool] || null : null;
  }

  getMaxAffordableShopQuantity(item = null) {
    const safeItem = item || this.getPendingShopItem();
    if (!safeItem) {
      return 0;
    }
    return Math.max(0, Math.floor((this.saveData.coins || 0) / safeItem.price));
  }

  syncShopModal() {
    const item = this.getPendingShopItem();
    if (!item) {
      return;
    }
    const maxAffordable = this.getMaxAffordableShopQuantity(item);
    const maxSelectable = Math.max(1, Math.min(99, maxAffordable > 0 ? maxAffordable : 1));
    this.pendingShopQuantity = clamp(Math.max(1, Math.floor(this.pendingShopQuantity || 1)), 1, maxSelectable);
    const totalPrice = item.price * this.pendingShopQuantity;

    this.elements.shopIcon.textContent = item.icon;
    this.elements.shopName.textContent = item.label;
    this.elements.shopDesc.textContent = item.description;
    this.elements.shopPrice.textContent = String(item.price);
    if (this.elements.shopTotalPrice) {
      this.elements.shopTotalPrice.textContent = String(totalPrice);
    }
    if (this.elements.shopQuantityValue) {
      this.elements.shopQuantityValue.textContent = String(this.pendingShopQuantity);
    }
    if (this.elements.shopQuantityMinus) {
      this.elements.shopQuantityMinus.disabled = this.pendingShopQuantity <= 1;
    }
    if (this.elements.shopQuantityPlus) {
      this.elements.shopQuantityPlus.disabled = this.pendingShopQuantity >= maxSelectable;
    }
    this.elements.shopQuantityPresets?.forEach((button) => {
      const quantity = Number(button.dataset.shiftShopQuantity) || 1;
      button.classList.toggle('is-active', quantity === this.pendingShopQuantity);
      button.disabled = quantity > maxSelectable;
    });
    this.elements.shopBuy.textContent = maxAffordable > 0 ? `购买 x${this.pendingShopQuantity}` : '金币不足';
    this.elements.shopBuy.disabled = maxAffordable <= 0;
  }

  setShopQuantity(quantity) {
    this.pendingShopQuantity = Math.max(1, Math.floor(quantity || 1));
    this.syncShopModal();
  }

  adjustShopQuantity(delta) {
    this.setShopQuantity((this.pendingShopQuantity || 1) + delta);
  }

  openShopForTool(toolId) {
    const item = SHOP_ITEMS[toolId];
    if (!item) {
      return;
    }
    this.pendingShopTool = item.id;
    this.pendingShopQuantity = 1;
    this.syncShopModal();
    this.openModal('shop');
  }

  buyPendingShopItem() {
    if (!this.pendingShopTool) {
      return;
    }
    const quantity = Math.max(1, Math.floor(this.pendingShopQuantity || 1));
    const ok = this.pendingShopTool === 'masterKey'
      ? this.buyMasterKey(quantity)
      : (this.pendingShopTool === 'goldFinger' ? this.buyGoldFinger(quantity) : this.buyLubricant(quantity));
    if (ok) {
      this.closeActiveModal();
    }
  }

  enterSelectedEndlessLevel(forceNew = false) {
    const resume = this.saveData.resume.endless;
    const activeRun = this.saveData.endless.activeRun;
    if (!forceNew) {
      if (resume?.difficultyId === this.selectedEndlessDifficulty) {
        this.startEndlessLevel(createEndlessRunState(resume.difficultyId, resume), {
          resumeBlocks: resume.blocks || null,
          resumeGates: resume.gates || null,
          resumeLogicState: resume.logicState || null,
          completed: resume.completed,
          rewardGranted: resume.rewardGranted,
          usedTools: resume.usedTools,
        });
        return;
      }
      if (activeRun?.difficultyId === this.selectedEndlessDifficulty) {
        this.startEndlessLevel(createEndlessRunState(activeRun.difficultyId, activeRun));
        return;
      }
    }
    this.startNewEndlessRun(this.selectedEndlessDifficulty);
  }

  returnToCurrentList() {
    const mode = this.currentMode || this.menuModeFocus || this.saveData.session.lastMode || 'campaign';
    if (mode === 'endless') {
      this.showLevelList('endless', {
        difficultyId: this.endlessRun?.difficultyId || this.selectedEndlessDifficulty,
      });
      return;
    }
    this.showLevelList('campaign', {
      levelIndex: this.currentMode === 'campaign' ? this.levelIndex : this.selectedCampaignIndex,
    });
  }

  restoreMenuState() {
    this.showHomeScreen();
  }

  showMenuPreview() {
    const previewSource = this.menuModeFocus === 'endless'
      ? createEndlessLevel({
        difficultyId: this.selectedEndlessDifficulty,
        baseSeed: this.saveData.endless.activeRun?.difficultyId === this.selectedEndlessDifficulty
          ? this.saveData.endless.activeRun.baseSeed
          : MENU_PREVIEW_SEED,
        round: this.saveData.endless.activeRun?.difficultyId === this.selectedEndlessDifficulty
          ? this.saveData.endless.activeRun.round
          : 1,
      })
      : SHIFT_LEVELS[this.selectedCampaignIndex] || SHIFT_LEVELS[0];
    this.previewLevel = createRuntimeLevel(previewSource);
  }

  startCampaignLevel(index, runtimeOverride = null) {
    this.levelIndex = clamp(index, 0, SHIFT_LEVELS.length - 1);
    this.selectedCampaignIndex = this.levelIndex;
    const source = runtimeOverride || createRuntimeLevel(SHIFT_LEVELS[this.levelIndex]);
    source.meta = {
      ...source.meta,
      mode: 'campaign',
      levelIndex: this.levelIndex,
    };
    source.usedTools = !!source.usedTools;
    if (!source.logicBaseLevel) {
      source.logicBaseLevel = createRuntimeLogicLevel(source);
    }
    if (source.logicState) {
      source.logicState = cloneLevelState(source.logicState);
    } else {
      rebuildRuntimeLogicState(source);
    }
    syncRuntimeLevelFromLogic(source);
    this.currentMode = 'campaign';
    this.runtimeLevel = source;
    this.previewLevel = null;
    this.endlessRun = this.saveData.endless.activeRun ? deepClone(this.saveData.endless.activeRun) : this.endlessRun;
    this.useMasterKeyMode = false;
    this.useGoldFingerMode = false;
    this.useLubricantMode = false;
    this.saveData.session.lastMode = 'campaign';
    this.closeActiveModal();
    this.showScreen('play');
    this.clearLevelMeshes();
    this.buildBoard(this.runtimeLevel);
    this.buildLevelMeshes(this.runtimeLevel);
    this.focusCamera();
    this.updateHud();
    this.persistResume();
  }

  startNewEndlessRun(difficultyId) {
    const runState = createEndlessRunState(difficultyId);
    return this.startEndlessLevel(runState, {
      isNewRun: true,
    });
  }

  async startEndlessLevel(runState, options = {}) {
    const normalizedRun = createEndlessRunState(runState.difficultyId, runState);
    const hasResumeState = !!options.resumeLogicState || (Array.isArray(options.resumeBlocks) && options.resumeBlocks.length > 0);
    const loadingTitle = options.loadingTitle
      || (options.isNewRun
        ? '正在生成新的动脑局'
        : (hasResumeState ? `正在恢复第 ${normalizedRun.round} 局` : `正在准备第 ${normalizedRun.round} 局`));
    const loadingCopy = options.loadingCopy
      || (hasResumeState ? '正在恢复你上次离开的盘面，请稍候。' : '正在整理高密度随机盘面，请稍候。');
    const loadingToken = Symbol(`endless:${normalizedRun.baseSeed}:${normalizedRun.round}`);
    this.endlessLoadingToken = loadingToken;
    this.setLoadingState(true, { title: loadingTitle, copy: loadingCopy });
    await this.waitForNextPaint(2);

    try {
      const source = createEndlessLevel({
        difficultyId: normalizedRun.difficultyId,
        baseSeed: normalizedRun.baseSeed,
        round: normalizedRun.round,
      });
      const runtimeLevel = createRuntimeLevel(source);
      if (Array.isArray(options.resumeBlocks) && options.resumeBlocks.length) {
        runtimeLevel.blocks = options.resumeBlocks.map(normalizeBlock);
      }
      if (Array.isArray(options.resumeGates) && options.resumeGates.length) {
        runtimeLevel.gates = deepClone(options.resumeGates);
      }
      if (options.resumeLogicState) {
        runtimeLevel.logicState = cloneLevelState(options.resumeLogicState);
      } else {
        rebuildRuntimeLogicState(runtimeLevel);
      }
      syncRuntimeLevelFromLogic(runtimeLevel);
      runtimeLevel.completed = !!options.completed;
      runtimeLevel.rewardGranted = !!options.rewardGranted;
      runtimeLevel.usedTools = !!options.usedTools;

      this.currentMode = 'endless';
      this.runtimeLevel = runtimeLevel;
      this.previewLevel = null;
      this.endlessRun = normalizedRun;
      this.selectedEndlessDifficulty = normalizedRun.difficultyId;
      this.useMasterKeyMode = false;
      this.useGoldFingerMode = false;
      this.useLubricantMode = false;
      this.saveData.endless.lastDifficulty = normalizedRun.difficultyId;
      this.saveData.endless.activeRun = deepClone(normalizedRun);
      this.saveData.session.lastMode = 'endless';
      this.closeActiveModal();
      this.showScreen('play');
      this.clearLevelMeshes();
      this.buildBoard(this.runtimeLevel);
      this.buildLevelMeshes(this.runtimeLevel);
      this.focusCamera();
      this.updateHud();
      this.persistResume();
    } finally {
      if (this.endlessLoadingToken === loadingToken) {
        this.endlessLoadingToken = null;
        this.setLoadingState(false);
      }
    }
  }

  continueSavedRun() {
    const descriptor = this.getContinueDescriptor();
    if (!descriptor) {
      this.showToast('当前没有可继续的进度。');
      return;
    }

    if (descriptor.mode === 'campaign') {
      const resume = this.saveData.resume.campaign;
      if (!resume) {
        this.showToast('主线进度已失效，请重新开始。');
        return;
      }
      const index = clamp(
        Number.isFinite(resume.levelIndex) ? resume.levelIndex : SHIFT_LEVELS.findIndex((level) => level.id === resume.levelId),
        0,
        SHIFT_LEVELS.length - 1
      );
      const runtimeLevel = createRuntimeLevel(SHIFT_LEVELS[index] || SHIFT_LEVELS[0]);
      runtimeLevel.blocks = (resume.blocks || []).map(normalizeBlock);
      runtimeLevel.gates = deepClone(resume.gates || []);
      if (resume.logicState) {
        runtimeLevel.logicState = cloneLevelState(resume.logicState);
      } else {
        rebuildRuntimeLogicState(runtimeLevel);
      }
      syncRuntimeLevelFromLogic(runtimeLevel);
      runtimeLevel.completed = !!resume.completed;
      runtimeLevel.rewardGranted = !!resume.rewardGranted;
      runtimeLevel.usedTools = !!resume.usedTools;
      this.startCampaignLevel(index, runtimeLevel);
      return;
    }

    const resume = this.saveData.resume.endless;
    const activeRun = this.saveData.endless.activeRun;
    const runSource = resume
      ? createEndlessRunState(resume.difficultyId, resume)
      : activeRun
        ? createEndlessRunState(activeRun.difficultyId, activeRun)
        : null;

    if (!runSource) {
      this.showToast('无限模式进度已失效，请重新开始。');
      return;
    }

    this.startEndlessLevel(runSource, {
      resumeBlocks: resume?.blocks || null,
      resumeGates: resume?.gates || null,
      resumeLogicState: resume?.logicState || null,
      completed: resume?.completed,
      rewardGranted: resume?.rewardGranted,
      usedTools: resume?.usedTools,
    });
  }

  clearLevelMeshes() {
    while (this.boardGroup.children.length) {
      const child = this.boardGroup.children.pop();
      if (child.parent) {
        child.parent.remove(child);
      }
    }
    while (this.levelGroup.children.length) {
      const child = this.levelGroup.children.pop();
      if (child.parent) {
        child.parent.remove(child);
      }
    }
    this.blockViews.clear();
    this.gateViews.clear();
    this.exitViews = [];
    this.animations = [];
    this.drag = null;
  }

  clearDynamicLevelMeshes() {
    while (this.levelGroup.children.length) {
      const child = this.levelGroup.children.pop();
      if (child.parent) {
        child.parent.remove(child);
      }
    }
    this.blockViews.clear();
    this.gateViews.clear();
    this.animations = [];
    this.drag = null;
  }

  rebuildDynamicLevelMeshes() {
    if (!this.runtimeLevel) {
      return;
    }
    const previousGateViews = new Map();
    this.gateViews.forEach((view, gateId) => {
      previousGateViews.set(gateId, {
        open: !!view.open,
        y: view.group?.position?.y ?? 0,
      });
    });
    this.clearDynamicLevelMeshes();
    this.buildLevelMeshes(this.runtimeLevel, { previousGateViews });
  }

  commitRuntimeMove(blockId, steps = []) {
    if (!this.runtimeLevel || !blockId) {
      return false;
    }
    if (!this.runtimeLevel.logicBaseLevel) {
      this.runtimeLevel.logicBaseLevel = createRuntimeLogicLevel(this.runtimeLevel);
    }
    if (!this.runtimeLevel.logicState) {
      rebuildRuntimeLogicState(this.runtimeLevel);
    }
    const normalizedSteps = (steps || []).filter((step) => Number.isFinite(step?.x) && Number.isFinite(step?.y));
    if (!normalizedSteps.length) {
      return false;
    }

    const finalStep = normalizedSteps[normalizedSteps.length - 1];
    const workingLevel = materializeLevel(this.runtimeLevel.logicBaseLevel, this.runtimeLevel.logicState);
    const workingState = cloneLevelState(this.runtimeLevel.logicState);
    const result = settleLevelAction(workingLevel, {
      blockId,
      targetAnchor: { x: finalStep.x, y: finalStep.y },
      approachDir: finalStep.approachDir || '',
    }, {
      state: workingState,
    });
    if (!result.ok) {
      return false;
    }

    this.runtimeLevel.logicState = cloneLevelState(result.state);
    this.runtimeLevel.session = deepClone(result.level.session || {});

    if (result.settleSummary?.cleared) {
      syncRuntimeLevelFromLogic(this.runtimeLevel, { preserveBlockId: blockId });
      this.rebuildDynamicLevelMeshes();
      this.persistResume();
      this.updateHud();
      const exit = (this.runtimeLevel.exits || []).find((entry) => entry.id === result.settleSummary.exitId)
        || (result.level.exits || []).find((entry) => entry.id === result.settleSummary.exitId)
        || null;
      this.animateClear(blockId, exit?.edge || '');
      return true;
    }

    syncRuntimeLevelFromLogic(this.runtimeLevel);
    this.rebuildDynamicLevelMeshes();
    this.persistResume();
    this.updateHud();
    this.playUiSound('move');
    this.triggerVibration(MOVE_VIBRATION_PATTERN);
    return true;
  }

  buildBoard(level) {
    if (!level) {
      return;
    }
    const board = level.board;
    const totalWidth = board.cols * CELL_SIZE;
    const totalHeight = board.rows * CELL_SIZE;
    const left = -totalWidth * 0.5;
    const top = -totalHeight * 0.5;
    const railBreadth = 0.42;
    const railOuterOffset = railBreadth * 0.5;
    const railDepth = BLOCK_HEIGHT;
    const exitBreadth = railBreadth;
    const exitDepth = railDepth;

    const tray = new THREE.Mesh(
      getRoundedPanelGeometry(
        this.geometryCache,
        `board-tray:${totalWidth}:${totalHeight}`,
        totalWidth + 0.82,
        totalHeight + 0.82,
        0.24,
        0.34,
        { bevelSize: 0.034, bevelThickness: 0.026, bevelSegments: 4, curveSegments: 12 }
      ),
      new THREE.MeshPhongMaterial({
        color: '#4c627a',
        emissive: new THREE.Color('#4c627a').multiplyScalar(0.052),
        specular: new THREE.Color('#e8f4ff').multiplyScalar(0.08),
        shininess: 18,
        toneMapped: false,
      })
    );
    tray.position.set(0, -0.16, 0);
    tray.castShadow = true;
    tray.receiveShadow = true;
    this.boardGroup.add(tray);

    const playfield = new THREE.Mesh(
      getRoundedPanelGeometry(
        this.geometryCache,
        `board-playfield:${totalWidth}:${totalHeight}`,
        totalWidth + 0.02,
        totalHeight + 0.02,
        0.1,
        0.22,
        { bevelSize: 0.018, bevelThickness: 0.014, bevelSegments: 3, curveSegments: 10 }
      ),
      new THREE.MeshPhongMaterial({
        color: '#44588f',
        emissive: new THREE.Color('#4b62a7').multiplyScalar(0.028),
        specular: new THREE.Color('#edf5ff').multiplyScalar(0.05),
        shininess: 16,
        toneMapped: false,
      })
    );
    playfield.position.set(0, -0.08, 0);
    playfield.receiveShadow = true;
    const playfieldOverlay = new THREE.Mesh(
      getRoundedTopPlateGeometry(
        this.geometryCache,
        `board-playfield-overlay-plate:${totalWidth}:${totalHeight}`,
        totalWidth + 0.02,
        totalHeight + 0.02,
        0.22,
        28
      ),
      new THREE.MeshBasicMaterial({
        color: '#ffffff',
        map: getBoardPlayfieldOverlayTexture(this.textureCache),
        transparent: true,
        opacity: 0.4,
        alphaTest: 0.02,
        depthWrite: false,
        toneMapped: false,
      })
    );
    playfieldOverlay.position.y = 0.052;
    playfieldOverlay.renderOrder = 2;
    playfield.add(playfieldOverlay);
    this.boardGroup.add(playfield);

    const cellGeometry = getRoundedPanelGeometry(
      this.geometryCache,
      'board-cell-well',
      CELL_SIZE - 0.16,
      CELL_SIZE - 0.16,
      0.065,
      0.17,
      { bevelSize: 0.016, bevelThickness: 0.013, bevelSegments: 3, curveSegments: 12 }
    );
    const cellMaterials = [
      new THREE.MeshPhongMaterial({
        color: '#7488cb',
        emissive: new THREE.Color('#6d82cd').multiplyScalar(0.016),
        specular: new THREE.Color('#edf4ff').multiplyScalar(0.042),
        shininess: 14,
        toneMapped: false,
      }),
      new THREE.MeshPhongMaterial({
        color: '#677cc0',
        emissive: new THREE.Color('#6076c1').multiplyScalar(0.016),
        specular: new THREE.Color('#edf4ff').multiplyScalar(0.038),
        shininess: 14,
        toneMapped: false,
      }),
    ];

    const cellOverlayGeometry = getRoundedTopPlateGeometry(
      this.geometryCache,
      'board-cell-overlay-plate',
      CELL_SIZE - 0.18,
      CELL_SIZE - 0.18,
      0.17,
      22
    );
    const cellOverlayMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: getBoardSlotOverlayTexture(this.textureCache),
      transparent: true,
      opacity: 0,
      alphaTest: 0.02,
      depthWrite: false,
      toneMapped: false,
    });
    const embeddedMechanicCellKeys = getMechanicCellKeySet(level.tiles || [], isBoardReplacingMechanicTile);
    for (let row = 0; row < board.rows; row += 1) {
      for (let col = 0; col < board.cols; col += 1) {
        if (embeddedMechanicCellKeys.has(`${col},${row}`)) {
          continue;
        }
        const cell = new THREE.Mesh(cellGeometry, cellMaterials[(row + col) % cellMaterials.length]);
        cell.position.set(left + (col + 0.5) * CELL_SIZE, 0.02, top + (row + 0.5) * CELL_SIZE);
        cell.receiveShadow = true;
        const cellOverlay = new THREE.Mesh(cellOverlayGeometry, cellOverlayMaterial);
        cellOverlay.position.y = 0.035;
        cellOverlay.renderOrder = 2;
        cell.add(cellOverlay);
        this.boardGroup.add(cell);
      }
    }

    const railMaterial = new THREE.MeshPhongMaterial({
      color: '#58636f',
      emissive: new THREE.Color('#51606d').multiplyScalar(0.016),
      specular: new THREE.Color('#ecf5ff').multiplyScalar(0.07),
      shininess: 18,
      toneMapped: false,
    });

    const cornerSize = railBreadth;
    const cornerGeometry = getQuarterCornerGeometry(
      this.geometryCache,
      `board-corner-quarter:${cornerSize}:${railDepth}`,
      cornerSize,
      railDepth,
      { bevelSize: 0.02, bevelThickness: 0.016, bevelSegments: 4, curveSegments: 24 }
    );
    const railCornerOverlayGeometry = getQuarterCornerTopPlateGeometry(
      this.geometryCache,
      `board-corner-quarter-overlay:${cornerSize}`,
      cornerSize,
      24
    );
    const railSurfaceOverlayMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: getRailSurfaceOverlayTexture(this.textureCache),
      transparent: true,
      opacity: 0.24,
      alphaTest: 0.02,
      depthWrite: false,
      toneMapped: false,
    });
    const exitSurfaceOverlayMaterial = new THREE.MeshBasicMaterial({
      color: '#ffffff',
      map: getExitSurfaceOverlayTexture(this.textureCache),
      transparent: true,
      opacity: 0.5,
      alphaTest: 0.02,
      depthWrite: false,
      toneMapped: false,
    });
    [
      { position: [left - cornerSize * 0.5, railDepth * 0.5, top - cornerSize * 0.5], rotationY: 0 },
      { position: [left + totalWidth + cornerSize * 0.5, railDepth * 0.5, top - cornerSize * 0.5], rotationY: -Math.PI * 0.5 },
      { position: [left + totalWidth + cornerSize * 0.5, railDepth * 0.5, top + totalHeight + cornerSize * 0.5], rotationY: Math.PI },
      { position: [left - cornerSize * 0.5, railDepth * 0.5, top + totalHeight + cornerSize * 0.5], rotationY: Math.PI * 0.5 },
    ].forEach(({ position, rotationY }) => {
      const corner = new THREE.Mesh(cornerGeometry, railMaterial);
      corner.position.set(...position);
      corner.rotation.y = rotationY;
      corner.castShadow = true;
      corner.receiveShadow = true;
      const cornerOverlay = new THREE.Mesh(railCornerOverlayGeometry, railSurfaceOverlayMaterial);
      cornerOverlay.position.y = railDepth * 0.5 + 0.003;
      cornerOverlay.renderOrder = 3;
      corner.add(cornerOverlay);
      this.boardGroup.add(corner);
    });

    const segmentEndRadius = railBreadth * 0.24;
    const getEdgePieceGeometry = (length, isVertical, radii) => {
      const key = isVertical
        ? `board-edge-piece-v:${length}:${radii.tl}:${radii.tr}:${radii.br}:${radii.bl}`
        : `board-edge-piece-h:${length}:${radii.tl}:${radii.tr}:${radii.br}:${radii.bl}`;
      return getCorneredPanelGeometry(
        this.geometryCache,
        key,
        isVertical ? railBreadth : length,
        isVertical ? length : railBreadth,
        railDepth,
        radii,
        { bevelSize: 0.022, bevelThickness: 0.018, bevelSegments: 4, curveSegments: 16 }
      );
    };

    const buildEdgePieces = (edge, totalCells) => {
      const exits = (level.exits || [])
        .filter((candidate) => candidate.edge === edge)
        .sort((leftExit, rightExit) => leftExit.start - rightExit.start);
      const segments = [];
      let cursor = 0;
      exits.forEach((exit) => {
        if (exit.start > cursor) {
          segments.push({ kind: 'rail', start: cursor, span: exit.start - cursor, exit: null });
        }
        segments.push({ kind: 'exit', start: exit.start, span: exit.span, exit });
        cursor = exit.start + exit.span;
      });
      if (cursor < totalCells) {
        segments.push({ kind: 'rail', start: cursor, span: totalCells - cursor, exit: null });
      }

      const cornerGap = 0.018;
      const bottomRightGap = 0.03;
      const pieceGap = 0.03;
      const isVertical = edge === 'left' || edge === 'right';

      segments.forEach((segment) => {
        const segmentEnd = segment.start + segment.span;
        const touchesStartCorner = segment.start <= 0;
        const touchesEndCorner = segmentEnd >= totalCells;
        const startInset = touchesStartCorner ? cornerGap : pieceGap;
        const endInset = touchesEndCorner
          ? ((edge === 'bottom' || edge === 'right') ? bottomRightGap : cornerGap)
          : pieceGap;
        const pieceLength = Math.max(0.22, segment.span * CELL_SIZE - startInset - endInset);
        const center = segment.start * CELL_SIZE + startInset + pieceLength * 0.5;
        const geometry = getEdgePieceGeometry(
          pieceLength,
          isVertical,
          isVertical
            ? {
                tl: segmentEndRadius,
                tr: segmentEndRadius,
                br: segmentEndRadius,
                bl: segmentEndRadius,
              }
            : {
                tl: segmentEndRadius,
                tr: segmentEndRadius,
                br: segmentEndRadius,
                bl: segmentEndRadius,
              }
        );
        const material = segment.kind === 'exit'
          ? (() => {
              const exitColor = getBoostedToyColor(segment.exit.acceptColor, 0.28, 0.002, 'exit');
              const exitInsetColor = getBoostedToyColor(segment.exit.acceptColor, 0.32, 0.028, 'exitInset');
              return new THREE.MeshPhongMaterial({
                color: exitColor,
                emissive: exitColor.clone().multiplyScalar(0.14),
                specular: new THREE.Color('#ffffff').multiplyScalar(0.28),
                shininess: 44,
                toneMapped: false,
              });
            })()
          : railMaterial;
        const mesh = new THREE.Mesh(geometry, material);
        const surfaceOverlayGeometry = getCorneredTopPlateGeometry(
          this.geometryCache,
          isVertical
            ? `board-edge-piece-overlay-v:${pieceLength}:${segmentEndRadius}`
            : `board-edge-piece-overlay-h:${pieceLength}:${segmentEndRadius}`,
          isVertical ? railBreadth - 0.03 : Math.max(0.18, pieceLength - 0.04),
          isVertical ? Math.max(0.18, pieceLength - 0.04) : railBreadth - 0.03,
          { tl: Math.max(0.04, segmentEndRadius - 0.02), tr: Math.max(0.04, segmentEndRadius - 0.02), br: Math.max(0.04, segmentEndRadius - 0.02), bl: Math.max(0.04, segmentEndRadius - 0.02) },
          18
        );
        const surfaceOverlay = new THREE.Mesh(
          surfaceOverlayGeometry,
          segment.kind === 'exit' ? exitSurfaceOverlayMaterial : railSurfaceOverlayMaterial
        );
        surfaceOverlay.position.y = railDepth * 0.5 + 0.003;
        surfaceOverlay.renderOrder = 3;
        mesh.add(surfaceOverlay);
        if (edge === 'top') {
          mesh.position.set(left + center, railDepth * 0.5, top - railOuterOffset);
        } else if (edge === 'bottom') {
          mesh.position.set(left + center, railDepth * 0.5, top + totalHeight + railOuterOffset);
        } else if (edge === 'left') {
          mesh.position.set(left - railOuterOffset, railDepth * 0.5, top + center);
        } else {
          mesh.position.set(left + totalWidth + railOuterOffset, railDepth * 0.5, top + center);
        }
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.boardGroup.add(mesh);
        if (segment.kind === 'exit') {
          this.exitViews.push({ exit: segment.exit, mesh, frame: null, rim: null, glow: null, badge: null });
        }
      });
    };

    buildEdgePieces('top', board.cols);
    buildEdgePieces('bottom', board.cols);
    buildEdgePieces('left', board.rows);
    buildEdgePieces('right', board.rows);
  }

  buildLevelMeshes(level, options = {}) {
    if (!level) {
      return;
    }
    const previousGateViews = options.previousGateViews || new Map();
    const addFlatMechanicMarker = (definition, kind) => {
      const bounds = getMechanicAreaBounds(definition.cells || []);
      const world = gridToWorld(level, bounds.minX, bounds.minY, bounds.w, bounds.h);
      const horizontal = bounds.w >= bounds.h;
      const isGate = kind === 'gate';
      const width = Math.max(0.72, bounds.w * (isGate && horizontal ? 0.96 : 0.9));
      const height = Math.max(0.56, bounds.h * (isGate && !horizontal ? 0.96 : (isGate ? 0.66 : 0.86)));
      const border = new THREE.Mesh(
        new THREE.PlaneGeometry(width, height),
        new THREE.MeshBasicMaterial({
          color: getMechanicMarkerPalette(definition, kind).edge,
          transparent: true,
          opacity: isGate ? 0.9 : 0.96,
          depthWrite: false,
          toneMapped: false,
        })
      );
      border.rotation.x = -Math.PI * 0.5;
      border.position.set(world.x, isGate ? 0.058 : 0.054, world.z);
      border.renderOrder = 3;
      this.levelGroup.add(border);

      const base = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(0.64, width - 0.05), Math.max(0.48, height - 0.05)),
        new THREE.MeshBasicMaterial({
          color: getMechanicMarkerPalette(definition, kind).base,
          transparent: true,
          opacity: isGate ? (definition.open ? 0.78 : 0.94) : 0.97,
          depthWrite: false,
          toneMapped: false,
        })
      );
      base.rotation.x = -Math.PI * 0.5;
      base.position.set(world.x, isGate ? 0.059 : 0.055, world.z);
      base.renderOrder = 3;
      this.levelGroup.add(base);

      const overlay = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.max(0.62, width - 0.08), Math.max(0.46, height - 0.08)),
        new THREE.MeshBasicMaterial({
          color: '#ffffff',
          map: getMechanicMarkerTexture(this.textureCache, definition, kind, { spanX: bounds.w, spanY: bounds.h }),
          transparent: true,
          opacity: 1,
          alphaTest: 0.001,
          depthWrite: false,
          toneMapped: false,
        })
      );
      overlay.rotation.x = -Math.PI * 0.5;
      overlay.position.set(world.x, isGate ? 0.061 : 0.057, world.z);
      overlay.renderOrder = 4;
      this.levelGroup.add(overlay);
    };

    const addMechanicMarker = (definition, kind) => {
      const bounds = getMechanicAreaBounds(definition.cells || []);
      const world = gridToWorld(level, bounds.minX, bounds.minY, bounds.w, bounds.h);
      const palette = getMechanicMarkerPalette(definition, kind);
      const spanX = Math.max(1, bounds.w);
      const spanY = Math.max(1, bounds.h);
      const horizontal = spanX >= spanY;
      const isGate = kind === 'gate';
      const group = new THREE.Group();
      group.position.set(world.x, 0, world.z);

      if (!isGate && definition.type === 'ice') {
        const iceWidth = Math.max(0.84, spanX * CELL_SIZE - 0.08);
        const iceHeight = Math.max(0.84, spanY * CELL_SIZE - 0.08);
        const iceRadius = Math.min(0.18, Math.min(iceWidth, iceHeight) * 0.24);
        const iceBody = new THREE.Mesh(
          getRoundedPanelGeometry(
            this.geometryCache,
            `mechanic-ice:${iceWidth.toFixed(3)}:${iceHeight.toFixed(3)}:${iceRadius.toFixed(3)}`,
            iceWidth,
            iceHeight,
            0.05,
            iceRadius,
            { bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 3, curveSegments: 14 }
          ),
          new THREE.MeshPhongMaterial({
            color: new THREE.Color('#8ae6ff'),
            transparent: true,
            opacity: 0.92,
            emissive: new THREE.Color('#7dddff').multiplyScalar(0.22),
            specular: new THREE.Color('#ffffff').multiplyScalar(0.54),
            shininess: 96,
            toneMapped: false,
          })
        );
        iceBody.position.y = 0.01;
        iceBody.receiveShadow = true;
        group.add(iceBody);

        const iceGloss = new THREE.Mesh(
          getRoundedTopPlateGeometry(
            this.geometryCache,
            `mechanic-ice-top:${iceWidth.toFixed(3)}:${iceHeight.toFixed(3)}`,
            Math.max(0.24, iceWidth - 0.12),
            Math.max(0.24, iceHeight - 0.12),
            Math.max(0.06, iceRadius - 0.04),
            20
          ),
          new THREE.MeshPhongMaterial({
            color: '#f2fdff',
            transparent: true,
            opacity: 0.18,
            emissive: new THREE.Color('#ffffff').multiplyScalar(0.1),
            specular: new THREE.Color('#ffffff').multiplyScalar(0.7),
            shininess: 140,
            depthWrite: false,
            toneMapped: false,
          })
        );
        iceGloss.position.y = 0.056;
        iceGloss.renderOrder = 4;
        group.add(iceGloss);

        const sparkleMaterial = new THREE.MeshBasicMaterial({
          color: '#ffffff',
          transparent: true,
          opacity: 0.96,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const sparkleShadowMaterial = new THREE.MeshBasicMaterial({
          color: '#2e97bb',
          transparent: true,
          opacity: 0.24,
          depthWrite: false,
          side: THREE.DoubleSide,
          toneMapped: false,
        });
        const createSparkle = () => {
          const sparkle = new THREE.Group();
          const layers = [
            { material: sparkleShadowMaterial, y: 0.063, x: 0.016, z: 0.016, scale: 1.14 },
            { material: sparkleMaterial, y: 0.068, x: 0, z: 0, scale: 1 },
          ];
          layers.forEach((layer) => {
            const layerGroup = new THREE.Group();
            layerGroup.position.set(layer.x, layer.y, layer.z);
            layerGroup.scale.setScalar(layer.scale);
            [
              [0.36, 0.05, 0],
              [0.36, 0.05, Math.PI * 0.5],
              [0.24, 0.045, Math.PI * 0.25],
              [0.24, 0.045, -Math.PI * 0.25],
            ].forEach(([length, thickness, rotation]) => {
              const bar = new THREE.Mesh(new THREE.PlaneGeometry(length, thickness), layer.material);
              bar.rotation.x = -Math.PI * 0.5;
              bar.rotation.z = rotation;
              layerGroup.add(bar);
            });
            const core = new THREE.Mesh(new THREE.CircleGeometry(0.045, 18), layer.material);
            core.rotation.x = -Math.PI * 0.5;
            layerGroup.add(core);
            sparkle.add(layerGroup);
          });
          return sparkle;
        };
        const iconCount = horizontal ? Math.max(2, Math.min(3, spanX)) : Math.max(1, Math.min(2, spanY));
        const iconTravel = horizontal ? Math.max(0, iceWidth - 0.84) : Math.max(0, iceHeight - 0.84);
        for (let index = 0; index < iconCount; index += 1) {
          const icon = createSparkle();
          const t = iconCount === 1 ? 0.5 : index / (iconCount - 1);
          const offset = iconCount === 1 ? 0 : (-iconTravel * 0.5 + iconTravel * t);
          icon.position.set(horizontal ? offset : 0, 0, horizontal ? 0 : offset);
          icon.renderOrder = 5;
          group.add(icon);
        }

        this.levelGroup.add(group);
        return;
      }

      if (isGate) {
        const bodyWidth = horizontal
          ? Math.max(0.84, spanX * CELL_SIZE - 0.12)
          : 0.28;
        const bodyHeight = horizontal
          ? 0.28
          : Math.max(0.84, spanY * CELL_SIZE - 0.12);
        const bodyDepth = definition.type === 'one_way' ? 0.28 : 0.32;
        const bodyRadius = Math.min(0.11, Math.min(bodyWidth, bodyHeight) * 0.42);
        const bodyColor = new THREE.Color(palette.base);
        const edgeColor = new THREE.Color(palette.edge);
        const bodyOpacity = getMechanicGateOpacity(definition);
        const bodyMaterial = new THREE.MeshPhongMaterial({
          color: bodyColor,
          transparent: bodyOpacity < 0.985,
          opacity: bodyOpacity,
          emissive: bodyColor.clone().multiplyScalar(definition.open ? 0.12 : 0.05),
          specular: edgeColor.clone().multiplyScalar(0.24),
          shininess: definition.open ? 44 : 30,
          toneMapped: false,
        });
        const body = new THREE.Mesh(
          getRoundedPanelGeometry(
            this.geometryCache,
            `mechanic-gate-body:${definition.type}:${bodyWidth.toFixed(3)}:${bodyHeight.toFixed(3)}:${bodyDepth.toFixed(3)}:${bodyRadius.toFixed(3)}`,
            bodyWidth,
            bodyHeight,
            bodyDepth,
            bodyRadius,
            { bevelSize: 0.018, bevelThickness: 0.015, bevelSegments: 3, curveSegments: 14 }
          ),
          bodyMaterial
        );
        body.position.y = bodyDepth * 0.5;
        body.castShadow = bodyOpacity >= 0.72;
        body.receiveShadow = true;
        group.add(body);

        const topPlateMaterial = definition.type === 'one_way'
          ? new THREE.MeshPhongMaterial({
              color: edgeColor.clone().lerp(bodyColor, 0.24),
              emissive: bodyColor.clone().multiplyScalar(0.08),
              specular: new THREE.Color('#ffffff').multiplyScalar(0.34),
              shininess: 84,
              toneMapped: false,
            })
          : new THREE.MeshBasicMaterial({
              color: '#ffffff',
              map: getMechanicGlyphTexture(this.textureCache, definition, kind, { spanX, spanY }),
              transparent: true,
              opacity: definition.open ? 0.92 : 1,
              alphaTest: 0.04,
              depthWrite: false,
              toneMapped: false,
            });
        const topPlate = new THREE.Mesh(
          getRoundedTopPlateGeometry(
            this.geometryCache,
            `mechanic-gate-top:${definition.type}:${bodyWidth.toFixed(3)}:${bodyHeight.toFixed(3)}:${Math.max(0.04, bodyRadius - 0.018).toFixed(3)}`,
            Math.max(0.2, bodyWidth - 0.04),
            Math.max(0.2, bodyHeight - 0.04),
            Math.max(0.04, bodyRadius - 0.018),
            20
          ),
          topPlateMaterial
        );
        topPlate.position.y = bodyDepth + 0.004;
        topPlate.renderOrder = 5;
        group.add(topPlate);

        if (definition.type === 'one_way') {
          const arrowGeometry = getArrowIconGeometry(this.geometryCache, `mechanic-oneway-arrow`);
          const arrowMaterial = new THREE.MeshPhongMaterial({
            color: '#ffffff',
            emissive: new THREE.Color('#ffffff').multiplyScalar(0.24),
            specular: new THREE.Color('#ffffff').multiplyScalar(0.94),
            shininess: 164,
            toneMapped: false,
          });
          const count = Math.max(4, Math.min(8, (horizontal ? spanX : spanY) * 2));
          const rotationY = {
            right: 0,
            bottom: -Math.PI * 0.5,
            left: Math.PI,
            top: Math.PI * 0.5,
          }[definition.allowDir] || 0;
          for (let index = 0; index < count; index += 1) {
            const t = count === 1 ? 0.5 : index / (count - 1);
            const arrow = new THREE.Mesh(arrowGeometry, arrowMaterial.clone());
            arrow.rotation.y = rotationY;
            arrow.position.set(
              horizontal ? (-bodyWidth * 0.28 + t * bodyWidth * 0.56) : 0,
              bodyDepth + 0.022,
              horizontal ? 0 : (-bodyHeight * 0.28 + t * bodyHeight * 0.56)
            );
            arrow.scale.setScalar(1.14);
            group.add(arrow);
          }
        }

        const gateView = {
          id: definition.id,
          type: definition.type,
          group,
          body,
          topPlate,
          baseColor: bodyColor,
          travelDepth: definition.type === 'one_way' ? bodyDepth + 0.16 : bodyDepth + 0.34,
          open: !!definition.open,
          targetOpen: !!definition.open,
        };
        const previous = previousGateViews.get(definition.id) || null;
        if (previous && previous.open !== gateView.targetOpen) {
          applyGateViewVisualState(gateView, previous.open, previous.y);
          this.animations.push({
            time: 0,
            update: (dt) => {
              const t = clamp(dt * GATE_SWITCH_SPEED, 0, 1);
              const targetY = getMechanicGateTargetYOffset(gateView, gateView.targetOpen);
              const nextY = lerp(gateView.group.position.y, targetY, t);
              applyGateViewVisualState(gateView, gateView.targetOpen, nextY);
              const done = Math.abs(gateView.group.position.y - targetY) < 0.01;
              if (done) {
                applyGateViewVisualState(gateView, gateView.targetOpen);
              }
              return done;
            },
          });
        } else {
          applyGateViewVisualState(gateView, gateView.targetOpen);
        }
        this.gateViews.set(definition.id, gateView);
      } else if (isEmbeddedMechanicTile(definition)) {
        const socketWidth = Math.max(0.82, spanX * CELL_SIZE - 0.12);
        const socketHeight = Math.max(0.82, spanY * CELL_SIZE - 0.12);
        const socketDepth = 0.052;
        const insertDepth = 0.03;
        const socketRadius = Math.min(0.18, Math.min(socketWidth, socketHeight) * 0.24);
        const paletteEdgeColor = new THREE.Color(palette.edge);
        const socketColor = new THREE.Color(palette.base).multiplyScalar(0.58).lerp(paletteEdgeColor, 0.06);
        const insertColor = new THREE.Color(palette.base).lerp(paletteEdgeColor, 0.18);

        const socket = new THREE.Mesh(
          getRoundedPanelGeometry(
            this.geometryCache,
            `mechanic-socket:${definition.type}:${socketWidth.toFixed(3)}:${socketHeight.toFixed(3)}:${socketDepth.toFixed(3)}:${socketRadius.toFixed(3)}`,
            socketWidth,
            socketHeight,
            socketDepth,
            socketRadius,
            { bevelSize: 0.016, bevelThickness: 0.012, bevelSegments: 3, curveSegments: 14 }
          ),
          new THREE.MeshPhongMaterial({
            color: socketColor,
            emissive: socketColor.clone().multiplyScalar(0.055),
            specular: new THREE.Color('#ffffff').multiplyScalar(0.16),
            shininess: 26,
            toneMapped: false,
          })
        );
        socket.position.y = -0.004;
        socket.receiveShadow = true;
        group.add(socket);

        const insert = new THREE.Mesh(
          getRoundedPanelGeometry(
            this.geometryCache,
            `mechanic-insert:${definition.type}:${socketWidth.toFixed(3)}:${socketHeight.toFixed(3)}`,
            Math.max(0.26, socketWidth - 0.09),
            Math.max(0.26, socketHeight - 0.09),
            insertDepth,
            Math.max(0.08, socketRadius - 0.03),
            { bevelSize: 0.012, bevelThickness: 0.01, bevelSegments: 3, curveSegments: 14 }
          ),
          new THREE.MeshPhongMaterial({
            color: insertColor,
            emissive: insertColor.clone().multiplyScalar(0.1),
            specular: new THREE.Color('#ffffff').multiplyScalar(0.34),
            shininess: 42,
            toneMapped: false,
          })
        );
        insert.position.y = 0.002;
        insert.receiveShadow = true;
        group.add(insert);

        const insertGloss = new THREE.Mesh(
          getRoundedTopPlateGeometry(
            this.geometryCache,
            `mechanic-insert-gloss:${definition.type}:${socketWidth.toFixed(3)}:${socketHeight.toFixed(3)}`,
            Math.max(0.22, socketWidth - 0.14),
            Math.max(0.22, socketHeight - 0.14),
            Math.max(0.06, socketRadius - 0.05),
            18
          ),
          new THREE.MeshBasicMaterial({
            color: '#ffffff',
            transparent: true,
            opacity: 0.16,
            alphaTest: 0.02,
            depthWrite: false,
            toneMapped: false,
          })
        );
        insertGloss.position.y = insert.position.y + insertDepth * 0.5 + 0.003;
        insertGloss.renderOrder = 4;
        group.add(insertGloss);

        const showGlyph = definition.type !== 'recolor';
        const glyphY = insert.position.y + insertDepth * 0.5 + 0.004;
        if (showGlyph) {
          const glyph = new THREE.Mesh(
            getRoundedTopPlateGeometry(
              this.geometryCache,
              `mechanic-glyph-top:${definition.type}:${socketWidth.toFixed(3)}:${socketHeight.toFixed(3)}`,
              Math.max(0.3, socketWidth - 0.1),
              Math.max(0.3, socketHeight - 0.1),
              Math.max(0.06, socketRadius - 0.04),
              18
            ),
            new THREE.MeshBasicMaterial({
              color: '#ffffff',
              map: getMechanicGlyphTexture(this.textureCache, definition, kind, { spanX, spanY }),
              transparent: true,
              opacity: 1,
              alphaTest: 0.001,
              depthWrite: false,
              toneMapped: false,
            })
          );
          glyph.position.y = glyphY;
          glyph.renderOrder = 5;
          group.add(glyph);
        }

        if (definition.type === 'key_pad' || definition.type === 'toggle_switch' || definition.type === 'recolor') {
          const iconGroup = createEmbeddedMechanicIcon(definition, this.geometryCache, this.textureCache);
          if (iconGroup) {
            iconGroup.position.set(0, glyphY + 0.05, 0);
            group.add(iconGroup);
          }
        }
      } else {
        addFlatMechanicMarker(definition, kind);
        return;
      }

      this.levelGroup.add(group);
    };

    (level.tiles || []).forEach((tile) => addMechanicMarker(tile, 'tile'));
    (level.gates || []).forEach((gate) => addMechanicMarker(gate, 'gate'));
    level.blocks.forEach((block) => {
      const materials = createBlockMaterials(block.style, this.textureCache);
      const group = new THREE.Group();
      group.userData.blockId = block.id;
      const shapeKey = getShapeSignature(block.shapeCells, { w: block.w, h: block.h });
      if (!this.geometryCache.has(shapeKey)) {
        this.geometryCache.set(shapeKey, createSolidBlockGeometry(block.shapeCells, { w: block.w, h: block.h }));
      }
      const bodyMesh = new THREE.Mesh(this.geometryCache.get(shapeKey), [materials.surface, materials.side]);
      bodyMesh.castShadow = true;
      bodyMesh.receiveShadow = true;
      bodyMesh.userData.blockId = block.id;
      group.add(bodyMesh);

      const topCap = null;
      const topGloss = null;

      const shadowKey = `block-contact-shadow:${shapeKey}`;
      if (!this.geometryCache.has(shadowKey)) {
        this.geometryCache.set(shadowKey, createContactShadowGeometry(block.shapeCells, { w: block.w, h: block.h }));
      }
      const shadowGeometry = this.geometryCache.get(shadowKey);
      const shadowOuter = new THREE.Mesh(
        shadowGeometry,
        new THREE.MeshBasicMaterial({
          color: '#18304e',
          transparent: true,
          opacity: CONTACT_SHADOW_OUTER_OPACITY,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -2,
          toneMapped: false,
        })
      );
      shadowOuter.renderOrder = 1;
      const shadowInner = new THREE.Mesh(
        shadowGeometry,
        new THREE.MeshBasicMaterial({
          color: '#102541',
          transparent: true,
          opacity: CONTACT_SHADOW_INNER_OPACITY,
          depthWrite: false,
          polygonOffset: true,
          polygonOffsetFactor: -1,
          polygonOffsetUnits: -2,
          toneMapped: false,
        })
      );
      shadowInner.renderOrder = 1;

      const studGeometry = getStudGeometry(this.geometryCache);
      const studOffsets = [-0.22, 0.22];
      block.shapeCells.forEach((cell) => {
        studOffsets.forEach((offsetX) => {
          studOffsets.forEach((offsetZ) => {
            const stud = new THREE.Mesh(studGeometry, materials.stud);
            stud.castShadow = false;
            stud.receiveShadow = false;
            stud.scale.setScalar(BLOCK_STUD_SCALE);
            stud.position.set(
              (cell.x + 0.5 - block.w * 0.5) * CELL_SIZE + offsetX * BLOCK_VISUAL_SCALE,
              BLOCK_HEIGHT * 0.5 + 0.01,
              (cell.y + 0.5 - block.h * 0.5) * CELL_SIZE + offsetZ * BLOCK_VISUAL_SCALE
            );
            group.add(stud);
          });
        });
      });

      const pos = gridToWorld(level, block.x, block.y, block.w, block.h);
      group.position.set(pos.x, BLOCK_HEIGHT * 0.5, pos.z);
      shadowOuter.position.set(pos.x, CONTACT_SHADOW_Y, pos.z);
      shadowInner.position.set(pos.x, CONTACT_SHADOW_Y + 0.002, pos.z);
      this.levelGroup.add(shadowOuter);
      this.levelGroup.add(shadowInner);
      this.levelGroup.add(group);
      const view = {
        mesh: group,
        logic: block,
        visualAnchor: { x: block.x, y: block.y },
        impact: 0,
        badge: null,
        shadowOuter,
        shadowInner,
        topCap,
        topGloss,
        topMaterials: [materials.surface],
      };
      this.blockViews.set(block.id, view);
      this.syncBlockVisualState(view);
      syncContactShadowMeshes(view);
    });
  }

  syncBlockVisualState(view) {
    if (!view?.mesh || !view.logic) {
      return;
    }
    if (view.badge?.parent) {
      view.badge.parent.remove(view.badge);
    }
    view.badge = createAxisBadge(view.logic, this.textureCache);
    if (view.badge) {
      view.mesh.add(view.badge);
    }
    (view.topMaterials || []).forEach((topMaterial) => {
      if (!topMaterial?.emissive) {
        return;
      }
      if (view.logic.isLubricated) {
        topMaterial.emissive.set('#59c9de');
      } else if (isAxisLimited(view.logic.moveAxis)) {
        topMaterial.emissive.set('#7a602a');
      } else {
        topMaterial.emissive.set('#000000');
      }
    });
  }

  focusCamera() {
    const levelForCamera = this.getSceneLevel() || { board: { cols: 5, rows: 5 } };
    const aspect = Math.max(0.52, (this.canvas.clientWidth || 1) / Math.max(1, this.canvas.clientHeight || 1));
    const direction = getPerspectiveCameraDirection(aspect);
    const bounds = new THREE.Box3();
    if (this.boardGroup || this.levelGroup) {
      this.scene?.updateMatrixWorld?.(true);
      if (this.boardGroup) {
        this.boardGroup.updateMatrixWorld(true);
        bounds.expandByObject(this.boardGroup);
      }
      if (this.levelGroup) {
        this.levelGroup.updateMatrixWorld(true);
        bounds.expandByObject(this.levelGroup);
      }
    }
    if (bounds.isEmpty()) {
      bounds.copy(getFallbackSceneBounds(levelForCamera));
    }
    bounds.expandByVector(new THREE.Vector3(0.16, 0.16, 0.18));

    const target = getPerspectiveCameraTarget(bounds);
    const fitPoints = getCameraFitPoints(bounds);
    this.camera.aspect = aspect;
    this.camera.fov = aspect < 0.7 ? 21 : 19;

    let low = 4.2;
    let high = 36;
    for (let i = 0; i < 28; i += 1) {
      const distance = (low + high) * 0.5;
      this.camera.position.copy(target).addScaledVector(direction, distance);
      this.camera.lookAt(target);
      this.camera.updateProjectionMatrix();
      this.camera.updateMatrixWorld();
      const fits = fitPoints.every((point) => {
        const projected = point.clone().project(this.camera);
        return projected.x >= -0.86 && projected.x <= 0.86 && projected.y >= -0.84 && projected.y <= 0.84;
      });
      if (fits) {
        high = distance;
      } else {
        low = distance;
      }
    }

    this.camera.position.copy(target).addScaledVector(direction, high * 1.04);
    this.camera.lookAt(target);
    this.camera.updateProjectionMatrix();
    this.camera.updateMatrixWorld();
  }

  handleResize() {
    if (!this.renderer) {
      return;
    }
    const width = Math.max(320, Math.round(this.canvas.clientWidth || this.canvas.parentElement.clientWidth || window.innerWidth));
    const height = Math.max(420, Math.round(this.canvas.clientHeight || Math.min(window.innerHeight * 0.74, 860)));
    this.renderer.setSize(width, height, false);
    this.focusCamera();
    this.render();
  }

  updateLegend(level) {
    if (!this.elements.legend) {
      return;
    }
    this.elements.legend.innerHTML = '';
    this.elements.legend.classList.add('is-hidden');
  }

  updateGuide() {

    if (!this.elements.guide) {
      return;
    }
    if (this.currentScreen !== 'play') {
      this.elements.guide.innerHTML = '';
      this.elements.guide.classList.add('is-hidden');
      return;
    }
    let message = '';
    if (this.runtimeLevel?.meta?.guideText && !this.runtimeLevel.completed) {
      message = escapeHtml(this.runtimeLevel.meta.guideText);
    } else if (this.currentMode === 'campaign' && this.levelIndex === 0 && this.runtimeLevel && !this.runtimeLevel.completed) {
      message = '把红块拖到右侧红门，整块离场。';
    }
    this.elements.guide.innerHTML = message;
    this.elements.guide.classList.toggle('is-hidden', !message);
  }

  updateHud() {
    const coinsText = String(this.saveData.coins);
    this.elements.coinDisplays.forEach((element) => {
      element.textContent = coinsText;
    });
    this.elements.masterKeyCount.textContent = String(this.saveData.inventory.masterKey);
    this.elements.goldFingerCount.textContent = String(this.saveData.inventory.goldFinger);
    this.elements.lubricantCount.textContent = String(this.saveData.inventory.lubricant);
    this.elements.useMasterKey.classList.toggle('is-active', this.useMasterKeyMode);
    this.elements.useGoldFinger.classList.toggle('is-active', this.useGoldFingerMode);
    this.elements.useLubricant.classList.toggle('is-active', this.useLubricantMode);
    const showStatusPill = !!this.runtimeLevel && (this.runtimeLevel.completed || this.useMasterKeyMode || this.useGoldFingerMode || this.useLubricantMode);
    this.elements.status.classList.toggle('is-hidden', !showStatusPill);
    this.updateMenuSummary();
    this.updateLegend(this.getSceneLevel());
    this.updateGuide();

    if (!this.runtimeLevel) {
      const difficulty = getEndlessDifficulty(this.selectedEndlessDifficulty);
      const unlockedCount = Math.max(1, Math.min(getCampaignPlayableLimit() + 1, SHIFT_LEVELS.length));
      this.elements.modeLine.textContent = this.menuModeFocus === 'endless' ? `无限模式 · ${difficulty.label}` : '主线模式';
      this.elements.levelLabel.textContent = this.menuModeFocus === 'endless'
        ? '准备开始'
        : formatCampaignLevelLabel(this.selectedCampaignIndex);
      this.elements.status.textContent = '看颜色，把整块送到对应门槽。';
      this.elements.meta.textContent = this.menuModeFocus === 'endless'
        ? `${difficulty.rewardCoins} 金币 + ${CLEAR_GOLD_FINGER_REWARD} 金手指 / 局 · 随机生成`
        : `主线暂缓打磨 · 已开放 ${unlockedCount} / ${SHIFT_LEVELS.length}`;
      return;
    }

    if (this.currentMode === 'endless') {
      const difficulty = getEndlessDifficulty(this.runtimeLevel.meta?.difficultyId || this.endlessRun?.difficultyId || 'brain');
      const streak = this.endlessRun?.streak || 0;
      const round = this.runtimeLevel.meta?.round || this.endlessRun?.round || 1;
      this.elements.modeLine.textContent = `无限模式 · ${difficulty.label}`;
      this.elements.levelLabel.textContent = `第 ${round} 局`;
      if (this.runtimeLevel.completed) {
        this.elements.status.textContent = '本局已完成，随时进入下一局。';
      } else if (this.useMasterKeyMode) {
        this.elements.status.textContent = '当前关卡没有锁门时，先把钥匙留着。';
      } else if (this.useGoldFingerMode) {
        this.elements.status.textContent = '点一个方块，直接把它移出当前棋盘。';
      } else if (this.useLubricantMode) {
        this.elements.status.textContent = '点一个方向块，让它本局自由移动。';
      } else {
        this.elements.status.textContent = '随机高密度盘面，尽量不做白给开局。';
      }
      const stageSummary = this.runtimeLevel.meta?.stageSummary ? ` · ${this.runtimeLevel.meta.stageSummary}` : '';
      this.elements.meta.textContent = `连过 ${streak} 局 · 本轮已得 ${this.endlessRun?.totalEarned || 0} 金币${stageSummary}`;
      return;
    }

    const activeLevel = SHIFT_LEVELS[this.levelIndex];
    const record = activeLevel ? this.saveData.progression.completed[activeLevel.id] : null;
    const chapter = getCampaignChapterByIndex(this.levelIndex);
    this.elements.modeLine.textContent = `主线模式 · ${chapter?.shortTitle || '主线'}`;
    this.elements.levelLabel.textContent = formatCampaignLevelLabel(this.levelIndex);
    if (this.runtimeLevel.completed) {
      this.elements.status.textContent = '本关已整理完成。';
    } else if (this.useMasterKeyMode) {
      this.elements.status.textContent = '当前关卡没有锁门时，先把钥匙留着。';
    } else if (this.useGoldFingerMode) {
      this.elements.status.textContent = '点一个方块，直接把它移出当前棋盘。';
    } else if (this.useLubricantMode) {
      this.elements.status.textContent = '点一个方向块，让它本局自由移动。';
    } else {
      this.elements.status.textContent = '自由拖动方块，把整块送到同色门槽。';
    }
    this.elements.meta.textContent = record?.perfect
      ? '已点亮完美星标'
      : `${this.runtimeLevel.meta?.chapterTitle || '主线'} · 首通 ${this.runtimeLevel.rewardCoins} 金币 + ${CLEAR_GOLD_FINGER_REWARD} 金手指`;
  }

  toggleMasterKey() {
    if (!this.runtimeLevel || this.saveData.inventory.masterKey <= 0) {
      this.showToast('当前没有可用的万能钥匙。');
      return;
    }
    if (!hasLockGates(this.runtimeLevel)) {
      this.showToast('当前关卡还没有锁门，先把钥匙留到后面章节。');
      return;
    }
    const nextState = !this.useMasterKeyMode;
    this.useMasterKeyMode = nextState;
    if (nextState) {
      this.useGoldFingerMode = false;
      this.useLubricantMode = false;
    }
    this.updateHud();
  }

  buyMasterKey(quantity = 1) {
    const amount = Math.max(1, Math.floor(quantity || 1));
    const totalCost = MASTER_KEY_COST * amount;
    if (this.saveData.coins < totalCost) {
      this.showToast('金币不够，先通过几局再来购买。');
      return false;
    }
    this.saveData.coins -= totalCost;
    this.saveData.inventory.masterKey += amount;
    this.persistSave();
    this.updateHud();
    this.showToast(`已购买 ${amount} 把万能钥匙。`);
    return true;
  }

  toggleGoldFinger() {
    if (!this.runtimeLevel || this.saveData.inventory.goldFinger <= 0) {
      this.showToast('当前没有可用的金手指。');
      return;
    }
    const nextState = !this.useGoldFingerMode;
    this.useGoldFingerMode = nextState;
    if (nextState) {
      this.useMasterKeyMode = false;
      this.useLubricantMode = false;
    }
    this.updateHud();
  }

  buyGoldFinger(quantity = 1) {
    const amount = Math.max(1, Math.floor(quantity || 1));
    const totalCost = GOLD_FINGER_COST * amount;
    if (this.saveData.coins < totalCost) {
      this.showToast('金币不够，先通过几局再来购买。');
      return false;
    }
    this.saveData.coins -= totalCost;
    this.saveData.inventory.goldFinger += amount;
    this.persistSave();
    this.updateHud();
    this.showToast(`已购买 ${amount} 个金手指。`);
    return true;
  }

  toggleLubricant() {
    if (!this.runtimeLevel || this.saveData.inventory.lubricant <= 0) {
      this.showToast('当前没有可用的润滑油。');
      return;
    }
    const nextState = !this.useLubricantMode;
    this.useLubricantMode = nextState;
    if (nextState) {
      this.useMasterKeyMode = false;
      this.useGoldFingerMode = false;
    }
    this.updateHud();
  }

  buyLubricant(quantity = 1) {
    const amount = Math.max(1, Math.floor(quantity || 1));
    const totalCost = LUBRICANT_COST * amount;
    if (this.saveData.coins < totalCost) {
      this.showToast('金币不够，先通过几局再来购买。');
      return false;
    }
    this.saveData.coins -= totalCost;
    this.saveData.inventory.lubricant += amount;
    this.persistSave();
    this.updateHud();
    this.showToast(`已购买 ${amount} 份润滑油。`);
    return true;
  }

  resetLevel() {
    if (!this.runtimeLevel) {
      this.showToast('先开始一局再说。');
      return;
    }
    if (this.currentMode === 'endless') {
      if (!this.endlessRun) {
        this.showToast('当前没有可重置的无限局。');
        return;
      }
      if (this.runtimeLevel.completed) {
        this.showToast('这一局已经完成，可以直接进入下一局。');
        return;
      }
      const currentRun = createEndlessRunState(this.endlessRun.difficultyId, {
        ...this.endlessRun,
        round: this.runtimeLevel.meta?.round || this.endlessRun.round,
      });
      this.startEndlessLevel(currentRun);
      return;
    }
    this.startCampaignLevel(this.levelIndex);
  }

  goToNextLevel() {
    this.closeActiveModal();
    if (this.currentMode === 'endless') {
      if (!this.endlessRun) {
        this.showToast('当前没有可进入的下一局。');
        return;
      }
      this.startEndlessLevel(this.endlessRun);
      return;
    }
    const nextIndex = (this.levelIndex + 1) % SHIFT_LEVELS.length;
    this.startCampaignLevel(nextIndex);
  }

  handleReplay() {
    this.closeActiveModal();
    if (this.currentMode === 'endless') {
      this.startNewEndlessRun(this.endlessRun?.difficultyId || this.selectedEndlessDifficulty);
      return;
    }
    this.startCampaignLevel(this.levelIndex);
  }

  animate(timestamp) {
    if (!this.isRunning || this.compatFailed) {
      return;
    }
    const deltaSec = clamp((timestamp - this.lastFrameTs) / 1000, 1 / 180, 1 / 20);
    this.lastFrameTs = timestamp;
    this.update(deltaSec);
    this.render();
    requestAnimationFrame(this.animate);
  }

  update(deltaSec) {
    this.animations = this.animations.filter((anim) => {
      anim.time += deltaSec;
      const done = anim.update(deltaSec, anim.time);
      return !done;
    });

    const sceneLevel = this.getSceneLevel();
    if (!sceneLevel) {
      return;
    }

    this.blockViews.forEach((view) => {
      if (this.drag && this.drag.blockId === view.logic.id) {
        const pos = gridToWorld(sceneLevel, this.drag.activeAnchor.x, this.drag.activeAnchor.y, view.logic.w, view.logic.h);
        this.drag.blockedStrength = Math.max(0, (this.drag.blockedStrength || 0) - deltaSec * DRAG_BLOCKED_DECAY);
        const blockedStrength = this.drag.blockedStrength || 0;
        const blockedAttempt = this.drag.blockedAttempt || { x: 0, y: 0 };
        view.mesh.position.x = pos.x + blockedAttempt.x * DRAG_BLOCKED_NUDGE * blockedStrength;
        view.mesh.position.z = pos.z + blockedAttempt.y * DRAG_BLOCKED_NUDGE * blockedStrength;
        view.mesh.position.y = BLOCK_HEIGHT * 0.5 + 0.12 - blockedStrength * 0.012;
        if (Math.abs(blockedAttempt.x) > Math.abs(blockedAttempt.y)) {
          view.mesh.scale.set(1 - blockedStrength * DRAG_BLOCKED_SQUASH, 1, 1 + blockedStrength * DRAG_BLOCKED_SQUASH * 0.55);
        } else if (Math.abs(blockedAttempt.y) > 0) {
          view.mesh.scale.set(1 + blockedStrength * DRAG_BLOCKED_SQUASH * 0.55, 1, 1 - blockedStrength * DRAG_BLOCKED_SQUASH);
        } else {
          view.mesh.scale.setScalar(1);
        }
        syncContactShadowMeshes(view);
        return;
      }
      const pos = gridToWorld(sceneLevel, view.visualAnchor.x, view.visualAnchor.y, view.logic.w, view.logic.h);
      view.mesh.position.x = lerp(view.mesh.position.x, pos.x, clamp(deltaSec * SNAP_SPEED, 0, 1));
      view.mesh.position.z = lerp(view.mesh.position.z, pos.z, clamp(deltaSec * SNAP_SPEED, 0, 1));
      view.mesh.scale.x = lerp(view.mesh.scale.x, 1, clamp(deltaSec * 12, 0, 1));
      view.mesh.scale.y = lerp(view.mesh.scale.y, 1, clamp(deltaSec * 12, 0, 1));
      view.mesh.scale.z = lerp(view.mesh.scale.z, 1, clamp(deltaSec * 12, 0, 1));
      if (view.impact > 0) {
        view.impact = Math.max(0, view.impact - deltaSec * IMPACT_SPEED);
      }
      const lift = view.impact > 0 ? Math.sin(view.impact * Math.PI) * 0.08 : 0;
      view.mesh.position.y = BLOCK_HEIGHT * 0.5 + lift;
      syncContactShadowMeshes(view);
    });
  }

  render() {
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  handlePointerDown(event) {
    this.unlockAudio();
    if (event.cancelable) {
      event.preventDefault();
    }
    if (!this.runtimeLevel || this.runtimeLevel.completed || !this.pointerEnabled) {
      return;
    }
    const hit = this.pickBlock(event);
    if (!hit) {
      return;
    }
    const block = this.runtimeLevel.blocks.find((entry) => entry.id === hit.blockId);
    if (!block) {
      return;
    }
    if (this.useMasterKeyMode) {
      this.showToast('万能钥匙会在锁门机制接入后启用。');
      return;
    }
    if (this.useGoldFingerMode) {
      this.tryUseGoldFinger(block);
      return;
    }
    if (this.useLubricantMode) {
      this.tryUseLubricant(block);
      return;
    }
    const planePoint = this.getBoardPoint(event);
    if (!planePoint) {
      return;
    }
    const view = this.blockViews.get(block.id);
    this.drag = {
      pointerId: event.pointerId,
      blockId: block.id,
      block,
      startWorld: planePoint.clone ? planePoint.clone() : planePoint,
      lastWorld: planePoint.clone ? planePoint.clone() : planePoint,
      startAnchor: { x: block.x, y: block.y },
      activeAnchor: { x: block.x, y: block.y },
      blockedAttempt: null,
      blockedStrength: 0,
      hasMoveFeedback: false,
      pathSteps: [],
      previewState: cloneLevelState(this.runtimeLevel.logicState || rebuildRuntimeLogicState(this.runtimeLevel)),
      view,
    };
    trySetPointerCapture(this.canvas, event.pointerId);
    view.mesh.position.y = BLOCK_HEIGHT * 0.5 + 0.1;
  }

  handlePointerMove(event) {
    if (event.cancelable) {
      event.preventDefault();
    }
    if (!this.drag || event.pointerId !== this.drag.pointerId) {
      return;
    }
    const planePoint = this.getBoardPoint(event);
    if (!planePoint || !this.runtimeLevel) {
      return;
    }
    this.drag.lastWorld = planePoint.clone ? planePoint.clone() : planePoint;
    const deltaX = planePoint.x - this.drag.startWorld.x;
    const deltaZ = planePoint.z - this.drag.startWorld.z;
    if (Math.max(Math.abs(deltaX), Math.abs(deltaZ)) < DRAG_THRESHOLD) {
      return;
    }

    const desiredAnchor = {
      x: this.drag.startAnchor.x + (deltaX / CELL_SIZE),
      y: this.drag.startAnchor.y + (deltaZ / CELL_SIZE),
    };

    if (this.drag.block.moveAxis === 'horizontal') {
      desiredAnchor.y = this.drag.startAnchor.y;
    } else if (this.drag.block.moveAxis === 'vertical') {
      desiredAnchor.x = this.drag.startAnchor.x;
    }

    const previousAnchor = { ...this.drag.activeAnchor };
    const resolution = resolveDraggedAnchor(
      this.runtimeLevel,
      this.drag.block,
      this.drag.activeAnchor,
      desiredAnchor,
      this.drag.previewState
    );
    this.drag.previewState = resolution.previewState || this.drag.previewState;
    this.drag.activeAnchor = resolution.anchor;
    (resolution.pathSteps || []).forEach((step) => {
      const lastStep = this.drag.pathSteps[this.drag.pathSteps.length - 1];
      if (!lastStep || lastStep.x !== step.x || lastStep.y !== step.y) {
        this.drag.pathSteps.push(step);
      }
    });
    if (!this.drag.hasMoveFeedback && (resolution.anchor.x !== previousAnchor.x || resolution.anchor.y !== previousAnchor.y)) {
      this.drag.hasMoveFeedback = true;
    }
    if (resolution.blockedAttempt) {
      this.drag.blockedAttempt = resolution.blockedAttempt;
      this.drag.blockedStrength = 1;
    } else if ((this.drag.blockedStrength || 0) <= 0.02) {
      this.drag.blockedAttempt = null;
      this.drag.blockedStrength = 0;
    }

    const pos = gridToWorld(
      this.runtimeLevel,
      this.drag.activeAnchor.x,
      this.drag.activeAnchor.y,
      this.drag.block.w,
      this.drag.block.h
    );
    const blockedAttempt = this.drag.blockedAttempt || { x: 0, y: 0 };
    const blockedStrength = this.drag.blockedStrength || 0;
    this.drag.view.mesh.position.x = pos.x + blockedAttempt.x * DRAG_BLOCKED_NUDGE * blockedStrength;
    this.drag.view.mesh.position.z = pos.z + blockedAttempt.y * DRAG_BLOCKED_NUDGE * blockedStrength;
    this.drag.view.mesh.position.y = BLOCK_HEIGHT * 0.5 + 0.12 - blockedStrength * 0.012;
  }

  resolveStationaryExitSwipe(drag, event) {
    if (!this.runtimeLevel) {
      return null;
    }
    const exit = getExitMatch(this.runtimeLevel, drag.block);
    if (!exit) {
      return null;
    }
    const blockedEdge = getEdgeFromAttempt(drag.blockedAttempt);
    if (blockedEdge === exit.edge) {
      return exit;
    }
    const planePoint = this.getBoardPoint(event) || drag.lastWorld || drag.startWorld;
    if (!planePoint || !drag.startWorld) {
      return null;
    }
    const swipeEdge = getSwipeEdgeFromWorldDelta(planePoint.x - drag.startWorld.x, planePoint.z - drag.startWorld.z);
    return swipeEdge === exit.edge ? exit : null;
  }

  handlePointerUp(event) {
    if (event?.cancelable) {
      event.preventDefault();
    }
    if (!this.drag) {
      return;
    }
    if (typeof event.pointerId === 'number' && event.pointerId !== this.drag.pointerId) {
      return;
    }
    const drag = this.drag;
    this.drag = null;
    tryReleasePointerCapture(this.canvas, event.pointerId);
    drag.view.mesh.scale.set(1, 1, 1);

    const finalX = drag.activeAnchor.x;
    const finalY = drag.activeAnchor.y;

    if (finalX === drag.startAnchor.x && finalY === drag.startAnchor.y) {
      const directExit = this.resolveStationaryExitSwipe(drag, event);
      if (directExit) {
        const committed = this.commitRuntimeMove(drag.block.id, [{
          x: drag.startAnchor.x,
          y: drag.startAnchor.y,
          approachDir: directExit.edge,
        }]);
        if (!committed) {
          drag.view.impact = 0.55;
        }
        return;
      }
      drag.view.impact = 0.55;
      return;
    }

    const steps = drag.pathSteps.length
      ? drag.pathSteps
      : [{ x: finalX, y: finalY, approachDir: getApproachDirFromAnchors(drag.startAnchor, { x: finalX, y: finalY }) }];
    const committed = this.commitRuntimeMove(drag.block.id, steps);
    if (!committed) {
      drag.view.impact = 0.55;
    }
  }

  resolveBlockLanding(block) {
    if (!block) {
      return;
    }
    const committed = this.commitRuntimeMove(block.id, [{
      x: block.x,
      y: block.y,
      approachDir: '',
    }]);
    if (!committed) {
      const view = this.blockViews.get(block.id);
      if (view) {
        view.impact = 0.55;
      }
    }
  }

  animateClear(blockId, edge) {
    const view = this.blockViews.get(blockId);
    if (!view) {
      return;
    }
    this.pointerEnabled = false;
    const start = view.mesh.position.clone();
    const target = start.clone();
    if (edge === 'right') {
      target.x += 1.1;
    } else if (edge === 'left') {
      target.x -= 1.1;
    } else if (edge === 'top') {
      target.z -= 1.1;
    } else {
      target.z += 1.1;
    }
    this.animations.push({
      time: 0,
      update: (_dt, elapsed) => {
        const t = clamp(elapsed * CLEAR_SPEED, 0, 1);
        view.mesh.position.lerpVectors(start, target, t);
        view.mesh.scale.setScalar(1 - t * 0.3);
        view.mesh.rotation.y = t * 0.28;
        if (t >= 1) {
          this.completeClear(blockId);
          return true;
        }
        return false;
      },
    });
  }

  completeClear(blockId) {
    if (this.runtimeLevel?.logicState?.blocks?.[blockId]) {
      this.runtimeLevel.logicState.blocks[blockId].cleared = true;
    }
    const index = this.runtimeLevel.blocks.findIndex((block) => block.id === blockId);
    if (index >= 0) {
      this.runtimeLevel.blocks.splice(index, 1);
    }
    const view = this.blockViews.get(blockId);
    if (view) {
      if (view.mesh.parent) {
        view.mesh.parent.remove(view.mesh);
      }
      if (view.shadowOuter?.parent) {
        view.shadowOuter.parent.remove(view.shadowOuter);
      }
      if (view.shadowInner?.parent) {
        view.shadowInner.parent.remove(view.shadowInner);
      }
      this.blockViews.delete(blockId);
    }
    syncRuntimeLevelFromLogic(this.runtimeLevel);
    this.rebuildDynamicLevelMeshes();
    this.pointerEnabled = true;
    this.playUiSound('success');
    this.triggerVibration(EXIT_VIBRATION_PATTERN);
    if (countTargets(this.runtimeLevel) === 0) {
      this.completeLevel();
    } else {
      this.persistResume();
    }
  }

  completeLevel() {
    if (!this.runtimeLevel) {
      return;
    }
    this.runtimeLevel.completed = true;
    this.runtimeLevel.perfectClear = !this.runtimeLevel.usedTools;

    if (this.currentMode === 'endless') {
      const difficulty = getEndlessDifficulty(this.runtimeLevel.meta?.difficultyId || this.endlessRun?.difficultyId || 'brain');
      const currentRun = createEndlessRunState(difficulty.id, this.endlessRun || this.saveData.endless.activeRun || {});
      const nextStreak = currentRun.streak + 1;
      const bonus = getEndlessBonus(nextStreak);
      const reward = this.runtimeLevel.rewardCoins;
      if (!this.runtimeLevel.rewardGranted) {
        this.runtimeLevel.rewardGranted = true;
        currentRun.streak = nextStreak;
        currentRun.totalEarned += reward + bonus;
        currentRun.round += 1;
        this.endlessRun = currentRun;
        this.saveData.coins += reward + bonus;
        this.saveData.inventory.goldFinger += CLEAR_GOLD_FINGER_REWARD;
        this.saveData.endless.activeRun = deepClone(currentRun);
        this.saveData.endless.lastDifficulty = difficulty.id;
        this.saveData.endless.bestStreak = Math.max(this.saveData.endless.bestStreak || 0, nextStreak);
        this.saveData.session.lastMode = 'endless';
        this.saveData = clearResume(this.saveData, 'endless');
        this.persistSave();
      }
      this.elements.resultBadge.textContent = '∞';
      this.elements.resultBadge.classList.remove('is-perfect');
      this.elements.resultTitle.textContent = '本局完成';
      this.elements.winCopy.textContent = bonus > 0
        ? `本局获得 ${reward} 金币 + ${CLEAR_GOLD_FINGER_REWARD} 个金手指，连过 ${nextStreak} 局追加 ${bonus} 金币。`
        : `本局获得 ${reward} 金币 + ${CLEAR_GOLD_FINGER_REWARD} 个金手指，继续下一局吧。`;
      this.elements.resultReward.textContent = String(reward + bonus);
      this.elements.resultExtra.textContent = this.runtimeLevel.usedTools
        ? `当前连过 ${nextStreak} 局 · +${CLEAR_GOLD_FINGER_REWARD} 金手指`
        : `未用道具 · 当前连过 ${nextStreak} 局 · +${CLEAR_GOLD_FINGER_REWARD} 金手指`;
      this.elements.next.textContent = '下一局';
      this.elements.replay.textContent = '重新开一轮';
      this.updateHud();
      this.playUiSound('win');
      this.triggerVibration(WIN_VIBRATION_PATTERN);
      this.openModal('win');
      return;
    }

    const reward = getRewardForLevel(this.saveData, this.runtimeLevel);
    const perfectClear = !this.runtimeLevel.usedTools;
    if (!this.runtimeLevel.rewardGranted) {
      this.runtimeLevel.rewardGranted = true;
      this.saveData.coins += reward;
      this.saveData.inventory.goldFinger += CLEAR_GOLD_FINGER_REWARD;
      const currentRecord = this.saveData.progression.completed[this.runtimeLevel.id] || {};
      this.saveData.progression.completed[this.runtimeLevel.id] = {
        cleared: true,
        perfect: !!currentRecord.perfect || perfectClear,
        clearedAt: new Date().toISOString(),
      };
      this.saveData.progression.lastLevelIndex = this.levelIndex;
      this.saveData.progression.unlockedLevelIndex = Math.max(
        this.saveData.progression.unlockedLevelIndex,
        clamp(this.levelIndex + 1, 0, SHIFT_LEVELS.length - 1)
      );
      this.saveData = clearResume(this.saveData, 'campaign');
      this.persistSave();
    }
    this.elements.resultBadge.textContent = perfectClear ? '★' : '✓';
    this.elements.resultBadge.classList.toggle('is-perfect', perfectClear);
    this.elements.resultTitle.textContent = perfectClear ? '完美通关' : '完成啦';
    this.elements.winCopy.textContent = perfectClear
      ? `未使用道具完成本关，已获得 ${reward} 金币和 ${CLEAR_GOLD_FINGER_REWARD} 个金手指。`
      : `本关已整理完成，已获得 ${reward} 金币和 ${CLEAR_GOLD_FINGER_REWARD} 个金手指。`;
    this.elements.resultReward.textContent = String(reward);
    this.elements.resultExtra.textContent = perfectClear ? `已点亮关卡星标 · +${CLEAR_GOLD_FINGER_REWARD} 金手指` : `可重玩冲击完美 · +${CLEAR_GOLD_FINGER_REWARD} 金手指`;
    this.elements.next.textContent = '下一关';
    this.elements.replay.textContent = '重玩本关';
    this.updateHud();
    this.playUiSound('win');
    this.triggerVibration(WIN_VIBRATION_PATTERN);
    this.openModal('win');
  }

  tryUseLubricant(block) {
    if (!isAxisLimited(block.moveAxis)) {
      if (block.isLubricated || (block.moveAxis === 'both' && isAxisLimited(block.baseMoveAxis))) {
        this.showToast('这个方向块已经在本局恢复自由移动了。');
      } else {
        this.showToast('润滑油只能作用于带箭头的方向块。');
      }
      return;
    }
    if (this.saveData.inventory.lubricant <= 0) {
      this.showToast('当前没有可用的润滑油。');
      return;
    }
    this.saveData.inventory.lubricant -= 1;
    this.useLubricantMode = false;
    this.runtimeLevel.usedTools = true;
    block.baseMoveAxis = isAxisLimited(block.baseMoveAxis) ? block.baseMoveAxis : block.moveAxis;
    block.moveAxis = 'both';
    block.isLubricated = true;
    if (this.runtimeLevel?.logicState?.blocks?.[block.id]) {
      this.runtimeLevel.logicState.blocks[block.id].moveAxis = 'both';
      this.runtimeLevel.logicState.blocks[block.id].flags = {
        ...(this.runtimeLevel.logicState.blocks[block.id].flags || {}),
        isLubricated: true,
      };
    }
    const view = this.blockViews.get(block.id);
    if (view) {
      this.syncBlockVisualState(view);
      view.impact = 0.42;
    }
    this.persistResume();
    this.persistSave();
    this.updateHud();
    this.playUiSound('tap');
    this.triggerVibration([10]);
    this.showToast('已涂上润滑油，这个方向块本局可自由移动。');
  }

  tryUseGoldFinger(block) {
    if (block.role !== 'target') {
      this.showToast('金手指只能作用于可移动目标方块。');
      return;
    }
    if (this.saveData.inventory.goldFinger <= 0) {
      this.showToast('当前没有可用的金手指。');
      return;
    }
    this.saveData.inventory.goldFinger -= 1;
    this.useMasterKeyMode = false;
    this.useGoldFingerMode = false;
    this.useLubricantMode = false;
    this.runtimeLevel.usedTools = true;
    if (this.runtimeLevel?.logicState?.blocks?.[block.id]) {
      this.runtimeLevel.logicState.blocks[block.id].cleared = true;
    }
    const index = this.runtimeLevel.blocks.findIndex((entry) => entry.id === block.id);
    if (index >= 0) {
      this.runtimeLevel.blocks.splice(index, 1);
    }
    const view = this.blockViews.get(block.id);
    if (view?.mesh?.parent) {
      view.mesh.parent.remove(view.mesh);
    }
    if (view?.shadowOuter?.parent) {
      view.shadowOuter.parent.remove(view.shadowOuter);
    }
    if (view?.shadowInner?.parent) {
      view.shadowInner.parent.remove(view.shadowInner);
    }
    this.blockViews.delete(block.id);
    syncRuntimeLevelFromLogic(this.runtimeLevel);
    this.rebuildDynamicLevelMeshes();
    this.playUiSound('tap');
    this.triggerVibration([12]);
    if (countTargets(this.runtimeLevel) === 0) {
      this.updateHud();
      this.completeLevel();
      return;
    }
    this.persistResume();
    this.persistSave();
    this.updateHud();
    this.showToast('已用金手指移除一个方块。');
  }

  pickBlock(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const meshes = Array.from(this.blockViews.values()).map((view) => view.mesh);
    const hits = this.raycaster.intersectObjects(meshes, true);
    if (!hits.length) {
      return null;
    }
    const blockId = resolveBlockIdFromObject(hits[0].object);
    return blockId ? { blockId } : null;
  }

  getBoardPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointerNdc.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    this.pointerNdc.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    this.raycaster.setFromCamera(this.pointerNdc, this.camera);
    const target = new THREE.Vector3();
    const ok = this.raycaster.ray.intersectPlane(this.boardPlane, target);
    return ok ? target.clone() : null;
  }

  highlightMatchingExits(style) {
    this.exitViews.forEach(({ exit, mesh, frame, rim, glow }) => {
      const config = STYLE_CONFIG[exit.acceptColor] || STYLE_CONFIG.yellow;
      const active = !!style && exit.acceptColor === normalizeStyleKey(style);
      if (mesh?.material?.color) {
        mesh.material.color.set(active ? (config.accent || config.color) : config.color);
      }
      if (mesh?.material?.emissive) {
        mesh.material.emissive.copy(new THREE.Color(config.color).multiplyScalar(active ? 0.34 : 0.16));
      }
      mesh.scale.setScalar(1);
      if (frame?.material?.color) {
        frame.material.color.set(active ? '#fffef6' : '#fff6db');
      }
      if (frame?.material?.emissive) {
        frame.material.emissive.set(active ? '#fff7e2' : '#f0e2b6');
      }
      if (rim?.material?.color) {
        rim.material.color.set(active ? '#27435e' : '#31445d');
      }
      if (rim?.material?.emissive) {
        rim.material.emissive.set(active ? '#365779' : '#223245');
      }
      if (glow?.material) {
        glow.material.color.set(active ? '#ffffff' : (config.accent || '#fff8df'));
        glow.material.opacity = active ? 1 : 0.84;
        glow.scale.setScalar(active ? 1.08 : 0.92);
      }
    });
  }

  handleKeyDown(event) {
    if (event.key === 'Escape' && this.currentModal) {
      event.preventDefault();
      this.closeActiveModal();
      return;
    }
    if (event.key && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      if (!document.fullscreenElement) {
        this.canvas.requestFullscreen?.();
      } else {
        document.exitFullscreen?.();
      }
    }
  }

  showToast(message) {
    window.clearTimeout(this.toastTimer);
    if (!message) {
      this.elements.toast.textContent = '';
      this.elements.toast.classList.remove('is-visible');
      return;
    }
    this.elements.toast.textContent = message;
    this.elements.toast.classList.add('is-visible');
    this.toastTimer = window.setTimeout(() => {
      this.elements.toast.classList.remove('is-visible');
    }, 1500);
  }

  persistResume() {
    if (!this.runtimeLevel) {
      return;
    }

    if (this.currentMode === 'endless') {
      if (this.runtimeLevel.completed) {
        this.saveData = clearResume(this.saveData, 'endless');
        this.persistSave();
        return;
      }
      const currentRun = createEndlessRunState(this.runtimeLevel.meta?.difficultyId || this.endlessRun?.difficultyId || 'brain', {
        ...this.endlessRun,
        round: this.runtimeLevel.meta?.round || this.endlessRun?.round || 1,
      });
      this.endlessRun = currentRun;
      this.saveData.endless.activeRun = deepClone(currentRun);
      this.saveData.resume.endless = {
        mode: 'endless',
        levelId: this.runtimeLevel.id,
        difficultyId: currentRun.difficultyId,
        baseSeed: currentRun.baseSeed,
        round: currentRun.round,
        streak: currentRun.streak,
        totalEarned: currentRun.totalEarned,
        blocks: this.runtimeLevel.blocks.map(normalizeBlock),
        gates: deepClone(this.runtimeLevel.gates || []),
        logicState: this.runtimeLevel.logicState ? cloneLevelState(this.runtimeLevel.logicState) : null,
        completed: this.runtimeLevel.completed,
        rewardGranted: this.runtimeLevel.rewardGranted,
        usedTools: this.runtimeLevel.usedTools,
      };
      this.saveData.session.lastMode = 'endless';
      this.persistSave();
      return;
    }

    if (this.runtimeLevel.completed) {
      this.saveData = clearResume(this.saveData, 'campaign');
      this.persistSave();
      return;
    }
    this.saveData.progression.lastLevelIndex = this.levelIndex;
    this.saveData.resume.campaign = {
      mode: 'campaign',
      levelId: this.runtimeLevel.id,
      levelIndex: this.levelIndex,
      blocks: this.runtimeLevel.blocks.map(normalizeBlock),
      gates: deepClone(this.runtimeLevel.gates || []),
      logicState: this.runtimeLevel.logicState ? cloneLevelState(this.runtimeLevel.logicState) : null,
      completed: this.runtimeLevel.completed,
      rewardGranted: this.runtimeLevel.rewardGranted,
      usedTools: this.runtimeLevel.usedTools,
    };
    this.saveData.session.lastMode = 'campaign';
    this.persistSave();
  }

  persistSave() {
    this.saveData = saveSaveData(normalizeSaveData(this.saveData));
  }

  renderGameToText() {
    const endlessDifficulty = this.runtimeLevel?.meta?.difficultyId || this.endlessRun?.difficultyId || null;
    const payload = {
      mode: this.compatFailed
        ? 'compat'
        : (this.currentModal === 'win' ? 'result' : this.currentScreen),
      modeKind: this.currentMode || this.menuModeFocus || 'campaign',
      currentScreen: this.currentScreen,
      currentModal: this.currentModal,
      menuFocus: this.menuModeFocus,
      coordinateSystem: {
        origin: 'top-left',
        x: 'right+',
        y: 'down+',
      },
      levelIndex: this.currentMode === 'campaign' ? this.levelIndex : null,
      selectedCampaignIndex: this.selectedCampaignIndex,
      levelId: this.runtimeLevel ? this.runtimeLevel.id : null,
      campaignLabel: (this.currentMode === 'campaign' || this.menuModeFocus === 'campaign') ? formatCampaignLevelLabel(this.currentMode === 'campaign' ? this.levelIndex : this.selectedCampaignIndex) : null,
      board: this.runtimeLevel ? deepClone(this.runtimeLevel.board) : (this.previewLevel ? deepClone(this.previewLevel.board) : null),
      coins: this.saveData.coins,
      masterKeyCount: this.saveData.inventory.masterKey,
      goldFingerCount: this.saveData.inventory.goldFinger,
      lubricantCount: this.saveData.inventory.lubricant,
      chapterCount: CAMPAIGN_CHAPTERS.length,
      settings: {
        volume: this.saveData.settings?.volume ?? 0.7,
        musicEnabled: this.saveData.settings?.musicEnabled ?? true,
        sfxEnabled: this.saveData.settings?.sfxEnabled ?? true,
        vibrationEnabled: this.saveData.settings?.vibrationEnabled ?? true,
      },
      masterKeyMode: this.useMasterKeyMode,
      goldFingerMode: this.useGoldFingerMode,
      lubricantMode: this.useLubricantMode,
      activeTool: this.useMasterKeyMode ? 'masterKey' : (this.useGoldFingerMode ? 'goldFinger' : (this.useLubricantMode ? 'lubricant' : null)),
      usedTools: !!this.runtimeLevel?.usedTools,
      perfectClear: !!this.runtimeLevel?.perfectClear,
      endlessDifficulty,
      endlessRound: this.runtimeLevel?.meta?.round || this.endlessRun?.round || null,
      endlessStreak: this.endlessRun?.streak || 0,
      endlessTotalEarned: this.endlessRun?.totalEarned || 0,
      blocks: (this.runtimeLevel || this.previewLevel) ? (this.runtimeLevel || this.previewLevel).blocks.map((block) => ({
        id: block.id,
        role: block.role === 'blocker' ? 'blocker' : 'target',
        style: block.style,
        x: block.x,
        y: block.y,
        w: block.w,
        h: block.h,
        shapePreset: block.shapePreset,
        shapeCells: deepClone(block.shapeCells),
        moveAxis: block.moveAxis,
        baseMoveAxis: block.baseMoveAxis,
        isLubricated: !!block.isLubricated,
      })) : [],
      exits: this.runtimeLevel ? deepClone(this.runtimeLevel.exits) : (this.previewLevel ? deepClone(this.previewLevel.exits) : []),
      continueMode: this.getContinueDescriptor()?.mode || null,
      movementModel: 'free-drag-path-snap',
      clearRule: 'full-span-exit',
    };
    return JSON.stringify(payload);
  }
}
