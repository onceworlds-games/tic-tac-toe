// The title, the setup (the game's lobby) and the series result, built from plain models. Each returns { root, update(model) }.
import { el, glyph, avatar, Flap } from './ui.js';
import { LEVEL_NAMES } from './core.js';

function seg(label, id, options, value, onPick, cls = '') {
  const row = el('div', 'row' + (cls.includes('full') ? ' full' : ''));
  row.appendChild(el('div', 'lab', label));
  const box = el('div', `seg ${cls}`);
  for (const o of options) {
    const b = el('button');
    b.type = 'button';
    b.setAttribute('aria-pressed', String(o.value === value));
    if (o.mark) b.appendChild(glyph(o.mark));
    b.appendChild(document.createTextNode(o.label));
    if (o.disabled) b.disabled = true;
    b.addEventListener('click', () => onPick(id, o.value));
    box.appendChild(b);
  }
  row.appendChild(box);
  return row;
}

export function buildTitle({ onPlay }) {
  const root = el('section');
  root.id = 'title';
  const logo = el('h1', 'logo');
  logo.append(el('span', 'l1', 'Tic'), el('span', 'l2', 'Tac'), el('span', 'l3', 'Toe'));
  const play = el('button', 'btn primary big', 'Play');
  play.type = 'button';
  play.addEventListener('click', onPlay);
  const rec = el('div', 'record');
  root.append(logo, play, rec);
  return {
    root,
    play,
    update(m) {
      rec.textContent = m.record || '';
      rec.hidden = !m.record;
    },
  };
}

const SERIES_LABEL = { 1: 'Single', 3: 'Best of 3', 5: 'Best of 5', 0: 'Endless' };

/**
 * model: {
 *   host (can change things), standalone, wide, prefs {opponent, level, mark, board, series, timer},
 *   alone, friend {name, avatarId, ready} | null, me {name, avatarId, ready}, hostPlayer {name, avatarId},
 *   canStart, startLabel, note
 * }
 * handlers: onPick(id, value), onStart(), onInvite(), onReady()
 */
