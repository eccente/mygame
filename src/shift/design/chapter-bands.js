export const DIFFICULTY_SCORE_BANDS = {
  hard: [58, 72],
  expert: [73, 88],
  brutal: [89, 100],
  'endless-peak': [80, 92],
};

export const MAINLINE_SEGMENT_LAYOUT = [
  { key: 'hard', start: 1, end: 5, tier: 'hard' },
  { key: 'expert', start: 6, end: 20, tier: 'expert' },
  { key: 'brutal', start: 21, end: 30, tier: 'brutal' },
];

const MAINLINE_OCCUPANCY_FLOOR = 0.8;

const TIER_DEFAULTS = {
  hard: {
    rows: [8, 10],
    occupancy: [0.68, 0.76],
    doorGroups: [6, 8],
    doorSlots: [8, 11],
    solutionFamilyMax: 3,
    doorCompetitionMin: 2,
    openingActionBand: [2, 4],
    difficultyScoreBand: DIFFICULTY_SCORE_BANDS.hard,
  },
  expert: {
    rows: [8, 11],
    occupancy: [0.72, 0.80],
    doorGroups: [7, 10],
    doorSlots: [10, 13],
    solutionFamilyMax: 2,
    doorCompetitionMin: 3,
    openingActionBand: [1, 3],
    difficultyScoreBand: DIFFICULTY_SCORE_BANDS.expert,
  },
  brutal: {
    rows: [9, 11],
    occupancy: [0.76, 0.80],
    doorGroups: [8, 11],
    doorSlots: [11, 15],
    solutionFamilyMax: 2,
    doorCompetitionMin: 4,
    openingActionBand: [1, 2],
    difficultyScoreBand: DIFFICULTY_SCORE_BANDS.brutal,
  },
};

function copyBand(band) {
  return Array.isArray(band) ? [...band] : null;
}

function intersectBand(source, limit) {
  const sourceBand = copyBand(source);
  const limitBand = copyBand(limit);
  if (!sourceBand) {
    return limitBand;
  }
  if (!limitBand) {
    return sourceBand;
  }
  const low = Math.max(sourceBand[0], limitBand[0]);
  const high = Math.min(sourceBand[1], limitBand[1]);
  if (low <= high) {
    return [low, high];
  }
  return sourceBand;
}


function applyOccupancyFloor(chapterNumber, band) {
  const sourceBand = copyBand(band);
  if (!sourceBand || chapterNumber < 2) {
    return sourceBand;
  }
  const low = Math.max(sourceBand[0], MAINLINE_OCCUPANCY_FLOOR);
  const high = Math.max(low, sourceBand[1]);
  return [Number(low.toFixed(2)), Number(high.toFixed(2))];
}

function deriveSolutionBand(baseBand, tier) {
  const band = copyBand(baseBand);
  if (!band || band.length < 2) {
    return null;
  }
  const [min, max] = band;
  if (max <= min) {
    return [min, max];
  }
  const span = max - min;
  const offsetByTier = {
    hard: [0, 0.48],
    expert: [0.22, 0.80],
    brutal: [0.52, 1],
  };
  const [startRatio, endRatio] = offsetByTier[tier] || [0, 1];
  const start = Math.round(min + (span * startRatio));
  const end = Math.round(min + (span * endRatio));
  const safeStart = Math.min(start, max);
  const safeEnd = Math.max(Math.min(end, max), safeStart);
  return [safeStart, safeEnd];
}

function buildTierSegment(chapterBand, layout, overrides = {}) {
  const tier = overrides.difficultyTier || overrides.difficultyBand || layout.tier;
  const defaults = TIER_DEFAULTS[tier] || {};
  return {
    key: overrides.key || layout.key,
    start: overrides.start ?? layout.start,
    end: overrides.end ?? layout.end,
    difficultyBand: tier,
    difficultyTier: tier,
    difficultyScoreBand: copyBand(overrides.difficultyScoreBand) || copyBand(defaults.difficultyScoreBand),
    rows: intersectBand(overrides.rows || chapterBand.rows, defaults.rows),
    colors: copyBand(overrides.colors || chapterBand.colors),
    solutionBand: copyBand(overrides.solutionBand) || deriveSolutionBand(chapterBand.solutionBand, tier),
    solutionFamilyMax: Number.isFinite(overrides.solutionFamilyMax)
      ? overrides.solutionFamilyMax
      : Number.isFinite(chapterBand.solutionFamilyMax)
        ? Math.min(chapterBand.solutionFamilyMax, defaults.solutionFamilyMax ?? chapterBand.solutionFamilyMax)
        : defaults.solutionFamilyMax,
    occupancy: applyOccupancyFloor(chapterBand.chapter, intersectBand(overrides.occupancy || chapterBand.occupancy, defaults.occupancy)),
    doorGroups: intersectBand(overrides.doorGroups || chapterBand.doorGroups, defaults.doorGroups),
    doorSlots: intersectBand(overrides.doorSlots || chapterBand.doorSlots, defaults.doorSlots),
    doorCompetitionMin: Number.isFinite(overrides.doorCompetitionMin)
      ? overrides.doorCompetitionMin
      : Math.max(chapterBand.doorCompetitionMin || 0, defaults.doorCompetitionMin || 0),
    openingActionBand: copyBand(overrides.openingActionBand) || copyBand(defaults.openingActionBand),
  };
}

