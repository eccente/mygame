import { SHIFT_LEVELS } from '../web_frontend/src/shift/levels.js';
import { validateLevelFull } from '../web_frontend/src/shift/core/solver.js';
import { CHAPTER_BANDS } from '../web_frontend/src/shift/design/chapter-bands.js';

function parseArgs(argv = []) {
  const options = {
    chapter: null,
    ids: [],
    json: false,
    strict: false,
    summaryOnly: false,
    maxStates: 12000,
    maxSolutions: 10,
    depthSlack: 1,
    familyCap: 4,
  };

  argv.forEach((arg) => {
    if (arg === '--json') {
      options.json = true;
      return;
    }
    if (arg === '--strict') {
      options.strict = true;
      return;
    }
    if (arg === '--summary-only') {
      options.summaryOnly = true;
      return;
    }
    if (arg.startsWith('--chapter=')) {
      options.chapter = Number(arg.split('=')[1]) || null;
      return;
    }
    if (arg.startsWith('--max-states=')) {
      options.maxStates = Number(arg.split('=')[1]) || options.maxStates;
      return;
    }
    if (arg.startsWith('--max-solutions=')) {
      options.maxSolutions = Number(arg.split('=')[1]) || options.maxSolutions;
      return;
    }
    if (arg.startsWith('--depth-slack=')) {
      options.depthSlack = Number(arg.split('=')[1]) || options.depthSlack;
      return;
    }
    if (arg.startsWith('--family-cap=')) {
      options.familyCap = Number(arg.split('=')[1]) || options.familyCap;
      return;
    }
    options.ids.push(arg);
  });

  return options;
}

function getChapterBand(chapter) {
  return CHAPTER_BANDS.find((entry) => entry.chapter === chapter) || null;
}

function getEffectiveBandForLevel(level) {
  const chapterBand = getChapterBand(level.chapter);
  if (!chapterBand) {
    return null;
  }
  const segment = (chapterBand.segments || []).find((entry) => level.index >= entry.start && level.index <= entry.end) || null;
  return {
    ...chapterBand,
    ...(segment || {}),
    chapter: chapterBand.chapter,
    title: chapterBand.title,
    segments: chapterBand.segments,
    segmentKey: segment?.key || null,
  };
}

function inBand(value, band) {
  if (!band || band.length < 2 || value == null || Number.isNaN(value)) {
    return true;
  }
  return value >= band[0] && value <= band[1];
}

function evaluateDesignTargets(level, report, occupancyRate, activeColors) {
  const band = getEffectiveBandForLevel(level);
  if (!band) {
    return {
      segmentKey: null,
      rowBand: null,
      rowBandOk: true,
      occupancyBand: null,
      occupancyOk: true,
      colorBand: null,
      colorCountOk: true,
      moveBand: null,
      moveBandOk: true,
      solutionFamilyMax: null,
      solutionFamilyOk: true,
      doorGroupBand: null,
      doorGroupCountOk: true,
      doorSlotBand: null,
      doorSlotCountOk: true,
      doorCompetitionMin: null,
      doorCompetitionOk: true,
      difficultyScoreBand: null,
      difficultyScoreOk: true,
      difficultyTier: null,
      difficultyTierOk: true,
    };
  }

  const rowBand = band.rows || null;
  const occupancyBand = band.occupancy || null;
  const colorBand = band.colors || null;
  const moveBand = band.solutionBand || null;
  const solutionFamilyMax = Number.isFinite(band.solutionFamilyMax) ? band.solutionFamilyMax : null;
  const doorGroupBand = band.doorGroups || null;
  const doorSlotBand = band.doorSlots || null;
  const doorCompetitionMin = Number.isFinite(band.doorCompetitionMin) ? band.doorCompetitionMin : null;
  const enforceDifficulty = band.enforceDifficulty !== false && level.chapter !== 1;
  const difficultyScoreBand = enforceDifficulty ? (band.difficultyScoreBand || null) : null;
  const difficultyTier = enforceDifficulty ? (band.difficultyTier || band.difficultyBand || null) : null;

  const rowBandOk = inBand(level.board.rows, rowBand);
  const occupancyOk = inBand(occupancyRate, occupancyBand);
  const colorCountOk = inBand(activeColors.length, colorBand);
  const moveBandOk = !moveBand || !report.isSolvable || !report.bestMoveCountEstimate
    ? true
    : inBand(report.bestMoveCountEstimate, moveBand);
  const solutionFamilyOk = solutionFamilyMax == null || report.solutionFamilyCount <= solutionFamilyMax;
  const doorGroupCountOk = inBand(report.doorGroupCount, doorGroupBand);
  const doorSlotCountOk = inBand(report.doorSlotCount, doorSlotBand);
  const doorCompetitionOk = doorCompetitionMin == null || report.doorCompetitionCount >= doorCompetitionMin;
  const difficultyScoreOk = !difficultyScoreBand || !report.isSolvable
    ? true
    : report.difficultyScore != null && inBand(report.difficultyScore, difficultyScoreBand);
  const difficultyTierOk = !difficultyTier || !report.isSolvable
    ? true
    : report.difficultyTier === difficultyTier;

  return {
    segmentKey: band.segmentKey,
    rowBand,
    rowBandOk,
    occupancyBand,
    occupancyOk,
    colorBand,
    colorCountOk,
    moveBand,
    moveBandOk,
    solutionFamilyMax,
    solutionFamilyOk,
    doorGroupBand,
    doorGroupCountOk,
    doorSlotBand,
    doorSlotCountOk,
    doorCompetitionMin,
    doorCompetitionOk,
    difficultyScoreBand,
    difficultyScoreOk,
    difficultyTier,
    difficultyTierOk,
  };
}

