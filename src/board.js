// Plain board helpers. Used by the app and by the tests.
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CCBoard = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  const W = 230;
  const H = 136;
  const SNAP = 20;
  const CELL_X = 260;
  const CELL_Y = 190;
  const START = 20;

  const placed = (c) => Number.isFinite(c.x) && Number.isFinite(c.y);
  const overlaps = (a, b) => Math.abs(a.x - b.x) < W + 10 && Math.abs(a.y - b.y) < H + 10;

  // Top row first, then left to right. Near-level buttons count as one row.
  function readingOrder(clips) {
    const row = (c) => Math.round(c.y / (H / 2));
    return [...clips].sort((a, b) => row(a) - row(b) || a.x - b.x);
  }

  // Gives new clips the first empty place. Returns true if anything changed.
  function placeMissing(clips, columns) {
    let changed = false;
    const fixed = clips.filter(placed);
    for (const clip of clips) {
      if (placed(clip)) continue;
      for (let n = 0; !placed(clip); n++) {
        const spot = {
          x: START + (n % columns) * CELL_X,
          y: START + Math.floor(n / columns) * CELL_Y,
        };
        if (!fixed.some((other) => overlaps(spot, other))) Object.assign(clip, spot);
      }
      fixed.push(clip);
      changed = true;
    }
    return changed;
  }

  // Lines a dropped button up, and moves it down if another button is there.
  function settle(clip, x, y, others) {
    const spot = {
      x: Math.max(0, Math.round(x / SNAP) * SNAP),
      y: Math.max(0, Math.round(y / SNAP) * SNAP),
    };
    while (others.some((other) => other.id !== clip.id && overlaps(spot, other))) spot.y += SNAP;
    return spot;
  }

  // Which clips can come next. An arrow wins over reading order.
  function nextChoices(clips, cursor) {
    if (!clips.length) return [];
    if (cursor < 0) return [0];
    const links = (clips[cursor] && clips[cursor].links) || [];
    const linked = links.map((id) => clips.findIndex((c) => c.id === id)).filter((i) => i >= 0);
    if (linked.length) return linked;
    return cursor + 1 < clips.length ? [cursor + 1] : [];
  }

  function arrowPath(a, b) {
    const sameRow = Math.abs(a.y - b.y) < H;
    if (sameRow) {
      const right = b.x >= a.x;
      const x1 = a.x + (right ? W : 0);
      const x2 = b.x + (right ? 0 : W);
      const y1 = a.y + H / 2;
      const y2 = b.y + H / 2;
      const bend = Math.max(30, Math.abs(x2 - x1) / 2) * (right ? 1 : -1);
      return `M${x1} ${y1} C${x1 + bend} ${y1} ${x2 - bend} ${y2} ${x2} ${y2}`;
    }
    const down = b.y > a.y;
    const x1 = a.x + W / 2;
    const x2 = b.x + W / 2;
    const y1 = a.y + (down ? H : 0);
    const y2 = b.y + (down ? 0 : H);
    const bend = Math.max(40, Math.abs(y2 - y1) / 2) * (down ? 1 : -1);
    return `M${x1} ${y1} C${x1} ${y1 + bend} ${x2} ${y2 - bend} ${x2} ${y2}`;
  }

  return { W, H, CELL_X, readingOrder, placeMissing, settle, nextChoices, arrowPath };
});