export function buildSetup(h, ow) {
  const root = el('section');
  root.id = 'setup';
  let sig = '';
  const personSeat = (p, ready, showReady) => {
    const s = el('div', 'seat plate');
    s.appendChild(avatar(p, { ow }));
    const t = el('div');
    t.style.minWidth = '0';
    t.appendChild(el('div', 'nm', p.name));
    s.appendChild(t);
    if (showReady) {
      const ok = el('span', 'ok' + (ready ? '' : ' no'));
      const NS = 'http://www.w3.org/2000/svg';
      const svg = document.createElementNS(NS, 'svg');
      svg.setAttribute('viewBox', '0 0 24 24');
      svg.setAttribute('width', '18');
      svg.setAttribute('height', '18');
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', 'M5 12.5l4.5 4.5L19 7.5');
      for (const [k, v] of Object.entries({ fill: 'none', stroke: 'currentColor', 'stroke-width': '3.4', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' })) path.setAttribute(k, v);
      svg.appendChild(path);
      ok.appendChild(svg);
      ok.setAttribute('aria-label', ready ? 'Ready' : 'Not ready');
      s.appendChild(ok);
    }
    return s;
  };
  return {
    root,
    update(m) {
      const next = JSON.stringify(m);
      if (next === sig) return;
      sig = next;
      const keepScroll = root.scrollTop;
      root.textContent = '';
      root.classList.toggle('wide', !!m.wide);
      const p = m.prefs;
      const rows = el('div', 'rows');
      const opp = m.friend ? 'friend' : p.opponent;

      if (m.host) {
        if (!m.friend) {
          const options = [{ value: 'computer', label: 'Computer' }];
          if (m.alone) options.push({ value: 'same', label: 'Same screen' });
          if (!m.standalone) options.push({ value: 'friend', label: 'Friend' });
          if (options.length > 1) rows.appendChild(seg('Play', 'opponent', options, opp, h.onPick, 'full'));
        }
        if (opp === 'computer') rows.appendChild(seg('Level', 'level', ['easy', 'normal', 'unbeatable'].map((v) => ({ value: v, label: LEVEL_NAMES[v] })), p.level, h.onPick, 'full'));
        if (opp === 'computer' || opp === 'same') rows.appendChild(seg(opp === 'same' ? 'Player 1' : 'Your mark', 'mark', [{ value: 'x', label: 'X', mark: 'x' }, { value: 'o', label: 'O', mark: 'o' }], p.mark, h.onPick, 'two'));
        rows.appendChild(seg('Board', 'board', [3, 4, 5].map((v) => ({ value: v, label: `${v}x${v}` })), p.board, h.onPick, ''));
        rows.appendChild(seg('Series', 'series', [1, 3, 5, 0].map((v) => ({ value: v, label: SERIES_LABEL[v] })), p.series, h.onPick, 'wrap'));
        if (opp === 'friend') rows.appendChild(seg('Turn timer', 'timer', [0, 15, 30].map((v) => ({ value: v, label: v ? `${v} s` : 'Off' })), p.timer, h.onPick, ''));
      } else {
        const line = [`${m.settings.board}x${m.settings.board}`, SERIES_LABEL[m.settings.series] ?? '', m.settings.timer ? `${m.settings.timer} s turns` : ''].filter(Boolean).join('  ·  ');
        const r = el('div', 'row full');
        r.appendChild(el('div', 'lab', 'Game'));
        const box = el('div', 'seat plate');
        box.appendChild(el('div', 'nm', line));
        r.appendChild(box);
        rows.appendChild(r);
      }

      if (opp === 'friend' || !m.host) {
        const r = el('div', 'row full');
        const seats = el('div', 'seats');
        seats.appendChild(personSeat(m.host ? m.me : m.hostPlayer, true, false));
        seats.appendChild(el('div', 'vs', 'vs'));
        if (m.host) {
          if (m.friend) seats.appendChild(personSeat(m.friend, m.friend.ready, true));
          else {
            const b = el('button', 'seat empty plate');
            b.type = 'button';
            b.append(el('span', 'plus', '+'), el('span', 'nm', 'Invite'));
            b.addEventListener('click', h.onInvite);
            seats.appendChild(b);
          }
        } else seats.appendChild(personSeat(m.me, m.me.ready, true));
        r.appendChild(seats);
        rows.appendChild(r);
      }
      root.appendChild(rows);

      const start = el('div', 'start-row');
      if (m.host) {
        const b = el('button', 'btn primary big', m.startLabel);
        b.type = 'button';
        b.disabled = !m.canStart;
        b.addEventListener('click', h.onStart);
        start.appendChild(b);
      } else {
        const b = el('button', 'btn primary big', m.me.ready ? `Waiting for ${m.hostPlayer.name}` : 'Ready');
        b.type = 'button';
        b.addEventListener('click', h.onReady);
        start.appendChild(b);
      }
      root.appendChild(start);
      if (m.note) root.appendChild(el('div', 'note', m.note));
      root.scrollTop = keepScroll;
    },
  };
}

/**
 * The series result. model: { champion: player|'draw', a, b, state:{a,b,d}, why, canRematch, canSetup, rematchLabel, record, mine }
 */
export function buildResult(h, ow) {
  const root = el('div');
  root.id = 'result';
  const flaps = { a: new Flap(), b: new Flap(), d: new Flap(true) };
  let sig = '';
  return {
    root,
    update(m) {
      const next = JSON.stringify([m.champion && m.champion.id, m.championDraw, m.a && m.a.id, m.b && m.b.id, m.state, m.why, m.canRematch, m.canSetup, m.rematchLabel, m.record, m.waiting]);
      if (next === sig) return;
      sig = next;
      root.textContent = '';
      const panel = el('div', 'panel plate');
      panel.appendChild(el('div', 'over', m.over));
      if (m.championDraw) {
        panel.appendChild(el('h2', null, 'Draw'));
      } else {
        panel.appendChild(avatar(m.champion, { ow, big: true }));
        panel.appendChild(el('h2', null, m.champion.name));
      }
      const tiles = el('div', 'tiles');
      const col = (slot, label) => {
        const d = el('div');
        d.appendChild(flaps[slot].root);
        d.appendChild(el('div', 'cap', label));
        return d;
      };
      flaps.a.set(m.state.a, false);
      flaps.b.set(m.state.b, false);
      flaps.d.set(m.state.d, false);
      tiles.append(col('a', m.a.name), col('d', 'Draws'), col('b', m.b.name));
      panel.appendChild(tiles);
      if (m.why) panel.appendChild(el('div', 'why', m.why));
      if (m.record) panel.appendChild(el('div', 'record', m.record));
      const btns = el('div', 'btns');
      if (m.canRematch) {
        const r = el('button', 'btn primary', m.rematchLabel);
        r.type = 'button';
        r.disabled = !!m.waiting;
        r.addEventListener('click', h.onRematch);
        btns.appendChild(r);
      }
      if (m.canSetup) {
        const s = el('button', 'btn', 'Setup');
        s.type = 'button';
        s.addEventListener('click', h.onSetup);
        btns.appendChild(s);
      }
      panel.appendChild(btns);
      root.appendChild(panel);
    },
  };
}