function isBrokenRow(row) {
  const { report, targets } = row;
  return (
    !report.isStructurallyValid
    || !report.isSolvable
    || !report.mobileViewportFit.matchesBoardSpec
    || report.reason === 'search_limit'
    || !targets.rowBandOk
    || !targets.occupancyOk
    || !targets.colorCountOk
    || !targets.moveBandOk
    || !targets.solutionFamilyOk
    || !targets.doorGroupCountOk
    || !targets.doorSlotCountOk
    || !targets.doorCompetitionOk
    || !targets.difficultyScoreOk
    || !targets.difficultyTierOk
  );
}

function buildLevelRow(level, options) {
  const report = validateLevelFull(level, {
    maxStates: options.maxStates,
    maxSolutions: options.maxSolutions,
    solutionDepthSlack: options.depthSlack,
    solutionFamilyCap: options.familyCap,
  });
  const occupiedCells = level.blocks.reduce((sum, block) => sum + block.shapeCells.length, 0);
  const boardCells = level.board.cols * level.board.rows;
  const occupancyRate = Number((occupiedCells / Math.max(1, boardCells)).toFixed(3));
  const activeColors = [...new Set(level.blocks.map((block) => block.style))].sort();
  const targets = evaluateDesignTargets(level, report, occupancyRate, activeColors);
  return {
    id: level.id,
    chapter: level.chapter,
    index: level.index,
    title: level.title,
    board: `${level.board.cols}x${level.board.rows}`,
    blockCount: level.blocks.length,
    occupiedCells,
    occupancyRate,
    activeColors,
    doorGroupCount: report.doorGroupCount,
    doorSlotCount: report.doorSlotCount,
    doorCompetitionCount: report.doorCompetitionCount,
    openingActionCount: report.openingActionCount,
    directClearCount: report.directClearCount,
    openingMovableBlockCount: report.openingMovableBlockCount,
    bestFirstClearDepth: report.bestFirstClearDepth,
    bestFirstClearSetupDepth: report.bestFirstClearSetupDepth,
    firstClearArea: report.firstClearArea,
    firstClearReleaseGain: report.firstClearReleaseGain,
    firstClearRouteCount: report.firstClearRouteCount,
    falseFirstClearCount: report.falseFirstClearCount,
    postFirstClearCollapseScore: report.postFirstClearCollapseScore,
    targets,
    report,
  };
}

