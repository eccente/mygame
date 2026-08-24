import { createBlock, createCampaignLevel, createExit } from '../catalog.js?v=20260824112338';

const CHAPTER = 8;
const TITLE = '单向门';
const SHORT = '单向';
const TAGLINE = '只能顺着箭头方向穿过门带。';

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

export const CAMPAIGN_CHAPTER_08 = {
  id: 'chapter-08',
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels: [
    level(1, {
      title: '8-01',
      difficultyBand: 'hard',
      tags: ['sample', 'one-way-gate'],
      exits: [
        createExit('c08-blue-exit', 'top', 2, 2, 'blue'),
        createExit('c08-yellow-exit', 'right', 6, 1, 'yellow'),
      ],
      blocks: [
        createBlock({ id: 'c08-blue-main', style: 'blue', x: 2, y: 5, shapeKey: 'square-2' }),
        createBlock({ id: 'c08-yellow-side', style: 'yellow', x: 4, y: 6 }),
      ],
      gates: [
        {
          id: 'c08-oneway-wall',
          type: 'one_way_gate',
          allowDir: 'top',
          cells: [
            { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
            { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
          ],
        },
      ],
    }),
  ],
};
