'use strict';

const BUILD_TAG = '__BUILD_TAG__';
const STORAGE_KEY_MAX_UNLOCKED = 'traffic_clear_max_unlocked';
const STORAGE_KEY_PLAYER_PROFILE = 'traffic_clear_profile_v1';
const STORAGE_KEY_RUNTIME_STATE = 'traffic_clear_runtime_v1';
const STORAGE_KEY_AUDIO_PREFS = 'traffic_clear_audio_prefs_v1';
const RUNTIME_STATE_VERSION = 1;
const RUNTIME_AUTOSAVE_SEC = 0.8;

const LEVELS_PER_PAGE = 24;
const GRID_ROWS = 6;
const GRID_COLS = 4;
const BOARD_W = 12;
const BOARD_H = 20;
const LENGTH_ONE_PROB = 0.60;

const COLOR_BG = '#f7f4ea';
const COLOR_TEXT = '#2d3a3a';
const COLOR_TEXT_MUTED = '#5a6767';
const COLOR_BUTTON = '#1f2b38';
const COLOR_BUTTON_BORDER = '#9a8f72';
const COLOR_BUTTON_TEXT = '#f2f4f6';
const COLOR_DISABLED = '#7f8590';
const COLOR_OVERLAY_WIN = 'rgba(45,58,58,0.55)';
const COLOR_OVERLAY_FAIL = 'rgba(115,30,30,0.55)';

const CAR_COLORS = ['#5ab0ff', '#8be160', '#ffd06a', '#bb9aff', '#57c9c7', '#ffab57'];
const ITEM_COST_GOLD_DEFAULT = 100;
const ITEM_COST_GOLD = {
  wrench: 100,
  step: 100,
  tow: 100,
  freeze: 50,
};
const LEVEL_HEARTS = 3;
const FREEZE_PEDESTRIAN_SEC = 5;
const WIN_REWARD_GOLD = 500;
const WIN_REWARD_ITEM_ROLLS = 2;
const ITEM_IDS = ['wrench', 'step', 'tow', 'freeze'];
const WIN_REWARD_ITEM_POOL = ITEM_IDS.filter((itemId) => itemId !== 'freeze');
const ITEM_LABEL = {
  wrench: '扳手',
  step: '步+5',
  tow: '拖车',
  freeze: '停行人',
};
const ITEM_DESC = {
  wrench: '拆除一段围栏',
  step: '本关步数上限 +5',
  tow: '移除一辆汽车',
  freeze: '行人停止移动5秒',
};
const CAR_IMPACT_SEC = 0.18;
const CAR_IMPACT_BACK_CELL = 0.055;
const CAR_IMPACT_SHAKE_CELL = 0.015;
const DRIVE_AUDIO_START_OFFSET_SEC = 0.55;
const TOUCH_VEHICLE_HIT_SLOP_PX = 10;
const TOUCH_DRAG_THRESHOLD_PX = 6;
const TOUCH_DRAG_AXIS_BIAS = 0.72;

function defaultProfile() {
  return {
    coins: 1000,
    inventory: {
      wrench: 10,
      step: 10,
      tow: 10,
      freeze: 10,
    },
  };
}

function cloneInventory(inv) {
  return {
    wrench: Math.max(0, Math.floor(inv.wrench || 0)),
    step: Math.max(0, Math.floor(inv.step || 0)),
    tow: Math.max(0, Math.floor(inv.tow || 0)),
    freeze: Math.max(0, Math.floor(inv.freeze || 0)),
  };
}

function normalizeProfile(raw) {
  const base = defaultProfile();
  if (!raw || typeof raw !== 'object') {
    return base;
  }
  const coins = Number.isFinite(raw.coins) ? Math.max(0, Math.floor(raw.coins)) : base.coins;
  const inv = raw.inventory && typeof raw.inventory === 'object' ? raw.inventory : {};
  return {
    coins,
    inventory: cloneInventory({
      wrench: Number.isFinite(inv.wrench) ? inv.wrench : base.inventory.wrench,
      step: Number.isFinite(inv.step) ? inv.step : base.inventory.step,
      tow: Number.isFinite(inv.tow) ? inv.tow : base.inventory.tow,
      freeze: Number.isFinite(inv.freeze) ? inv.freeze : base.inventory.freeze,
    }),
  };
}

function itemCostGold(itemId) {
  return Number.isFinite(ITEM_COST_GOLD[itemId]) ? ITEM_COST_GOLD[itemId] : ITEM_COST_GOLD_DEFAULT;
}

function pickRandomItemId(itemPool = ITEM_IDS, rngLike = Math) {
  const pool = Array.isArray(itemPool) && itemPool.length ? itemPool : ITEM_IDS;
  const rand = typeof rngLike.float === 'function'
    ? () => rngLike.float(0, 1)
    : () => Math.random();
  const index = Math.floor(rand() * pool.length) % pool.length;
  return pool[index];
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function smootherStep(t) {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

function randomChoice(rng, array) {
  return array[rng.int(0, array.length - 1)];
}

function roundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, Math.abs(w) * 0.5, Math.abs(h) * 0.5);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

function pointInRect(px, py, rect) {
  return px >= rect.x && py >= rect.y && px <= rect.x + rect.w && py <= rect.y + rect.h;
}

function distanceToRect(px, py, rect) {
  const dx = px < rect.x ? rect.x - px : (px > rect.x + rect.w ? px - (rect.x + rect.w) : 0);
  const dy = py < rect.y ? rect.y - py : (py > rect.y + rect.h ? py - (rect.y + rect.h) : 0);
  return Math.hypot(dx, dy);
}

function textFont(size, weight = 600) {
  return `${weight} ${Math.round(size)}px "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif`;
}

function mixColor(hexA, hexB, ratio) {
  const t = clamp(ratio, 0, 1);
  const parse = (color) => {
    if (typeof color !== 'string') {
      return [128, 128, 128];
    }
    const text = color.trim().toLowerCase();
    if (text.startsWith('#')) {
      const raw = text.slice(1);
      const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
      const value = parseInt(full, 16);
      if (Number.isNaN(value)) {
        return [128, 128, 128];
      }
      return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
    }
    const rgbMatch = text.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map((p) => p.trim());
      const r = clamp(Number(parts[0]) || 0, 0, 255);
      const g = clamp(Number(parts[1]) || 0, 0, 255);
      const b = clamp(Number(parts[2]) || 0, 0, 255);
      return [r, g, b];
    }
    return [128, 128, 128];
  };
  const [ar, ag, ab] = parse(hexA);
  const [br, bg, bb] = parse(hexB);
  const r = Math.round(ar * (1 - t) + br * t);
  const g = Math.round(ag * (1 - t) + bg * t);
  const b = Math.round(ab * (1 - t) + bb * t);
  return `rgb(${r},${g},${b})`;
}

function createOffscreenCanvas(width, height) {
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(width));
  canvas.height = Math.max(1, Math.round(height));
  return canvas;
}

class VehicleTextureLibrary {
  constructor(buildTag) {
    this.buildTag = buildTag;
    this.baseSprite = null;
    this.ready = false;
    this.failed = false;
    this.tintCache = new Map();
    this.load();
  }

  load() {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => {
      try {
        this.baseSprite = this.extractSprite(image);
        this.ready = !!this.baseSprite;
        this.failed = !this.ready;
      } catch (_err) {
        this.ready = false;
        this.failed = true;
      }
    };
    image.onerror = () => {
      this.ready = false;
      this.failed = true;
    };
    image.src = `./assets/img/car_base.jpg?v=${this.buildTag}`;
  }

  estimateBgColor(data, width, height) {
    let r = 0;
    let g = 0;
    let b = 0;
    let count = 0;
    const stepX = Math.max(4, Math.floor(width / 16));
    const stepY = Math.max(4, Math.floor(height / 16));
    const push = (x, y) => {
      const cx = clamp(Math.round(x), 0, width - 1);
      const cy = clamp(Math.round(y), 0, height - 1);
      const idx = (cy * width + cx) * 4;
      r += data[idx];
      g += data[idx + 1];
      b += data[idx + 2];
      count += 1;
    };

    for (let x = 0; x < width; x += stepX) {
      push(x, 0);
      push(x, height - 1);
    }
    for (let y = 0; y < height; y += stepY) {
      push(0, y);
      push(width - 1, y);
    }
    push(0, 0);
    push(width - 1, 0);
    push(0, height - 1);
    push(width - 1, height - 1);

    if (!count) {
      return [224, 224, 224];
    }
    return [Math.round(r / count), Math.round(g / count), Math.round(b / count)];
  }

  parseColor(color) {
    if (typeof color !== 'string') {
      return [240, 207, 100];
    }
    const text = color.trim().toLowerCase();
    if (text.startsWith('#')) {
      const raw = text.slice(1);
      const full = raw.length === 3 ? raw.split('').map((ch) => ch + ch).join('') : raw;
      const value = parseInt(full, 16);
      if (!Number.isNaN(value)) {
        return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
      }
    }
    const rgbMatch = text.match(/^rgba?\(([^)]+)\)$/);
    if (rgbMatch) {
      const parts = rgbMatch[1].split(',').map((p) => Number(p.trim()));
      if (parts.length >= 3) {
        return [
          clamp(parts[0] || 0, 0, 255),
          clamp(parts[1] || 0, 0, 255),
          clamp(parts[2] || 0, 0, 255),
        ];
      }
    }
    return [240, 207, 100];
  }

  rgbToHsl(r, g, b) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    const l = (max + min) * 0.5;
    if (max === min) {
      return [0, 0, l];
    }
    const d = max - min;
    const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    let h = 0;
    if (max === rn) {
      h = (gn - bn) / d + (gn < bn ? 6 : 0);
    } else if (max === gn) {
      h = (bn - rn) / d + 2;
    } else {
      h = (rn - gn) / d + 4;
    }
    return [h / 6, s, l];
  }

  hslToRgb(h, s, l) {
    if (s === 0) {
      const v = Math.round(l * 255);
      return [v, v, v];
    }
    const hue2rgb = (p, q, t) => {
      let x = t;
      if (x < 0) {
        x += 1;
      }
      if (x > 1) {
        x -= 1;
      }
      if (x < 1 / 6) {
        return p + (q - p) * 6 * x;
      }
      if (x < 1 / 2) {
        return q;
      }
      if (x < 2 / 3) {
        return p + (q - p) * (2 / 3 - x) * 6;
      }
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    const r = hue2rgb(p, q, h + 1 / 3);
    const g = hue2rgb(p, q, h);
    const b = hue2rgb(p, q, h - 1 / 3);
    return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
  }

  extractSprite(image) {
    const width = image.naturalWidth || image.width;
    const height = image.naturalHeight || image.height;
    if (!width || !height) {
      return null;
    }

    const source = createOffscreenCanvas(width, height);
    const srcCtx = source.getContext('2d', { willReadFrequently: true });
    srcCtx.drawImage(image, 0, 0, width, height);

    const imageData = srcCtx.getImageData(0, 0, width, height);
    const px = imageData.data;
    const [bgR, bgG, bgB] = this.estimateBgColor(px, width, height);
    const low = 20;
    const high = 48;
    let minX = width;
    let minY = height;
    let maxX = -1;
    let maxY = -1;
    let coreMinX = width;
    let coreMinY = height;
    let coreMaxX = -1;
    let coreMaxY = -1;

    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const idx = (y * width + x) * 4;
        const r = px[idx];
        const g = px[idx + 1];
        const b = px[idx + 2];
        const dr = Math.abs(r - bgR);
        const dg = Math.abs(g - bgG);
        const db = Math.abs(b - bgB);
        const delta = Math.max(dr, dg, db);
        const maxV = Math.max(r, g, b);
        const minV = Math.min(r, g, b);
        const sat = maxV === 0 ? 0 : (maxV - minV) / maxV;

        let alpha = 0;
        if (delta >= high) {
          alpha = 255;
        } else if (delta > low) {
          alpha = Math.round(((delta - low) / (high - low)) * 255);
        }

        // Drop soft floor shadow/halo from JPG background.
        if (sat < 0.12 && maxV > 128 && delta < 92) {
          alpha = 0;
        }
        if (alpha < 28) {
          alpha = 0;
        }

        px[idx + 3] = alpha;

        if (alpha > 8) {
          if (x < minX) {
            minX = x;
          }
          if (x > maxX) {
            maxX = x;
          }
          if (y < minY) {
            minY = y;
          }
          if (y > maxY) {
            maxY = y;
          }
        }

        // Track body-like pixels to constrain crop, avoiding large cast shadow.
        if (delta > 56 && (sat > 0.16 || maxV < 118)) {
          if (x < coreMinX) {
            coreMinX = x;
          }
          if (x > coreMaxX) {
            coreMaxX = x;
          }
          if (y < coreMinY) {
            coreMinY = y;
          }
          if (y > coreMaxY) {
            coreMaxY = y;
          }
        }
      }
    }

    if (coreMaxX >= 0 && coreMaxY >= 0) {
      const marginX = Math.max(8, Math.floor(width * 0.04));
      const marginY = Math.max(8, Math.floor(height * 0.04));
      const keepMinX = Math.max(0, coreMinX - marginX);
      const keepMaxX = Math.min(width - 1, coreMaxX + marginX);
      const keepMinY = Math.max(0, coreMinY - marginY);
      const keepMaxY = Math.min(height - 1, coreMaxY + marginY);

      minX = width;
      minY = height;
      maxX = -1;
      maxY = -1;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const idx = (y * width + x) * 4 + 3;
          if (px[idx] === 0) {
            continue;
          }
          if (x < keepMinX || x > keepMaxX || y < keepMinY || y > keepMaxY) {
            px[idx] = 0;
            continue;
          }
          if (x < minX) {
            minX = x;
          }
          if (x > maxX) {
            maxX = x;
          }
          if (y < minY) {
            minY = y;
          }
          if (y > maxY) {
            maxY = y;
          }
        }
      }
    }

    if (maxX < 0 || maxY < 0) {
      return null;
    }

    srcCtx.putImageData(imageData, 0, 0);

    const pad = 3;
    const cropX = Math.max(0, minX - pad);
    const cropY = Math.max(0, minY - pad);
    const cropW = Math.min(width - cropX, maxX - minX + 1 + pad * 2);
    const cropH = Math.min(height - cropY, maxY - minY + 1 + pad * 2);
    const cropped = createOffscreenCanvas(cropW, cropH);
    const outCtx = cropped.getContext('2d');
    outCtx.drawImage(source, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
    return cropped;
  }

  getTinted(color) {
    if (!this.baseSprite) {
      return null;
    }
    const key = color || '__default__';
    const cached = this.tintCache.get(key);
    if (cached) {
      return cached;
    }

    const canvas = createOffscreenCanvas(this.baseSprite.width, this.baseSprite.height);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(this.baseSprite, 0, 0);

    if (color) {
      const [targetR, targetG, targetB] = this.parseColor(color);
      const [targetH, targetS, targetL] = this.rgbToHsl(targetR, targetG, targetB);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const px = imageData.data;
      for (let i = 0; i < px.length; i += 4) {
        const alpha = px[i + 3];
        if (alpha === 0) {
          continue;
        }

        const r = px[i];
        const g = px[i + 1];
        const b = px[i + 2];
        const maxV = Math.max(r, g, b);
        const minV = Math.min(r, g, b);
        const sat = maxV === 0 ? 0 : (maxV - minV) / maxV;

        // Keep very dark structure (glass gap, wheels, hard trim).
        if (maxV < 88 && sat < 0.20) {
          continue;
        }

        // Preserve near-white highlight details and only apply a light tint.
        if (sat < 0.09 && maxV > 190) {
          px[i] = Math.round(r * 0.82 + targetR * 0.18);
          px[i + 1] = Math.round(g * 0.82 + targetG * 0.18);
          px[i + 2] = Math.round(b * 0.82 + targetB * 0.18);
          continue;
        }

        const [, srcS, srcL] = this.rgbToHsl(r, g, b);
        const newS = clamp(targetS * 0.92 + srcS * 0.20 + 0.12, 0, 1);
        const newL = clamp(srcL * 0.84 + targetL * 0.34 + 0.02, 0, 1);
        const [tr, tg, tb] = this.hslToRgb(targetH, newS, newL);
        const blend = sat < 0.12 ? 0.48 : 0.84;
        px[i] = Math.round(r * (1 - blend) + tr * blend);
        px[i + 1] = Math.round(g * (1 - blend) + tg * blend);
        px[i + 2] = Math.round(b * (1 - blend) + tb * blend);
      }
      ctx.putImageData(imageData, 0, 0);
    }

    const gloss = ctx.createLinearGradient(0, 0, 0, canvas.height);
    gloss.addColorStop(0, 'rgba(255,255,255,0.12)');
    gloss.addColorStop(0.42, 'rgba(255,255,255,0.03)');
    gloss.addColorStop(1, 'rgba(0,0,0,0.04)');
    ctx.fillStyle = gloss;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    this.tintCache.set(key, canvas);
    return canvas;
  }

  drawSliced(ctx, sprite, width, length) {
    const sw = sprite.width;
    const sh = sprite.height;
    const capRear = Math.max(8, Math.floor(sh * 0.28));
    const capFront = Math.max(8, Math.floor(sh * 0.30));
    const midSrcH = Math.max(4, sh - capRear - capFront);
    const rearDstH = length * (capRear / sh);
    const frontDstH = length * (capFront / sh);
    const midDstH = Math.max(2, length - rearDstH - frontDstH);
    const top = -length * 0.5;

    ctx.drawImage(sprite, 0, 0, sw, capRear, -width * 0.5, top, width, rearDstH);
    ctx.drawImage(sprite, 0, capRear, sw, midSrcH, -width * 0.5, top + rearDstH, width, midDstH);
    ctx.drawImage(
      sprite,
      0,
      sh - capFront,
      sw,
      capFront,
      -width * 0.5,
      top + rearDstH + midDstH,
      width,
      frontDstH,
    );
  }

  drawVehicle(ctx, vehicle, x, y, w, h, frontDir) {
    if (!this.ready || !this.baseSprite) {
      return false;
    }

    const sprite = this.getTinted(vehicle.color);
    if (!sprite) {
      return false;
    }

    const shortSide = Math.min(w, h);
    const longSide = Math.max(w, h);
    const carW = shortSide * (vehicle.length === 1 ? 0.82 : 0.86);
    const carL = vehicle.length === 1 ? shortSide * 1.06 : longSide * 0.95;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const angleByDir = {
      UP: 0,
      RIGHT: Math.PI * 0.5,
      DOWN: Math.PI,
      LEFT: -Math.PI * 0.5,
    };
    const angle = (angleByDir[frontDir] || 0) + Math.PI;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.ellipse(
      shortSide * 0.07,
      carL * 0.18,
      carW * 0.58,
      Math.max(2, shortSide * 0.14),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(17,21,28,0.30)';
    ctx.fill();

    this.drawSliced(ctx, sprite, carW, carL);

    ctx.restore();
    return true;
  }
}