function summarizeChapter(rows = []) {
  const total = rows.length;
  const broken = rows.filter(isBrokenRow);
  const solvable = rows.filter(({ report }) => report.isSolvable);
  const avgMoves = solvable.length
    ? Number((solvable.reduce((sum, row) => sum + (row.report.bestMoveCountEstimate || 0), 0) / solvable.length).toFixed(2))
    : null;
  const avgOccupancy = total
    ? Number((rows.reduce((sum, row) => sum + row.occupancyRate, 0) / total).toFixed(3))
    : null;
  const avgActiveColors = total
    ? Number((rows.reduce((sum, row) => sum + row.activeColors.length, 0) / total).toFixed(2))
    : null;
  const avgDoorGroups = total
    ? Number((rows.reduce((sum, row) => sum + row.doorGroupCount, 0) / total).toFixed(2))
    : null;
  const avgDoorSlots = total
    ? Number((rows.reduce((sum, row) => sum + row.doorSlotCount, 0) / total).toFixed(2))
    : null;
  const avgDoorCompetition = total
    ? Number((rows.reduce((sum, row) => sum + row.doorCompetitionCount, 0) / total).toFixed(2))
    : null;
  const difficultyRows = rows.filter(({ report }) => Number.isFinite(report.difficultyScore));
  const avgDifficultyScore = difficultyRows.length
    ? Number((difficultyRows.reduce((sum, row) => sum + row.report.difficultyScore, 0) / difficultyRows.length).toFixed(2))
    : null;
  const avgFastDifficulty = difficultyRows.length
    ? Number((difficultyRows.reduce((sum, row) => sum + (row.report.fastDifficultyScore || 0), 0) / difficultyRows.length).toFixed(2))
    : null;
  const solverRows = rows.filter(({ report }) => Number.isFinite(report.solverDifficultyScore));
  const avgSolverDifficulty = solverRows.length
    ? Number((solverRows.reduce((sum, row) => sum + row.report.solverDifficultyScore, 0) / solverRows.length).toFixed(2))
    : null;
  return {
    total,
    broken: broken.length,
    avgMoves,
    avgOccupancy,
    avgActiveColors,
    avgDoorGroups,
    avgDoorSlots,
    avgDoorCompetition,
    avgDifficultyScore,
    avgFastDifficulty,
    avgSolverDifficulty,
  };
}

const options = parseArgs(process.argv.slice(2));
let selectedLevels = SHIFT_LEVELS;
if (options.chapter) {
  selectedLevels = selectedLevels.filter((level) => level.chapter === options.chapter);
}
if (options.ids.length) {
  selectedLevels = selectedLevels.filter((level) => options.ids.includes(level.id));
}

if (!selectedLevels.length) {
  console.error('No matching shift levels found.');
  process.exit(1);
}

const rows = selectedLevels.map((level) => buildLevelRow(level, options));
const chapterMap = new Map();
rows.forEach((row) => {
  const list = chapterMap.get(row.chapter) || [];
  list.push(row);
  chapterMap.set(row.chapter, list);
});

const chapterSummary = [...chapterMap.entries()].map(([chapter, chapterRows]) => ({
  chapter,
  ...summarizeChapter(chapterRows),
}));

const brokenRows = rows.filter(isBrokenRow);

