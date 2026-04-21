import { createBlock, createCampaignLevel, createExit } from '../catalog.js';

const CHAPTER = 7;
const TITLE = '钥匙开门';
const SHORT = '钥门';
const TAGLINE = '先踩钥匙垫，再打开锁门通路。';

function level(index, definition) {
  return createCampaignLevel({
    chapter: CHAPTER,
    index,
    chapterTitle: TITLE,
    chapterShortTitle: SHORT,
    chapterTagline: TAGLINE,
    cols: 6,
    rows: 8,
    rewardCoins: 120,
    ...definition,
  });
}

export const CAMPAIGN_CHAPTER_07 = {
  id: 'chapter-07',
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels: [
    level(1, {
      title: '7-01',
      difficultyBand: 'hard',
      tags: ['sample', 'lock-gate'],
      exits: [
        createExit('c07-blue-exit', 'top', 2, 2, 'blue'),
        createExit('c07-yellow-exit', 'right', 6, 1, 'yellow'),
      ],
      blocks: [
        createBlock({ id: 'c07-blue-main', style: 'blue', x: 2, y: 5, shapeKey: 'square-2' }),
        createBlock({ id: 'c07-yellow-key', style: 'yellow', x: 4, y: 6 }),
      ],
      tiles: [
        { id: 'c07-keypad', type: 'key_pad', x: 1, y: 6 },
      ],
      gates: [
        {
          id: 'c07-lock-wall',
          type: 'lock_gate',
          keyPadIds: ['c07-keypad'],
          cells: [
            { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
            { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
          ],
        },
      ],
    }),
  ],
};