function createMainlineSegments(chapterBand) {
  return MAINLINE_SEGMENT_LAYOUT.map((layout) => buildTierSegment(chapterBand, layout));
}

function createFinaleSegments(chapterBand) {
  return [buildTierSegment(chapterBand, {
    key: 'brutal',
    start: 1,
    end: 30,
    tier: 'brutal',
  }, {
    difficultyScoreBand: [92, 100],
    solutionFamilyMax: 1,
    doorCompetitionMin: Math.max(chapterBand.doorCompetitionMin || 0, 5),
    openingActionBand: [1, 2],
  })];
}

function finalizeChapter(definition) {
  const chapter = {
    ...definition,
    rows: copyBand(definition.rows),
    colors: copyBand(definition.colors),
    solutionBand: copyBand(definition.solutionBand),
    occupancy: applyOccupancyFloor(definition.chapter, definition.occupancy),
    doorGroups: copyBand(definition.doorGroups),
    doorSlots: copyBand(definition.doorSlots),
  };

  if (!chapter.segments) {
    if (chapter.chapter >= 2 && chapter.chapter <= 11) {
      chapter.segments = createMainlineSegments(chapter);
    } else if (chapter.chapter === 12) {
      chapter.segments = createFinaleSegments(chapter);
    }
  }

  if (Array.isArray(chapter.segments)) {
    chapter.segments = chapter.segments.map((segment) => ({
      ...segment,
      occupancy: applyOccupancyFloor(chapter.chapter, segment.occupancy || chapter.occupancy),
    }));
  }

  return chapter;
}

