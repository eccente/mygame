import { createBlock, createCampaignLevel, createExit } from '../catalog.js?v=20260824112338';

const CHAPTER = 11;
const TITLE = '冰面滑行';
const SHORT = '冰面';
const TAGLINE = '滑到停下来的那一格，才是真正的位置。';

function level(index, definition) {
  return createCampaignLevel({
    chapter: CHAPTER,
    index,
    chapterTitle: TITLE,
    chapterShortTitle: SHORT,
    chapterTagline: TAGLINE,
    cols: 6,
    rows: 8,
    rewardCoins: 140,
    ...definition,
  });
}

export const CAMPAIGN_CHAPTER_11 = {
  id: 'chapter-11',
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels: [
    level(1, {
      title: '11-01',
      difficultyBand: 'hard',
      tags: ['sample', 'ice'],
      exits: [
        createExit('c11-blue-exit', 'top', 4, 1, 'blue'),
        createExit('c11-red-exit', 'bottom', 5, 1, 'red'),
      ],
      blocks: [
        createBlock({ id: 'c11-blue-slider', style: 'blue', x: 0, y: 5 }),
        createBlock({ id: 'c11-red-stop', style: 'red', x: 5, y: 5 }),
      ],
      tiles: [
        { id: 'c11-ice-strip', type: 'ice', cells: [
          { x: 1, y: 5 }, { x: 2, y: 5 }, { x: 3, y: 5 }, { x: 4, y: 5 },
        ] },
      ],
    }),
  ],
};
