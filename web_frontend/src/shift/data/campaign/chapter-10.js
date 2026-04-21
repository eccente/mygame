import { createBlock, createCampaignLevel, createExit } from '../catalog.js';

const CHAPTER = 10;
const TITLE = '变色垫';
const SHORT = '变色';
const TAGLINE = '先换颜色，再对准新的门槽。';

function level(index, definition) {
  return createCampaignLevel({
    chapter: CHAPTER,
    index,
    chapterTitle: TITLE,
    chapterShortTitle: SHORT,
    chapterTagline: TAGLINE,
    cols: 6,
    rows: 8,
    rewardCoins: 130,
    ...definition,
  });
}

export const CAMPAIGN_CHAPTER_10 = {
  id: 'chapter-10',
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels: [
    level(1, {
      title: '10-01',
      difficultyBand: 'hard',
      tags: ['sample', 'recolor'],
      exits: [
        createExit('c10-red-exit', 'top', 2, 2, 'red'),
        createExit('c10-green-fake-exit', 'bottom', 0, 2, 'green'),
        createExit('c10-yellow-exit', 'right', 6, 1, 'yellow'),
      ],
      blocks: [
        createBlock({ id: 'c10-green-main', style: 'green', x: 2, y: 5, shapeKey: 'square-2' }),
        createBlock({ id: 'c10-yellow-side', style: 'yellow', x: 4, y: 6 }),
      ],
      tiles: [
        { id: 'c10-red-pad', type: 'recolor', x: 2, y: 3, w: 1, h: 1, toColor: 'red' },
      ],
      gates: [
        {
          id: 'c10-green-lock',
          type: 'lock_gate',
          cells: [{ x: 0, y: 6 }, { x: 1, y: 6 }],
        },
      ],
    }),
  ],
};