function stableHash(str) {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

function toCellKey(x, y) {
  return `${x},${y}`;
}

function toFenceKey(x, y, dir) {
  return `${x},${y},${dir}`;
}

function parseFenceKey(key) {
  if (typeof key !== 'string') {
    return null;
  }
  const parts = key.split(',');
  if (parts.length !== 3) {
    return null;
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const direction = parts[2];
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  if (direction !== 'UP' && direction !== 'DOWN' && direction !== 'LEFT' && direction !== 'RIGHT') {
    return null;
  }
  return { x, y, direction };
}

class RNG {
  constructor(seed) {
    this.seed = seed >>> 0;
  }

  next() {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  float(min = 0, max = 1) {
    return min + this.next() * (max - min);
  }

  int(min, max) {
    return Math.floor(this.float(min, max + 1));
  }
}

function directionDelta(direction) {
  switch (direction) {
    case 'LEFT':
      return [-1, 0];
    case 'RIGHT':
      return [1, 0];
    case 'UP':
      return [0, -1];
    case 'DOWN':
      return [0, 1];
    default:
      return [0, 0];
  }
}

function directionMatchesAxis(axis, direction) {
  if (axis === 'H') {
    return direction === 'LEFT' || direction === 'RIGHT';
  }
  return direction === 'UP' || direction === 'DOWN';
}

function vehicleCells(vehicle) {
  if (!vehicle.active) {
    return [];
  }
  const cells = [];
  if (vehicle.axis === 'H') {
    for (let i = 0; i < vehicle.length; i += 1) {
      cells.push([vehicle.x + i, vehicle.y]);
    }
  } else {
    for (let i = 0; i < vehicle.length; i += 1) {
      cells.push([vehicle.x, vehicle.y + i]);
    }
  }
  return cells;
}

function clonePedestrian(ped) {
  return {
    id: ped.id,
    x: ped.x,
    y: ped.y,
    axis: ped.axis,
    minPos: ped.minPos,
    maxPos: ped.maxPos,
    direction: ped.direction,
    patrolNodes: ped.patrolNodes.map((p) => [p[0], p[1]]),
    patrolIndex: ped.patrolIndex,
    patrolForward: ped.patrolForward,
    pauseTicks: ped.pauseTicks,
    facing: ped.facing,
  };
}

function cloneVehicle(v) {
  return {
    id: v.id,
    x: v.x,
    y: v.y,
    length: v.length,
    axis: v.axis,
    color: v.color,
    spriteType: v.spriteType,
    frontPositive: v.frontPositive,
    active: v.active,
  };
}

function cloneLevel(level) {
  return {
    id: level.id,
    seed: level.seed,
    boardW: level.boardW,
    boardH: level.boardH,
    vehicles: level.vehicles.map(cloneVehicle),
    fences: level.fences.map((f) => ({ x: f.x, y: f.y, direction: f.direction })),
    pedestrians: level.pedestrians.map(clonePedestrian),
    optimalMoves: level.optimalMoves,
    maxSteps: level.maxSteps,
    difficulty: level.difficulty,
    pedestrianStepSec: level.pedestrianStepSec,
    carAnimBaseSec: level.carAnimBaseSec,
    carAnimPerCellSec: level.carAnimPerCellSec,
    carAnimMinSec: level.carAnimMinSec,
    carAnimMaxSec: level.carAnimMaxSec,
    solutionPlan: level.solutionPlan.map((m) => [m[0], m[1]]),
  };
}

function findVehicle(level, vehicleId) {
  return level.vehicles.find((v) => v.id === vehicleId) || null;
}

function activeVehicleCount(level) {
  let count = 0;
  for (const v of level.vehicles) {
    if (v.active) {
      count += 1;
    }
  }
  return count;
}

function buildOccupancy(level, ignoreVehicleId = null) {
  const occupancy = new Set();
  for (const v of level.vehicles) {
    if (!v.active) {
      continue;
    }
    if (ignoreVehicleId !== null && v.id === ignoreVehicleId) {
      continue;
    }
    for (const [x, y] of vehicleCells(v)) {
      occupancy.add(toCellKey(x, y));
    }
  }
  return occupancy;
}

function buildOccupancyMap(level, ignoreVehicleId = null) {
  const occupancy = new Map();
  for (const v of level.vehicles) {
    if (!v.active) {
      continue;
    }
    if (ignoreVehicleId !== null && v.id === ignoreVehicleId) {
      continue;
    }
    for (const [x, y] of vehicleCells(v)) {
      occupancy.set(toCellKey(x, y), v.id);
    }
  }
  return occupancy;
}

function buildFenceSet(level) {
  const set = new Set();
  for (const fence of level.fences) {
    set.add(toFenceKey(fence.x, fence.y, fence.direction));
  }
  return set;
}

function isOutside(level, x, y) {
  return x < 0 || y < 0 || x >= level.boardW || y >= level.boardH;
}

function headCell(vehicle, direction) {
  if (vehicle.axis === 'H') {
    if (direction === 'LEFT') {
      return [vehicle.x, vehicle.y];
    }
    return [vehicle.x + vehicle.length - 1, vehicle.y];
  }
  if (direction === 'UP') {
    return [vehicle.x, vehicle.y];
  }
  return [vehicle.x, vehicle.y + vehicle.length - 1];
}

function pedestrianUsesNodePatrol(ped) {
  return ped.patrolNodes && ped.patrolNodes.length >= 2;
}

function vehicleHitsPedestrian(vehicle, pedestrians) {
  if (!vehicle.active) {
    return false;
  }
  const occupied = new Set(vehicleCells(vehicle).map(([x, y]) => toCellKey(x, y)));
  for (const ped of pedestrians) {
    if (occupied.has(toCellKey(ped.x, ped.y))) {
      return true;
    }
  }
  return false;
}

function anyVehiclePedCollision(level) {
  for (const vehicle of level.vehicles) {
    if (!vehicle.active) {
      continue;
    }
    if (vehicleHitsPedestrian(vehicle, level.pedestrians)) {
      return true;
    }
  }
  return false;
}

function advanceNodePatrolPedestrian(ped, occupiedCells = null) {
  if (ped.pauseTicks > 0) {
    ped.pauseTicks -= 1;
    return;
  }
  const nodes = ped.patrolNodes;
  if (!nodes || nodes.length < 2) {
    return;
  }

  ped.patrolForward = ped.patrolForward >= 0 ? 1 : -1;
  if (ped.patrolIndex < 0 || ped.patrolIndex >= nodes.length) {
    ped.patrolIndex = clamp(ped.patrolIndex, 0, nodes.length - 1);
  }

  let nextIndex = ped.patrolIndex + ped.patrolForward;
  if (nextIndex < 0 || nextIndex >= nodes.length) {
    ped.patrolForward *= -1;
    ped.pauseTicks = 1;
    return;
  }

  const [targetX, targetY] = nodes[nextIndex];
  const dx = targetX - ped.x;
  const dy = targetY - ped.y;

  if (dx !== 0) {
    const step = dx > 0 ? 1 : -1;
    const nextX = ped.x + step;
    const nextY = ped.y;
    if (occupiedCells && occupiedCells.has(toCellKey(nextX, nextY))) {
      // Temporary endpoint: when front cell is blocked, treat current cell as end
      // and reverse patrol to mimic "endpoint moved to obstacle-1".
      ped.patrolIndex = nextIndex;
      ped.patrolForward *= -1;
      ped.pauseTicks = 1;
      ped.facing = step > 0 ? 'LEFT' : 'RIGHT';
      return;
    }
    ped.x = nextX;
    ped.axis = 'H';
    ped.direction = step;
    ped.facing = step > 0 ? 'RIGHT' : 'LEFT';
  } else if (dy !== 0) {
    const step = dy > 0 ? 1 : -1;
    const nextX = ped.x;
    const nextY = ped.y + step;
    if (occupiedCells && occupiedCells.has(toCellKey(nextX, nextY))) {
      ped.patrolIndex = nextIndex;
      ped.patrolForward *= -1;
      ped.pauseTicks = 1;
      ped.facing = step > 0 ? 'UP' : 'DOWN';
      return;
    }
    ped.y = nextY;
    ped.axis = 'V';
    ped.direction = step;
    ped.facing = step > 0 ? 'DOWN' : 'UP';
  } else {
    ped.patrolIndex = nextIndex;
  }

  if (ped.x !== targetX || ped.y !== targetY) {
    return;
  }

  ped.patrolIndex = nextIndex;
  const lookahead = ped.patrolIndex + ped.patrolForward;
  if (lookahead < 0 || lookahead >= nodes.length) {
    ped.pauseTicks = 1;
    return;
  }

  const [prevX, prevY] = nodes[ped.patrolIndex - ped.patrolForward];
  const [lookX, lookY] = nodes[lookahead];
  const inDx = ped.x - prevX;
  const inDy = ped.y - prevY;
  const outDx = lookX - ped.x;
  const outDy = lookY - ped.y;
  const turning = (inDx !== 0 && outDy !== 0) || (inDy !== 0 && outDx !== 0);
  if (turning) {
    ped.pauseTicks = 1;
  }
}

function advancePedestrians(level, occupiedCells = null) {
  for (const ped of level.pedestrians) {
    if (pedestrianUsesNodePatrol(ped)) {
      advanceNodePatrolPedestrian(ped, occupiedCells);
      continue;
    }

    if (ped.axis === 'H') {
      let next = ped.x + ped.direction;
      if (next < ped.minPos || next > ped.maxPos) {
        ped.direction *= -1;
        next = ped.x + ped.direction;
      }
      if (occupiedCells && occupiedCells.has(toCellKey(next, ped.y))) {
        // Dynamic endpoint before obstacle: reverse just like hitting boundary.
        ped.direction *= -1;
        next = ped.x + ped.direction;
        if (next < ped.minPos || next > ped.maxPos || (occupiedCells && occupiedCells.has(toCellKey(next, ped.y)))) {
          ped.facing = ped.direction >= 0 ? 'RIGHT' : 'LEFT';
          continue;
        }
      }
      ped.x = next;
      ped.facing = ped.direction >= 0 ? 'RIGHT' : 'LEFT';
    } else {
      let next = ped.y + ped.direction;
      if (next < ped.minPos || next > ped.maxPos) {
        ped.direction *= -1;
        next = ped.y + ped.direction;
      }
      if (occupiedCells && occupiedCells.has(toCellKey(ped.x, next))) {
        ped.direction *= -1;
        next = ped.y + ped.direction;
        if (next < ped.minPos || next > ped.maxPos || (occupiedCells && occupiedCells.has(toCellKey(ped.x, next)))) {
          ped.facing = ped.direction >= 0 ? 'DOWN' : 'UP';
          continue;
        }
      }
      ped.y = next;
      ped.facing = ped.direction >= 0 ? 'DOWN' : 'UP';
    }
  }
}

function tickPedestrians(level, steps = 1) {
  const count = Math.max(0, Math.floor(steps));
  for (let i = 0; i < count; i += 1) {
    const occupied = buildOccupancy(level);
    advancePedestrians(level, occupied);
  }
  return false;
}

function simulateMove(level, vehicleId, direction) {
  const vehicle = findVehicle(level, vehicleId);
  if (!vehicle || !vehicle.active || !directionMatchesAxis(vehicle.axis, direction)) {
    return {
      nextLevel: cloneLevel(level),
      moved: false,
      leftBoard: false,
      distance: 0,
      pedestrianCollision: false,
      blockedByVehicle: false,
      blockedByFence: false,
      blockedVehicleId: null,
    };
  }

  const occupancy = buildOccupancyMap(level, vehicleId);
  const fenceBlocked = buildFenceSet(level);
  const workingLevel = cloneLevel(level);
  const moving = findVehicle(workingLevel, vehicleId);
  const [dx, dy] = directionDelta(direction);

  let distance = 0;
  const finish = (moved, leftBoard, pedestrianCollision, stopReason = null, blockedVehicleId = null) => ({
    nextLevel: workingLevel,
    moved,
    leftBoard,
    distance,
    pedestrianCollision,
    blockedByVehicle: stopReason === 'vehicle',
    blockedByFence: stopReason === 'fence',
    blockedVehicleId: stopReason === 'vehicle' ? blockedVehicleId : null,
  });

  while (true) {
    const [headX, headY] = headCell(moving, direction);
    const nextX = headX + dx;
    const nextY = headY + dy;

    if (isOutside(workingLevel, nextX, nextY)) {
      if (fenceBlocked.has(toFenceKey(headX, headY, direction))) {
        return finish(distance > 0, false, false, 'fence');
      }
      moving.active = false;
      return finish(true, true, false);
    }

    const nextKey = toCellKey(nextX, nextY);
    if (occupancy.has(nextKey)) {
      return finish(distance > 0, false, false, 'vehicle', occupancy.get(nextKey) || null);
    }

    moving.x += dx;
    moving.y += dy;
    distance += 1;

    if (vehicleHitsPedestrian(moving, workingLevel.pedestrians)) {
      return finish(true, false, true);
    }
  }
}

function sampleVehicleLength(rng) {
  return rng.float() < LENGTH_ONE_PROB ? 1 : 2;
}

function vehicleCellsFor(x, y, length, axis) {
  const cells = [];
  if (axis === 'H') {
    for (let i = 0; i < length; i += 1) {
      cells.push([x + i, y]);
    }
  } else {
    for (let i = 0; i < length; i += 1) {
      cells.push([x, y + i]);
    }
  }
  return cells;
}

function canExitNow(params) {
  const {
    boardW,
    boardH,
    occupancy,
    blockedFences,
    x,
    y,
    length,
    axis,
    direction,
  } = params;

  if (axis === 'H') {
    if (direction === 'RIGHT') {
      for (let col = x + length; col < boardW; col += 1) {
        if (occupancy.has(toCellKey(col, y))) {
          return false;
        }
      }
      return !blockedFences.has(toFenceKey(x + length - 1, y, 'RIGHT'));
    }
    if (direction === 'LEFT') {
      for (let col = x - 1; col >= 0; col -= 1) {
        if (occupancy.has(toCellKey(col, y))) {
          return false;
        }
      }
      return !blockedFences.has(toFenceKey(x, y, 'LEFT'));
    }
    return false;
  }

  if (direction === 'DOWN') {
    for (let row = y + length; row < boardH; row += 1) {
      if (occupancy.has(toCellKey(x, row))) {
        return false;
      }
    }
    return !blockedFences.has(toFenceKey(x, y + length - 1, 'DOWN'));
  }
  if (direction === 'UP') {
    for (let row = y - 1; row >= 0; row -= 1) {
      if (occupancy.has(toCellKey(x, row))) {
        return false;
      }
    }
    return !blockedFences.has(toFenceKey(x, y, 'UP'));
  }
  return false;
}

function collectExitCandidates(params) {
  const {
    boardW,
    boardH,
    occupancy,
    blockedFences,
    length,
    axis,
  } = params;

  const candidates = [];
  if (axis === 'H') {
    if (length > boardW) {
      return candidates;
    }
    for (let x = 0; x <= boardW - length; x += 1) {
      for (let y = 0; y < boardH; y += 1) {
        const cells = vehicleCellsFor(x, y, length, axis);
        let blocked = false;
        for (const [cx, cy] of cells) {
          if (occupancy.has(toCellKey(cx, cy))) {
            blocked = true;
            break;
          }
        }
        if (blocked) {
          continue;
        }
        for (const dir of ['LEFT', 'RIGHT']) {
          if (canExitNow({ boardW, boardH, occupancy, blockedFences, x, y, length, axis, direction: dir })) {
            candidates.push({ x, y, direction: dir });
          }
        }
      }
    }
    return candidates;
  }

  if (length > boardH) {
    return candidates;
  }

  for (let x = 0; x < boardW; x += 1) {
    for (let y = 0; y <= boardH - length; y += 1) {
      const cells = vehicleCellsFor(x, y, length, axis);
      let blocked = false;
      for (const [cx, cy] of cells) {
        if (occupancy.has(toCellKey(cx, cy))) {
          blocked = true;
          break;
        }
      }
      if (blocked) {
        continue;
      }
      for (const dir of ['UP', 'DOWN']) {
        if (canExitNow({ boardW, boardH, occupancy, blockedFences, x, y, length, axis, direction: dir })) {
          candidates.push({ x, y, direction: dir });
        }
      }
    }
  }
  return candidates;
}

function generateVehicleLayout(rng, boardW, boardH, targetCells, blockedFences = new Set()) {
  const vehicles = [];
  const occupancy = new Set();
  const insertionPlan = [];

  let filledCells = 0;

  while (filledCells < targetCells) {
    const preferLen = sampleVehicleLength(rng);
    const preferAxis = rng.float() < 0.5 ? 'H' : 'V';
    const options = [
      [preferLen, preferAxis],
      [preferLen, preferAxis === 'H' ? 'V' : 'H'],
      [preferLen === 2 ? 1 : 2, preferAxis],
      [preferLen === 2 ? 1 : 2, preferAxis === 'H' ? 'V' : 'H'],
    ];

    let placed = false;
    for (const [length, axis] of options) {
      if (filledCells + length > targetCells + 1) {
        continue;
      }
      const candidates = collectExitCandidates({
        boardW,
        boardH,
        occupancy,
        blockedFences,
        length,
        axis,
      });
      if (!candidates.length) {
        continue;
      }

      const choice = randomChoice(rng, candidates);
      const id = `V${String(vehicles.length).padStart(3, '0')}`;
      const color = randomChoice(rng, CAR_COLORS);
      vehicles.push({
        id,
        x: choice.x,
        y: choice.y,
        length,
        axis,
        color,
        spriteType: rng.float() < 0.5 ? 'sedan' : 'suv',
        frontPositive: rng.float() < 0.5,
        active: true,
      });
      insertionPlan.push([id, choice.direction]);
      for (const [cx, cy] of vehicleCellsFor(choice.x, choice.y, length, axis)) {
        occupancy.add(toCellKey(cx, cy));
      }
      filledCells += length;
      placed = true;
      break;
    }

    if (!placed) {
      return null;
    }
  }

  if (!vehicles.length || filledCells < targetCells) {
    return null;
  }

  return {
    vehicles,
    solutionPlan: insertionPlan.reverse(),
  };
}

function boundaryFenceCandidates(boardW, boardH) {
  const items = [];
  for (let x = 0; x < boardW; x += 1) {
    items.push({ x, y: 0, direction: 'UP' });
    items.push({ x, y: boardH - 1, direction: 'DOWN' });
  }
  for (let y = 0; y < boardH; y += 1) {
    items.push({ x: 0, y, direction: 'LEFT' });
    items.push({ x: boardW - 1, y, direction: 'RIGHT' });
  }
  return items;
}

function generateDirectionalFences(boardW, boardH) {
  const fences = [];
  for (let y = 0; y < boardH; y += 1) {
    fences.push({ x: 0, y, direction: 'LEFT' });
  }
  for (let x = 0; x < boardW; x += 1) {
    fences.push({ x, y: 0, direction: 'UP' });
  }
  return fences;
}

function planProtectedExits(vehicles, solutionPlan, boardW, boardH) {
  const byId = new Map();
  for (const v of vehicles) {
    byId.set(v.id, v);
  }
  const protectedSet = new Set();

  for (const [vehicleId, direction] of solutionPlan) {
    const v = byId.get(vehicleId);
    if (!v) {
      continue;
    }
    if (direction === 'LEFT') {
      protectedSet.add(toFenceKey(0, v.y, direction));
    } else if (direction === 'RIGHT') {
      protectedSet.add(toFenceKey(boardW - 1, v.y, direction));
    } else if (direction === 'UP') {
      protectedSet.add(toFenceKey(v.x, 0, direction));
    } else {
      protectedSet.add(toFenceKey(v.x, boardH - 1, direction));
    }
  }
  return protectedSet;
}

function oppositeDirection(direction) {
  switch (direction) {
    case 'LEFT':
      return 'RIGHT';
    case 'RIGHT':
      return 'LEFT';
    case 'UP':
      return 'DOWN';
    case 'DOWN':
      return 'UP';
    default:
      return direction;
  }
}

function boundaryFenceKeyForVehicle(vehicle, direction, boardW, boardH) {
  if (direction === 'LEFT') {
    return toFenceKey(0, vehicle.y, 'LEFT');
  }
  if (direction === 'RIGHT') {
    return toFenceKey(boardW - 1, vehicle.y, 'RIGHT');
  }
  if (direction === 'UP') {
    return toFenceKey(vehicle.x, 0, 'UP');
  }
  if (direction === 'DOWN') {
    return toFenceKey(vehicle.x, boardH - 1, 'DOWN');
  }
  return '';
}

function planMandatoryOppositeFences(rng, vehicles, solutionPlan, boardW, boardH, protectedExits) {
  const byId = new Map();
  for (const v of vehicles) {
    byId.set(v.id, v);
  }

  const candidates = [];
  const seen = new Set();
  for (const [vehicleId, direction] of solutionPlan) {
    const v = byId.get(vehicleId);
    if (!v) {
      continue;
    }
    const key = boundaryFenceKeyForVehicle(v, oppositeDirection(direction), boardW, boardH);
    if (!key || seen.has(key) || protectedExits.has(key)) {
      continue;
    }
    seen.add(key);
    candidates.push(key);
  }

  if (!candidates.length) {
    return new Set();
  }

  for (let i = candidates.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = candidates[i];
    candidates[i] = candidates[j];
    candidates[j] = tmp;
  }

  const target = clamp(1 + Math.floor(solutionPlan.length / 7), 1, 3);
  const picked = new Set();
  for (let i = 0; i < Math.min(target, candidates.length); i += 1) {
    picked.add(candidates[i]);
  }
  return picked;
}

function sideDirectionFullyBlocked(allCandidates, blocked, direction) {
  const total = allCandidates.filter((f) => f.direction === direction).length;
  const blockedCount = blocked.filter((f) => f.direction === direction).length;
  return total > 0 && blockedCount >= total;
}

function sideLengthForDirection(direction, boardW, boardH) {
  return direction === 'UP' || direction === 'DOWN' ? boardW : boardH;
}

function sideFenceCountBounds(sideLen, ratioMin, ratioMax) {
  let minCount = Math.floor(sideLen * ratioMin);
  let maxCount = Math.floor(sideLen * ratioMax);

  // Match expected discrete ranges on fixed-size board: 20 => 6-12, 12 => 4-8.
  if (ratioMax >= 0.66 && sideLen % 3 !== 0) {
    maxCount -= 1;
  }

  minCount = clamp(minCount, 0, sideLen);
  maxCount = clamp(maxCount, minCount, sideLen);
  return [minCount, maxCount];
}

function generateFences(rng, boardW, boardH, protectedExits, ratioMin, ratioMax, requiredFenceKeys = new Set()) {
  const all = boundaryFenceCandidates(boardW, boardH);
  const candidates = all.filter((f) => !protectedExits.has(toFenceKey(f.x, f.y, f.direction)));
  if (!candidates.length) {
    return [];
  }

  const sideBuckets = {
    UP: { required: [], optional: [] },
    DOWN: { required: [], optional: [] },
    LEFT: { required: [], optional: [] },
    RIGHT: { required: [], optional: [] },
  };
  for (const fence of candidates) {
    const key = toFenceKey(fence.x, fence.y, fence.direction);
    if (requiredFenceKeys.has(key)) {
      sideBuckets[fence.direction].required.push(fence);
    } else {
      sideBuckets[fence.direction].optional.push(fence);
    }
  }

  const blocked = [];
  for (const side of ['UP', 'DOWN', 'LEFT', 'RIGHT']) {
    const sideLen = sideLengthForDirection(side, boardW, boardH);
    const [minByRatio, maxByRatio] = sideFenceCountBounds(sideLen, ratioMin, ratioMax);
    const required = sideBuckets[side].required;
    const optional = sideBuckets[side].optional;
    const available = required.length + optional.length;
    if (!available) {
      continue;
    }

    const minTarget = Math.min(available, Math.max(required.length, minByRatio));
    const maxTarget = Math.min(available, Math.max(minTarget, maxByRatio));
    const target = maxTarget > minTarget ? rng.int(minTarget, maxTarget) : minTarget;

    const shuffled = [...optional];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = rng.int(0, i);
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    blocked.push(...required);
    blocked.push(...shuffled.slice(0, Math.max(0, target - required.length)));
  }
  return blocked;
}

function shuffledIndices(rng, total) {
  const arr = [];
  for (let i = 0; i < total; i += 1) {
    arr.push(i);
  }
  for (let i = arr.length - 1; i > 0; i -= 1) {
    const j = rng.int(0, i);
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }
  return arr;
}

function pickDisjointIndices(rng, total, countA, countB) {
  const shuffled = shuffledIndices(rng, total);
  const a = shuffled.slice(0, Math.min(countA, total));
  const aSet = new Set(a);
  const remain = [];
  for (const index of shuffled) {
    if (!aSet.has(index)) {
      remain.push(index);
    }
  }
  const b = remain.slice(0, Math.min(countB, remain.length));
  if (b.length < countB) {
    for (const index of shuffled) {
      if (b.length >= countB) {
        break;
      }
      if (!b.includes(index)) {
        b.push(index);
      }
    }
  }
  return [a, b];
}

function generateBalancedEdgeFences(rng, boardW, boardH, ratio = 1 / 3) {
  const hCount = clamp(Math.round(boardH * ratio), 1, boardH);
  const wCount = clamp(Math.round(boardW * ratio), 1, boardW);

  const [leftYs, rightYs] = pickDisjointIndices(rng, boardH, hCount, hCount);
  const [topXs, bottomXs] = pickDisjointIndices(rng, boardW, wCount, wCount);

  const fences = [];
  for (const y of leftYs) {
    fences.push({ x: 0, y, direction: 'LEFT' });
  }
  for (const y of rightYs) {
    fences.push({ x: boardW - 1, y, direction: 'RIGHT' });
  }
  for (const x of topXs) {
    fences.push({ x, y: 0, direction: 'UP' });
  }
  for (const x of bottomXs) {
    fences.push({ x, y: boardH - 1, direction: 'DOWN' });
  }
  return fences;
}

function segmentCells(start, end) {
  const [x0, y0] = start;
  const [x1, y1] = end;
  const cells = [];
  if (x0 === x1) {
    const step = y1 >= y0 ? 1 : -1;
    for (let y = y0; y !== y1 + step; y += step) {
      cells.push([x0, y]);
    }
    return cells;
  }
  if (y0 === y1) {
    const step = x1 >= x0 ? 1 : -1;
    for (let x = x0; x !== x1 + step; x += step) {
      cells.push([x, y0]);
    }
    return cells;
  }
  return cells;
}

function tryBuildPedestrianNodes(rng, boardW, boardH, blockedCells, reservedCells) {
  const start = [rng.int(0, boardW - 1), rng.int(0, boardH - 1)];
  if (blockedCells.has(toCellKey(start[0], start[1])) || reservedCells.has(toCellKey(start[0], start[1]))) {
    return null;
  }

  const dirs = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ];
  const [dx1, dy1] = randomChoice(rng, dirs);
  const len1 = rng.int(2, 5);
  const mid = [start[0] + dx1 * len1, start[1] + dy1 * len1];

  if (mid[0] < 0 || mid[1] < 0 || mid[0] >= boardW || mid[1] >= boardH) {
    return null;
  }

  const seg1 = segmentCells(start, mid);
  if (!seg1.length) {
    return null;
  }
  for (const [x, y] of seg1) {
    const key = toCellKey(x, y);
    if (blockedCells.has(key) || reservedCells.has(key)) {
      return null;
    }
  }

  let nodes = [start, mid];
  if (rng.float() < 0.58) {
    const turnDirs = dx1 !== 0 ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]];
    const [dx2, dy2] = randomChoice(rng, turnDirs);
    const len2 = rng.int(2, 4);
    const end = [mid[0] + dx2 * len2, mid[1] + dy2 * len2];
    if (end[0] < 0 || end[1] < 0 || end[0] >= boardW || end[1] >= boardH) {
      return null;
    }
    const seg2 = segmentCells(mid, end);
    if (!seg2.length) {
      return null;
    }
    for (const [x, y] of seg2) {
      const key = toCellKey(x, y);
      if (blockedCells.has(key) || reservedCells.has(key)) {
        return null;
      }
    }
    nodes = [start, mid, end];
  }

  const routeCells = new Set();
  for (let i = 0; i < nodes.length - 1; i += 1) {
    for (const [x, y] of segmentCells(nodes[i], nodes[i + 1])) {
      routeCells.add(toCellKey(x, y));
    }
  }

  return {
    nodes,
    routeCells,
  };
}

function traceSolutionMoves(level, solutionPlan) {
  const traces = [];
  let working = cloneLevel(level);

  for (const [vehicleId, direction] of solutionPlan) {
    const vehicle = findVehicle(working, vehicleId);
    if (!vehicle || !vehicle.active) {
      continue;
    }

    const before = cloneVehicle(vehicle);
    const outcome = simulateMove(working, vehicleId, direction);
    if (!outcome.moved && !outcome.leftBoard) {
      return traces;
    }

    const [dx, dy] = directionDelta(direction);
    const swept = new Set();
    for (let step = 1; step <= outcome.distance; step += 1) {
      const px = before.x + dx * step;
      const py = before.y + dy * step;
      for (const [cx, cy] of vehicleCellsFor(px, py, before.length, before.axis)) {
        if (cx < 0 || cy < 0 || cx >= level.boardW || cy >= level.boardH) {
          continue;
        }
        swept.add(toCellKey(cx, cy));
      }
    }

    traces.push({
      vehicleId,
      direction,
      before,
      distance: outcome.distance,
      sweptCells: [...swept],
    });
    working = outcome.nextLevel;
  }

  return traces;
}

function buildConstrainedPedestrian(rng, boardW, boardH, anchor, blockedCells, reservedCells) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (anchor.axis === 'H') {
      let minX = clamp(anchor.x - rng.int(1, 4), 0, boardW - 1);
      let maxX = clamp(anchor.x + rng.int(1, 4), 0, boardW - 1);
      if (maxX - minX < 2) {
        minX = Math.max(0, minX - 1);
        maxX = Math.min(boardW - 1, maxX + 1);
      }
      if (maxX - minX < 2) {
        continue;
      }

      const routeCells = new Set();
      let invalid = false;
      for (let x = minX; x <= maxX; x += 1) {
        const key = toCellKey(x, anchor.y);
        if (blockedCells.has(key) || reservedCells.has(key)) {
          invalid = true;
          break;
        }
        routeCells.add(key);
      }
      if (invalid) {
        continue;
      }

      const nodes = rng.float() < 0.5
        ? [[minX, anchor.y], [maxX, anchor.y]]
        : [[maxX, anchor.y], [minX, anchor.y]];
      return { nodes, routeCells };
    }

    let minY = clamp(anchor.y - rng.int(1, 4), 0, boardH - 1);
    let maxY = clamp(anchor.y + rng.int(1, 4), 0, boardH - 1);
    if (maxY - minY < 2) {
      minY = Math.max(0, minY - 1);
      maxY = Math.min(boardH - 1, maxY + 1);
    }
    if (maxY - minY < 2) {
      continue;
    }

    const routeCells = new Set();
    let invalid = false;
    for (let y = minY; y <= maxY; y += 1) {
      const key = toCellKey(anchor.x, y);
      if (blockedCells.has(key) || reservedCells.has(key)) {
        invalid = true;
        break;
      }
      routeCells.add(key);
    }
    if (invalid) {
      continue;
    }

    const nodes = rng.float() < 0.5
      ? [[anchor.x, minY], [anchor.x, maxY]]
      : [[anchor.x, maxY], [anchor.x, minY]];
    return { nodes, routeCells };
  }
  return null;
}

function buildPedestrianFromNodes(index, nodes) {
  const [sx, sy] = nodes[0];
  const [nx, ny] = nodes[1];
  const facing = nx > sx ? 'RIGHT' : nx < sx ? 'LEFT' : ny > sy ? 'DOWN' : 'UP';
  return {
    id: `P${String(index).padStart(2, '0')}`,
    x: sx,
    y: sy,
    axis: nx !== sx ? 'H' : 'V',
    minPos: 0,
    maxPos: 0,
    direction: 1,
    patrolNodes: nodes,
    patrolIndex: 0,
    patrolForward: 1,
    pauseTicks: 0,
    facing,
  };
}

function collectConstrainedPedestrianAnchors(rng, level, occupiedCells) {
  const traces = traceSolutionMoves(level, level.solutionPlan);
  if (!traces.length) {
    return [];
  }

  const fenceSet = buildFenceSet(level);
  const strict = [];
  const relaxed = [];

  for (const trace of traces) {
    if (!trace.distance || !trace.sweptCells.length) {
      continue;
    }
    const exitKey = boundaryFenceKeyForVehicle(trace.before, trace.direction, level.boardW, level.boardH);
    const oppositeKey = boundaryFenceKeyForVehicle(trace.before, oppositeDirection(trace.direction), level.boardW, level.boardH);
    const openCells = trace.sweptCells.filter((key) => !occupiedCells.has(key));
    if (!openCells.length) {
      continue;
    }
    const item = {
      axis: trace.before.axis,
      cells: openCells,
      weight: trace.distance,
    };
    if (!fenceSet.has(exitKey) && fenceSet.has(oppositeKey)) {
      strict.push(item);
    } else if (fenceSet.has(oppositeKey)) {
      relaxed.push(item);
    }
  }

  const pool = strict.length ? strict : relaxed;
  if (!pool.length) {
    return [];
  }

  pool.sort((a, b) => b.weight - a.weight);
  const target = Math.min(2, pool.length);
  const anchors = [];
  const used = new Set();

  for (const item of pool) {
    const shuffled = [...item.cells];
    for (let i = shuffled.length - 1; i > 0; i -= 1) {
      const j = rng.int(0, i);
      const tmp = shuffled[i];
      shuffled[i] = shuffled[j];
      shuffled[j] = tmp;
    }

    let chosen = null;
    for (const key of shuffled) {
      if (!used.has(key)) {
        chosen = key;
        break;
      }
    }
    if (!chosen) {
      continue;
    }
    used.add(chosen);
    const [xText, yText] = chosen.split(',');
    anchors.push({
      axis: item.axis,
      x: Number(xText),
      y: Number(yText),
    });
    if (anchors.length >= target) {
      break;
    }
  }

  return anchors;
}

function generatePedestrians(rng, levelIndex, boardW, boardH, occupiedCells, levelForPlanning = null) {
  const pedestrians = [];
  const reserved = new Set();
  const target = clamp(1 + Math.floor(levelIndex / 18), 1, 3);

  if (levelForPlanning) {
    const anchors = collectConstrainedPedestrianAnchors(rng, levelForPlanning, occupiedCells);
    for (const anchor of anchors) {
      if (pedestrians.length >= target) {
        break;
      }
      const forced = buildConstrainedPedestrian(rng, boardW, boardH, anchor, occupiedCells, reserved);
      if (!forced) {
        continue;
      }
      for (const key of forced.routeCells) {
        reserved.add(key);
      }
      pedestrians.push(buildPedestrianFromNodes(pedestrians.length, forced.nodes));
    }
  }

  for (let i = pedestrians.length; i < target; i += 1) {
    let created = null;
    for (let attempt = 0; attempt < 64; attempt += 1) {
      created = tryBuildPedestrianNodes(rng, boardW, boardH, occupiedCells, reserved);
      if (created) {
        break;
      }
    }
    if (!created) {
      continue;
    }

    for (const key of created.routeCells) {
      reserved.add(key);
    }

    pedestrians.push(buildPedestrianFromNodes(i, created.nodes));
  }

  return pedestrians;
}

function isPlanSolvable(level, solutionPlan) {
  let working = cloneLevel(level);
  for (const [vehicleId, direction] of solutionPlan) {
    const outcome = simulateMove(working, vehicleId, direction);
    if (outcome.pedestrianCollision) {
      return false;
    }
    if (!outcome.moved && !outcome.leftBoard) {
      return false;
    }
    working = outcome.nextLevel;
    if (tickPedestrians(working, 1)) {
      return false;
    }
  }
  return activeVehicleCount(working) === 0;
}

