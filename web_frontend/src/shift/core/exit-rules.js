const EDGE_ORDER = new Map([
  ['top', 0],
  ['right', 1],
  ['bottom', 2],
  ['left', 3],
]);

export function getExitEnd(exit) {
  return (Number(exit?.start) || 0) + (Number(exit?.span) || 0);
}

export function exitsOverlap(left, right) {
  if (!left || !right || left.edge !== right.edge) {
    return false;
  }
  return (Number(left.start) || 0) < getExitEnd(right) && (Number(right.start) || 0) < getExitEnd(left);
}

export function exitsTouch(left, right) {
  if (!left || !right || left.edge !== right.edge) {
    return false;
  }
  return getExitEnd(left) === (Number(right.start) || 0) || getExitEnd(right) === (Number(left.start) || 0);
}

export function areAdjacentSameColorSingleExits(left, right) {
  return !!left
    && !!right
    && left.edge === right.edge
    && left.acceptColor === right.acceptColor
    && (Number(left.span) || 0) === 1
    && (Number(right.span) || 0) === 1
    && exitsTouch(left, right);
}

export function hasExitLayoutConflict(exits = [], candidate, ignoreId = '') {
  return (exits || []).some((exit) => {
    if (!exit || exit.id === ignoreId || exit.id === candidate?.id) {
      return false;
    }
    return exitsOverlap(exit, candidate) || areAdjacentSameColorSingleExits(exit, candidate);
  });
}

export function collectExitLayoutIssues(exits = []) {
  const issues = [];
  for (let index = 0; index < exits.length; index += 1) {
    const left = exits[index];
    for (let nextIndex = index + 1; nextIndex < exits.length; nextIndex += 1) {
      const right = exits[nextIndex];
      if (exitsOverlap(left, right)) {
        issues.push({
          type: 'exit_overlap',
          exitId: left.id || right.id || `exit-${index + 1}`,
          detail: `${left.id || 'unknown'}|${right.id || 'unknown'}`,
        });
        continue;
      }
      if (areAdjacentSameColorSingleExits(left, right)) {
        issues.push({
          type: 'adjacent_same_color_single_exits',
          exitId: left.id || right.id || `exit-${index + 1}`,
          color: left.acceptColor || right.acceptColor || '',
          detail: `${left.id || 'unknown'}|${right.id || 'unknown'}`,
        });
      }
    }
  }
  return issues;
}

export function normalizeExitLayout(exits = []) {
  const sorted = [...(exits || [])]
    .map((exit) => ({ ...exit }))
    .sort((left, right) => {
      const edgeCmp = (EDGE_ORDER.get(left.edge) ?? 99) - (EDGE_ORDER.get(right.edge) ?? 99);
      if (edgeCmp) {
        return edgeCmp;
      }
      if ((left.acceptColor || '') !== (right.acceptColor || '')) {
        return String(left.acceptColor || '').localeCompare(String(right.acceptColor || ''));
      }
      if ((Number(left.start) || 0) !== (Number(right.start) || 0)) {
        return (Number(left.start) || 0) - (Number(right.start) || 0);
      }
      if ((Number(left.span) || 0) !== (Number(right.span) || 0)) {
        return (Number(left.span) || 0) - (Number(right.span) || 0);
      }
      return String(left.id || '').localeCompare(String(right.id || ''));
    });

  const result = [];
  sorted.forEach((exit) => {
    const last = result[result.length - 1];
    const overlaps = last && last.edge === exit.edge && last.acceptColor === exit.acceptColor && getExitEnd(last) > (Number(exit.start) || 0);
    const mergeSingles = last && areAdjacentSameColorSingleExits(last, exit);
    if (overlaps || mergeSingles) {
      const mergedStart = Math.min(Number(last.start) || 0, Number(exit.start) || 0);
      const mergedEnd = Math.max(getExitEnd(last), getExitEnd(exit));
      last.start = mergedStart;
      last.span = mergedEnd - mergedStart;
      return;
    }
    result.push({ ...exit });
  });
  return result;
}