if (options.json) {
  console.log(JSON.stringify({
    total: rows.length,
    broken: brokenRows.length,
    chapters: chapterSummary,
    levels: rows,
  }, null, 2));
} else {
  console.log(`Validated ${rows.length} shift level(s).`);
  console.log(`Broken or transitional: ${brokenRows.length}.`);
  chapterSummary.forEach((summary) => {
    console.log(`Chapter ${summary.chapter}: total=${summary.total} broken=${summary.broken} avgMoves=${summary.avgMoves ?? 'n/a'} avgOccupancy=${summary.avgOccupancy ?? 'n/a'} avgActiveColors=${summary.avgActiveColors ?? 'n/a'} avgDoorGroups=${summary.avgDoorGroups ?? 'n/a'} avgDoorSlots=${summary.avgDoorSlots ?? 'n/a'} avgDoorCompetition=${summary.avgDoorCompetition ?? 'n/a'} avgDifficulty=${summary.avgDifficultyScore ?? 'n/a'} fast=${summary.avgFastDifficulty ?? 'n/a'} solver=${summary.avgSolverDifficulty ?? 'n/a'}`);
  });

  if (!options.summaryOnly) {
    rows.forEach((row) => {
      const issueText = row.report.issues.map((issue) => issue.type).join(', ') || 'none';
      const warningText = row.report.warnings.map((warning) => warning.type).join(', ') || 'none';
      const unmatched = row.report.unmatchedBlocks.map((item) => item.blockId).join(', ') || 'none';
      const rowBand = row.targets.rowBand ? `${row.targets.rowBand[0]}~${row.targets.rowBand[1]}` : 'n/a';
      const occupancyBand = row.targets.occupancyBand ? `${row.targets.occupancyBand[0]}~${row.targets.occupancyBand[1]}` : 'n/a';
      const colorBand = row.targets.colorBand ? `${row.targets.colorBand[0]}~${row.targets.colorBand[1]}` : 'n/a';
      const moveBand = row.targets.moveBand ? `${row.targets.moveBand[0]}~${row.targets.moveBand[1]}` : 'n/a';
      const doorGroupBand = row.targets.doorGroupBand ? `${row.targets.doorGroupBand[0]}~${row.targets.doorGroupBand[1]}` : 'n/a';
      const doorSlotBand = row.targets.doorSlotBand ? `${row.targets.doorSlotBand[0]}~${row.targets.doorSlotBand[1]}` : 'n/a';
      const difficultyScoreBand = row.targets.difficultyScoreBand ? `${row.targets.difficultyScoreBand[0]}~${row.targets.difficultyScoreBand[1]}` : 'n/a';
      const rowState = row.targets.rowBandOk ? 'ok' : 'out';
      const occupancyState = row.targets.occupancyOk ? 'ok' : 'out';
      const colorState = row.targets.colorCountOk ? 'ok' : 'out';
      const moveState = row.targets.moveBandOk ? 'ok' : 'out';
      const familyState = row.targets.solutionFamilyOk ? 'ok' : 'high';
      const doorGroupState = row.targets.doorGroupCountOk ? 'ok' : 'out';
      const doorSlotState = row.targets.doorSlotCountOk ? 'ok' : 'out';
      const doorCompetitionState = row.targets.doorCompetitionOk ? 'ok' : 'low';
      const difficultyScoreState = row.targets.difficultyScoreOk ? 'ok' : 'out';
      const difficultyTierState = row.targets.difficultyTierOk ? 'ok' : 'out';
      console.log(
        `- ${row.id} segment=${row.targets.segmentKey || 'n/a'} [${row.board}] rows=${levelRowsFromBoard(row.board)} targetRows=${rowBand} rowState=${rowState} blocks=${row.blockCount} colors=${row.activeColors.length}[${row.activeColors.join('/')}] targetColors=${colorBand} colorState=${colorState} occ=${row.occupancyRate} targetOcc=${occupancyBand} occState=${occupancyState} doors=${row.doorGroupCount}/${row.doorSlotCount}/${row.doorCompetitionCount} targetDoors=${doorGroupBand}/${doorSlotBand}/${row.targets.doorCompetitionMin ?? 'n/a'} doorState=${doorGroupState}/${doorSlotState}/${doorCompetitionState} reason=${row.report.reason} solvable=${row.report.isSolvable} moves=${row.report.bestMoveCountEstimate ?? 'n/a'} targetMoves=${moveBand} moveState=${moveState} families=${row.report.solutionFamilyCount}/${row.targets.solutionFamilyMax ?? 'n/a'} familyState=${familyState} diff=${row.report.difficultyScore ?? 'n/a'}/${row.report.fastDifficultyScore ?? 'n/a'}/${row.report.solverDifficultyScore ?? 'n/a'} targetDiff=${difficultyScoreBand}/${row.targets.difficultyTier ?? 'n/a'} diffState=${difficultyScoreState}/${difficultyTierState} mobile=${row.report.mobileViewportFit.tier} issues=${issueText} warnings=${warningText} unmatched=${unmatched}`
      );
    });
  }
}

if (options.strict && brokenRows.length) {
  process.exit(1);
}

function levelRowsFromBoard(boardLabel = '') {
  const parts = String(boardLabel).split('x');
  return Number(parts[1]) || 0;
}