function generateRandomVehicles(rng, boardW, boardH, targetCells, minVehicles = 8) {
  const vehicles = [];
  const occupancy = new Set();
  const desiredCells = Math.max(8, targetCells);
  const desiredVehicles = Math.max(4, minVehicles);
  const maxAttempts = Math.max(900, desiredCells * 44);

  let filled = 0;
  let attempts = 0;
  while (attempts < maxAttempts && (filled < desiredCells || vehicles.length < desiredVehicles)) {
    attempts += 1;
    const length = sampleVehicleLength(rng);
    const axis = rng.float() < 0.5 ? 'H' : 'V';
    const maxX = axis === 'H' ? boardW - length : boardW - 1;
    const maxY = axis === 'V' ? boardH - length : boardH - 1;
    if (maxX < 0 || maxY < 0) {
      continue;
    }

    const x = rng.int(0, maxX);
    const y = rng.int(0, maxY);
    const cells = vehicleCellsFor(x, y, length, axis);

    let blocked = false;
    for (const [cx, cy] of cells) {
      if (occupancy.has(toCellKey(cx, cy))) {
        blocked = true;
        break;
      }
    }
    if (blocked) {
      continue;
    }

    const id = `V${String(vehicles.length).padStart(3, '0')}`;
    vehicles.push({
      id,
      x,
      y,
      length,
      axis,
      color: randomChoice(rng, CAR_COLORS),
      spriteType: rng.float() < 0.5 ? 'sedan' : 'suv',
      frontPositive: rng.float() < 0.5,
      active: true,
    });
    for (const [cx, cy] of cells) {
      occupancy.add(toCellKey(cx, cy));
    }
    filled += length;

    if (filled >= desiredCells && vehicles.length >= desiredVehicles && rng.float() < 0.10) {
      break;
    }
  }

  if (vehicles.length < Math.max(4, Math.floor(desiredVehicles * 0.7))) {
    return null;
  }
  return vehicles;
}

function countSafeMoves(level) {
  let count = 0;
  for (const v of level.vehicles) {
    if (!v.active) {
      continue;
    }
    const dirs = v.axis === 'H' ? ['LEFT', 'RIGHT'] : ['UP', 'DOWN'];
    for (const dir of dirs) {
      const outcome = simulateMove(level, v.id, dir);
      if ((outcome.moved || outcome.leftBoard) && !outcome.pedestrianCollision) {
        count += 1;
      }
    }
  }
  return count;
}

function tuningForLevel(levelNumber) {
  const t = clamp((levelNumber - 1) / 80, 0, 1);
  return {
    densityMin: lerp(0.66, 0.68, t),
    densityMax: lerp(0.72, 0.75, t),
    pedestrianStepSec: lerp(0.44, 0.32, t),
    carAnimBaseSec: lerp(0.17, 0.24, t),
    carAnimPerCellSec: lerp(0.082, 0.098, t),
    carAnimMinSec: lerp(0.20, 0.24, t),
    carAnimMaxSec: lerp(0.78, 0.92, t),
  };
}

function generateLevel(levelNumber) {
  const baseSeed = 12000 + levelNumber * 41;
  const tune = tuningForLevel(levelNumber);
  const buildLevel = (seed, vehicles, fences, pedestrians) => {
    const vehicleCount = vehicles.length;
    return {
      id: `L-${String(levelNumber).padStart(4, '0')}`,
      seed,
      boardW: BOARD_W,
      boardH: BOARD_H,
      vehicles,
      fences,
      pedestrians,
      optimalMoves: Math.max(1, Math.round(vehicleCount * 0.72)),
      maxSteps: vehicleCount + 5,
      difficulty: 'RANDOM',
      pedestrianStepSec: tune.pedestrianStepSec,
      carAnimBaseSec: tune.carAnimBaseSec,
      carAnimPerCellSec: tune.carAnimPerCellSec,
      carAnimMinSec: tune.carAnimMinSec,
      carAnimMaxSec: tune.carAnimMaxSec,
      solutionPlan: [],
    };
  };

  for (let attempt = 0; attempt < 420; attempt += 1) {
    const seed = baseSeed + attempt * 7919;
    const rng = new RNG(seed);
    const density = rng.float(tune.densityMin, tune.densityMax);
    const targetCells = Math.max(8, Math.round(BOARD_W * BOARD_H * density));
    const minVehicles = clamp(Math.round(targetCells / 2.3), 10, 56);
    const vehicles = generateRandomVehicles(rng, BOARD_W, BOARD_H, targetCells, minVehicles);
    if (!vehicles || vehicles.length < 10) {
      continue;
    }

    const fences = generateBalancedEdgeFences(rng, BOARD_W, BOARD_H, 1 / 3);
    if (fences.length < 8) {
      continue;
    }

    const occupied = new Set();
    for (const v of vehicles) {
      for (const [x, y] of vehicleCells(v)) {
        occupied.add(toCellKey(x, y));
      }
    }
    const pedestrians = generatePedestrians(rng, levelNumber, BOARD_W, BOARD_H, occupied, null);
    const level = buildLevel(seed, vehicles, fences, pedestrians);
    if (countSafeMoves(level) < 1) {
      continue;
    }
    return level;
  }

  // Soft fallback: lower density and fewer pedestrians.
  for (let i = 0; i < 360; i += 1) {
    const seed = baseSeed + 9800003 + i * 1291;
    const rng = new RNG(seed);
    const density = rng.float(0.65, 0.71);
    const targetCells = Math.max(8, Math.round(BOARD_W * BOARD_H * density));
    const vehicles = generateRandomVehicles(rng, BOARD_W, BOARD_H, targetCells, 8);
    if (!vehicles || vehicles.length < 4) {
      continue;
    }
    const fences = generateBalancedEdgeFences(rng, BOARD_W, BOARD_H, 1 / 3);
    const occupied = new Set();
    for (const v of vehicles) {
      for (const [x, y] of vehicleCells(v)) {
        occupied.add(toCellKey(x, y));
      }
    }
    const pedestrians = generatePedestrians(rng, levelNumber, BOARD_W, BOARD_H, occupied, null).slice(0, 2);
    const level = buildLevel(seed, vehicles, fences, pedestrians);
    if (countSafeMoves(level) < 1) {
      continue;
    }
    return level;
  }

  // Hard safety net: keep high occupancy and avoid single-vehicle fallback.
  let rng = new RNG(baseSeed ^ 0x9e3779b9);
  let vehicles = null;
  for (let i = 0; i < 420 && !vehicles; i += 1) {
    const seed = (baseSeed ^ 0x9e3779b9) + i * 4099;
    rng = new RNG(seed);
    vehicles = generateRandomVehicles(rng, BOARD_W, BOARD_H, Math.round(BOARD_W * BOARD_H * 0.66), 6);
  }
  if (!vehicles) {
    vehicles = [];
    let id = 0;
    let filled = 0;
    const targetCells = Math.round(BOARD_W * BOARD_H * 0.66);
    for (let y = 0; y < BOARD_H && filled < targetCells; y += 1) {
      for (let x = 0; x < BOARD_W && filled < targetCells; x += 1) {
        vehicles.push({
          id: `V${String(id).padStart(3, '0')}`,
          x,
          y,
          length: 1,
          axis: 'H',
          color: CAR_COLORS[id % CAR_COLORS.length],
          spriteType: id % 2 === 0 ? 'sedan' : 'suv',
          frontPositive: (id % 3) !== 0,
          active: true,
        });
        id += 1;
        filled += 1;
      }
    }
  }
  const fences = generateBalancedEdgeFences(rng, BOARD_W, BOARD_H, 1 / 3);
  return {
    id: `L-${String(levelNumber).padStart(4, '0')}`,
    seed: baseSeed,
    boardW: BOARD_W,
    boardH: BOARD_H,
    vehicles,
    fences,
    pedestrians: [],
    optimalMoves: Math.max(1, Math.round(vehicles.length * 0.72)),
    maxSteps: vehicles.length + 5,
    difficulty: 'RANDOM',
    pedestrianStepSec: tune.pedestrianStepSec,
    carAnimBaseSec: tune.carAnimBaseSec,
    carAnimPerCellSec: tune.carAnimPerCellSec,
    carAnimMinSec: tune.carAnimMinSec,
    carAnimMaxSec: tune.carAnimMaxSec,
    solutionPlan: [],
  };
}

function directionText(direction) {
  switch (direction) {
    case 'LEFT':
      return '左';
    case 'RIGHT':
      return '右';
    case 'UP':
      return '上';
    case 'DOWN':
      return '下';
    default:
      return '-';
  }
}

function computeHint(level) {
  for (const [vehicleId, direction] of level.solutionPlan) {
    const vehicle = findVehicle(level, vehicleId);
    if (!vehicle || !vehicle.active) {
      continue;
    }
    const outcome = simulateMove(level, vehicleId, direction);
    if ((outcome.moved || outcome.leftBoard) && !outcome.pedestrianCollision) {
      return { vehicleId, direction, fromSolution: true, exitsNow: outcome.leftBoard };
    }
  }

  const active = level.vehicles.filter((v) => v.active);
  for (const v of active) {
    const dirs = v.axis === 'H' ? ['LEFT', 'RIGHT'] : ['UP', 'DOWN'];
    for (const dir of dirs) {
      const outcome = simulateMove(level, v.id, dir);
      if (outcome.leftBoard && !outcome.pedestrianCollision) {
        return { vehicleId: v.id, direction: dir, fromSolution: false, exitsNow: true };
      }
    }
  }

  let best = null;
  for (const v of active) {
    const dirs = v.axis === 'H' ? ['LEFT', 'RIGHT'] : ['UP', 'DOWN'];
    for (const dir of dirs) {
      const outcome = simulateMove(level, v.id, dir);
      if (!outcome.moved || outcome.pedestrianCollision) {
        continue;
      }
      if (!best || outcome.distance > best.distance) {
        best = { vehicleId: v.id, direction: dir, distance: outcome.distance };
      }
    }
  }

  if (!best) {
    return null;
  }
  return { vehicleId: best.vehicleId, direction: best.direction, fromSolution: false, exitsNow: false };
}

class AudioManager {
  constructor() {
    this.unlocked = false;
    this.ctx = null;
    this.assetAudio = null;

    this.bgmTrackSets = [
      ['./assets/audio/bgm.ogg', './assets/audio/bgm.mp3', './assets/audio/bgm.m4a'],
      ['./assets/audio/bgm2.ogg', './assets/audio/bgm2.mp3', './assets/audio/bgm2.m4a'],
    ];
    this.bgmResolved = [];
    this.bgmIndex = 0;

    this.rewardSources = ['./assets/audio/reward.ogg', './assets/audio/rewards.ogg', './assets/audio/reward.mp3', './assets/audio/reward.m4a', './assets/audio/reward.wav'];
    this.driveSources = ['./assets/audio/drive.ogg', './assets/audio/derive.ogg'];
    this.hitSources = ['./assets/audio/hit.ogg'];
    this.winSources = ['./assets/audio/win.ogg', './assets/audio/win.mp3'];
    this.failSources = ['./assets/audio/fail.ogg', './assets/audio/fail.mp3'];
    this.bgmVolume = 0.90;
    this.rewardVolume = 0.87;
    this.driveVolume = 0.54;
    this.hitVolume = 0.78;
    this.winVolume = 0.87;
    this.failVolume = 0.87;
    this.lastDriveAt = 0;
    this.lastHitAt = 0;
    this.bgmStarted = false;
    this.usingAsset = false;
    this.synthTimer = null;
    this.synthTick = 0;

    this.oneShotBufferDefs = {
      reward: this.rewardSources,
      drive: this.driveSources,
      hit: this.hitSources,
      win: this.winSources,
      fail: this.failSources,
    };
    this.oneShotBuffers = new Map();
    this.oneShotPreparing = null;
    this.lifecycleBound = false;
    this.bgmEnabled = true;
    this.sfxEnabled = true;
    this.loadPrefs();
  }

  loadPrefs() {
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY_AUDIO_PREFS);
      if (!raw) {
        return;
      }
      const parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return;
      }
      this.bgmEnabled = parsed.bgmEnabled !== false;
      this.sfxEnabled = parsed.sfxEnabled !== false;
    } catch (_err) {
      // ignore malformed/blocked storage
    }
  }

  savePrefs() {
    try {
      window.localStorage.setItem(STORAGE_KEY_AUDIO_PREFS, JSON.stringify({
        bgmEnabled: this.bgmEnabled,
        sfxEnabled: this.sfxEnabled,
      }));
    } catch (_err) {
      // ignore storage failures
    }
  }

  isBgmEnabled() {
    return !!this.bgmEnabled;
  }

  isSfxEnabled() {
    return !!this.sfxEnabled;
  }

  setBgmEnabled(enabled, options = {}) {
    const forceRestart = !!options.forceRestart;
    this.bgmEnabled = !!enabled;
    this.savePrefs();

    if (!this.bgmEnabled) {
      if (this.assetAudio) {
        this.assetAudio.pause();
      }
      if (this.synthTimer !== null) {
        window.clearInterval(this.synthTimer);
        this.synthTimer = null;
        this.synthTick = 0;
      }
      return;
    }

    if (!this.unlocked) {
      return;
    }

    if (forceRestart) {
      this.bgmStarted = false;
      if (this.assetAudio) {
        this.assetAudio.pause();
        this.assetAudio.currentTime = 0;
      }
      this.assetAudio = null;
      this.bgmResolved = [];
    }

    if (!this.assetAudio && this.synthTimer === null) {
      this.bgmStarted = false;
    }

    this.resumeAfterSuspend();
    if (!this.bgmStarted) {
      this.startBgm();
    }
  }

  toggleBgm(options = {}) {
    const next = !this.bgmEnabled;
    this.setBgmEnabled(next, options);
    return this.bgmEnabled;
  }

  pausePlayback() {
    if (this.assetAudio) {
      this.assetAudio.pause();
    }
    if (this.synthTimer !== null) {
      window.clearInterval(this.synthTimer);
      this.synthTimer = null;
      this.synthTick = 0;
    }
  }

  resumePlayback() {
    if (!this.bgmEnabled || !this.unlocked) {
      return;
    }
    if (this.assetAudio) {
      try {
        const playPromise = this.assetAudio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch (_err) {
        // ignore playback errors
      }
      return;
    }
    if (this.synthTimer !== null) {
      return;
    }
    this.bgmStarted = false;
    this.startBgm();
  }

  setSfxEnabled(enabled) {
    this.sfxEnabled = !!enabled;
    this.savePrefs();
  }

  toggleSfx() {
    this.setSfxEnabled(!this.sfxEnabled);
    return this.sfxEnabled;
  }

  async unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (Ctor) {
        this.ctx = new Ctor();
      }
    }

    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        await this.ctx.resume();
      } catch (_err) {
        // ignore
      }
    }

    this.unlocked = true;
    this.bindLifecycleListeners();
    this.prepareOneShotBuffers();
    this.startBgm();
  }

  bindLifecycleListeners() {
    if (this.lifecycleBound) {
      return;
    }
    this.lifecycleBound = true;

    const recover = () => {
      this.resumeAfterSuspend();
    };

    document.addEventListener('visibilitychange', recover);
    window.addEventListener('pageshow', recover);
    window.addEventListener('focus', recover);
  }

  async resumeAfterSuspend() {
    if (!this.unlocked) {
      return;
    }
    if (this.ctx && (this.ctx.state === 'suspended' || this.ctx.state === 'interrupted')) {
      try {
        await this.ctx.resume();
      } catch (_err) {
        // ignore
      }
    }
    if (this.assetAudio && !document.hidden && this.bgmEnabled && this.assetAudio.paused) {
      try {
        const playPromise = this.assetAudio.play();
        if (playPromise && typeof playPromise.catch === 'function') {
          playPromise.catch(() => {});
        }
      } catch (_err) {
        // ignore
      }
    }
  }

  startBgm() {
    if (!this.unlocked || this.bgmStarted || !this.bgmEnabled) {
      return;
    }
    this.bgmStarted = true;
    this.prepareBgmPlaylist().then((ok) => {
      if (!ok) {
        this.startSynthBgm();
      }
    });
  }

  mimeByExt(src) {
    if (src.endsWith('.mp3')) {
      return 'audio/mpeg';
    }
    if (src.endsWith('.m4a')) {
      return 'audio/mp4';
    }
    if (src.endsWith('.ogg')) {
      return 'audio/ogg';
    }
    if (src.endsWith('.wav')) {
      return 'audio/wav';
    }
    return 'audio/*';
  }

  canPlay(src) {
    const probe = new Audio();
    const mime = this.mimeByExt(src);
    if (!probe.canPlayType) {
      return true;
    }
    return probe.canPlayType(mime) !== '';
  }

  probeCanLoad(src, volume = 0.4) {
    return new Promise((resolve) => {
      const audio = new Audio();
      let done = false;
      const finish = (ok) => {
        if (done) {
          return;
        }
        done = true;
        audio.removeEventListener('canplaythrough', onReady);
        audio.removeEventListener('loadeddata', onReady);
        audio.removeEventListener('error', onError);
        resolve(ok);
      };
      const onReady = () => finish(true);
      const onError = () => finish(false);

      audio.preload = 'auto';
      audio.volume = volume;
      audio.src = src;
      audio.addEventListener('canplaythrough', onReady, { once: true });
      audio.addEventListener('loadeddata', onReady, { once: true });
      audio.addEventListener('error', onError, { once: true });
      try {
        audio.load();
      } catch (_err) {
        finish(false);
        return;
      }
      window.setTimeout(() => finish(false), 900);
    });
  }

  async resolveFirstLoadable(candidates, volume = 0.4) {
    for (const baseSrc of candidates) {
      if (!this.canPlay(baseSrc)) {
        continue;
      }
      const src = `${baseSrc}?v=${BUILD_TAG}`;
      try {
        const ok = await this.probeCanLoad(src, volume);
        if (ok) {
          return src;
        }
      } catch (_err) {
        // continue
      }
    }
    return null;
  }

  async prepareBgmPlaylist() {
    const resolved = [];
    for (const set of this.bgmTrackSets) {
      const src = await this.resolveFirstLoadable(set, this.bgmVolume);
      if (src) {
        resolved.push(src);
      }
    }
    if (!resolved.length) {
      return false;
    }
    this.bgmResolved = resolved;
    this.usingAsset = true;
    this.playBgmTrack(0);
    return true;
  }

  playBgmTrack(index) {
    if (!this.unlocked || !this.bgmResolved.length || !this.bgmEnabled) {
      return;
    }
    const normalized = ((index % this.bgmResolved.length) + this.bgmResolved.length) % this.bgmResolved.length;
    this.bgmIndex = normalized;
    const src = this.bgmResolved[normalized];
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.loop = this.bgmResolved.length <= 1;
    audio.volume = this.bgmVolume;

    audio.addEventListener('ended', () => {
      if (this.bgmResolved.length > 1 && this.assetAudio === audio) {
        this.playBgmTrack((normalized + 1) % this.bgmResolved.length);
      }
    }, { once: true });
    audio.addEventListener('error', () => {
      if (this.bgmResolved.length > 1) {
        this.playBgmTrack((normalized + 1) % this.bgmResolved.length);
      } else {
        this.startSynthBgm();
      }
    }, { once: true });

    if (this.assetAudio) {
      this.assetAudio.pause();
      this.assetAudio.currentTime = 0;
    }
    this.assetAudio = audio;
    const playPromise = audio.play();
    if (playPromise && typeof playPromise.catch === 'function') {
      playPromise.catch(() => {
        if (this.bgmResolved.length > 1) {
          this.playBgmTrack((normalized + 1) % this.bgmResolved.length);
        } else {
          this.startSynthBgm();
        }
      });
    }
  }

  playOneShotFromCandidates(candidates, volume, fallback = null, options = {}) {
    const startOffsetSec = Number.isFinite(options.startOffsetSec) ? Math.max(0, options.startOffsetSec) : 0;
    const tryPlay = (index) => {
      if (index >= candidates.length) {
        if (fallback) {
          fallback();
        }
        return;
      }
      const baseSrc = candidates[index];
      if (!this.canPlay(baseSrc)) {
        tryPlay(index + 1);
        return;
      }
      const audio = new Audio(`${baseSrc}?v=${BUILD_TAG}`);
      audio.preload = 'auto';
      audio.volume = volume;

      let settled = false;
      let started = false;
      let metadataReady = false;
      let offsetApplied = false;
      const fail = () => {
        if (settled) {
          return;
        }
        settled = true;
        tryPlay(index + 1);
      };
      audio.addEventListener('error', fail, { once: true });

      const applyStartOffset = () => {
        if (offsetApplied || startOffsetSec <= 0) {
          return;
        }
        try {
          if (Number.isFinite(audio.duration) && audio.duration > 0) {
            audio.currentTime = Math.min(startOffsetSec, Math.max(0, audio.duration - 0.01));
            offsetApplied = true;
            return;
          }
          if (audio.readyState >= 1) {
            audio.currentTime = startOffsetSec;
            offsetApplied = true;
          }
        } catch (_err) {
          // ignore offset failures
        }
      };

      const startPlayback = () => {
        if (started || settled) {
          return;
        }
        if (startOffsetSec > 0 && !metadataReady) {
          return;
        }
        started = true;
        applyStartOffset();
        try {
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(fail);
          }
        } catch (_err) {
          fail();
        }
      };

      if (startOffsetSec <= 0) {
        startPlayback();
        return;
      }

      const onReady = () => {
        metadataReady = true;
        applyStartOffset();
        startPlayback();
      };
      audio.addEventListener('loadedmetadata', onReady, { once: true });
      audio.addEventListener('canplay', onReady, { once: true });
      try {
        audio.load();
      } catch (_err) {
        // ignore
      }
      window.setTimeout(() => {
        if (!started && !metadataReady) {
          try {
            const playPromise = audio.play();
            if (playPromise && typeof playPromise.catch === 'function') {
              playPromise.catch(fail);
            }
          } catch (_err) {
            fail();
          }
        }
      }, 450);
    };
    tryPlay(0);
  }

  ensureCtx() {
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) {
      return null;
    }
    if (!this.ctx) {
      this.ctx = new Ctor();
    }
    return this.ctx;
  }

  decodeAudioDataCompat(ctx, arrayBuffer) {
    return new Promise((resolve, reject) => {
      try {
        const input = arrayBuffer.slice(0);
        const maybePromise = ctx.decodeAudioData(
          input,
          (decoded) => resolve(decoded),
          (err) => reject(err || new Error('decodeAudioData failed')),
        );
        if (maybePromise && typeof maybePromise.then === 'function') {
          maybePromise.then(resolve).catch(reject);
        }
      } catch (err) {
        reject(err);
      }
    });
  }

  async prepareOneShotBuffers() {
    if (this.oneShotPreparing) {
      return this.oneShotPreparing;
    }
    const ctx = this.ensureCtx();
    if (!ctx) {
      return false;
    }

    this.oneShotPreparing = (async () => {
      const entries = Object.entries(this.oneShotBufferDefs);
      await Promise.all(entries.map(async ([key, candidates]) => {
        if (this.oneShotBuffers.has(key)) {
          return;
        }
        try {
          const src = await this.resolveFirstLoadable(candidates, 0.35);
          if (!src) {
            return;
          }
          const resp = await fetch(src, { cache: 'force-cache' });
          if (!resp.ok) {
            return;
          }
          const ab = await resp.arrayBuffer();
          const decoded = await this.decodeAudioDataCompat(ctx, ab);
          if (decoded) {
            this.oneShotBuffers.set(key, decoded);
          }
        } catch (_err) {
          // keep fallback path
        }
      }));
      return this.oneShotBuffers.size > 0;
    })().finally(() => {
      this.oneShotPreparing = null;
    });

    return this.oneShotPreparing;
  }

  playBufferedOneShot(key, volume, options = {}) {
    if (!this.unlocked) {
      return false;
    }
    const ctx = this.ensureCtx();
    const buffer = this.oneShotBuffers.get(key);
    if (!ctx || !buffer) {
      return false;
    }

    if (ctx.state === 'suspended' || ctx.state === 'interrupted') {
      ctx.resume().catch(() => {});
    }

    const startOffsetSec = Number.isFinite(options.startOffsetSec) ? Math.max(0, options.startOffsetSec) : 0;
    try {
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      const gain = ctx.createGain();
      gain.gain.value = volume;
      source.connect(gain);
      gain.connect(ctx.destination);
      const offset = Math.min(startOffsetSec, Math.max(0, buffer.duration - 0.01));
      source.start(ctx.currentTime, offset);
      return true;
    } catch (_err) {
      return false;
    }
  }

  midiToFreq(note) {
    return 440 * Math.pow(2, (note - 69) / 12);
  }

  playTone(freq, duration, gain = 0.12, type = 'sine', when = 0) {
    if (!this.unlocked) {
      return;
    }
    const ctx = this.ensureCtx();
    if (!ctx) {
      return;
    }
    const start = ctx.currentTime + when;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, start);
    g.gain.setValueAtTime(0.0001, start);
    g.gain.exponentialRampToValueAtTime(gain, start + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(g);
    g.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + duration + 0.02);
  }

  startSynthBgm() {
    if (!this.bgmEnabled) {
      return;
    }
    if (this.synthTimer !== null) {
      return;
    }
    const chords = [
      [57, 60, 64, 69],
      [53, 57, 60, 65],
      [55, 59, 62, 67],
      [52, 55, 59, 64],
    ];

    this.synthTimer = window.setInterval(() => {
      if (!this.unlocked) {
        return;
      }
      const beat = this.synthTick;
      const chord = chords[Math.floor(beat / 4) % chords.length];
      const arp = chord[beat % chord.length];
      this.playTone(this.midiToFreq(arp), 0.28, 0.06, 'triangle');
      if (beat % 2 === 0) {
        this.playTone(this.midiToFreq(chord[0] - 12), 0.45, 0.05, 'sine');
      }
      if (beat % 4 === 2) {
        this.playTone(this.midiToFreq(chord[3] + 12), 0.20, 0.05, 'sine', 0.08);
      }
      this.synthTick += 1;
    }, 320);
  }

  playRewardSynth() {
    this.playTone(this.midiToFreq(84), 0.14, 0.15, 'triangle', 0.00);
    this.playTone(this.midiToFreq(91), 0.18, 0.13, 'triangle', 0.05);
    this.playTone(this.midiToFreq(96), 0.19, 0.11, 'triangle', 0.09);
  }

  playWinSynth() {
    this.playTone(this.midiToFreq(79), 0.11, 0.10, 'triangle', 0.00);
    this.playTone(this.midiToFreq(83), 0.12, 0.11, 'triangle', 0.05);
    this.playTone(this.midiToFreq(86), 0.14, 0.11, 'triangle', 0.11);
    this.playTone(this.midiToFreq(91), 0.20, 0.10, 'triangle', 0.16);
  }

  playFailSynth() {
    this.playTone(this.midiToFreq(62), 0.12, 0.11, 'square', 0.00);
    this.playTone(this.midiToFreq(57), 0.15, 0.10, 'triangle', 0.05);
    this.playTone(this.midiToFreq(52), 0.20, 0.09, 'sawtooth', 0.11);
  }

  playReward() {
    if (!this.sfxEnabled) {
      return;
    }
    if (!this.unlocked) {
      this.playRewardSynth();
      return;
    }
    if (this.playBufferedOneShot('reward', this.rewardVolume)) {
      return;
    }
    this.prepareOneShotBuffers();
    this.playOneShotFromCandidates(this.rewardSources, this.rewardVolume, () => {
      this.playRewardSynth();
    });
  }

  playDrive() {
    if (!this.sfxEnabled) {
      return;
    }
    const now = performance.now();
    if (now - this.lastDriveAt < 80) {
      return;
    }
    this.lastDriveAt = now;
    if (!this.unlocked) {
      this.playTone(120, 0.20, 0.04, 'sawtooth');
      return;
    }
    if (this.playBufferedOneShot('drive', this.driveVolume, { startOffsetSec: DRIVE_AUDIO_START_OFFSET_SEC })) {
      return;
    }
    this.prepareOneShotBuffers();
    this.playOneShotFromCandidates(
      this.driveSources,
      this.driveVolume,
      () => {
        this.playTone(120, 0.22, 0.05, 'sawtooth');
        this.playTone(92, 0.24, 0.03, 'triangle', 0.03);
      },
      { startOffsetSec: DRIVE_AUDIO_START_OFFSET_SEC },
    );
  }

  playHit() {
    if (!this.sfxEnabled) {
      return;
    }
    const now = performance.now();
    if (now - this.lastHitAt < 80) {
      return;
    }
    this.lastHitAt = now;
    if (!this.unlocked) {
      this.playTone(180, 0.06, 0.09, 'square');
      this.playTone(122, 0.08, 0.06, 'triangle', 0.03);
      return;
    }
    if (this.playBufferedOneShot('hit', this.hitVolume)) {
      return;
    }
    this.prepareOneShotBuffers();
    this.playOneShotFromCandidates(this.hitSources, this.hitVolume, () => {
      this.playTone(180, 0.06, 0.09, 'square');
      this.playTone(122, 0.08, 0.06, 'triangle', 0.03);
    });
  }

  playWin() {
    if (!this.sfxEnabled) {
      return;
    }
    if (!this.unlocked) {
      this.playWinSynth();
      return;
    }
    if (this.playBufferedOneShot('win', this.winVolume)) {
      return;
    }
    this.prepareOneShotBuffers();
    this.playOneShotFromCandidates(this.winSources, this.winVolume, () => {
      this.playWinSynth();
    });
  }

  playFail() {
    if (!this.sfxEnabled) {
      return;
    }
    if (!this.unlocked) {
      this.playFailSynth();
      return;
    }
    if (this.playBufferedOneShot('fail', this.failVolume)) {
      return;
    }
    this.prepareOneShotBuffers();
    this.playOneShotFromCandidates(this.failSources, this.failVolume, () => {
      this.playFailSynth();
    });
  }

  playEngine() {
    this.playDrive();
  }
}