export const CHAPTER_BANDS = [
  finalizeChapter({
    chapter: 1,
    title: '整块离场',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2'],
    mechanics: [],
    cols: 6,
    rows: [8, 9],
    colors: [4, 4],
    solutionBand: [24, 100],
    solutionFamilyMax: 4,
    occupancy: [0.77, 0.87],
    doorGroups: [4, 6],
    doorSlots: [8, 10],
    doorCompetitionMin: 4,
    enforceDifficulty: false,
    segments: [
      { key: 'teaching', start: 1, end: 2, difficultyBand: 'expert', difficultyTier: 'expert', rows: [8, 8], solutionBand: [40, 70], solutionFamilyMax: 4, occupancy: [0.77, 0.83], doorGroups: [4, 5], doorSlots: [9, 10], doorCompetitionMin: 4 },
      { key: 'ramp', start: 3, end: 6, difficultyBand: 'expert', difficultyTier: 'expert', rows: [8, 8], solutionBand: [24, 55], solutionFamilyMax: 4, occupancy: [0.77, 0.82], doorGroups: [6, 6], doorSlots: [9, 10], doorCompetitionMin: 6 },
      { key: 'main', start: 7, end: 15, difficultyBand: 'expert', difficultyTier: 'expert', rows: [8, 9], solutionBand: [24, 70], solutionFamilyMax: 4, occupancy: [0.77, 0.86], doorGroups: [6, 6], doorSlots: [8, 10], doorCompetitionMin: 6 },
      { key: 'pressure', start: 16, end: 24, difficultyBand: 'expert', difficultyTier: 'expert', rows: [8, 9], solutionBand: [24, 65], solutionFamilyMax: 4, occupancy: [0.77, 0.87], doorGroups: [6, 6], doorSlots: [8, 10], doorCompetitionMin: 6 },
      { key: 'climax', start: 25, end: 30, difficultyBand: 'expert', difficultyTier: 'expert', rows: [8, 9], solutionBand: [30, 100], solutionFamilyMax: 3, occupancy: [0.79, 0.86], doorGroups: [6, 6], doorSlots: [8, 10], doorCompetitionMin: 7 },
    ],
  }),
  finalizeChapter({
    chapter: 2,
    title: 'L 形借位',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4'],
    mechanics: [],
    cols: 6,
    rows: [8, 9],
    colors: [5, 5],
    solutionBand: [24, 48],
    solutionFamilyMax: 2,
    occupancy: [0.74, 0.83],
    doorGroups: [6, 9],
    doorSlots: [9, 13],
    doorCompetitionMin: 4,
    segments: [
      {
        key: 'hard',
        start: 1,
        end: 5,
        difficultyBand: 'hard',
        difficultyTier: 'hard',
        difficultyScoreBand: DIFFICULTY_SCORE_BANDS.hard,
        rows: [8, 8],
        colors: [5, 5],
        solutionBand: [24, 32],
        solutionFamilyMax: 3,
        occupancy: [0.74, 0.79],
        doorGroups: [6, 7],
        doorSlots: [9, 11],
        doorCompetitionMin: 4,
        openingActionBand: [2, 4],
      },
      {
        key: 'expert',
        start: 6,
        end: 20,
        difficultyBand: 'expert',
        difficultyTier: 'expert',
        difficultyScoreBand: DIFFICULTY_SCORE_BANDS.expert,
        rows: [8, 9],
        colors: [5, 5],
        solutionBand: [28, 38],
        solutionFamilyMax: 2,
        occupancy: [0.76, 0.82],
        doorGroups: [7, 8],
        doorSlots: [10, 12],
        doorCompetitionMin: 4,
        openingActionBand: [1, 3],
      },
      {
        key: 'brutal',
        start: 21,
        end: 30,
        difficultyBand: 'brutal',
        difficultyTier: 'brutal',
        difficultyScoreBand: DIFFICULTY_SCORE_BANDS.brutal,
        rows: [9, 9],
        colors: [5, 5],
        solutionBand: [34, 48],
        solutionFamilyMax: 2,
        occupancy: [0.78, 0.83],
        doorGroups: [8, 9],
        doorSlots: [11, 13],
        doorCompetitionMin: 5,
        openingActionBand: [1, 2],
      },
    ],
  }),
  finalizeChapter({
    chapter: 3,
    title: 'T 形堵点',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: [],
    cols: 6,
    rows: [8, 10],
    colors: [6, 6],
    solutionBand: [20, 38],
    solutionFamilyMax: 3,
    occupancy: [0.70, 0.80],
    doorGroups: [7, 10],
    doorSlots: [11, 15],
    doorCompetitionMin: 3,
  }),
  finalizeChapter({
    chapter: 4,
    title: '多门竞争',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: [],
    cols: 6,
    rows: [9, 10],
    colors: [6, 6],
    solutionBand: [22, 46],
    solutionFamilyMax: 3,
    occupancy: [0.72, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 15],
    doorCompetitionMin: 3,
  }),
  finalizeChapter({
    chapter: 5,
    title: '顺序压缩',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: [],
    cols: 6,
    rows: [9, 10],
    colors: [6, 6],
    solutionBand: [24, 44],
    solutionFamilyMax: 2,
    occupancy: [0.72, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 15],
    doorCompetitionMin: 4,
  }),
  finalizeChapter({
    chapter: 6,
    title: '方向训练',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: ['directional'],
    cols: 6,
    rows: [9, 10],
    colors: [6, 6],
    solutionBand: [18, 30],
    solutionFamilyMax: 3,
    occupancy: [0.76, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 14],
    doorCompetitionMin: 4,
  }),
  finalizeChapter({
    chapter: 7,
    title: '锁链车间',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: ['directional', 'lock-gate'],
    cols: 6,
    rows: [9, 10],
    colors: [6, 6],
    solutionBand: [20, 32],
    solutionFamilyMax: 3,
    occupancy: [0.76, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 14],
    doorCompetitionMin: 4,
  }),
  finalizeChapter({
    chapter: 8,
    title: '单向站台',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: ['directional', 'lock-gate', 'one-way'],
    cols: 6,
    rows: [9, 11],
    colors: [6, 6],
    solutionBand: [22, 34],
    solutionFamilyMax: 3,
    occupancy: [0.76, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 14],
    doorCompetitionMin: 4,
  }),
  finalizeChapter({
    chapter: 9,
    title: '开关仓',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: ['directional', 'lock-gate', 'one-way', 'toggle-gate'],
    cols: 6,
    rows: [10, 11],
    colors: [6, 6],
    solutionBand: [24, 36],
    solutionFamilyMax: 3,
    occupancy: [0.76, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 14],
    doorCompetitionMin: 4,
  }),
  finalizeChapter({
    chapter: 10,
    title: '染色工坊',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: ['recolor'],
    cols: 6,
    rows: [9, 11],
    colors: [6, 6],
    solutionBand: [22, 35],
    solutionFamilyMax: 3,
    occupancy: [0.74, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 14],
    doorCompetitionMin: 4,
  }),
  finalizeChapter({
    chapter: 11,
    title: '冰面实验室',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2'],
    mechanics: ['ice'],
    cols: 6,
    rows: [10, 11],
    colors: [6, 6],
    solutionBand: [24, 36],
    solutionFamilyMax: 3,
    occupancy: [0.74, 0.80],
    doorGroups: [8, 10],
    doorSlots: [11, 14],
    doorCompetitionMin: 4,
  }),
  finalizeChapter({
    chapter: 12,
    title: '终章拼盘',
    levelCount: 30,
    shapes: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4'],
    mechanics: ['directional', 'lock-gate', 'one-way', 'toggle-gate', 'recolor', 'ice'],
    mechanicMixMode: 'single-mechanic-fixed-quota',
    mechanicQuota: {
      directional: 5,
      'lock-gate': 5,
      'one-way': 5,
      'toggle-gate': 5,
      recolor: 5,
      ice: 5,
    },
    cols: 6,
    rows: [10, 11],
    colors: [6, 6],
    solutionBand: [30, 48],
    solutionFamilyMax: 1,
    occupancy: [0.76, 0.80],
    doorGroups: [9, 11],
    doorSlots: [12, 16],
    doorCompetitionMin: 5,
  }),
];
