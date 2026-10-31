// Where everything goes for a window size, pure. Rects are in CSS pixels.
// Portrait: scoreboard on top, board in the middle, actions under it. Landscape: a column on the left, the board filling the rest.

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

/**
 * @param {number} w window width
 * @param {number} h window height
 * @param {{x:number,y:number,w:number,h:number}[]|null} reserved the platform's UI over the game (ow.ui.reserved)
 * @param {{ actions?: boolean, status?: boolean }} opts
 */
export function playLayout(w, h, reserved = null, opts = {}) {
  const landscape = w >= h * 1.05;
  // The platform's menu sits top-left: keep clear of it (150 x 70 until it says where it is).
  const menu = (reserved || []).find((r) => r && r.kind === 'menu');
  const menuBottom = menu ? menu.y + menu.h : 56;
  const menuRight = menu ? menu.x + menu.w : 130;
  const topPad = Math.round(menuBottom + 8);
  const pad = clamp(Math.round(Math.min(w, h) * 0.03), 8, 20);
  const actionsH = opts.actions === false ? 0 : 60;
  const statusH = opts.status === false ? 0 : 34;

  if (landscape) {
    const colW = clamp(Math.round(w * 0.27), 200, 300);
    const colX = pad;
    const colY = topPad;
    const colH = h - colY - pad;
    const areaX = colX + colW + pad;
    const areaW = w - areaX - pad;
    const boardTop = pad + statusH;
    const s = Math.floor(Math.max(120, Math.min(areaW, h - boardTop - pad)));
    const bx = Math.round(areaX + (areaW - s) / 2);
    const by = Math.round(boardTop + (h - boardTop - pad - s) / 2);
    return {
      landscape,
      pad,
      board: { x: bx, y: by, s },
      score: { x: colX, y: colY, w: colW, h: Math.max(120, colH - actionsH - 10), mode: 'col' },
      actions: { x: colX, y: h - pad - actionsH, w: colW, h: actionsH },
      status: { x: bx, y: Math.max(8, by - statusH - 2), w: s, h: statusH },
      topPad,
      menuRight,
    };
  }

  const scoreH = clamp(Math.round(h * 0.15), 96, 124);
  const scoreY = topPad;
  const bottomPad = pad;
  const freeTop = scoreY + scoreH + 4;
  const freeBottom = h - bottomPad - actionsH - 6;
  const availH = freeBottom - freeTop - statusH;
  const s = Math.floor(Math.max(120, Math.min(w - pad * 2, availH)));
  const by = Math.round(freeTop + statusH + Math.max(0, (availH - s) / 2));
  const bx = Math.round((w - s) / 2);
  return {
    landscape,
    pad,
    board: { x: bx, y: by, s },
    score: { x: pad, y: scoreY, w: w - pad * 2, h: scoreH, mode: 'row' },
    actions: { x: pad, y: h - bottomPad - actionsH, w: w - pad * 2, h: actionsH },
    status: { x: bx, y: Math.max(freeTop, by - statusH - 2), w: s, h: statusH },
    topPad,
    menuRight,
  };
}

/** Title and setup screens: a board on one side, text or a panel on the other. */
export function stageLayout(w, h, reserved = null, { panel = 0 } = {}) {
  const landscape = w >= h * 1.05;
  const menu = (reserved || []).find((r) => r && r.kind === 'menu');
  const topPad = Math.round((menu ? menu.y + menu.h : 56) + 8);
  const pad = clamp(Math.round(Math.min(w, h) * 0.04), 10, 24);
  if (landscape) {
    const half = Math.round(w * (panel ? 0.46 : 0.5));
    const s = Math.floor(Math.max(120, Math.min(half - pad * 2, h - pad * 2 - (panel ? 0 : 0))));
    return { landscape, board: { x: Math.round((half - s) / 2), y: Math.round((h - s) / 2), s }, text: { x: half, y: topPad, w: w - half - pad, h: h - topPad - pad }, topPad, pad };
  }
  const top = topPad;
  const free = h - top - pad;
  const textH = panel || Math.round(free * 0.42);
  const s = Math.floor(Math.max(110, Math.min(w - pad * 2, free - textH - pad)));
  return { landscape, board: { x: Math.round((w - s) / 2), y: top + Math.max(0, Math.round((free - textH - pad - s) / 2)), s }, text: { x: pad, y: h - pad - textH, w: w - pad * 2, h: textH }, topPad, pad };
}

/** The cell under a point, or -1. */
export function cellAt(board, n, px, py) {
  const inset = board.s * 0.045;
  const gx = board.x + inset;
  const gy = board.y + inset;
  const gs = board.s - inset * 2;
  const x = Math.floor(((px - gx) / gs) * n);
  const y = Math.floor(((py - gy) / gs) * n);
  if (px < gx || py < gy || x < 0 || y < 0 || x >= n || y >= n || px > gx + gs || py > gy + gs) return -1;
  return y * n + x;
}

/** The centre of a cell and the cell's size. */
export function cellRect(board, n, cell) {
  const inset = board.s * 0.045;
  const gs = board.s - inset * 2;
  const cs = gs / n;
  const x = board.x + inset + (cell % n) * cs;
  const y = board.y + inset + Math.floor(cell / n) * cs;
  return { x, y, cs, cx: x + cs / 2, cy: y + cs / 2 };
}