class GameApp {
  constructor() {
    this.canvas = document.getElementById('game-canvas');
    this.ctx = this.canvas.getContext('2d');
    this.width = 360;
    this.height = 640;
    this.dpr = 1;

    const stored = Number(window.localStorage.getItem(STORAGE_KEY_MAX_UNLOCKED));
    this.maxUnlocked = Number.isFinite(stored) && stored > 0 ? Math.floor(stored) : 1;
    this.profile = this.loadProfile();

    this.scene = 'level_select';
    this.levelPage = 0;
    this.shopReturnScene = 'level_select';
    this.runtimeAutosaveElapsed = 0;
    this.lastRuntimeStateSnapshotText = '';

    this.game = null;
    this.shopToast = null;

    this.audio = new AudioManager();
    this.vehicleTextures = new VehicleTextureLibrary(BUILD_TAG);
    this.lastTs = 0;
    this.lastSceneForDom = null;
    this.homeLinkEl = document.querySelector('.home-link');
    this.staticGameplayLayerCanvas = null;
    this.staticGameplayLayerCtx = null;
    this.staticGameplayLayerKey = '';

    this.pointer = {
      down: false,
      x: 0,
      y: 0,
      id: null,
      type: 'mouse',
      blockNativePan: false,
    };

    this.restoreRuntimeState();
    this.bindEvents();
    this.updateViewportHeightVar();
    this.resize();
    this.lastRuntimeStateSnapshotText = this.buildRuntimeStateSnapshotText();
  }

  loadProfile() {
    const rawText = window.localStorage.getItem(STORAGE_KEY_PLAYER_PROFILE);
    if (!rawText) {
      const profile = defaultProfile();
      window.localStorage.setItem(STORAGE_KEY_PLAYER_PROFILE, JSON.stringify(profile));
      return profile;
    }
    try {
      const parsed = JSON.parse(rawText);
      const profile = normalizeProfile(parsed);
      window.localStorage.setItem(STORAGE_KEY_PLAYER_PROFILE, JSON.stringify(profile));
      return profile;
    } catch (_err) {
      const profile = defaultProfile();
      window.localStorage.setItem(STORAGE_KEY_PLAYER_PROFILE, JSON.stringify(profile));
      return profile;
    }
  }

  saveProfile() {
    window.localStorage.setItem(STORAGE_KEY_PLAYER_PROFILE, JSON.stringify(this.profile));
  }

  inventoryCount(itemId) {
    return Math.max(0, Math.floor(this.profile.inventory[itemId] || 0));
  }

  clearRuntimeState() {
    window.localStorage.removeItem(STORAGE_KEY_RUNTIME_STATE);
    this.lastRuntimeStateSnapshotText = '';
  }

  serializeRuntimeGame(game) {
    if (!game) {
      return null;
    }
    const runtimeSource = game.collisionPrompt && game.collisionPrompt.restoreSnapshot
      ? game.collisionPrompt.restoreSnapshot
      : game;
    return {
      levelNumber: Math.max(1, Math.floor(game.levelNumber)),
      level: cloneLevel(runtimeSource.level),
      movesUsed: Math.max(0, Math.floor(runtimeSource.movesUsed || 0)),
      status: runtimeSource.status === 'won' || runtimeSource.status === 'failed' ? runtimeSource.status : 'playing',
      hitPedestrian: !!runtimeSource.hitPedestrian,
      hint: runtimeSource.hint ? { ...runtimeSource.hint } : null,
      hintRemaining: Math.max(0, Math.ceil(Number(runtimeSource.hintRemaining) || 0)),
      wrenchCount: Math.max(0, Math.floor(runtimeSource.wrenchCount || 0)),
      stepCardCount: Math.max(0, Math.floor(runtimeSource.stepCardCount || 0)),
      towCount: Math.max(0, Math.floor(runtimeSource.towCount || 0)),
      freezeCount: Math.max(0, Math.floor(runtimeSource.freezeCount || 0)),
      usedAnyItem: !!runtimeSource.usedAnyItem,
      wrenchMode: !!runtimeSource.wrenchMode,
      towMode: !!runtimeSource.towMode,
      itemMenuOpen: false,
      rewardGranted: !!runtimeSource.rewardGranted,
      rewardCoins: Math.max(0, Math.floor(runtimeSource.rewardCoins || 0)),
      rewardItems: Array.isArray(runtimeSource.rewardItems)
        ? runtimeSource.rewardItems.filter((itemId) => ITEM_IDS.includes(itemId))
        : [],
      heartsRemaining: Number.isFinite(game.heartsRemaining)
        ? Math.max(0, Math.floor(game.heartsRemaining))
        : LEVEL_HEARTS,
      freezePedRemaining: Math.max(0, Math.ceil(Number(runtimeSource.freezePedRemaining) || 0)),
      pedElapsed: 0,
      pedBlend: 1,
    };
  }

  restoreGameFromRuntime(rawGame) {
    if (!rawGame || typeof rawGame !== 'object') {
      return null;
    }
    const levelNumber = Number.isFinite(rawGame.levelNumber) ? Math.max(1, Math.floor(rawGame.levelNumber)) : 0;
    if (levelNumber < 1 || !rawGame.level || typeof rawGame.level !== 'object') {
      return null;
    }

    let level = null;
    try {
      level = cloneLevel(rawGame.level);
    } catch (_err) {
      return null;
    }

    const status = rawGame.status === 'won' || rawGame.status === 'failed' ? rawGame.status : 'playing';
    const pedMap = this.pedestrianPosMap(level.pedestrians);
    const base = {
      levelNumber,
      level,
      movesUsed: Number.isFinite(rawGame.movesUsed) ? Math.max(0, Math.floor(rawGame.movesUsed)) : 0,
      status,
      hitPedestrian: !!rawGame.hitPedestrian,
      history: [],
      toast: null,
      hint: null,
      hintRemaining: 0,
      wrenchCount: this.inventoryCount('wrench'),
      stepCardCount: this.inventoryCount('step'),
      towCount: this.inventoryCount('tow'),
      freezeCount: this.inventoryCount('freeze'),
      usedAnyItem: false,
      wrenchMode: false,
      towMode: false,
      itemMenuOpen: false,
      rewardGranted: false,
      rewardCoins: 0,
      rewardItems: [],
      heartsRemaining: LEVEL_HEARTS,
      collisionPrompt: null,
      moveAnimations: [],
      drag: null,
      freezePedRemaining: 0,
      pedElapsed: 0,
      pedBlend: 1,
      pedPrev: { ...pedMap },
      pedCurr: { ...pedMap },
    };

    const hint = rawGame.hint;
    const hintDir = hint && typeof hint === 'object' ? hint.direction : null;
    if (hint && typeof hint === 'object' && typeof hint.vehicleId === 'string'
      && (hintDir === 'LEFT' || hintDir === 'RIGHT' || hintDir === 'UP' || hintDir === 'DOWN')) {
      base.hint = {
        vehicleId: hint.vehicleId,
        direction: hintDir,
        fromSolution: !!hint.fromSolution,
        exitsNow: !!hint.exitsNow,
      };
    } else {
      base.hint = null;
    }
    base.hintRemaining = Number.isFinite(rawGame.hintRemaining) ? Math.max(0, rawGame.hintRemaining) : 0;
    if (!base.hint || base.hintRemaining <= 0) {
      base.hint = null;
      base.hintRemaining = 0;
    }

    base.wrenchCount = Number.isFinite(rawGame.wrenchCount) ? Math.max(0, Math.floor(rawGame.wrenchCount)) : base.wrenchCount;
    base.stepCardCount = Number.isFinite(rawGame.stepCardCount) ? Math.max(0, Math.floor(rawGame.stepCardCount)) : base.stepCardCount;
    base.towCount = Number.isFinite(rawGame.towCount) ? Math.max(0, Math.floor(rawGame.towCount)) : base.towCount;
    base.freezeCount = Number.isFinite(rawGame.freezeCount) ? Math.max(0, Math.floor(rawGame.freezeCount)) : base.freezeCount;

    base.usedAnyItem = !!rawGame.usedAnyItem;
    base.wrenchMode = status === 'playing' && !!rawGame.wrenchMode;
    base.towMode = status === 'playing' && !!rawGame.towMode;
    base.itemMenuOpen = false;

    base.rewardGranted = !!rawGame.rewardGranted;
    base.rewardCoins = Number.isFinite(rawGame.rewardCoins) ? Math.max(0, Math.floor(rawGame.rewardCoins)) : 0;
    base.rewardItems = Array.isArray(rawGame.rewardItems)
      ? rawGame.rewardItems.filter((itemId) => ITEM_IDS.includes(itemId))
      : [];
    base.heartsRemaining = Number.isFinite(rawGame.heartsRemaining)
      ? Math.max(0, Math.floor(rawGame.heartsRemaining))
      : LEVEL_HEARTS;
    base.collisionPrompt = null;

    base.freezePedRemaining = Number.isFinite(rawGame.freezePedRemaining) ? Math.max(0, rawGame.freezePedRemaining) : 0;
    base.pedElapsed = Number.isFinite(rawGame.pedElapsed) ? Math.max(0, rawGame.pedElapsed) : 0;
    base.pedBlend = Number.isFinite(rawGame.pedBlend) ? clamp(rawGame.pedBlend, 0, 1) : 1;
    return base;
  }

  buildRuntimeStatePayload(options = {}) {
    return {
      version: RUNTIME_STATE_VERSION,
      scene: this.scene,
      levelPage: Math.max(0, Math.floor(this.levelPage || 0)),
      shopReturnScene: this.shopReturnScene === 'gameplay' ? 'gameplay' : 'level_select',
      game: this.serializeRuntimeGame(this.game),
      savedAt: options.includeSavedAt === false ? 0 : Date.now(),
    };
  }

  buildRuntimeStateSnapshotText() {
    return JSON.stringify(this.buildRuntimeStatePayload({ includeSavedAt: false }));
  }

  saveRuntimeState(options = {}) {
    try {
      const payload = this.buildRuntimeStatePayload();
      const snapshotText = JSON.stringify({ ...payload, savedAt: 0 });
      if (!options.force && snapshotText === this.lastRuntimeStateSnapshotText) {
        return false;
      }
      window.localStorage.setItem(STORAGE_KEY_RUNTIME_STATE, JSON.stringify(payload));
      this.lastRuntimeStateSnapshotText = snapshotText;
      return true;
    } catch (_err) {
      // Ignore storage write failures (quota/private mode).
      return false;
    }
  }

  restoreRuntimeState() {
    const text = window.localStorage.getItem(STORAGE_KEY_RUNTIME_STATE);
    if (!text) {
      return;
    }

    let parsed = null;
    try {
      parsed = JSON.parse(text);
    } catch (_err) {
      this.clearRuntimeState();
      return;
    }
    if (!parsed || typeof parsed !== 'object') {
      this.clearRuntimeState();
      return;
    }
    if (parsed.version !== RUNTIME_STATE_VERSION) {
      this.clearRuntimeState();
      return;
    }

    const restoredGame = this.restoreGameFromRuntime(parsed.game);
    this.levelPage = Number.isFinite(parsed.levelPage) ? Math.max(0, Math.floor(parsed.levelPage)) : 0;
    this.shopReturnScene = parsed.shopReturnScene === 'gameplay' ? 'gameplay' : 'level_select';
    this.game = restoredGame;

    if (restoredGame) {
      this.profile.inventory.wrench = restoredGame.wrenchCount;
      this.profile.inventory.step = restoredGame.stepCardCount;
      this.profile.inventory.tow = restoredGame.towCount;
      this.profile.inventory.freeze = restoredGame.freezeCount;
      this.saveProfile();
    }

    if (parsed.scene === 'shop') {
      this.scene = 'shop';
    } else if (parsed.scene === 'gameplay' && restoredGame) {
      this.scene = 'gameplay';
    } else {
      this.scene = 'level_select';
    }
    this.runtimeAutosaveElapsed = 0;
    this.lastRuntimeStateSnapshotText = this.buildRuntimeStateSnapshotText();
  }

  bindEvents() {
    window.addEventListener('resize', () => {
      this.updateViewportHeightVar();
      this.resize();
    });
    window.addEventListener('beforeunload', () => {
      this.saveRuntimeState({ force: true });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.saveRuntimeState({ force: true });
      }
    });
    window.addEventListener('orientationchange', () => {
      window.setTimeout(() => {
        this.updateViewportHeightVar();
        this.resize();
      }, 80);
    });
    if (window.visualViewport) {
      window.visualViewport.addEventListener('resize', () => {
        this.updateViewportHeightVar();
        this.resize();
      });
    }

    window.addEventListener('mygame:view-change', (event) => {
      const targetView = String(event && event.detail && event.detail.view ? event.detail.view : '').toLowerCase();
      if (!targetView || targetView === 'game') {
        this.audio.resumePlayback();
        return;
      }
      this.audio.pausePlayback();
    });

