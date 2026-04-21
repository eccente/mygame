import { createBlock, createCampaignLevel, createExit } from '../catalog.js';

const CHAPTER = 6;
const TITLE = '方向通道';
const SHORT = '方向';
const TAGLINE = '自由块和单向移动块开始混编。';

function level(index, definition) {
  return createCampaignLevel({
    chapter: CHAPTER,
    index,
    chapterTitle: TITLE,
    chapterShortTitle: SHORT,
    chapterTagline: TAGLINE,
    cols: 6,
    rows: 8,
    rewardCoins: 110,
    ...definition,
  });
}

export const CAMPAIGN_CHAPTER_06 = {
  id: 'chapter-06',
  number: CHAPTER,
  title: TITLE,
  shortTitle: SHORT,
  tagline: TAGLINE,
  levels: [
    level(1, {
      title: '6-01',
      difficultyBand: 'hard',
      tags: ['sample', 'directional'],
      exits: [
        createExit('c06-red-exit', 'top', 2, 2, 'red'),
        createExit('c06-green-exit', 'left', 2, 1, 'green'),
        createExit('c06-blue-exit', 'bottom', 4, 1, 'blue'),
        createExit('c06-yellow-exit', 'right', 6, 1, 'yellow'),
      ],
      blocks: [
        createBlock({ id: 'c06-red-main', style: 'red', x: 2, y: 4, shapeKey: 'square-2' }),
        createBlock({ id: 'c06-green-lane', style: 'green', x: 1, y: 2, shapeKey: 'bar3', shapeVariant: 'h', moveAxis: 'horizontal', baseMoveAxis: 'horizontal' }),
        createBlock({ id: 'c06-blue-pin', style: 'blue', x: 4, y: 4, moveAxis: 'vertical', baseMoveAxis: 'vertical' }),
        createBlock({ id: 'c06-yellow-runner', style: 'yellow', x: 1, y: 6, moveAxis: 'horizontal', baseMoveAxis: 'horizontal' }),
      ],
    }),
  ],
};
