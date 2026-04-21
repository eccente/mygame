export const MAINLINE_MECHANIC_WHITELIST = {
  shapeWhitelist: ['mono', 'domino', 'bar3', 'square-2', 'L-3', 'L-4', 'T-4', 'cross-5'],
  excludedShapes: ['Z-4', 'S-4'],
  trueSpecialBlockTypes: ['directional-target'],
  mechanics: [
    'directional-target',
    'lock-gate',
    'one-way-gate',
    'toggle-gate',
    'recolor',
    'ice',
  ],
};

export const ENDLESS_V1_WHITELIST = {
  shapeMainPool: ['mono', 'domino', 'bar3', 'square-2'],
  conditionalPool: ['L-3', 'L-4', 'T-4', 'cross-5'],
  excludedShapes: ['Z-4', 'S-4'],
  mechanics: ['directional-target', 'lock-gate', 'toggle-gate', 'recolor', 'ice'],
  excludedMechanics: [],
};
