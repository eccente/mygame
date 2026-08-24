import { createBlock, createCampaignLevel, createExit } from '../catalog.js?v=20260824112338';

const CHAPTER = 9;
const TITLE = '切换门';
const SHORT = '切换';
const TAGLINE = '踩一下开，必要时还能再切一次。';

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

export const CAMPAIGN_CHAPTER_09 = {
  id: 'chapter-09',
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels: [
    level(1, {
      title: '9-01',
      difficultyBand: 'hard',
      tags: ['sample', 'toggle-gate'],
      exits: [
        createExit('c09-blue-exit', 'top', 2, 2, 'blue'),
        createExit('c09-yellow-exit', 'right', 6, 1, 'yellow'),
      ],
      blocks: [
        createBlock({ id: 'c09-blue-main', style: 'blue', x: 2, y: 5, shapeKey: 'square-2' }),
        createBlock({ id: 'c09-yellow-switcher', style: 'yellow', x: 0, y: 6 }),
      ],
      tiles: [
        { id: 'c09-switch', type: 'toggle_switch', x: 1, y: 6, switchIds: ['c09-toggle-wall'] },
      ],
      gates: [
        {
          id: 'c09-toggle-wall',
          type: 'toggle_gate',
          defaultOpen: false,
          open: false,
          switchIds: ['c09-switch'],
          cells: [
            { x: 0, y: 3 }, { x: 1, y: 3 }, { x: 2, y: 3 },
            { x: 3, y: 3 }, { x: 4, y: 3 }, { x: 5, y: 3 },
          ],
        },
      ],
    }),
  ],
};