    this.canvas.addEventListener('pointerdown', (event) => {
      this.onPointerDown(event);
    });
    this.canvas.addEventListener('pointermove', (event) => {
      this.onPointerMove(event);
    });
    this.canvas.addEventListener('pointerup', (event) => {
      this.onPointerUp(event);
    });
    this.canvas.addEventListener('pointercancel', (event) => {
      this.onPointerUp(event);
    });
    this.canvas.addEventListener('lostpointercapture', (event) => {
      if (event.pointerId !== this.pointer.id) {
        return;
      }
      this.pointer.down = false;
      this.pointer.id = null;
      this.pointer.type = 'mouse';
      this.pointer.blockNativePan = false;
    });
    this.canvas.addEventListener('touchmove', (event) => {
      this.onNativeTouchMove(event);
    }, { passive: false });
  }

  updateViewportHeightVar() {
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--app-vh', `${Math.max(1, Math.round(vh))}px`);
  }

  resize() {
    const vw = window.visualViewport ? window.visualViewport.width : window.innerWidth;
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    this.width = Math.max(320, Math.round(vw));
    this.height = Math.max(568, Math.round(vh));
    this.dpr = Math.max(1, Math.min(3, window.devicePixelRatio || 1));

    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = true;
    this.ctx.imageSmoothingQuality = 'high';
    this.staticGameplayLayerKey = '';
  }

  start() {
    window.render_game_to_text = () => this.renderGameToText();
    window.advanceTime = (ms) => this.advanceTime(ms);

    const step = (ts) => {
      if (!this.lastTs) {
        this.lastTs = ts;
      }
      const shellView = document.body.getAttribute('data-shell-view');
      const shouldRender = !shellView || shellView === 'game';
      if (!shouldRender) {
        this.lastTs = ts;
        window.requestAnimationFrame(step);
        return;
      }
      const dt = clamp((ts - this.lastTs) / 1000, 0, 0.25);
      this.lastTs = ts;
      this.update(dt);
      this.render();
      window.requestAnimationFrame(step);
    };
    window.requestAnimationFrame(step);
  }

  advanceTime(ms) {
    const totalMs = Math.max(0, Number(ms) || 0);
    const frameMs = 1000 / 60;
    const steps = Math.max(1, Math.ceil(totalMs / frameMs));
    const dt = (totalMs > 0 ? totalMs / steps : frameMs) / 1000;
    for (let i = 0; i < steps; i += 1) {
      this.update(dt);
    }
    this.render();
    this.lastTs = performance.now();
    return this.renderGameToText();
  }

  renderGameToText() {
    const payload = {
      coordinateSystem: 'origin=(0,0) top-left; x increases right; y increases down; board positions use cell units',
      scene: this.scene,
      coins: Math.max(0, Math.floor(this.profile.coins || 0)),
      inventory: cloneInventory(this.profile.inventory),
      shopToast: this.shopToast ? this.shopToast.text : null,
    };

    if (this.scene === 'level_select') {
      payload.levelPage = Math.max(0, Math.floor(this.levelPage || 0));
      payload.maxUnlocked = Math.max(1, Math.floor(this.maxUnlocked || 1));
    }

    if (this.scene === 'shop') {
      payload.shopReturnScene = this.shopReturnScene;
    }

    if (this.scene === 'gameplay' && this.game) {
      const g = this.game;
      const animatingIds = new Set((g.moveAnimations || []).map((anim) => anim.vehicleId));
      payload.gameplay = {
        levelNumber: g.levelNumber,
        boardSize: { w: g.level.boardW, h: g.level.boardH },
        status: g.status,
        moves: { used: g.movesUsed, max: g.level.maxSteps },
        hearts: { remaining: g.heartsRemaining, total: LEVEL_HEARTS },
        items: {
          wrench: g.wrenchCount,
          step: g.stepCardCount,
          tow: g.towCount,
          freeze: g.freezeCount,
        },
        modes: {
          itemMenuOpen: !!g.itemMenuOpen,
          wrench: !!g.wrenchMode,
          tow: !!g.towMode,
        },
        hint: g.hint && g.hintRemaining > 0
          ? { ...g.hint, remainingSec: Math.max(0, Math.ceil(g.hintRemaining)) }
          : null,
        toast: g.toast ? g.toast.text : null,
        collisionPrompt: g.collisionPrompt
          ? {
            title: '撞到行人',
            heartsText: `${g.heartsRemaining}/${LEVEL_HEARTS}`,
            actions: ['继续(-1❤️)', '放弃'],
          }
          : null,
        reward: g.status === 'won'
          ? {
            coins: Math.max(0, Math.floor(g.rewardCoins || 0)),
            items: Array.isArray(g.rewardItems) ? g.rewardItems.slice() : [],
          }
          : null,
        vehicles: g.level.vehicles
          .filter((vehicle) => vehicle.active)
          .map((vehicle) => ({
            id: vehicle.id,
            x: vehicle.x,
            y: vehicle.y,
            length: vehicle.length,
            axis: vehicle.axis,
            animating: animatingIds.has(vehicle.id),
          })),
        pedestrians: g.level.pedestrians.map((ped) => {
          const [x, y] = this.pedestrianRenderPos(ped);
          return {
            id: ped.id,
            x: Number(x.toFixed(2)),
            y: Number(y.toFixed(2)),
            facing: ped.facing,
            axis: ped.axis,
          };
        }),
        fences: g.level.fences.map((fence) => `${fence.x},${fence.y},${fence.direction}`),
      };
    }

    return JSON.stringify(payload);
  }

  newGameState(levelNumber) {
    const level = generateLevel(levelNumber);
    const pedMap = this.pedestrianPosMap(level.pedestrians);

    return {
      levelNumber,
      level,
      movesUsed: 0,
      status: 'playing',
      hitPedestrian: false,
      history: [],
      toast: null,
      hint: null,
      hintRemaining: 0,
      wrenchCount: this.inventoryCount('wrench'),
      stepCardCount: this.inventoryCount('step'),
      towCount: this.inventoryCount('tow'),
      freezeCount: this.inventoryCount('freeze'),
      usedAnyItem: false,
      wrenchMode: false,
      towMode: false,
      itemMenuOpen: false,
      rewardGranted: false,
      rewardCoins: 0,
      rewardItems: [],
      heartsRemaining: LEVEL_HEARTS,
      collisionPrompt: null,
      moveAnimations: [],
      drag: null,
      freezePedRemaining: 0,
      pedElapsed: 0,
      pedBlend: 1,
      pedPrev: { ...pedMap },
      pedCurr: { ...pedMap },
    };
  }

  startLevel(levelNumber) {
    const safeLevel = Math.max(1, Math.floor(levelNumber));
    this.game = this.newGameState(safeLevel);
    this.scene = 'gameplay';
    this.runtimeAutosaveElapsed = 0;
    this.saveRuntimeState();
  }

  openLevelFromSelect(levelNumber) {
    const safeLevel = Math.max(1, Math.floor(levelNumber));
    if (this.game && this.game.levelNumber === safeLevel) {
      this.syncGameInventoryFromProfile({ skipSaveRuntime: true });
      this.scene = 'gameplay';
      this.runtimeAutosaveElapsed = 0;
      this.saveRuntimeState();
      return;
    }
    this.startLevel(safeLevel);
  }

  backToLevelSelect(focusLevel) {
    this.scene = 'level_select';
    this.shopReturnScene = 'level_select';
    this.levelPage = Math.max(0, Math.floor((focusLevel - 1) / LEVELS_PER_PAGE));
    this.saveRuntimeState();
  }

  saveProgress() {
    window.localStorage.setItem(STORAGE_KEY_MAX_UNLOCKED, String(this.maxUnlocked));
  }

  addToast(text, sec = 1.2) {
    if (!this.game) {
      return;
    }
    this.game.toast = {
      text,
      remaining: sec,
    };
  }

  addShopToast(text, sec = 1.2) {
    this.shopToast = {
      text,
      remaining: sec,
    };
  }

  openShop(fromScene = 'level_select') {
    this.shopReturnScene = fromScene === 'gameplay' ? 'gameplay' : 'level_select';
    this.scene = 'shop';
    this.saveRuntimeState();
  }

  closeShop() {
    if (this.shopReturnScene === 'gameplay' && this.game) {
      this.syncGameInventoryFromProfile({ skipSaveRuntime: true });
      this.scene = 'gameplay';
    } else {
      this.scene = 'level_select';
    }
    this.shopReturnScene = 'level_select';
    this.saveRuntimeState();
  }

  resetProgressAndInventory() {
    const ok = window.confirm('确认重置存档？将清空当前进度并恢复初始金币/道具。');
    if (!ok) {
      return;
    }
    this.maxUnlocked = 1;
    this.profile = defaultProfile();
    this.saveProgress();
    this.saveProfile();
    this.levelPage = 0;
    this.game = null;
    this.shopToast = null;
    this.shopReturnScene = 'level_select';
    this.scene = 'level_select';
    this.runtimeAutosaveElapsed = 0;
    this.clearRuntimeState();
  }

  syncProfileInventoryFromGame() {
    const g = this.game;
    if (!g) {
      return;
    }
    this.profile.inventory.wrench = Math.max(0, Math.floor(g.wrenchCount || 0));
    this.profile.inventory.step = Math.max(0, Math.floor(g.stepCardCount || 0));
    this.profile.inventory.tow = Math.max(0, Math.floor(g.towCount || 0));
    this.profile.inventory.freeze = Math.max(0, Math.floor(g.freezeCount || 0));
    this.saveProfile();
    this.saveRuntimeState();
  }

  syncGameInventoryFromProfile(options = {}) {
    const g = this.game;
    if (!g) {
      return;
    }
    g.wrenchCount = this.inventoryCount('wrench');
    g.stepCardCount = this.inventoryCount('step');
    g.towCount = this.inventoryCount('tow');
    g.freezeCount = this.inventoryCount('freeze');
    if (!options.skipSaveRuntime) {
      this.saveRuntimeState();
    }
  }

  captureGameSnapshot(sourceGame = this.game) {
    if (!sourceGame) {
      return null;
    }
    return {
      level: cloneLevel(sourceGame.level),
      movesUsed: sourceGame.movesUsed,
      status: sourceGame.status,
      hitPedestrian: !!sourceGame.hitPedestrian,
      freezePedRemaining: sourceGame.freezePedRemaining,
      pedElapsed: sourceGame.pedElapsed,
      pedBlend: sourceGame.pedBlend,
      pedPrev: { ...sourceGame.pedPrev },
      pedCurr: { ...sourceGame.pedCurr },
      hint: sourceGame.hint ? { ...sourceGame.hint } : null,
      hintRemaining: sourceGame.hintRemaining,
      wrenchCount: sourceGame.wrenchCount,
      stepCardCount: sourceGame.stepCardCount,
      towCount: sourceGame.towCount,
      freezeCount: sourceGame.freezeCount,
      usedAnyItem: !!sourceGame.usedAnyItem,
      wrenchMode: !!sourceGame.wrenchMode,
      towMode: !!sourceGame.towMode,
      itemMenuOpen: !!sourceGame.itemMenuOpen,
      rewardGranted: !!sourceGame.rewardGranted,
      rewardCoins: Math.max(0, Math.floor(sourceGame.rewardCoins || 0)),
      rewardItems: Array.isArray(sourceGame.rewardItems)
        ? sourceGame.rewardItems.filter((itemId) => ITEM_IDS.includes(itemId))
        : [],
    };
  }

  restoreGameSnapshot(snapshot, options = {}) {
    const g = this.game;
    if (!g || !snapshot) {
      return false;
    }
    g.level = cloneLevel(snapshot.level);
    g.movesUsed = Number.isFinite(snapshot.movesUsed) ? Math.max(0, Math.floor(snapshot.movesUsed)) : 0;
    g.status = snapshot.status === 'won' || snapshot.status === 'failed' ? snapshot.status : 'playing';
    g.hitPedestrian = !!snapshot.hitPedestrian;
    g.freezePedRemaining = Number.isFinite(snapshot.freezePedRemaining) ? Math.max(0, snapshot.freezePedRemaining) : 0;
    g.pedElapsed = Number.isFinite(snapshot.pedElapsed) ? Math.max(0, snapshot.pedElapsed) : 0;
    g.pedBlend = Number.isFinite(snapshot.pedBlend) ? clamp(snapshot.pedBlend, 0, 1) : 1;
    g.pedPrev = { ...snapshot.pedPrev };
    g.pedCurr = { ...snapshot.pedCurr };
    g.hint = snapshot.hint ? { ...snapshot.hint } : null;
    g.hintRemaining = Number.isFinite(snapshot.hintRemaining) ? Math.max(0, snapshot.hintRemaining) : 0;
    g.wrenchCount = Number.isFinite(snapshot.wrenchCount) ? Math.max(0, Math.floor(snapshot.wrenchCount)) : 0;
    g.stepCardCount = Number.isFinite(snapshot.stepCardCount) ? Math.max(0, Math.floor(snapshot.stepCardCount)) : 0;
    g.towCount = Number.isFinite(snapshot.towCount) ? Math.max(0, Math.floor(snapshot.towCount)) : 0;
    g.freezeCount = Number.isFinite(snapshot.freezeCount) ? Math.max(0, Math.floor(snapshot.freezeCount)) : 0;
    g.usedAnyItem = !!snapshot.usedAnyItem;
    g.wrenchMode = !!snapshot.wrenchMode;
    g.towMode = !!snapshot.towMode;
    g.itemMenuOpen = !!snapshot.itemMenuOpen;
    g.rewardGranted = !!snapshot.rewardGranted;
    g.rewardCoins = Number.isFinite(snapshot.rewardCoins) ? Math.max(0, Math.floor(snapshot.rewardCoins)) : 0;
    g.rewardItems = Array.isArray(snapshot.rewardItems)
      ? snapshot.rewardItems.filter((itemId) => ITEM_IDS.includes(itemId))
      : [];
    g.moveAnimations = [];
    g.drag = null;
    g.collisionPrompt = null;
    g.toast = null;

    if (options.syncProfile !== false) {
      this.syncProfileInventoryFromGame();
    }
    return true;
  }

  failCurrentLevel(message, options = {}) {
    const g = this.game;
    if (!g) {
      return;
    }
    g.status = 'failed';
    g.hitPedestrian = !!options.hitPedestrian;
    g.itemMenuOpen = false;
    g.wrenchMode = false;
    g.towMode = false;
    g.collisionPrompt = null;
    g.moveAnimations = [];
    g.drag = null;
    this.audio.playFail();
    this.addToast(message, 1.4);
    this.saveRuntimeState();
  }

  promptPedestrianCollision(message, restoreSnapshot, options = {}) {
    const g = this.game;
    if (!g || g.status !== 'playing') {
      return;
    }
    if (!restoreSnapshot) {
      this.failCurrentLevel('撞到行人，挑战失败', { hitPedestrian: true });
      return;
    }
    if (g.heartsRemaining <= 0) {
      this.failCurrentLevel('❤️已耗尽，挑战失败', { hitPedestrian: true });
      return;
    }

    g.itemMenuOpen = false;
    g.wrenchMode = false;
    g.towMode = false;
    g.drag = null;
    g.moveAnimations = [];
    g.collisionPrompt = {
      message,
      restoreSnapshot,
      consumeHistorySnapshot: !!options.consumeHistorySnapshot,
    };
    this.audio.playHit();
    this.saveRuntimeState();
  }

  resolveCollisionPrompt(continuePlaying) {
    const g = this.game;
    if (!g || !g.collisionPrompt) {
      return;
    }
    const prompt = g.collisionPrompt;
    g.collisionPrompt = null;

    if (!continuePlaying) {
      this.failCurrentLevel('你选择放弃，本关失败', { hitPedestrian: true });
      return;
    }

    if (g.heartsRemaining <= 0) {
      this.failCurrentLevel('❤️已耗尽，挑战失败', { hitPedestrian: true });
      return;
    }

    g.heartsRemaining = Math.max(0, g.heartsRemaining - 1);
    if (prompt.consumeHistorySnapshot && g.history.length) {
      g.history.pop();
    }
    this.restoreGameSnapshot(prompt.restoreSnapshot);
    this.addToast(`已消耗 1 颗❤️，剩余 ${g.heartsRemaining} 颗`, 1.3);
    this.saveRuntimeState();
  }

  markLevelWon() {
    const g = this.game;
    if (!g) {
      return;
    }
    if (g.status !== 'won') {
      g.status = 'won';
      g.itemMenuOpen = false;
      this.audio.playWin();
      const nextLevel = g.levelNumber + 1;
      this.maxUnlocked = Math.max(this.maxUnlocked, nextLevel);
      this.saveProgress();
      this.saveRuntimeState();
    }
    this.grantWinRewards();
  }

  grantWinRewards() {
    const g = this.game;
    if (!g || g.status !== 'won' || g.rewardGranted) {
      return;
    }
    const rewardMultiplier = g.usedAnyItem ? 1 : 2;
    const rewardCoins = WIN_REWARD_GOLD * rewardMultiplier;
    const rewardItemRolls = WIN_REWARD_ITEM_ROLLS * rewardMultiplier;
    const rewardItems = [];

    this.profile.coins += rewardCoins;
    for (let i = 0; i < rewardItemRolls; i += 1) {
      const itemId = pickRandomItemId(WIN_REWARD_ITEM_POOL);
      rewardItems.push(itemId);
      this.profile.inventory[itemId] = Math.max(0, Math.floor(this.profile.inventory[itemId] || 0)) + 1;
    }
    this.saveProfile();
    this.syncGameInventoryFromProfile({ skipSaveRuntime: true });

    g.rewardGranted = true;
    g.rewardCoins = rewardCoins;
    g.rewardItems = rewardItems;
    this.saveRuntimeState();
  }

  tryUseStepCard() {
    const g = this.game;
    if (!g || g.status !== 'playing' || (g.moveAnimations && g.moveAnimations.length > 0)) {
      return;
    }
    if (g.stepCardCount <= 0) {
      this.addToast('步数道具已用尽', 1.1);
      return;
    }
    this.pushHistorySnapshot();
    g.level.maxSteps += 5;
    g.stepCardCount -= 1;
    g.wrenchMode = false;
    g.towMode = false;
    g.itemMenuOpen = false;
    g.usedAnyItem = true;
    g.hint = null;
    g.hintRemaining = 0;
    this.syncProfileInventoryFromGame();
    this.addToast('步数上限 +5', 1.2);
  }

  tryUseFreezeCard() {
    const g = this.game;
    if (!g || g.status !== 'playing' || (g.moveAnimations && g.moveAnimations.length > 0)) {
      return;
    }
    if (g.freezeCount <= 0) {
      this.addToast('停止行人道具已用尽', 1.1);
      return;
    }
    if (!g.level.pedestrians.length) {
      this.addToast('当前没有行人', 1.0);
      return;
    }
    this.pushHistorySnapshot();
    g.freezeCount -= 1;
    g.freezePedRemaining += FREEZE_PEDESTRIAN_SEC;
    g.wrenchMode = false;
    g.towMode = false;
    g.itemMenuOpen = false;
    g.usedAnyItem = true;
    g.hint = null;
    g.hintRemaining = 0;
    this.syncProfileInventoryFromGame();
    this.addToast('行人已停止 5 秒', 1.2);
  }

  toggleWrenchMode() {
    const g = this.game;
    if (!g || g.status !== 'playing' || (g.moveAnimations && g.moveAnimations.length > 0)) {
      return;
    }

    if (g.wrenchMode) {
      g.wrenchMode = false;
      g.itemMenuOpen = false;
      this.addToast('已取消扳手', 0.9);
      return;
    }
    if (g.wrenchCount <= 0) {
      this.addToast('扳手已用尽', 1.1);
      return;
    }
    if (!g.level.fences.length) {
      this.addToast('当前没有可拆除围栏', 1.1);
      return;
    }

    g.wrenchMode = true;
    g.towMode = false;
    g.itemMenuOpen = false;
    this.addToast('扳手已启用，请点击围栏', 2.0);
  }

  toggleTowMode() {
    const g = this.game;
    if (!g || g.status !== 'playing' || (g.moveAnimations && g.moveAnimations.length > 0)) {
      return;
    }

    if (g.towMode) {
      g.towMode = false;
      g.itemMenuOpen = false;
      this.addToast('已取消拖车', 0.9);
      return;
    }
    if (g.towCount <= 0) {
      this.addToast('拖车道具已用尽', 1.1);
      return;
    }

    g.towMode = true;
    g.wrenchMode = false;
    g.itemMenuOpen = false;
    this.addToast('拖车已启用，请点击要移除的车辆', 2.0);
  }

  fenceSegment(layout, fence) {
    const board = layout.boardRect;
    const cell = layout.cell;
    const left = board.x + fence.x * cell;
    const top = board.y + fence.y * cell;
    const right = left + cell;
    const bottom = top + cell;
    if (fence.direction === 'UP') {
      return { x1: left, y1: top, x2: right, y2: top };
    }
    if (fence.direction === 'DOWN') {
      return { x1: left, y1: bottom, x2: right, y2: bottom };
    }
    if (fence.direction === 'LEFT') {
      return { x1: left, y1: top, x2: left, y2: bottom };
    }
    return { x1: right, y1: top, x2: right, y2: bottom };
  }

  fenceDistanceToPoint(pos, segment) {
    const nearX = clamp(pos.x, Math.min(segment.x1, segment.x2), Math.max(segment.x1, segment.x2));
    const nearY = clamp(pos.y, Math.min(segment.y1, segment.y2), Math.max(segment.y1, segment.y2));
    return Math.hypot(pos.x - nearX, pos.y - nearY);
  }

  findFenceIndexAtPoint(pos, layout) {
    const g = this.game;
    if (!g) {
      return -1;
    }
    const threshold = Math.max(8, layout.cell * 0.34);
    let bestIndex = -1;
    let bestDistance = threshold;
    for (let i = 0; i < g.level.fences.length; i += 1) {
      const fence = g.level.fences[i];
      const segment = this.fenceSegment(layout, fence);
      const distance = this.fenceDistanceToPoint(pos, segment);
      if (distance <= bestDistance) {
        bestDistance = distance;
        bestIndex = i;
      }
    }
    return bestIndex;
  }

  tryUseWrenchAtPoint(pos, layout) {
    const g = this.game;
    if (!g || !g.wrenchMode) {
      return false;
    }
    if (g.wrenchCount <= 0) {
      g.wrenchMode = false;
      this.addToast('扳手已用尽', 1.2);
      return true;
    }
    const fenceIndex = this.findFenceIndexAtPoint(pos, layout);
    if (fenceIndex < 0) {
      this.addToast('请点击围栏拆除', 1.0);
      return true;
    }

    this.pushHistorySnapshot();
    g.level.fences.splice(fenceIndex, 1);
    g.wrenchCount -= 1;
    g.wrenchMode = false;
    g.itemMenuOpen = false;
    g.usedAnyItem = true;
    g.hint = null;
    g.hintRemaining = 0;
    this.syncProfileInventoryFromGame();
    this.addToast('已拆除围栏', 1.1);
    return true;
  }

  tryUseTowAtPoint(pos, layout) {
    const g = this.game;
    if (!g || !g.towMode) {
      return false;
    }
    if (g.towCount <= 0) {
      g.towMode = false;
      this.addToast('拖车道具已用尽', 1.1);
      return true;
    }
    const vehicle = this.findVehicleAtPoint(pos, layout);
    if (!vehicle || !vehicle.active) {
      this.addToast('请点击车辆进行拖走', 1.0);
      return true;
    }

    this.pushHistorySnapshot();
    const target = findVehicle(g.level, vehicle.id);
    if (!target || !target.active) {
      return true;
    }
    target.active = false;
    g.towCount -= 1;
    g.towMode = false;
    g.itemMenuOpen = false;
    g.usedAnyItem = true;
    g.hint = null;
    g.hintRemaining = 0;
    this.syncProfileInventoryFromGame();
    this.addToast('已拖走一辆车', 1.0);

    if (activeVehicleCount(g.level) === 0) {
      this.markLevelWon();
    }
    return true;
  }

  pushHistorySnapshot(snapshot = null) {
    if (!this.game) {
      return;
    }
    this.game.history.push(snapshot || this.captureGameSnapshot(this.game));
    if (this.game.history.length > 80) {
      this.game.history.shift();
    }
  }

  undoMove() {
    if (!this.game || !this.game.history.length || (this.game.moveAnimations && this.game.moveAnimations.length > 0)) {
      return;
    }
    const snap = this.game.history.pop();
    this.restoreGameSnapshot(snap);
  }

  restartLevel() {
    if (!this.game) {
      return;
    }
    this.game = this.newGameState(this.game.levelNumber);
    this.runtimeAutosaveElapsed = 0;
    this.saveRuntimeState();
  }

  advanceNextLevel() {
    if (!this.game) {
      return;
    }
    const nextLevel = this.game.levelNumber + 1;
    this.maxUnlocked = Math.max(this.maxUnlocked, nextLevel);
    this.saveProgress();
    this.game = this.newGameState(nextLevel);
    this.runtimeAutosaveElapsed = 0;
    this.saveRuntimeState();
  }

  pedestrianPosMap(peds) {
    const result = {};
    for (const p of peds) {
      result[p.id] = [p.x, p.y];
    }
    return result;
  }

  update(dt) {
    if (this.shopToast) {
      this.shopToast.remaining -= dt;
      if (this.shopToast.remaining <= 0) {
        this.shopToast = null;
      }
    }

    if (this.game) {
      this.runtimeAutosaveElapsed += dt;
      if (this.runtimeAutosaveElapsed >= RUNTIME_AUTOSAVE_SEC) {
        this.saveRuntimeState();
        this.runtimeAutosaveElapsed = 0;
      }
    } else {
      this.runtimeAutosaveElapsed = 0;
    }

    if (this.scene !== 'gameplay' || !this.game) {
      return;
    }

    const g = this.game;

    if (g.collisionPrompt) {
      return;
    }

    if (g.toast) {
      g.toast.remaining -= dt;
      if (g.toast.remaining <= 0) {
        g.toast = null;
      }
    }

    if (g.hintRemaining > 0) {
      g.hintRemaining -= dt;
      if (g.hintRemaining <= 0) {
        g.hint = null;
      }
    }

    if (g.freezePedRemaining > 0) {
      g.freezePedRemaining = Math.max(0, g.freezePedRemaining - dt);
    }

    if (g.level.pedestrians.length && g.freezePedRemaining <= 0) {
      g.pedElapsed += dt;
      const stepSec = Math.max(0.08, g.level.pedestrianStepSec);
      g.pedBlend = clamp(g.pedElapsed / stepSec, 0, 1);

      if (g.pedElapsed >= stepSec) {
        const steps = Math.floor(g.pedElapsed / stepSec);
        for (let i = 0; i < steps; i += 1) {
          const preCollisionSnapshot = this.captureGameSnapshot(g);
          g.pedPrev = this.pedestrianPosMap(g.level.pedestrians);
          g.pedElapsed -= stepSec;
          if (tickPedestrians(g.level, 1)) {
            g.pedCurr = this.pedestrianPosMap(g.level.pedestrians);
            g.pedBlend = 1;
            if (g.status === 'playing') {
              this.promptPedestrianCollision('将回退到碰撞前的安全位置。', preCollisionSnapshot);
            }
            break;
          }
          g.pedCurr = this.pedestrianPosMap(g.level.pedestrians);
        }
        g.pedBlend = clamp(g.pedElapsed / stepSec, 0, 1);
      }
    }

    if (g.collisionPrompt) {
      return;
    }

    if (g.moveAnimations && g.moveAnimations.length) {
      for (let i = g.moveAnimations.length - 1; i >= 0; i -= 1) {
        const anim = g.moveAnimations[i];
        anim.elapsed += dt;
        const impactDuration = Math.max(0, anim.impactDuration || 0);
        if (anim.hitOnFinish && !anim.hitPlayed && impactDuration > 0) {
          const impactStart = Math.max(0, anim.duration - impactDuration);
          if (anim.elapsed >= impactStart) {
            this.audio.playHit();
            anim.hitPlayed = true;
          }
        }
        if (anim.elapsed < anim.duration) {
          continue;
        }
        if (anim.rewardOnFinish) {
          this.audio.playReward();
        }
        if (anim.hitOnFinish && !anim.hitPlayed) {
          this.audio.playHit();
          anim.hitPlayed = true;
        }
        g.moveAnimations.splice(i, 1);
      }
    }

    if (g.status === 'playing' && activeVehicleCount(g.level) === 0) {
      this.markLevelWon();
    }

  }

  trySetPointerCapture(pointerId) {
    if (!this.canvas || typeof this.canvas.setPointerCapture !== 'function') {
      return;
    }
    try {
      if (typeof this.canvas.hasPointerCapture === 'function' && this.canvas.hasPointerCapture(pointerId)) {
        return;
      }
      this.canvas.setPointerCapture(pointerId);
    } catch (_err) {
      // Some browsers/devices reject pointer capture for specific pointer types.
    }
  }

  tryReleasePointerCapture(pointerId) {
    if (!this.canvas || typeof this.canvas.releasePointerCapture !== 'function') {
      return;
    }
    try {
      if (typeof this.canvas.hasPointerCapture === 'function' && !this.canvas.hasPointerCapture(pointerId)) {
        return;
      }
      this.canvas.releasePointerCapture(pointerId);
    } catch (_err) {
      // Ignore release failures; pointer lifecycle already finished.
    }
  }

  onPointerDown(event) {
    if (this.pointer.down) {
      // Ignore extra touch points so browser pinch-zoom can work.
      return;
    }
    if (event.pointerType !== 'touch') {
      this.trySetPointerCapture(event.pointerId);
    }
    const pos = this.eventToCanvasPoint(event);
    this.pointer.down = true;
    this.pointer.id = event.pointerId;
    this.pointer.type = event.pointerType || 'mouse';
    this.pointer.x = pos.x;
    this.pointer.y = pos.y;
    this.pointer.blockNativePan = false;

    this.audio.unlock();

    if (this.scene === 'level_select') {
      this.handleLevelSelectDown(pos);
      this.pointer.blockNativePan = true;
      return;
    }
    if (this.scene === 'shop') {
      this.handleShopDown(pos);
      this.pointer.blockNativePan = true;
      return;
    }

    this.pointer.blockNativePan = this.handleGameplayDown(pos);
  }

  onPointerMove(event) {
    if (!this.pointer.down || event.pointerId !== this.pointer.id) {
      return;
    }
    const pos = this.eventToCanvasPoint(event);
    this.pointer.x = pos.x;
    this.pointer.y = pos.y;

    if (this.scene === 'gameplay') {
      this.handleGameplayMove(pos);
    }
  }

  onPointerUp(event) {
    if (event.pointerId !== this.pointer.id) {
      return;
    }
    const pos = this.eventToCanvasPoint(event);
    const pointerId = this.pointer.id;
    this.pointer.down = false;
    this.pointer.id = null;
    this.pointer.type = 'mouse';
    this.pointer.blockNativePan = false;
    this.tryReleasePointerCapture(pointerId);

    if (this.scene === 'gameplay') {
      this.handleGameplayUp(pos);
      this.saveRuntimeState();
    }
  }

  onNativeTouchMove(event) {
    if (this.scene !== 'gameplay') {
      return;
    }
    // Keep one-finger drag for gameplay, but still allow two-finger pinch zoom.
    if (this.pointer.down && this.pointer.blockNativePan && event.touches && event.touches.length <= 1) {
      event.preventDefault();
    }
  }

  eventToCanvasPoint(event) {
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * this.width,
      y: ((event.clientY - rect.top) / rect.height) * this.height,
    };
  }

  getLevelSelectLayout() {
    const w = this.width;
    const h = this.height;

    const titleSize = clamp(w * 0.102, 30, 52);
    const bodySize = clamp(w * 0.050, 17, 29);
    const smallSize = clamp(w * 0.040, 13, 22);

    const topPad = clamp(h * 0.045, 26, 56);
    const headerBottom = topPad + titleSize + bodySize + smallSize * 2 + 44;

    const navH = clamp(h * 0.056, 36, 56);
    const navW = clamp(w * 0.30, 110, 220);
    const navY = h - navH - clamp(h * 0.032, 16, 38);

    const side = clamp(w * 0.09, 14, 52);
    const gridTop = headerBottom;
    const gridBottom = navY - clamp(h * 0.026, 12, 24);
    const availW = w - side * 2;
    const availH = Math.max(120, gridBottom - gridTop);

    const gapX = clamp(w * 0.028, 6, 18);
    const gapY = clamp(h * 0.012, 6, 14);

    const cellW = Math.floor((availW - gapX * (GRID_COLS - 1)) / GRID_COLS);
    const cellH = Math.floor((availH - gapY * (GRID_ROWS - 1)) / GRID_ROWS);

    const prevRect = {
      x: Math.round(w * 0.18 - navW * 0.5),
      y: navY,
      w: navW,
      h: navH,
    };
    const nextRect = {
      x: Math.round(w * 0.82 - navW * 0.5),
      y: navY,
      w: navW,
      h: navH,
    };
    const shopRect = {
      x: Math.round(w * 0.70),
      y: Math.round(topPad - 4),
      w: clamp(w * 0.23, 96, 156),
      h: clamp(h * 0.046, 32, 48),
    };

    const cells = [];
    for (let i = 0; i < LEVELS_PER_PAGE; i += 1) {
      const row = Math.floor(i / GRID_COLS);
      const col = i % GRID_COLS;
      cells.push({
        x: Math.round(side + col * (cellW + gapX)),
        y: Math.round(gridTop + row * (cellH + gapY)),
        w: cellW,
        h: cellH,
      });
    }

    return {
      titleSize,
      bodySize,
      smallSize,
      topPad,
      gridTop,
      prevRect,
      nextRect,
      shopRect,
      cells,
    };
  }

  handleLevelSelectDown(pos) {
    const layout = this.getLevelSelectLayout();

    if (pointInRect(pos.x, pos.y, layout.shopRect)) {
      this.openShop('level_select');
      return;
    }

    if (pointInRect(pos.x, pos.y, layout.prevRect)) {
      this.levelPage = Math.max(0, this.levelPage - 1);
      this.saveRuntimeState();
      return;
    }

    if (pointInRect(pos.x, pos.y, layout.nextRect)) {
      this.levelPage += 1;
      this.saveRuntimeState();
      return;
    }

    const pageStart = this.levelPage * LEVELS_PER_PAGE + 1;
    for (let i = 0; i < layout.cells.length; i += 1) {
      const rect = layout.cells[i];
      if (!pointInRect(pos.x, pos.y, rect)) {
        continue;
      }
      const level = pageStart + i;
      this.openLevelFromSelect(level);
      return;
    }
  }

  getShopLayout() {
    const w = this.width;
    const h = this.height;

    const titleSize = clamp(w * 0.092, 26, 44);
    const bodySize = clamp(w * 0.045, 14, 24);
    const smallSize = clamp(w * 0.037, 12, 19);

    const backRect = {
      x: Math.round(w * 0.05),
      y: Math.round(h * 0.038),
      w: clamp(w * 0.16, 66, 108),
      h: clamp(h * 0.048, 32, 46),
    };
    const resetRect = {
      x: Math.round(w - w * 0.05 - clamp(w * 0.30, 108, 168)),
      y: Math.round(h * 0.038),
      w: clamp(w * 0.30, 108, 168),
      h: clamp(h * 0.048, 32, 46),
    };
    const panel = {
      x: Math.round(w * 0.07),
      y: Math.round(h * 0.14),
      w: Math.round(w * 0.86),
      h: Math.round(h * 0.74),
    };
    const cardGap = clamp(h * 0.018, 10, 18);
    const cardH = Math.floor((panel.h - cardGap * (ITEM_IDS.length - 1)) / ITEM_IDS.length);
    const cards = [];
    for (let i = 0; i < ITEM_IDS.length; i += 1) {
      const id = ITEM_IDS[i];
      const y = panel.y + i * (cardH + cardGap);
      const card = {
        id,
        x: panel.x,
        y,
        w: panel.w,
        h: cardH,
      };
      const buyW = clamp(panel.w * 0.28, 92, 156);
      const buyH = clamp(cardH * 0.42, 34, 52);
      card.buyRect = {
        x: card.x + card.w - buyW - clamp(panel.w * 0.05, 12, 22),
        y: card.y + card.h * 0.5 - buyH * 0.5,
        w: buyW,
        h: buyH,
      };
      cards.push(card);
    }

    return {
      titleSize,
      bodySize,
      smallSize,
      backRect,
      resetRect,
      panel,
      cards,
    };
  }

  handleShopDown(pos) {
    const layout = this.getShopLayout();
    if (pointInRect(pos.x, pos.y, layout.backRect)) {
      this.closeShop();
      return;
    }
    if (pointInRect(pos.x, pos.y, layout.resetRect)) {
      this.resetProgressAndInventory();
      return;
    }
    for (const card of layout.cards) {
      if (!pointInRect(pos.x, pos.y, card.buyRect)) {
        continue;
      }
      const cost = itemCostGold(card.id);
      if (this.profile.coins < cost) {
        this.addShopToast('金币不足，无法购买', 1.2);
        return;
      }
      this.profile.coins -= cost;
      this.profile.inventory[card.id] = Math.max(0, Math.floor(this.profile.inventory[card.id] || 0)) + 1;
      this.saveProfile();
      if (this.game) {
        this.syncGameInventoryFromProfile({ skipSaveRuntime: true });
      }
      this.addShopToast(`购买成功：${ITEM_LABEL[card.id]} +1`, 1.2);
      this.saveRuntimeState();
      return;
    }
  }

  getGameplayLayout() {
    const w = this.width;
    const h = this.height;
    const level = this.game ? this.game.level : null;
    const boardW = level ? level.boardW : BOARD_W;
    const boardH = level ? level.boardH : BOARD_H;

    const titleSize = clamp(w * 0.065, 24, 44);
    const bodySize = clamp(w * 0.040, 14, 24);
    const smallSize = clamp(w * 0.035, 12, 20);

    const topHud = clamp(h * 0.112, 68, 118);
    const bottomBar = clamp(h * 0.112, 76, 128);

    const boardMaxW = w * 0.965;
    const boardMaxH = h - topHud - bottomBar - 20;
    const cell = Math.max(7, Math.min(boardMaxW / boardW, boardMaxH / boardH));

    const boardPxW = Math.round(cell * boardW);
    const boardPxH = Math.round(cell * boardH);
    const boardRect = {
      x: Math.round((w - boardPxW) * 0.5),
      y: Math.round(topHud),
      w: boardPxW,
      h: boardPxH,
    };

    const btnGapX = clamp(w * 0.016, 6, 12);
    const btnGapY = clamp(h * 0.010, 6, 12);
    const btnH = clamp(h * 0.044, 32, 48);
    const rowCapacity = w * 0.94;
    const mainCount = 4;
    const btnW = clamp((rowCapacity - btnGapX * (mainCount - 1)) / mainCount, 62, 110);
    const rowW = btnW * mainCount + btnGapX * (mainCount - 1);
    const btnStartX = Math.round((w - rowW) * 0.5);
    const rowY = Math.round(h - btnH - clamp(h * 0.018, 8, 16));

    const controls = [
      { id: 'items', label: '道具', x: btnStartX, y: rowY, w: btnW, h: btnH },
      { id: 'bgm', label: '音乐', x: btnStartX + (btnW + btnGapX), y: rowY, w: btnW, h: btnH },
      { id: 'sfx', label: '音效', x: btnStartX + (btnW + btnGapX) * 2, y: rowY, w: btnW, h: btnH },
      { id: 'restart', label: '重开', x: btnStartX + (btnW + btnGapX) * 3, y: rowY, w: btnW, h: btnH },
    ];

    const itemBtnW = btnW;
    const itemBtnH = btnH;
    const itemRowW = itemBtnW * ITEM_IDS.length + btnGapX * (ITEM_IDS.length - 1);
    const itemRowX = Math.round((w - itemRowW) * 0.5);
    const itemRowY = rowY - btnGapY - itemBtnH;
    const itemButtons = ITEM_IDS.map((itemId, index) => ({
      id: itemId,
      x: itemRowX + index * (itemBtnW + btnGapX),
      y: itemRowY,
      w: itemBtnW,
      h: itemBtnH,
    }));
    const itemPanelPad = clamp(w * 0.016, 6, 12);
    const itemPanel = {
      x: itemRowX - itemPanelPad,
      y: itemRowY - itemPanelPad,
      w: itemRowW + itemPanelPad * 2,
      h: itemBtnH + itemPanelPad * 2,
    };

    const backRect = {
      x: Math.round(w * 0.018),
      y: Math.round(h * 0.012),
      w: clamp(w * 0.085, 30, 46),
      h: clamp(h * 0.052, 30, 44),
    };
    const shopRect = {
      x: Math.round(w - (w * 0.018 + clamp(w * 0.085, 30, 46))),
      y: Math.round(h * 0.012),
      w: clamp(w * 0.085, 30, 46),
      h: clamp(h * 0.052, 30, 44),
    };
    const restartRect = controls.find((btn) => btn.id === 'restart') || controls[controls.length - 1];
    const livesRectH = clamp(btnH * 0.86, 22, 34);
    const livesRectW = Math.round(Math.max(restartRect.w, btnH * 2.1));
    const livesBaseY = this.game && this.game.itemMenuOpen
      ? clamp(itemPanel.y - livesRectH - clamp(h * 0.012, 6, 10), 0, h - livesRectH)
      : clamp(restartRect.y - livesRectH - clamp(h * 0.012, 6, 10), 0, h - livesRectH);
    const livesRect = {
      x: Math.round(restartRect.x + (restartRect.w - livesRectW) * 0.5),
      y: Math.round(livesBaseY),
      w: livesRectW,
      h: Math.round(livesRectH),
    };

    const overlayBtnW = clamp(w * 0.44, 160, 280);
    const overlayBtnH = clamp(h * 0.066, 40, 64);
    const isResultOverlay = !!(this.game && !this.game.collisionPrompt
      && (this.game.status === 'won' || this.game.status === 'failed'));
    const isWinOverlay = isResultOverlay && this.game.status === 'won';

    const promptPanelW = Math.min(w * 0.76, 336);
    const promptPanelH = clamp(h * (isWinOverlay ? 0.29 : 0.24), isWinOverlay ? 206 : 156, isWinOverlay ? 236 : 188);
    const overlayGap = isResultOverlay
      ? clamp(h * 0.038, 28, 40)
      : clamp(h * 0.018, 12, 18);
    const overlayStackH = isResultOverlay ? promptPanelH + overlayGap + overlayBtnH : promptPanelH;
    const promptPanelTop = isResultOverlay
      ? clamp(Math.round((h - overlayStackH) * 0.38), Math.round(h * 0.12), Math.round(h * 0.30))
      : Math.round((h - promptPanelH) * 0.5);
    const promptPanel = {
      x: Math.round((w - promptPanelW) * 0.5),
      y: promptPanelTop,
      w: Math.round(promptPanelW),
      h: Math.round(promptPanelH),
    };
    const overlayBtn = {
      x: Math.round((w - overlayBtnW) * 0.5),
      y: isResultOverlay
        ? Math.round(promptPanel.y + promptPanel.h + overlayGap)
        : Math.round(h * 0.57),
      w: overlayBtnW,
      h: overlayBtnH,
    };
    const promptBtnGap = clamp(w * 0.030, 10, 18);
    const promptBtnPad = clamp(promptPanel.w * 0.08, 16, 26);
    const promptBtnH = clamp(h * 0.064, 40, 58);
    const promptBtnW = Math.floor((promptPanel.w - promptBtnPad * 2 - promptBtnGap) / 2);
    const promptBtnY = promptPanel.y + promptPanel.h - promptBtnH - clamp(promptPanel.h * 0.11, 16, 24);
    const promptContinueBtn = {
      x: promptPanel.x + promptBtnPad,
      y: promptBtnY,
      w: promptBtnW,
      h: promptBtnH,
    };
    const promptGiveUpBtn = {
      x: promptContinueBtn.x + promptBtnW + promptBtnGap,
      y: promptBtnY,
      w: promptBtnW,
      h: promptBtnH,
    };

    return {
      titleSize,
      bodySize,
      smallSize,
      boardRect,
      cell,
      controls,
      itemButtons,
      itemPanel,
      backRect,
      shopRect,
      livesRect,
      overlayBtn,
      promptPanel,
      promptContinueBtn,
      promptGiveUpBtn,
    };
  }

  handleGameplayDown(pos) {
    const g = this.game;
    if (!g) {
      return false;
    }

    const layout = this.getGameplayLayout();

    if (g.collisionPrompt) {
      if (pointInRect(pos.x, pos.y, layout.promptContinueBtn)) {
        this.resolveCollisionPrompt(true);
      } else if (pointInRect(pos.x, pos.y, layout.promptGiveUpBtn)) {
        this.resolveCollisionPrompt(false);
      }
      return true;
    }

    if (pointInRect(pos.x, pos.y, layout.backRect)) {
      this.backToLevelSelect(g.levelNumber);
      return true;
    }
    if (pointInRect(pos.x, pos.y, layout.shopRect)) {
      g.itemMenuOpen = false;
      this.openShop('gameplay');
      return true;
    }

    if (g.status === 'won') {
      if (pointInRect(pos.x, pos.y, layout.overlayBtn)) {
        this.advanceNextLevel();
      }
      return true;
    }

    if (g.status === 'failed') {
      if (pointInRect(pos.x, pos.y, layout.overlayBtn)) {
        this.restartLevel();
      }
      return true;
    }

    for (const btn of layout.controls) {
      if (!pointInRect(pos.x, pos.y, btn)) {
        continue;
      }
      if (btn.id === 'items') {
        if (g.status === 'playing') {
          g.itemMenuOpen = !g.itemMenuOpen;
          if (g.itemMenuOpen) {
            g.wrenchMode = false;
            g.towMode = false;
            this.addToast('选择要使用的道具', 0.9);
          }
        }
      } else if (btn.id === 'bgm') {
        const enabled = this.audio.toggleBgm({ forceRestart: true });
        if (enabled) {
          this.audio.unlock();
          this.audio.resumeAfterSuspend();
        }
        this.addToast(enabled ? '背景音乐: 开' : '背景音乐: 关', 1.0);
      } else if (btn.id === 'sfx') {
        const enabled = this.audio.toggleSfx();
        this.addToast(enabled ? '音效: 开' : '音效: 关', 1.0);
      } else if (btn.id === 'restart') {
        this.restartLevel();
      }
      return true;
    }

    if (g.itemMenuOpen) {
      for (const itemBtn of layout.itemButtons) {
        if (!pointInRect(pos.x, pos.y, itemBtn)) {
          continue;
        }
        g.itemMenuOpen = false;
        if (itemBtn.id === 'wrench') {
          this.toggleWrenchMode();
        } else if (itemBtn.id === 'step') {
          this.tryUseStepCard();
        } else if (itemBtn.id === 'tow') {
          this.toggleTowMode();
        } else if (itemBtn.id === 'freeze') {
          this.tryUseFreezeCard();
        }
        return true;
      }
      if (pointInRect(pos.x, pos.y, layout.itemPanel)) {
        return true;
      }
      g.itemMenuOpen = false;
    }

    if (!pointInRect(pos.x, pos.y, layout.boardRect)) {
      return false;
    }

    if (g.wrenchMode) {
      this.tryUseWrenchAtPoint(pos, layout);
      return true;
    }
    if (g.towMode) {
      this.tryUseTowAtPoint(pos, layout);
      return true;
    }

    const vehicle = this.findVehicleAtPoint(pos, layout);
    if (!vehicle) {
      return false;
    }

    g.drag = {
      vehicleId: vehicle.id,
      axis: vehicle.axis,
      startX: pos.x,
      startY: pos.y,
      direction: null,
    };
    return true;
  }

  handleGameplayMove(pos) {
    const g = this.game;
    if (!g || !g.drag) {
      return;
    }

    const layout = this.getGameplayLayout();
    const dx = pos.x - g.drag.startX;
    const dy = pos.y - g.drag.startY;
    const touchInput = this.pointer.type === 'touch';
    const threshold = touchInput
      ? clamp(layout.cell * 0.16, TOUCH_DRAG_THRESHOLD_PX, 10)
      : Math.max(10, layout.cell * 0.25);
    const axisBias = touchInput ? TOUCH_DRAG_AXIS_BIAS : 1;

    if (g.drag.axis === 'H' && Math.abs(dx) >= threshold && Math.abs(dx) >= Math.abs(dy) * axisBias) {
      g.drag.direction = dx > 0 ? 'RIGHT' : 'LEFT';
    } else if (g.drag.axis === 'V' && Math.abs(dy) >= threshold && Math.abs(dy) >= Math.abs(dx) * axisBias) {
      g.drag.direction = dy > 0 ? 'DOWN' : 'UP';
    }
  }

  handleGameplayUp(_pos) {
    const g = this.game;
    if (!g || !g.drag || g.status !== 'playing') {
      if (g) {
        g.drag = null;
      }
      return;
    }

    const drag = g.drag;
    g.drag = null;

    if (!drag.direction) {
      return;
    }

    if (g.movesUsed >= g.level.maxSteps) {
      return;
    }

    const before = findVehicle(g.level, drag.vehicleId);
    if (!before || !before.active) {
      return;
    }

    const beforeCopy = cloneVehicle(before);
    const outcome = simulateMove(g.level, drag.vehicleId, drag.direction);
    if (!outcome.moved && !outcome.leftBoard) {
      if (outcome.blockedByVehicle) {
        this.queueImpactAnimation(beforeCopy, drag.direction, { hitOnFinish: true });
        if (outcome.blockedVehicleId) {
          const target = findVehicle(g.level, outcome.blockedVehicleId);
          if (target && target.active) {
            this.queueImpactAnimation(cloneVehicle(target), oppositeDirection(drag.direction), { hitOnFinish: false });
          }
        }
        this.addToast('前方有车辆阻挡', 0.95);
      } else if (outcome.blockedByFence) {
        this.queueImpactAnimation(beforeCopy, drag.direction, { hitOnFinish: true });
        this.addToast('前方围栏阻挡', 0.95);
      } else {
        this.addToast('该方向无法移动', 0.95);
      }
      return;
    }

    const safeSnapshot = this.captureGameSnapshot(g);
    this.pushHistorySnapshot(safeSnapshot);

    g.level = outcome.nextLevel;
    g.movesUsed += 1;
    g.hint = null;
    g.hintRemaining = 0;

    const after = findVehicle(g.level, drag.vehicleId);
    const endX = outcome.leftBoard ? beforeCopy.x + directionDelta(drag.direction)[0] * (outcome.distance + 1) : after.x;
    const endY = outcome.leftBoard ? beforeCopy.y + directionDelta(drag.direction)[1] * (outcome.distance + 1) : after.y;

    const moveCells = Math.abs(endX - beforeCopy.x) + Math.abs(endY - beforeCopy.y);
    const motionDuration = clamp(
      g.level.carAnimBaseSec + moveCells * g.level.carAnimPerCellSec,
      g.level.carAnimMinSec,
      g.level.carAnimMaxSec,
    );
    const blockedByObstacle = outcome.blockedByVehicle || outcome.blockedByFence;
    const impactDuration = blockedByObstacle ? CAR_IMPACT_SEC : 0;
    const duration = motionDuration + impactDuration;

    if (!g.moveAnimations) {
      g.moveAnimations = [];
    }
    g.moveAnimations.push({
      vehicleId: beforeCopy.id,
      axis: beforeCopy.axis,
      length: beforeCopy.length,
      color: beforeCopy.color,
      frontPositive: beforeCopy.frontPositive,
      spriteType: beforeCopy.spriteType,
      startX: beforeCopy.x,
      startY: beforeCopy.y,
      endX,
      endY,
      direction: drag.direction,
      rewardOnFinish: outcome.leftBoard,
      hitOnFinish: blockedByObstacle,
      hitPlayed: false,
      elapsed: 0,
      motionDuration,
      impactDuration,
      duration,
    });

    if (outcome.blockedByVehicle && outcome.blockedVehicleId) {
      const target = findVehicle(g.level, outcome.blockedVehicleId);
      if (target && target.active) {
        this.queueImpactAnimation(cloneVehicle(target), oppositeDirection(drag.direction), {
          hitOnFinish: false,
          leadInDuration: motionDuration,
        });
      }
    }

    this.audio.playEngine();

    if (outcome.pedestrianCollision) {
      this.promptPedestrianCollision('将回退这一步并继续当前关卡。', safeSnapshot, {
        consumeHistorySnapshot: true,
      });
      return;
    }

    if (activeVehicleCount(g.level) === 0) {
      this.markLevelWon();
      return;
    }

  }

  findVehicleAtPoint(pos, layout) {
    const g = this.game;
    if (!g) {
      return null;
    }
    const animatingIds = new Set((g.moveAnimations || []).map((a) => a.vehicleId));
    const touchInput = this.pointer.type === 'touch';
    const hitSlop = touchInput ? clamp(layout.cell * 0.18, TOUCH_VEHICLE_HIT_SLOP_PX, 16) : 0;
    let closestVehicle = null;
    let closestDistance = Number.POSITIVE_INFINITY;

    for (let i = g.level.vehicles.length - 1; i >= 0; i -= 1) {
      const v = g.level.vehicles[i];
      if (!v.active) {
        continue;
      }
      if (animatingIds.has(v.id)) {
        continue;
      }
      const rect = this.vehicleRect(v, layout);
      if (pointInRect(pos.x, pos.y, rect)) {
        return v;
      }
      if (!touchInput) {
        continue;
      }
      const expanded = {
        x: rect.x - hitSlop,
        y: rect.y - hitSlop,
        w: rect.w + hitSlop * 2,
        h: rect.h + hitSlop * 2,
      };
      if (!pointInRect(pos.x, pos.y, expanded)) {
        continue;
      }
      const distance = distanceToRect(pos.x, pos.y, rect);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestVehicle = v;
      }
    }
    return closestVehicle;
  }

  queueImpactAnimation(vehicle, direction, options = {}) {
    const g = this.game;
    if (!g || !vehicle) {
      return;
    }
    const leadInDuration = Number.isFinite(options.leadInDuration) ? Math.max(0, options.leadInDuration) : 0;
    const hitOnFinish = options.hitOnFinish !== undefined ? !!options.hitOnFinish : true;
    if (!g.moveAnimations) {
      g.moveAnimations = [];
    }
    g.moveAnimations.push({
      vehicleId: vehicle.id,
      axis: vehicle.axis,
      length: vehicle.length,
      color: vehicle.color,
      frontPositive: vehicle.frontPositive,
      spriteType: vehicle.spriteType,
      startX: vehicle.x,
      startY: vehicle.y,
      endX: vehicle.x,
      endY: vehicle.y,
      direction,
      rewardOnFinish: false,
      hitOnFinish,
      hitPlayed: false,
      elapsed: 0,
      leadInDuration,
      impactDuration: CAR_IMPACT_SEC,
      duration: leadInDuration + CAR_IMPACT_SEC,
    });
  }

  vehicleRect(vehicle, layout) {
    const pad = layout.cell * 0.12;
    const x = layout.boardRect.x + vehicle.x * layout.cell + pad;
    const y = layout.boardRect.y + vehicle.y * layout.cell + pad;
    const w = vehicle.axis === 'H' ? layout.cell * vehicle.length - pad * 2 : layout.cell - pad * 2;
    const h = vehicle.axis === 'V' ? layout.cell * vehicle.length - pad * 2 : layout.cell - pad * 2;
    return {
      x,
      y,
      w: Math.max(4, w),
      h: Math.max(4, h),
    };
  }

  withRenderContext(nextCtx, drawFn) {
    const prevCtx = this.ctx;
    this.ctx = nextCtx;
    try {
      drawFn();
    } finally {
      this.ctx = prevCtx;
    }
  }

  drawPedestrianPatrolPaths(layout, pedestrians = []) {
    const ctx = this.ctx;
    for (const ped of pedestrians) {
      if (!pedestrianUsesNodePatrol(ped) || ped.patrolNodes.length < 2) {
        continue;
      }
      ctx.strokeStyle = 'rgba(199,176,140,0.86)';
      ctx.lineWidth = Math.max(2, layout.cell * 0.08);
      ctx.setLineDash([Math.max(2, layout.cell * 0.18), Math.max(2, layout.cell * 0.22)]);
      ctx.beginPath();
      for (let i = 0; i < ped.patrolNodes.length; i += 1) {
        const [nx, ny] = ped.patrolNodes[i];
        const cx = layout.boardRect.x + (nx + 0.5) * layout.cell;
        const cy = layout.boardRect.y + (ny + 0.5) * layout.cell;
        if (i === 0) {
          ctx.moveTo(cx, cy);
        } else {
          ctx.lineTo(cx, cy);
        }
      }
      ctx.stroke();
      ctx.setLineDash([]);
      for (let i = 1; i < ped.patrolNodes.length - 1; i += 1) {
        const [nx, ny] = ped.patrolNodes[i];
        const cx = layout.boardRect.x + (nx + 0.5) * layout.cell;
        const cy = layout.boardRect.y + (ny + 0.5) * layout.cell;
        ctx.beginPath();
        ctx.arc(cx, cy, Math.max(2, layout.cell * 0.07), 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(155,139,113,0.86)';
        ctx.fill();
      }
    }
  }

  buildGameplayStaticLayerKey(layout, level) {
    const fenceKey = level.fences.map((fence) => `${fence.x},${fence.y},${fence.direction}`).join('|');
    const patrolKey = level.pedestrians
      .filter((ped) => pedestrianUsesNodePatrol(ped) && ped.patrolNodes.length >= 2)
      .map((ped) => ped.patrolNodes.map((node) => `${node[0]},${node[1]}`).join(';'))
      .join('|');
    return [
      this.width,
      this.height,
      this.dpr,
      level.boardW,
      level.boardH,
      layout.boardRect.x,
      layout.boardRect.y,
      layout.boardRect.w,
      layout.boardRect.h,
      Number(layout.cell).toFixed(3),
      fenceKey,
      patrolKey,
    ].join('/');
  }

  ensureGameplayStaticLayer(layout, level) {
    const nextKey = this.buildGameplayStaticLayerKey(layout, level);
    const pixelWidth = Math.max(1, Math.round(this.width * this.dpr));
    const pixelHeight = Math.max(1, Math.round(this.height * this.dpr));

    if (!this.staticGameplayLayerCanvas) {
      this.staticGameplayLayerCanvas = document.createElement('canvas');
      this.staticGameplayLayerCtx = this.staticGameplayLayerCanvas.getContext('2d');
    }
    if (!this.staticGameplayLayerCtx) {
      return null;
    }
    if (this.staticGameplayLayerKey === nextKey
      && this.staticGameplayLayerCanvas.width === pixelWidth
      && this.staticGameplayLayerCanvas.height === pixelHeight) {
      return this.staticGameplayLayerCanvas;
    }

    this.staticGameplayLayerCanvas.width = pixelWidth;
    this.staticGameplayLayerCanvas.height = pixelHeight;
    this.staticGameplayLayerCtx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.staticGameplayLayerCtx.imageSmoothingEnabled = true;
    this.staticGameplayLayerCtx.imageSmoothingQuality = 'high';
    this.staticGameplayLayerCtx.clearRect(0, 0, this.width, this.height);

    this.withRenderContext(this.staticGameplayLayerCtx, () => {
      this.drawBoard(layout);
      for (const fence of level.fences) {
        this.drawFence(layout, fence);
      }
      this.drawPedestrianPatrolPaths(layout, level.pedestrians);
    });

    this.staticGameplayLayerKey = nextKey;
    return this.staticGameplayLayerCanvas;
  }

  render() {
    const ctx = this.ctx;
    this.renderClockSec = performance.now() * 0.001;
    if (this.lastSceneForDom !== this.scene) {
      this.lastSceneForDom = this.scene;
      document.body.setAttribute('data-game-scene', this.scene);
      if (this.homeLinkEl) {
        this.homeLinkEl.style.display = this.scene === 'level_select' ? 'inline-block' : 'none';
      }
    }
    ctx.clearRect(0, 0, this.width, this.height);
    this.drawBackdrop();

    if (this.scene === 'level_select') {
      this.renderLevelSelect();
      return;
    }
    if (this.scene === 'shop') {
      this.renderShop();
      return;
    }

    this.renderGameplay();
  }

  drawBackdrop() {
    const ctx = this.ctx;
    const grad = ctx.createLinearGradient(0, 0, 0, this.height);
    grad.addColorStop(0, '#e7edf2');
    grad.addColorStop(0.42, '#edf0e7');
    grad.addColorStop(1, '#e2e5d8');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, this.width, this.height);

    const radial = ctx.createRadialGradient(
      this.width * 0.5,
      this.height * 0.18,
      this.width * 0.08,
      this.width * 0.5,
      this.height * 0.08,
      this.width * 0.78,
    );
    radial.addColorStop(0, 'rgba(255,255,255,0.30)');
    radial.addColorStop(1, 'rgba(255,255,255,0.0)');
    ctx.fillStyle = radial;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  drawButton(rect, label, options = {}) {
    const {
      enabled = true,
      fontSize = 20,
      fill = COLOR_BUTTON,
      border = COLOR_BUTTON_BORDER,
      text = COLOR_BUTTON_TEXT,
    } = options;

    const ctx = this.ctx;
    roundRect(ctx, rect.x, rect.y + Math.max(1, rect.h * 0.08), rect.w, rect.h, Math.min(rect.h * 0.32, 14));
    ctx.fillStyle = enabled ? 'rgba(20,25,31,0.28)' : 'rgba(40,40,40,0.15)';
    ctx.fill();

    roundRect(ctx, rect.x, rect.y, rect.w, rect.h, Math.min(rect.h * 0.32, 14));
    if (enabled) {
      const grad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grad.addColorStop(0, mixColor(fill, '#ffffff', 0.08));
      grad.addColorStop(1, mixColor(fill, '#121820', 0.08));
      ctx.fillStyle = grad;
    } else {
      ctx.fillStyle = '#d3d4d6';
    }
    ctx.fill();

    ctx.lineWidth = Math.max(1, rect.h * 0.08);
    ctx.strokeStyle = enabled ? border : '#9ca0a6';
    ctx.stroke();

    if (enabled) {
      ctx.strokeStyle = 'rgba(255,255,255,0.16)';
      ctx.lineWidth = Math.max(1, rect.h * 0.04);
      ctx.beginPath();
      ctx.moveTo(rect.x + rect.w * 0.08, rect.y + rect.h * 0.20);
      ctx.lineTo(rect.x + rect.w * 0.92, rect.y + rect.h * 0.20);
      ctx.stroke();
    }

    ctx.fillStyle = enabled ? text : COLOR_DISABLED;
    ctx.font = textFont(fontSize, 600);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, rect.x + rect.w * 0.5, rect.y + rect.h * 0.52);
  }

  drawLevelSelectIconButton(rect, options = {}) {
    this.drawButton(rect, '', options);
    const ctx = this.ctx;
    const gap = rect.w * 0.10;
    const dot = Math.max(2, rect.w * 0.13);
    const total = dot * 3 + gap * 2;
    const startX = rect.x + (rect.w - total) * 0.5;
    const startY = rect.y + (rect.h - total) * 0.5;
    ctx.fillStyle = COLOR_BUTTON_TEXT;
    for (let row = 0; row < 3; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        const x = startX + col * (dot + gap);
        const y = startY + row * (dot + gap);
        roundRect(ctx, x, y, dot, dot, dot * 0.35);
        ctx.fill();
      }
    }
  }

  drawShopIconButton(rect, options = {}) {
    this.drawButton(rect, '', options);
    const ctx = this.ctx;
    const iconColor = COLOR_BUTTON_TEXT;
    const basketW = rect.w * 0.50;
    const basketH = rect.h * 0.30;
    const basketX = rect.x + (rect.w - basketW) * 0.5;
    const basketY = rect.y + rect.h * 0.44;
    const radius = Math.max(2, basketH * 0.20);

    roundRect(ctx, basketX, basketY, basketW, basketH, radius);
    ctx.lineWidth = Math.max(1.5, rect.w * 0.06);
    ctx.strokeStyle = iconColor;
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(basketX + basketW * 0.20, basketY);
    ctx.quadraticCurveTo(
      basketX + basketW * 0.50,
      basketY - basketH * 0.85,
      basketX + basketW * 0.80,
      basketY,
    );
    ctx.stroke();

    const wheelR = Math.max(1.2, rect.w * 0.06);
    for (const cx of [basketX + basketW * 0.28, basketX + basketW * 0.72]) {
      ctx.beginPath();
      ctx.arc(cx, basketY + basketH + wheelR * 0.5, wheelR, 0, Math.PI * 2);
      ctx.fillStyle = iconColor;
      ctx.fill();
    }
  }

  drawAudioToggleIconButton(rect, kind, enabled, options = {}) {
    const fill = enabled
      ? (kind === 'bgm' ? '#2f6d4b' : '#3b5f8e')
      : '#6b6f77';
    const border = enabled
      ? (kind === 'bgm' ? '#8fddb0' : '#9fc7ff')
      : '#b2b7bf';
    this.drawButton(rect, '', {
      ...options,
      enabled: true,
      fill,
      border,
    });

    const ctx = this.ctx;
    const icon = enabled ? '#f3f7fb' : '#d6dde4';
    const x = rect.x;
    const y = rect.y;
    const w = rect.w;
    const h = rect.h;

    const bodyW = w * 0.14;
    const bodyH = h * 0.30;
    const bodyX = x + w * 0.24;
    const bodyY = y + h * 0.5 - bodyH * 0.5;
    roundRect(ctx, bodyX, bodyY, bodyW, bodyH, Math.max(2, bodyH * 0.18));
    ctx.fillStyle = icon;
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(bodyX + bodyW, bodyY + bodyH * 0.18);
    ctx.lineTo(bodyX + bodyW + w * 0.13, bodyY - bodyH * 0.16);
    ctx.lineTo(bodyX + bodyW + w * 0.13, bodyY + bodyH * 1.16);
    ctx.closePath();
    ctx.fill();

    const centerX = bodyX + bodyW + w * 0.10;
    const centerY = y + h * 0.5;
    if (enabled) {
      ctx.strokeStyle = icon;
      ctx.lineWidth = Math.max(1.4, h * 0.06);
      for (const mul of [0.18, 0.32]) {
        ctx.beginPath();
        ctx.arc(centerX, centerY, h * mul, -0.85, 0.85);
        ctx.stroke();
      }
      if (kind === 'bgm') {
        ctx.fillStyle = icon;
        ctx.font = textFont(Math.max(9, h * 0.34), 700);
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText('♪', x + w * 0.88, y + h * 0.52);
      } else {
        ctx.fillStyle = icon;
        const cx = x + w * 0.80;
        const cy = y + h * 0.5;
        const r = Math.max(2, h * 0.06);
        for (const [ox, oy] of [[0, 0], [r * 1.7, -r * 0.2], [-r * 1.5, r * 0.25]]) {
          ctx.beginPath();
          ctx.arc(cx + ox, cy + oy, r, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    } else {
      ctx.strokeStyle = '#ffc2c2';
      ctx.lineWidth = Math.max(2, h * 0.09);
      ctx.beginPath();
      ctx.moveTo(x + w * 0.68, y + h * 0.28);
      ctx.lineTo(x + w * 0.88, y + h * 0.72);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(x + w * 0.88, y + h * 0.28);
      ctx.lineTo(x + w * 0.68, y + h * 0.72);
      ctx.stroke();
    }
  }

  drawInfoChip(x, y, w, h, label, value, valueColor = '#2f3f4b') {
    const ctx = this.ctx;
    roundRect(ctx, x + 1, y + 2, w, h, Math.min(10, h * 0.4));
    ctx.fillStyle = 'rgba(33,42,51,0.16)';
    ctx.fill();

    roundRect(ctx, x, y, w, h, Math.min(10, h * 0.4));
    const grad = ctx.createLinearGradient(x, y, x, y + h);
    grad.addColorStop(0, 'rgba(255,255,255,0.78)');
    grad.addColorStop(1, 'rgba(238,232,213,0.74)');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(128,118,90,0.32)';
    ctx.lineWidth = Math.max(1, h * 0.08);
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = textFont(Math.max(10, h * 0.36), 600);
    ctx.fillStyle = '#6b7679';
    ctx.fillText(label, x + w * 0.08, y + h * 0.50);

    ctx.textAlign = 'right';
    ctx.font = textFont(Math.max(10, h * 0.42), 700);
    ctx.fillStyle = valueColor;
    ctx.fillText(value, x + w * 0.92, y + h * 0.50);
  }

  drawHeartIcon(cx, cy, size, fill, stroke = null) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(cx, cy + size * 0.30);
    ctx.bezierCurveTo(
      cx + size * 0.56,
      cy - size * 0.12,
      cx + size * 1.02,
      cy + size * 0.42,
      cx,
      cy + size * 0.98,
    );
    ctx.bezierCurveTo(
      cx - size * 1.02,
      cy + size * 0.42,
      cx - size * 0.56,
      cy - size * 0.12,
      cx,
      cy + size * 0.30,
    );
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = Math.max(1, size * 0.08);
      ctx.stroke();
    }
  }

  drawLivesChip(x, y, w, h, current, max = LEVEL_HEARTS) {
    const safeMax = Math.max(1, Math.floor(max));
    const horizontal = w >= h;
    if (horizontal) {
      const heartGap = clamp(w * 0.045, 4, 8);
      const heartSize = Math.min(
        h * 0.72,
        w / (safeMax * 2 + Math.max(0, safeMax - 1) * 0.55),
      );
      const totalW = safeMax * heartSize * 2 + (safeMax - 1) * heartGap;
      let heartX = x + Math.max(0, (w - totalW) * 0.5);
      const heartY = y + Math.max(0, (h - heartSize * 1.08) * 0.5);

      for (let i = 0; i < safeMax; i += 1) {
        const active = i < current;
        this.drawHeartIcon(
          heartX + heartSize + 1.2,
          heartY + 1.6,
          heartSize,
          'rgba(60,34,42,0.18)'
        );
        this.drawHeartIcon(
          heartX + heartSize,
          heartY,
          heartSize,
          active ? '#ef6278' : 'rgba(141,146,156,0.26)',
          active ? '#b63a52' : 'rgba(124,131,143,0.42)',
        );
        heartX += heartSize * 2 + heartGap;
      }
      return;
    }

    const heartGap = clamp(h * 0.10, 6, 10);
    const availableH = h - heartGap * (safeMax - 1);
    const heartSize = Math.min(w * 0.42, availableH / (safeMax * 1.08));
    const cx = x + w * 0.5;
    const totalH = safeMax * heartSize * 1.08 + (safeMax - 1) * heartGap;
    let heartY = y + Math.max(0, (h - totalH) * 0.5);

    for (let i = 0; i < safeMax; i += 1) {
      const active = i < current;
      this.drawHeartIcon(
        cx + 1.2,
        heartY + 1.6,
        heartSize,
        'rgba(60,34,42,0.18)'
      );
      this.drawHeartIcon(
        cx,
        heartY,
        heartSize,
        active ? '#ef6278' : 'rgba(141,146,156,0.26)',
        active ? '#b63a52' : 'rgba(124,131,143,0.42)',
      );
      heartY += heartSize * 1.05 + heartGap;
    }
  }

  renderLevelSelect() {
    const ctx = this.ctx;
    const layout = this.getLevelSelectLayout();
    const pageStart = this.levelPage * LEVELS_PER_PAGE + 1;
    const pageEnd = pageStart + LEVELS_PER_PAGE - 1;

    const panel = {
      x: Math.round(this.width * 0.055),
      y: Math.round(this.height * 0.055),
      w: Math.round(this.width * 0.89),
      h: Math.round(this.height * 0.87),
    };

    roundRect(ctx, panel.x + 2, panel.y + 4, panel.w, panel.h, 22);
    ctx.fillStyle = 'rgba(30,38,46,0.20)';
    ctx.fill();

    roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 22);
    const panelGrad = ctx.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.h);
    panelGrad.addColorStop(0, 'rgba(251,249,238,0.97)');
    panelGrad.addColorStop(1, 'rgba(239,235,220,0.97)');
    ctx.fillStyle = panelGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(110,126,136,0.42)';
    ctx.lineWidth = Math.max(1, this.width * 0.004);
    ctx.stroke();

    const titleY = layout.topPad + layout.titleSize * 0.5;

    ctx.fillStyle = COLOR_TEXT;
    ctx.font = textFont(layout.titleSize, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('关卡选择', this.width * 0.5, titleY);

    this.drawButton(layout.shopRect, '商店', {
      enabled: true,
      fontSize: clamp(layout.shopRect.h * 0.50, 12, 20),
    });

    ctx.fillStyle = COLOR_TEXT_MUTED;
    ctx.font = textFont(layout.bodySize, 600);
    ctx.fillText(`第 ${pageStart}-${pageEnd} 关  最高通关 ${this.maxUnlocked}`, this.width * 0.5, titleY + layout.titleSize * 0.78);

    ctx.font = textFont(layout.smallSize, 600);
    ctx.fillStyle = '#556268';
    ctx.fillText(`金币: ${this.profile.coins}`, this.width * 0.5, titleY + layout.titleSize * 1.28);
    ctx.font = textFont(layout.smallSize * 0.96, 500);
    ctx.fillText(
      `背包 扳手:${this.inventoryCount('wrench')} 步+5:${this.inventoryCount('step')} 拖车:${this.inventoryCount('tow')} 停行人:${this.inventoryCount('freeze')}`,
      this.width * 0.5,
      titleY + layout.titleSize * 1.76,
    );

    for (let i = 0; i < layout.cells.length; i += 1) {
      const level = pageStart + i;
      const rect = layout.cells[i];
      const isCleared = level <= this.maxUnlocked;
      const isCurrentLevel = !!this.game && this.game.levelNumber === level;
      const hasProgress = isCurrentLevel && this.game.movesUsed > 0 && this.game.status === 'playing';

      if (level === this.maxUnlocked) {
        const glow = {
          x: rect.x - 4,
          y: rect.y - 4,
          w: rect.w + 8,
          h: rect.h + 8,
        };
        roundRect(ctx, glow.x, glow.y, glow.w, glow.h, Math.min(glow.h * 0.32, 16));
        ctx.fillStyle = 'rgba(226,192,120,0.66)';
        ctx.fill();
      }

      this.drawButton(rect, String(level), {
        enabled: true,
        fontSize: clamp(rect.h * 0.48, 16, 28),
        fill: isCurrentLevel ? '#4a5f6f' : COLOR_BUTTON,
        border: isCurrentLevel ? '#d8bb79' : COLOR_BUTTON_BORDER,
      });

      if (hasProgress) {
        const tagW = rect.w * 0.48;
        const tagH = rect.h * 0.22;
        const tx = rect.x + 4;
        const ty = rect.y + 4;
        roundRect(ctx, tx, ty, tagW, tagH, Math.min(8, tagH * 0.45));
        ctx.fillStyle = 'rgba(42,82,66,0.86)';
        ctx.fill();
        ctx.fillStyle = 'rgba(242,255,247,0.96)';
        ctx.font = textFont(Math.max(9, tagH * 0.58), 700);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('继续', tx + tagW * 0.5, ty + tagH * 0.53);
      }

      if (!isCleared) {
        const badgeW = rect.w * 0.42;
        const badgeH = rect.h * 0.22;
        const bx = rect.x + rect.w - badgeW - 4;
        const by = rect.y + 4;
        roundRect(ctx, bx, by, badgeW, badgeH, Math.min(8, badgeH * 0.45));
        ctx.fillStyle = 'rgba(52,64,74,0.70)';
        ctx.fill();
        ctx.fillStyle = 'rgba(244,248,252,0.95)';
        ctx.font = textFont(Math.max(9, badgeH * 0.58), 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('可跳', bx + badgeW * 0.5, by + badgeH * 0.53);
      }
    }

    this.drawButton(layout.prevRect, '上一页', {
      enabled: this.levelPage > 0,
      fontSize: clamp(layout.prevRect.h * 0.5, 14, 24),
    });
    this.drawButton(layout.nextRect, '下一页', {
      enabled: true,
      fontSize: clamp(layout.nextRect.h * 0.5, 14, 24),
    });
  }

  renderShop() {
    const ctx = this.ctx;
    const layout = this.getShopLayout();

    this.drawButton(layout.backRect, '返回', {
      enabled: true,
      fontSize: clamp(layout.backRect.h * 0.52, 12, 20),
    });
    this.drawButton(layout.resetRect, '重置存档', {
      enabled: true,
      fontSize: clamp(layout.resetRect.h * 0.44, 11, 18),
      fill: '#7e3030',
      border: '#d8a08f',
    });

    ctx.fillStyle = COLOR_TEXT;
    ctx.font = textFont(layout.titleSize, 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('道具商店', this.width * 0.5, this.height * 0.075);

    ctx.fillStyle = '#5f6a70';
    ctx.font = textFont(layout.bodySize, 600);
    ctx.fillText(`金币: ${this.profile.coins}`, this.width * 0.5, this.height * 0.115);

    roundRect(ctx, layout.panel.x, layout.panel.y, layout.panel.w, layout.panel.h, 22);
    const panelGrad = ctx.createLinearGradient(layout.panel.x, layout.panel.y, layout.panel.x, layout.panel.y + layout.panel.h);
    panelGrad.addColorStop(0, 'rgba(250,247,236,0.96)');
    panelGrad.addColorStop(1, 'rgba(238,232,215,0.96)');
    ctx.fillStyle = panelGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(120,132,141,0.40)';
    ctx.lineWidth = 2;
    ctx.stroke();

    for (const card of layout.cards) {
      roundRect(ctx, card.x + 2, card.y + 2, card.w, card.h, 16);
      ctx.fillStyle = 'rgba(31,42,50,0.10)';
      ctx.fill();

      roundRect(ctx, card.x, card.y, card.w, card.h, 16);
      const cardGrad = ctx.createLinearGradient(card.x, card.y, card.x, card.y + card.h);
      cardGrad.addColorStop(0, 'rgba(255,255,255,0.85)');
      cardGrad.addColorStop(1, 'rgba(242,236,219,0.84)');
      ctx.fillStyle = cardGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(142,131,103,0.34)';
      ctx.lineWidth = 1.6;
      ctx.stroke();

      ctx.textAlign = 'left';
      ctx.fillStyle = '#2f3e49';
      ctx.font = textFont(clamp(layout.bodySize * 0.98, 14, 24), 700);
      ctx.fillText(ITEM_LABEL[card.id], card.x + card.w * 0.06, card.y + card.h * 0.30);

      ctx.fillStyle = '#617178';
      ctx.font = textFont(clamp(layout.smallSize * 0.96, 12, 19), 600);
      ctx.fillText(ITEM_DESC[card.id], card.x + card.w * 0.06, card.y + card.h * 0.52);
      ctx.fillText(`持有: ${this.inventoryCount(card.id)}`, card.x + card.w * 0.06, card.y + card.h * 0.74);

      const cost = itemCostGold(card.id);
      const buyEnabled = this.profile.coins >= cost;
      this.drawButton(card.buyRect, `${cost} 金币`, {
        enabled: buyEnabled,
        fontSize: clamp(card.buyRect.h * 0.42, 12, 20),
      });
    }

    if (this.shopToast) {
      const toastW = Math.min(this.width * 0.72, 340);
      const toastH = clamp(this.height * 0.058, 34, 56);
      const rect = {
        x: (this.width - toastW) * 0.5,
        y: this.height * 0.86,
        w: toastW,
        h: toastH,
      };
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 12);
      ctx.fillStyle = 'rgba(35,35,35,0.92)';
      ctx.fill();
      ctx.fillStyle = '#f5f5f5';
      ctx.font = textFont(clamp(layout.smallSize * 0.95, 12, 20), 600);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(this.shopToast.text, rect.x + rect.w * 0.5, rect.y + rect.h * 0.53);
    }
  }

  drawBoard(layout) {
    const ctx = this.ctx;
    const board = layout.boardRect;
    const cell = layout.cell;
    const deckDepth = Math.max(4, cell * 0.28);
    const deckSkew = Math.max(2, deckDepth * 0.62);
    const outerPad = Math.max(6, cell * 0.58);
    const outer = {
      x: board.x - outerPad,
      y: board.y - outerPad,
      w: board.w + outerPad * 2,
      h: board.h + outerPad * 2,
    };

    const shadow = {
      x: board.x - deckDepth * 1.8,
      y: board.y + board.h - deckDepth * 0.3,
      w: board.w + deckDepth * 3.4,
      h: deckDepth * 2.8,
    };
    ctx.beginPath();
    ctx.ellipse(
      shadow.x + shadow.w * 0.5,
      shadow.y + shadow.h * 0.5,
      shadow.w * 0.5,
      shadow.h * 0.5,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(20,24,28,0.24)';
    ctx.fill();

    const rightFace = [
      [board.x + board.w, board.y],
      [board.x + board.w + deckDepth, board.y + deckSkew],
      [board.x + board.w + deckDepth, board.y + board.h + deckSkew],
      [board.x + board.w, board.y + board.h],
    ];
    const bottomFace = [
      [board.x, board.y + board.h],
      [board.x + board.w, board.y + board.h],
      [board.x + board.w + deckDepth, board.y + board.h + deckSkew],
      [board.x + deckDepth, board.y + board.h + deckSkew],
    ];

    ctx.beginPath();
    ctx.moveTo(rightFace[0][0], rightFace[0][1]);
    for (let i = 1; i < rightFace.length; i += 1) {
      ctx.lineTo(rightFace[i][0], rightFace[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = '#646d75';
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(bottomFace[0][0], bottomFace[0][1]);
    for (let i = 1; i < bottomFace.length; i += 1) {
      ctx.lineTo(bottomFace[i][0], bottomFace[i][1]);
    }
    ctx.closePath();
    ctx.fillStyle = '#5b646d';
    ctx.fill();

    roundRect(ctx, outer.x, outer.y, outer.w, outer.h, 20);
    const roadGrad = ctx.createLinearGradient(outer.x, outer.y, outer.x, outer.y + outer.h);
    roadGrad.addColorStop(0, '#79848f');
    roadGrad.addColorStop(1, '#626c78');
    ctx.fillStyle = roadGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(226,231,235,0.70)';
    ctx.lineWidth = Math.max(2, cell * 0.11);
    ctx.stroke();

    roundRect(ctx, board.x, board.y, board.w, board.h, 12);
    const lotGrad = ctx.createLinearGradient(board.x, board.y, board.x, board.y + board.h);
    lotGrad.addColorStop(0, '#707b88');
    lotGrad.addColorStop(0.55, '#616b77');
    lotGrad.addColorStop(1, '#56616d');
    ctx.fillStyle = lotGrad;
    ctx.fill();

    for (let row = 0; row < BOARD_H; row += 1) {
      if (row % 2 === 0) {
        continue;
      }
      const stripeY = board.y + row * cell;
      ctx.fillStyle = 'rgba(35,43,50,0.12)';
      ctx.fillRect(board.x, stripeY, board.w, Math.max(1, cell * 0.46));
    }

    for (let row = 0; row <= BOARD_H; row += 1) {
      const y = board.y + row * cell;
      ctx.strokeStyle = row % 2 === 0 ? 'rgba(235,240,244,0.26)' : 'rgba(180,192,201,0.16)';
      ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.beginPath();
      ctx.moveTo(board.x, y);
      ctx.lineTo(board.x + board.w, y);
      ctx.stroke();
    }

    for (let col = 0; col <= BOARD_W; col += 1) {
      const x = board.x + col * cell;
      ctx.strokeStyle = 'rgba(236,240,244,0.17)';
      ctx.lineWidth = Math.max(1, cell * 0.05);
      ctx.beginPath();
      ctx.moveTo(x, board.y);
      ctx.lineTo(x, board.y + board.h);
      ctx.stroke();
    }

    for (let row = 1; row < BOARD_H; row += 4) {
      const laneY = board.y + row * cell + cell * 0.17;
      ctx.fillStyle = 'rgba(53,61,68,0.65)';
      ctx.fillRect(board.x, laneY, board.w, Math.max(4, cell * 0.68));

      const y = board.y + row * cell + cell * 0.50;
      const dash = Math.max(8, cell * 0.64);
      const gap = Math.max(5, cell * 0.36);
      let x = board.x + cell * 0.20;
      ctx.strokeStyle = 'rgba(255,223,127,0.94)';
      ctx.lineWidth = Math.max(2, cell * 0.09);
      while (x < board.x + board.w) {
        const x2 = Math.min(x + dash, board.x + board.w);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x2, y);
        ctx.stroke();
        x += dash + gap;
      }
    }

    this.drawAsphaltNoise(layout);

    ctx.strokeStyle = 'rgba(241,245,248,0.55)';
    ctx.lineWidth = Math.max(2, cell * 0.11);
    roundRect(ctx, board.x, board.y, board.w, board.h, 12);
    ctx.stroke();

    this.drawLotDecor(layout, outer);
  }

  drawLotDecor(layout, outer) {
    const ctx = this.ctx;
    const board = layout.boardRect;
    const cell = layout.cell;
    const pad = Math.max(2, cell * 0.2);

    const grassW = Math.min(Math.max(8, cell * 0.92), Math.max(8, (board.x - outer.x) - pad - 1));
    const grassH = Math.min(Math.max(6, cell * 0.62), Math.max(6, (board.y - outer.y) - pad - 1));
    const spots = [
      { x: outer.x + 2, y: outer.y + 2, w: grassW, h: grassH },
      { x: outer.x + outer.w - grassW - 2, y: outer.y + 2, w: grassW, h: grassH },
      { x: outer.x + 2, y: outer.y + outer.h - grassH - 2, w: grassW, h: grassH },
      { x: outer.x + outer.w - grassW - 2, y: outer.y + outer.h - grassH - 2, w: grassW, h: grassH },
    ];

    for (const rect of spots) {
      roundRect(ctx, rect.x + 1, rect.y + 1, rect.w, rect.h, Math.max(4, cell * 0.2));
      ctx.fillStyle = 'rgba(52,74,47,0.6)';
      ctx.fill();
      roundRect(ctx, rect.x, rect.y, rect.w, rect.h, Math.max(4, cell * 0.2));
      const grassGrad = ctx.createLinearGradient(rect.x, rect.y, rect.x, rect.y + rect.h);
      grassGrad.addColorStop(0, '#78b170');
      grassGrad.addColorStop(1, '#5f9c59');
      ctx.fillStyle = grassGrad;
      ctx.fill();
    }

    for (const rect of spots) {
      const tx = rect.x + rect.w * 0.5;
      const ty = rect.y + rect.h * 0.5;
      const r = Math.max(4, cell * 0.18);

      ctx.beginPath();
      ctx.ellipse(tx, ty + r * 0.9, r * 0.9, r * 0.5, 0, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(28,40,24,0.48)';
      ctx.fill();

      roundRect(ctx, tx - r * 0.18, ty - r * 0.2, r * 0.36, r * 0.78, 1.5);
      ctx.fillStyle = '#7b5a3b';
      ctx.fill();

      ctx.beginPath();
      ctx.arc(tx, ty - r * 0.4, r, 0, Math.PI * 2);
      ctx.fillStyle = '#5b9a55';
      ctx.fill();
      ctx.beginPath();
      ctx.arc(tx - r * 0.33, ty - r * 0.58, r * 0.52, 0, Math.PI * 2);
      ctx.fillStyle = '#7ebc76';
      ctx.fill();
    }

    const lampTop = outer.y + cell * 0.42;
    const lampBottom = outer.y + outer.h - cell * 0.42;
    for (const ly of [lampTop, lampBottom]) {
      const lx = outer.x + outer.w * 0.5;
      ctx.strokeStyle = '#adb6bd';
      ctx.lineWidth = Math.max(1, cell * 0.07);
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(lx, ly + cell * 0.5);
      ctx.stroke();

      roundRect(ctx, lx - cell * 0.1, ly - cell * 0.08, cell * 0.2, cell * 0.16, cell * 0.04);
      ctx.fillStyle = '#e7ebef';
      ctx.fill();

      const glow = ctx.createRadialGradient(lx, ly + cell * 0.02, 0, lx, ly + cell * 0.02, cell * 0.45);
      glow.addColorStop(0, 'rgba(255,236,165,0.46)');
      glow.addColorStop(1, 'rgba(255,236,165,0.0)');
      ctx.fillStyle = glow;
      ctx.fillRect(lx - cell * 0.5, ly - cell * 0.2, cell, cell * 0.7);
    }
  }

  drawAsphaltNoise(layout) {
    const ctx = this.ctx;
    const board = layout.boardRect;
    const cell = layout.cell;
    const spacing = Math.max(4, Math.round(cell * 0.72));
    const alpha = clamp(cell / 42, 0.04, 0.10);
    ctx.fillStyle = `rgba(226,233,238,${alpha.toFixed(3)})`;

    for (let y = board.y + 2, row = 0; y < board.y + board.h - 2; y += spacing, row += 1) {
      for (let x = board.x + 2, col = 0; x < board.x + board.w - 2; x += spacing) {
        const pulse = ((row + col) % 5) - 2;
        const w = Math.max(1, cell * 0.045 + pulse * 0.05);
        const h = Math.max(1, cell * 0.028 + pulse * 0.03);
        ctx.fillRect(x, y, w, h);
      }
    }
  }

  drawFence(layout, fence) {
    const ctx = this.ctx;
    const board = layout.boardRect;
    const cell = layout.cell;

    const left = board.x + fence.x * cell;
    const top = board.y + fence.y * cell;
    const right = left + cell;
    const bottom = top + cell;

    const width = Math.max(3, cell * 0.16);
    const stripeStep = Math.max(4, cell * 0.30);
    const shadowShift = Math.max(1, width * 0.7);

    const drawMain = (x1, y1, x2, y2, vertical) => {
      ctx.strokeStyle = 'rgba(52,40,32,0.72)';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1 + shadowShift, y1 + shadowShift);
      ctx.lineTo(x2 + shadowShift, y2 + shadowShift);
      ctx.stroke();

      ctx.strokeStyle = '#8f6442';
      ctx.lineWidth = width;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();

      ctx.strokeStyle = '#f0d15b';
      ctx.lineWidth = Math.max(1, width * 0.45);
      for (let off = 0; off < cell; off += stripeStep) {
        if (vertical) {
          const y0 = top + off;
          const y1s = Math.min(y0 + stripeStep * 0.48, bottom);
          ctx.beginPath();
          ctx.moveTo(x1, y0);
          ctx.lineTo(x1, y1s);
          ctx.stroke();
        } else {
          const x0 = left + off;
          const x1s = Math.min(x0 + stripeStep * 0.48, right);
          ctx.beginPath();
          ctx.moveTo(x0, y1);
          ctx.lineTo(x1s, y1);
          ctx.stroke();
        }
      }
    };

    if (fence.direction === 'UP') {
      drawMain(left, top, right, top, false);
    } else if (fence.direction === 'DOWN') {
      drawMain(left, bottom, right, bottom, false);
    } else if (fence.direction === 'LEFT') {
      drawMain(left, top, left, bottom, true);
    } else {
      drawMain(right, top, right, bottom, true);
    }

    const postR = Math.max(2, width * 0.62);
    for (const [px, py] of [
      [left, top],
      [right, top],
      [left, bottom],
      [right, bottom],
    ]) {
      ctx.beginPath();
      ctx.arc(px, py, postR, 0, Math.PI * 2);
      ctx.fillStyle = '#d8cab6';
      ctx.fill();
    }
  }

  drawHintBadge(x, y, w, h, hintDir) {
    const ctx = this.ctx;
    const badgeR = Math.max(8, Math.min(w, h) * 0.22);
    const cx = x + w - badgeR;
    const cy = y + badgeR;
    ctx.beginPath();
    ctx.arc(cx, cy, badgeR, 0, Math.PI * 2);
    ctx.fillStyle = '#232b31';
    ctx.fill();
    ctx.strokeStyle = '#ffdf6a';
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.fillStyle = '#ffe789';
    ctx.font = textFont(Math.max(10, badgeR * 1.2), 700);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const arrowMap = { LEFT: '←', RIGHT: '→', UP: '↑', DOWN: '↓' };
    ctx.fillText(arrowMap[hintDir] || '?', cx, cy + 0.5);
  }

  drawVehicleRect(v, x, y, w, h, highlight, hintDir) {
    const ctx = this.ctx;
    const frontDir = v.axis === 'H'
      ? (v.frontPositive ? 'RIGHT' : 'LEFT')
      : (v.frontPositive ? 'DOWN' : 'UP');
    const shortSide = Math.min(w, h);
    const longSide = Math.max(w, h);
    const compact = longSide < shortSide * 1.34;
    const bodyRadius = Math.max(4, shortSide * 0.28);
    const baseColor = v.spriteType === 'suv'
      ? mixColor(v.color, '#ffffff', 0.07)
      : mixColor(v.color, '#ffffff', 0.11);
    const angleByDir = {
      UP: 0,
      RIGHT: Math.PI * 0.5,
      DOWN: Math.PI,
      LEFT: -Math.PI * 0.5,
    };
    const angle = angleByDir[frontDir] || 0;
    const cx = x + w * 0.5;
    const cy = y + h * 0.5;
    const carW = shortSide * 0.92;
    const carL = longSide * 0.94;

    const fillPoly = (points, fillStyle, strokeStyle = null, lineWidth = 1) => {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      for (let i = 1; i < points.length; i += 1) {
        ctx.lineTo(points[i][0], points[i][1]);
      }
      ctx.closePath();
      ctx.fillStyle = fillStyle;
      ctx.fill();
      if (strokeStyle) {
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.stroke();
      }
    };

    if (highlight) {
      const glow = { x: x - 5, y: y - 5, w: w + 10, h: h + 10 };
      roundRect(ctx, glow.x, glow.y, glow.w, glow.h, Math.min(glow.h * 0.24, 12));
      ctx.strokeStyle = '#ffe57b';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (this.vehicleTextures.drawVehicle(ctx, v, x, y, w, h, frontDir)) {
      if (highlight && hintDir) {
        this.drawHintBadge(x, y, w, h, hintDir);
      }
      return;
    }

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);

    ctx.beginPath();
    ctx.ellipse(
      shortSide * 0.07,
      carL * 0.20,
      carW * 0.58,
      Math.max(3, shortSide * 0.18),
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(21,27,32,0.33)';
    ctx.fill();

    roundRect(ctx, -carW * 0.5, -carL * 0.5, carW, carL, bodyRadius);
    const bodyGrad = ctx.createLinearGradient(0, carL * 0.5, 0, -carL * 0.5);
    bodyGrad.addColorStop(0, mixColor(baseColor, '#2a3440', 0.10));
    bodyGrad.addColorStop(0.42, mixColor(baseColor, '#ffffff', 0.04));
    bodyGrad.addColorStop(1, mixColor(baseColor, '#ffffff', 0.20));
    ctx.fillStyle = bodyGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(26,34,42,0.72)';
    ctx.lineWidth = Math.max(1.3, shortSide * 0.068);
    ctx.stroke();

    roundRect(ctx, -carW * 0.5, -carL * 0.5, carW, carL, bodyRadius);
    ctx.strokeStyle = 'rgba(255,255,255,0.28)';
    ctx.lineWidth = Math.max(1, shortSide * 0.03);
    ctx.stroke();

    roundRect(ctx, -carW * 0.44, -carL * 0.40, carW * 0.13, carL * 0.72, carW * 0.05);
    ctx.fillStyle = 'rgba(24,34,46,0.52)';
    ctx.fill();
    roundRect(ctx, carW * 0.31, -carL * 0.40, carW * 0.13, carL * 0.72, carW * 0.05);
    ctx.fill();

    roundRect(ctx, -carW * 0.35, -carL * 0.28, carW * 0.70, carL * 0.56, carW * 0.16);
    ctx.fillStyle = 'rgba(25,37,50,0.30)';
    ctx.fill();

    const frontWindowTop = compact ? -carL * 0.40 : -carL * 0.35;
    const frontWindowBottom = compact ? -carL * 0.14 : -carL * 0.12;
    const rearWindowTop = compact ? carL * 0.12 : carL * 0.10;
    const rearWindowBottom = compact ? carL * 0.37 : carL * 0.33;
    const frontWindow = [
      [-carW * 0.30, frontWindowTop],
      [carW * 0.30, frontWindowTop],
      [carW * 0.24, frontWindowBottom],
      [-carW * 0.24, frontWindowBottom],
    ];
    const rearWindow = [
      [-carW * 0.23, rearWindowTop],
      [carW * 0.23, rearWindowTop],
      [carW * 0.30, rearWindowBottom],
      [-carW * 0.30, rearWindowBottom],
    ];
    fillPoly(frontWindow, 'rgba(25,37,50,0.95)', 'rgba(179,216,236,0.48)', Math.max(1, shortSide * 0.038));
    fillPoly(rearWindow, 'rgba(31,42,56,0.92)', 'rgba(169,206,228,0.36)', Math.max(1, shortSide * 0.035));

    if (!compact) {
      roundRect(ctx, -carW * 0.16, -carL * 0.07, carW * 0.32, carL * 0.15, carW * 0.07);
      ctx.fillStyle = mixColor(baseColor, '#ffffff', 0.17);
      ctx.fill();
      roundRect(ctx, -carW * 0.11, -carL * 0.02, carW * 0.22, carL * 0.05, carW * 0.03);
      ctx.fillStyle = 'rgba(255,255,255,0.26)';
      ctx.fill();
    }

    const hoodTop = -carL * 0.50;
    const hoodBottom = compact ? -carL * 0.20 : -carL * 0.15;
    const hoodPoly = [
      [-carW * 0.28, hoodTop + carL * 0.05],
      [carW * 0.28, hoodTop + carL * 0.05],
      [carW * 0.20, hoodBottom],
      [-carW * 0.20, hoodBottom],
    ];
    fillPoly(hoodPoly, mixColor(baseColor, '#ffffff', 0.24));

    roundRect(
      ctx,
      -carW * 0.22,
      -carL * 0.52,
      carW * 0.44,
      carL * 0.07,
      carW * 0.04,
    );
    ctx.fillStyle = mixColor(baseColor, '#fff6d2', compact ? 0.28 : 0.20);
    ctx.fill();

    const headLampW = carW * (compact ? 0.17 : 0.15);
    const headLampH = carL * (compact ? 0.085 : 0.075);
    const headLampY = -carL * 0.50;
    roundRect(ctx, -carW * 0.43, headLampY, headLampW, headLampH, carW * 0.035);
    ctx.fillStyle = 'rgba(255,255,248,0.97)';
    ctx.fill();
    roundRect(ctx, carW * 0.28, headLampY, headLampW, headLampH, carW * 0.035);
    ctx.fill();
    roundRect(ctx, -carW * 0.41, headLampY + headLampH * 0.18, headLampW * 0.74, headLampH * 0.44, carW * 0.02);
    ctx.fillStyle = 'rgba(255,226,158,0.92)';
    ctx.fill();
    roundRect(ctx, carW * 0.30, headLampY + headLampH * 0.18, headLampW * 0.74, headLampH * 0.44, carW * 0.02);
    ctx.fill();

    const rearLampW = carW * 0.13;
    const rearLampH = carL * 0.062;
    const rearLampY = carL * 0.44;
    roundRect(ctx, -carW * 0.40, rearLampY, rearLampW, rearLampH, carW * 0.03);
    ctx.fillStyle = 'rgba(207,54,64,0.88)';
    ctx.fill();
    roundRect(ctx, carW * 0.27, rearLampY, rearLampW, rearLampH, carW * 0.03);
    ctx.fill();

    ctx.strokeStyle = 'rgba(35,44,52,0.72)';
    ctx.lineWidth = Math.max(1, shortSide * 0.03);
    ctx.beginPath();
    ctx.moveTo(-carW * 0.16, -carL * 0.51);
    ctx.lineTo(carW * 0.16, -carL * 0.51);
    ctx.stroke();

    roundRect(ctx, -carW * 0.12, carL * 0.44, carW * 0.24, carL * 0.04, carW * 0.02);
    ctx.fillStyle = 'rgba(35,44,52,0.72)';
    ctx.fill();

    if (v.spriteType === 'suv') {
      ctx.strokeStyle = 'rgba(233,238,244,0.60)';
      ctx.lineWidth = Math.max(1, shortSide * 0.045);
      ctx.beginPath();
      ctx.moveTo(-carW * 0.22, -carL * 0.10);
      ctx.lineTo(-carW * 0.22, carL * 0.12);
      ctx.moveTo(carW * 0.22, -carL * 0.10);
      ctx.lineTo(carW * 0.22, carL * 0.12);
      ctx.stroke();
    } else if (!compact) {
      ctx.strokeStyle = 'rgba(233,238,244,0.54)';
      ctx.lineWidth = Math.max(1, shortSide * 0.04);
      ctx.beginPath();
      ctx.moveTo(-carW * 0.18, -carL * 0.06);
      ctx.lineTo(carW * 0.18, -carL * 0.06);
      ctx.stroke();
    }

    ctx.fillStyle = '#27323a';
    const wheelR = Math.max(1.1, shortSide * 0.09);
    ctx.beginPath();
    ctx.arc(-carW * 0.42, -carL * 0.22, wheelR, 0, Math.PI * 2);
    ctx.arc(carW * 0.42, -carL * 0.22, wheelR, 0, Math.PI * 2);
    ctx.arc(-carW * 0.42, carL * 0.22, wheelR, 0, Math.PI * 2);
    ctx.arc(carW * 0.42, carL * 0.22, wheelR, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    if (highlight && hintDir) {
      this.drawHintBadge(x, y, w, h, hintDir);
    }
  }

  pedestrianStyle(pedId) {
    const hash = stableHash(pedId);
    const shirtPalette = ['#58acff', '#7ad086', '#f7b267', '#ba93ff', '#5cc3bf'];
    const pantsPalette = ['#4b5e76', '#5f6672', '#445062', '#6a5f72'];
    const bagPalette = ['#5f6f80', '#707b67', '#7a6858', '#6f5e82'];
    return {
      shirt: shirtPalette[hash % shirtPalette.length],
      pants: pantsPalette[(hash >> 3) % pantsPalette.length],
      bag: bagPalette[(hash >> 5) % bagPalette.length],
      skin: (hash % 2) === 0 ? '#f4cda5' : '#eabf95',
    };
  }

  drawPedestrian(layout, ped, px, py) {
    const ctx = this.ctx;
    const cx = layout.boardRect.x + (px + 0.5) * layout.cell;
    const cy = layout.boardRect.y + (py + 0.5) * layout.cell;
    const style = this.pedestrianStyle(ped.id);
    const bodyH = Math.max(7, layout.cell * 0.29);
    const bodyW = Math.max(4, layout.cell * 0.14);
    const headR = Math.max(2, layout.cell * 0.085);
    const walkPhase = this.renderClockSec * 8 + (ped.id.charCodeAt(0) % 7);
    const swing = Math.sin(walkPhase) * Math.max(1, layout.cell * 0.055);

    let facingX = 0;
    let facingY = 0;
    if (ped.facing === 'LEFT') {
      facingX = -1;
    } else if (ped.facing === 'RIGHT') {
      facingX = 1;
    } else if (ped.facing === 'UP') {
      facingY = -1;
    } else if (ped.facing === 'DOWN') {
      facingY = 1;
    }
    const offsetX = facingX * Math.max(0.4, layout.cell * 0.04);
    const offsetY = facingY * Math.max(0.4, layout.cell * 0.03);

    ctx.beginPath();
    ctx.ellipse(
      cx + layout.cell * 0.05,
      cy + layout.cell * 0.20,
      bodyW * 0.76,
      bodyW * 0.40,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fillStyle = 'rgba(22,27,31,0.46)';
    ctx.fill();

    roundRect(
      ctx,
      cx - bodyW * 0.5 + offsetX,
      cy - bodyH * 0.33 + offsetY,
      bodyW,
      bodyH,
      Math.max(2, bodyW * 0.30),
    );
    const shirtGrad = ctx.createLinearGradient(0, cy - bodyH * 0.33, 0, cy + bodyH * 0.67);
    shirtGrad.addColorStop(0, mixColor(style.shirt, '#ffffff', 0.18));
    shirtGrad.addColorStop(1, mixColor(style.shirt, '#243443', 0.14));
    ctx.fillStyle = shirtGrad;
    ctx.fill();

    roundRect(
      ctx,
      cx - bodyW * 0.24 + offsetX,
      cy - bodyH * 0.10 + offsetY,
      bodyW * 0.48,
      bodyH * 0.34,
      Math.max(2, bodyW * 0.16),
    );
    ctx.fillStyle = 'rgba(234,245,255,0.30)';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cx + offsetX, cy - bodyH * 0.55 + offsetY, headR, 0, Math.PI * 2);
    ctx.fillStyle = style.skin;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(cx + offsetX - headR * 0.34, cy - bodyH * 0.70 + offsetY, headR * 0.36, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255,235,210,0.72)';
    ctx.fill();

    ctx.strokeStyle = style.pants;
    ctx.lineWidth = Math.max(1.3, layout.cell * 0.07);
    ctx.beginPath();
    ctx.moveTo(cx - 1 + offsetX, cy + bodyH * 0.56 + offsetY);
    ctx.lineTo(cx - 3 - swing + offsetX, cy + bodyH * 0.95 + offsetY);
    ctx.moveTo(cx + 1 + offsetX, cy + bodyH * 0.56 + offsetY);
    ctx.lineTo(cx + 3 + swing + offsetX, cy + bodyH * 0.95 + offsetY);
    ctx.stroke();

    ctx.strokeStyle = mixColor(style.pants, '#28313a', 0.24);
    ctx.lineWidth = Math.max(1.0, layout.cell * 0.05);
    ctx.beginPath();
    ctx.moveTo(cx - bodyW * 0.52 + offsetX, cy - bodyH * 0.07 + offsetY);
    ctx.lineTo(cx - bodyW * 0.82 + offsetX - swing * 0.16, cy + bodyH * 0.22 + offsetY);
    ctx.moveTo(cx + bodyW * 0.52 + offsetX, cy - bodyH * 0.07 + offsetY);
    ctx.lineTo(cx + bodyW * 0.82 + offsetX + swing * 0.16, cy + bodyH * 0.22 + offsetY);
    ctx.stroke();

    roundRect(
      ctx,
      cx + bodyW * 0.18 + offsetX,
      cy - bodyH * 0.06 + offsetY,
      bodyW * 0.34,
      bodyH * 0.30,
      bodyW * 0.14,
    );
    ctx.fillStyle = style.bag;
    ctx.fill();
  }

  pedestrianRenderPos(ped) {
    const g = this.game;
    if (!g) {
      return [ped.x, ped.y];
    }
    const start = g.pedPrev[ped.id];
    const end = g.pedCurr[ped.id];
    if (!start || !end) {
      return [ped.x, ped.y];
    }
    const t = clamp(g.pedBlend, 0, 1);
    return [lerp(start[0], end[0], t), lerp(start[1], end[1], t)];
  }

  renderGameplay() {
    const g = this.game;
    if (!g) {
      return;
    }
    const ctx = this.ctx;
    const layout = this.getGameplayLayout();

    const staticLayer = this.ensureGameplayStaticLayer(layout, g.level);
    if (staticLayer) {
      ctx.drawImage(staticLayer, 0, 0, this.width, this.height);
    } else {
      this.drawBoard(layout);
      for (const fence of g.level.fences) {
        this.drawFence(layout, fence);
      }
      this.drawPedestrianPatrolPaths(layout, g.level.pedestrians);
    }

    const animatingIds = new Set((g.moveAnimations || []).map((a) => a.vehicleId));

    for (const v of g.level.vehicles) {
      if (!v.active) {
        continue;
      }
      if (animatingIds.has(v.id)) {
        continue;
      }
      const rect = this.vehicleRect(v, layout);
      const highlighted = g.hint && g.hintRemaining > 0 && g.hint.vehicleId === v.id;
      this.drawVehicleRect(v, rect.x, rect.y, rect.w, rect.h, highlighted, highlighted ? g.hint.direction : null);
    }

    for (const a of (g.moveAnimations || [])) {
      const leadInDuration = Math.max(0, a.leadInDuration || 0);
      const impactDuration = Math.max(0, a.impactDuration || 0);
      const activeDuration = Math.max(0.001, a.duration - leadInDuration);
      const activeElapsed = Math.max(0, a.elapsed - leadInDuration);
      const moveTotalDuration = Math.max(0.001, activeDuration - impactDuration);
      const moveElapsed = Math.min(activeElapsed, moveTotalDuration);
      const t = smootherStep(clamp(moveElapsed / moveTotalDuration, 0, 1));
      const x = lerp(a.startX, a.endX, t);
      const y = lerp(a.startY, a.endY, t);
      let renderX = x;
      let renderY = y;

      if (impactDuration > 0 && activeElapsed > moveTotalDuration) {
        const it = clamp((activeElapsed - moveTotalDuration) / impactDuration, 0, 1);
        const [dx, dy] = directionDelta(a.direction);
        const backOffset = Math.sin(Math.PI * it) * CAR_IMPACT_BACK_CELL;
        const shakeOffset = Math.sin(Math.PI * 6 * it) * (1 - it) * CAR_IMPACT_SHAKE_CELL;
        renderX -= dx * backOffset;
        renderY -= dy * backOffset;
        if (a.axis === 'H') {
          renderY += shakeOffset;
        } else {
          renderX += shakeOffset;
        }
      }

      const v = {
        id: a.vehicleId,
        x: renderX,
        y: renderY,
        length: a.length,
        axis: a.axis,
        color: a.color,
        frontPositive: a.frontPositive,
        spriteType: a.spriteType,
        active: true,
      };
      const rect = this.vehicleRect(v, layout);
      const highlighted = g.hint && g.hintRemaining > 0 && g.hint.vehicleId === v.id;
      this.drawVehicleRect(v, rect.x, rect.y, rect.w, rect.h, highlighted, highlighted ? g.hint.direction : null);
    }

    for (const ped of g.level.pedestrians) {
      const [px, py] = this.pedestrianRenderPos(ped);
      this.drawPedestrian(layout, ped, px, py);
    }

    const headerPlate = {
      x: Math.round(this.width * 0.12),
      y: Math.round(this.height * 0.011),
      w: Math.round(this.width * 0.76),
      h: clamp(this.height * 0.072, 36, 58),
    };
    roundRect(ctx, headerPlate.x, headerPlate.y, headerPlate.w, headerPlate.h, 16);
    const plateGrad = ctx.createLinearGradient(headerPlate.x, headerPlate.y, headerPlate.x, headerPlate.y + headerPlate.h);
    plateGrad.addColorStop(0, 'rgba(252,250,241,0.90)');
    plateGrad.addColorStop(1, 'rgba(241,236,219,0.88)');
    ctx.fillStyle = plateGrad;
    ctx.fill();
    ctx.strokeStyle = 'rgba(143,132,104,0.42)';
    ctx.lineWidth = Math.max(1, layout.cell * 0.06);
    ctx.stroke();

    this.drawLevelSelectIconButton(layout.backRect, {
      enabled: true,
    });
    this.drawShopIconButton(layout.shopRect, {
      enabled: true,
    });

    const chipY = headerPlate.y + clamp(headerPlate.h * 0.16, 5, 10);
    const chipH = clamp(headerPlate.h * 0.66, 22, 34);
    const chipGap = clamp(this.width * 0.018, 6, 12);
    const chipInset = clamp(this.width * 0.017, 6, 12);
    const chipW = Math.floor((headerPlate.w - chipInset * 2 - chipGap * 2) / 3);
    const chipStartX = Math.round(headerPlate.x + chipInset);
    this.drawInfoChip(
      chipStartX,
      chipY,
      chipW,
      chipH,
      '关卡',
      `${g.levelNumber}`,
      '#304450',
    );
    this.drawInfoChip(
      chipStartX + chipW + chipGap,
      chipY,
      chipW,
      chipH,
      '步数',
      `${g.movesUsed}/${g.level.maxSteps}`,
      g.movesUsed >= g.level.maxSteps ? '#b83f3f' : '#304450',
    );
    this.drawInfoChip(
      chipStartX + (chipW + chipGap) * 2,
      chipY,
      chipW,
      chipH,
      '金币',
      `${this.profile.coins}`,
      '#304450',
    );
    this.drawLivesChip(layout.livesRect.x, layout.livesRect.y, layout.livesRect.w, layout.livesRect.h, g.heartsRemaining, LEVEL_HEARTS);

    let statusNoticeText = '';
    if (g.status === 'playing') {
      if (g.freezePedRemaining > 0) {
        statusNoticeText = `行人暂停中 ${g.freezePedRemaining.toFixed(1)}s`;
      } else if (g.movesUsed >= g.level.maxSteps) {
        statusNoticeText = '步数已用尽，可使用步+5道具';
      }
    }

    const canUseItem = g.status === 'playing';
    const totalItems = g.wrenchCount + g.stepCardCount + g.towCount + g.freezeCount;
    for (const btn of layout.controls) {
      let enabled = g.status === 'playing';
      let label = btn.label;
      let iconType = null;
      const style = {
        enabled,
        fontSize: clamp(btn.h * 0.50, 13, 24),
      };

      if (btn.id === 'items') {
        enabled = canUseItem && totalItems > 0;
        label = `道具${totalItems > 0 ? `(${totalItems})` : ''}`;
        if (g.itemMenuOpen) {
          style.fill = '#8b6a2f';
          style.border = '#debf75';
        }
      } else if (btn.id === 'bgm') {
        enabled = true;
        label = '';
        iconType = 'bgm';
      } else if (btn.id === 'sfx') {
        enabled = true;
        label = '';
        iconType = 'sfx';
      }

      style.enabled = enabled;
      if (iconType) {
        this.drawAudioToggleIconButton(
          btn,
          iconType,
          iconType === 'bgm' ? this.audio.isBgmEnabled() : this.audio.isSfxEnabled(),
          style,
        );
      } else {
        this.drawButton(btn, label, style);
      }
    }

    if (g.itemMenuOpen && g.status === 'playing') {
      roundRect(
        ctx,
        layout.itemPanel.x,
        layout.itemPanel.y,
        layout.itemPanel.w,
        layout.itemPanel.h,
        Math.min(14, layout.itemPanel.h * 0.35),
      );
      const itemPanelGrad = ctx.createLinearGradient(
        layout.itemPanel.x,
        layout.itemPanel.y,
        layout.itemPanel.x,
        layout.itemPanel.y + layout.itemPanel.h,
      );
      itemPanelGrad.addColorStop(0, 'rgba(252,248,236,0.96)');
      itemPanelGrad.addColorStop(1, 'rgba(238,232,214,0.94)');
      ctx.fillStyle = itemPanelGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(136,125,95,0.42)';
      ctx.lineWidth = Math.max(1, layout.cell * 0.06);
      ctx.stroke();

      for (const itemBtn of layout.itemButtons) {
        let enabled = true;
        let label = '';
        const style = {
          enabled: true,
          fontSize: clamp(itemBtn.h * 0.42, 11, 18),
        };
        if (itemBtn.id === 'wrench') {
          enabled = g.wrenchCount > 0 && g.level.fences.length > 0;
          label = `扳手x${g.wrenchCount}`;
          if (g.wrenchMode) {
            style.fill = '#8b6a2f';
            style.border = '#debf75';
          }
        } else if (itemBtn.id === 'step') {
          enabled = g.stepCardCount > 0;
          label = `步+5x${g.stepCardCount}`;
        } else if (itemBtn.id === 'tow') {
          enabled = g.towCount > 0 && activeVehicleCount(g.level) > 0;
          label = `拖车x${g.towCount}`;
          if (g.towMode) {
            style.fill = '#8b6a2f';
            style.border = '#debf75';
          }
        } else if (itemBtn.id === 'freeze') {
          enabled = g.freezeCount > 0 && g.level.pedestrians.length > 0;
          label = `停行人x${g.freezeCount}`;
        }
        style.enabled = enabled;
        this.drawButton(itemBtn, label, style);
      }
    }

    if (g.collisionPrompt) {
      ctx.fillStyle = 'rgba(59,18,24,0.54)';
      ctx.fillRect(0, 0, this.width, this.height);

      const panel = layout.promptPanel;
      roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 20);
      const panelGrad = ctx.createLinearGradient(panel.x, panel.y, panel.x, panel.y + panel.h);
      panelGrad.addColorStop(0, 'rgba(255,252,250,0.98)');
      panelGrad.addColorStop(1, 'rgba(244,232,233,0.98)');
      ctx.fillStyle = panelGrad;
      ctx.fill();
      ctx.strokeStyle = 'rgba(171,109,122,0.55)';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = '#7d3040';
      ctx.font = textFont(clamp(layout.titleSize * 0.92, 22, 38), 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('撞到行人', panel.x + panel.w * 0.5, panel.y + panel.h * 0.30);

      ctx.fillStyle = '#645d57';
      ctx.font = textFont(clamp(layout.bodySize * 0.98, 14, 24), 600);
      ctx.fillText(`当前剩余：${g.heartsRemaining}/${LEVEL_HEARTS}`, panel.x + panel.w * 0.5, panel.y + panel.h * 0.50);

      this.drawButton(layout.promptContinueBtn, '继续(-1❤️)', {
        enabled: g.heartsRemaining > 0,
        fill: '#92535e',
        border: '#e7bbc3',
        fontSize: clamp(layout.promptContinueBtn.h * 0.42, 13, 22),
      });
      this.drawButton(layout.promptGiveUpBtn, '放弃', {
        enabled: true,
        fill: '#565c66',
        border: '#c8ced8',
        fontSize: clamp(layout.promptGiveUpBtn.h * 0.42, 13, 22),
      });
    } else if (g.status === 'won' || g.status === 'failed') {
      ctx.fillStyle = g.status === 'won' ? COLOR_OVERLAY_WIN : COLOR_OVERLAY_FAIL;
      ctx.fillRect(0, 0, this.width, this.height);

      const panel = {
        x: layout.promptPanel.x,
        y: layout.promptPanel.y,
        w: layout.promptPanel.w,
        h: layout.promptPanel.h,
      };

      roundRect(ctx, panel.x, panel.y, panel.w, panel.h, 18);
      ctx.fillStyle = '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#a89976';
      ctx.lineWidth = 2;
      ctx.stroke();

      ctx.fillStyle = COLOR_TEXT;
      ctx.font = textFont(clamp(layout.titleSize * 0.9, 22, 38), 700);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(g.status === 'won' ? '通关' : '挑战失败', panel.x + panel.w * 0.5, panel.y + panel.h * 0.22);

      ctx.fillStyle = COLOR_TEXT_MUTED;
      ctx.font = textFont(clamp(layout.bodySize * 0.95, 14, 24), 600);
      const sub = g.status === 'won'
        ? `总步数: ${g.movesUsed}`
        : g.hitPedestrian
          ? '撞到行人，请重开'
          : '挑战失败，请重开';
      ctx.fillText(sub, panel.x + panel.w * 0.5, panel.y + panel.h * 0.43);

      if (g.status === 'won') {
        const itemText = g.rewardItems.length
          ? g.rewardItems.map((itemId) => ITEM_LABEL[itemId]).join('、')
          : '-';
        const bonusLabel = g.usedAnyItem ? '基础奖励' : '无道具通关';
        const bonusValue = g.usedAnyItem ? '500金币 + 随机道具x2' : '1000金币 + 随机道具x4';
        ctx.fillStyle = '#8a6a2b';
        ctx.font = textFont(clamp(layout.bodySize * 0.94, 14, 24), 700);
        ctx.fillText(`奖励: +${g.rewardCoins} 金币`, panel.x + panel.w * 0.5, panel.y + panel.h * 0.54);
        ctx.fillStyle = '#6e6a5c';
        ctx.font = textFont(clamp(layout.smallSize * 0.95, 12, 20), 600);
        ctx.fillText('道具掉落', panel.x + panel.w * 0.5, panel.y + panel.h * 0.65);
        ctx.fillText(itemText, panel.x + panel.w * 0.5, panel.y + panel.h * 0.73);
        ctx.fillText(bonusLabel, panel.x + panel.w * 0.5, panel.y + panel.h * 0.82);
        ctx.fillText(bonusValue, panel.x + panel.w * 0.5, panel.y + panel.h * 0.89);
      }

      const overlayBtn = {
        x: layout.overlayBtn.x,
        y: layout.overlayBtn.y,
        w: layout.overlayBtn.w,
        h: layout.overlayBtn.h,
      };

      this.drawButton(overlayBtn, g.status === 'won' ? '下一关' : '重开本关', {
        enabled: true,
        fontSize: clamp(overlayBtn.h * 0.46, 14, 24),
      });
    }

    const centerMessages = [];
    if (statusNoticeText) {
      centerMessages.push(statusNoticeText);
    }
    if (g.toast) {
      centerMessages.push(g.toast.text);
    }
    if (!g.collisionPrompt && centerMessages.length) {
      const toastH = clamp(this.height * 0.058, 34, 56);
      const toastGap = clamp(this.height * 0.012, 8, 14);
      const totalH = centerMessages.length * toastH + (centerMessages.length - 1) * toastGap;
      const startY = this.height * 0.52 - totalH * 0.5;
      for (let i = 0; i < centerMessages.length; i += 1) {
        const message = centerMessages[i];
        ctx.font = textFont(clamp(layout.smallSize * 0.95, 12, 20), 600);
        const measured = ctx.measureText(message).width;
        const toastW = clamp(measured + 34, 180, Math.min(this.width * 0.86, 460));
        const rect = {
          x: (this.width - toastW) * 0.5,
          y: startY + i * (toastH + toastGap),
          w: toastW,
          h: toastH,
        };
        roundRect(ctx, rect.x, rect.y, rect.w, rect.h, 12);
        ctx.fillStyle = 'rgba(28,28,28,0.92)';
        ctx.fill();
        ctx.fillStyle = '#f5f5f5';
        ctx.font = textFont(clamp(layout.smallSize * 0.95, 12, 20), 600);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(message, rect.x + rect.w * 0.5, rect.y + rect.h * 0.53);
      }
    }
  }
}

function bootstrap() {
  const app = new GameApp();
  app.start();
}

bootstrap();
