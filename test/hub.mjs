// A room server in one process for the online tests: several pages (each a RoomLike) talk to one hub that keeps the players,
// the shared state (host: keys only from the host), messages, ready flags and the match lifecycle the way the platform does.
import { existsSync } from 'node:fs';

export const SDK_DIST = process.env.OW_SDK_DIST || '/Users/gowravthota/Desktop/commit/vibecode-game/packages/sdk/dist';
export const haveSdk = existsSync(`${SDK_DIST}/match.js`);

export async function loadHelpers() {
  const m = await import(`${SDK_DIST}/match.js`);
  const hst = await import(`${SDK_DIST}/host.js`);
  const b = await import(`${SDK_DIST}/bots.js`);
  return { createMatch: m.createMatch, createHost: hst.createHost, createBots: b.createBots, t: hst.t };
}

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

class FakeRoom {
  constructor(hub, id) {
    this.hub = hub;
    this.id = hub.roomId;
    this.handlers = {};
    this.closed = false;
    this.connected = true;
    this.kind = 'private';
    this.ranked = false;
    this.private = {};
    this.state = clone(hub.state);
    this.pid = id;
    this.errors = [];
  }
  get me() {
    return this.hub.players.get(this.pid);
  }
  get players() {
    return this.hub.players;
  }
  get host() {
    return this.hub.host;
  }
  get isHost() {
    return this.connected && !this.closed && this.hub.host === this.pid;
  }
  get match() {
    return this.hub.match;
  }
  get running() {
    return this.hub.match.phase === 'playing' && !this.hub.pausedNow();
  }
  get participants() {
    return this.hub.match.phase === 'lobby' ? [] : this.hub.match.participants.map((id) => this.hub.players.get(id)).filter(Boolean);
  }
  get spectating() {
    return this.hub.match.phase !== 'lobby' && !this.hub.match.participants.includes(this.pid);
  }
  get settings() {
    return this.hub.frozen ?? { ...this.hub.settings };
  }
  get online() {
    return [...this.hub.players.values()].filter((p) => p.connected !== false);
  }
  get canStart() {
    return this.hub.canStart();
  }
  get notReady() {
    return [...this.hub.players.values()].filter((p) => p.id !== this.hub.host && !p.ready);
  }
  isParticipant(id) {
    return this.hub.match.phase !== 'lobby' && this.hub.match.participants.includes(id);
  }
  matchNow() {
    return this.hub.matchNow();
  }
  on(ev, fn) {
    (this.handlers[ev] ??= new Set()).add(fn);
    return () => this.handlers[ev]?.delete(fn);
  }
  emit(ev, ...args) {
    for (const fn of [...(this.handlers[ev] ?? [])]) fn(...args);
  }
  send(data, opts = {}) {
    this.hub.route(this.pid, clone(data), opts.to);
  }
  setState(k, v) {
    if (k.startsWith('host:') && this.hub.host !== this.pid) {
      this.errors.push('not_host');
      return;
    }
    if (v === null || v === undefined) delete this.state[k];
    else this.state[k] = clone(v);
    this.hub.write(this.pid, k, v === undefined ? null : clone(v));
  }
  setReady(on) {
    const me = this.me;
    if (me) me.ready = on !== false;
    this.hub.broadcast(this.pid, 'ready', me);
  }
  startMatch() {
    this.hub.start(this.pid);
  }
  endMatch() {
    this.hub.end(this.pid);
  }
  admit(ids) {
    this.hub.admit(this.pid, ids);
  }
  setOpen() {}
  reportResult() {}
  setPrivate(k, v) {
    this.private[k] = v;
  }
  setSetting(id, v) {
    if (this.isHost && this.hub.match.phase === 'lobby') {
      this.hub.settings[id] = v;
      this.hub.broadcast(null, 'settings', this.hub.settings);
    }
  }
  clearReady() {
    for (const p of this.hub.players.values()) delete p.ready;
  }
  leave() {
    this.hub.leave(this.pid);
  }
}

export class Hub {
  constructor(settings = {}) {
    this.roomId = 'room1';
    this.settings = { opponent: 'computer', board: 3, series: 3, level: 'normal', mark: 'x', timer: 0, ...settings };
    this.frozen = null;
    this.players = new Map();
    this.pages = new Map();
    this.state = {};
    this.host = '';
    this.counter = 0;
    this.match = { phase: 'lobby', n: 0, id: '', seed: 0, participants: [] };
    this.startedAt = 0;
    this.errors = [];
  }
  now() {
    return Date.now();
  }
  matchNow() {
    return this.match.phase === 'playing' ? Math.max(0, this.now() - this.startedAt) : 0;
  }
  pausedNow() {
    return false;
  }
  join(id, name = id) {
    const fresh = !this.players.has(id);
    if (fresh) this.players.set(id, { id, name, connected: true, team: 0 });
    else this.players.get(id).connected = true;
    if (!this.host) this.host = id;
    const page = new FakeRoom(this, id);
    this.pages.set(id, page);
    if (fresh) this.broadcast(id, 'join', this.players.get(id));
    return page;
  }
  /** A page reloads: the old one is gone, a new one has the room as it is. */
  reload(id) {
    const old = this.pages.get(id);
    if (old) {
      old.closed = true;
      old.emit('close', 'replaced');
    }
    return this.join(id);
  }
  drop(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = false;
    const page = this.pages.get(id);
    if (page) page.connected = false;
    this.broadcast(id, 'away', p);
    if (this.host === id) this.passHost(id);
  }
  back(id) {
    const p = this.players.get(id);
    if (!p) return;
    p.connected = true;
    const page = this.pages.get(id);
    if (page) page.connected = true;
    this.broadcast(id, 'back', p, false);
  }
  passHost(from) {
    const next = [...this.players.values()].find((p) => p.id !== from && p.connected !== false);
    if (next) {
      this.host = next.id;
      this.broadcast(null, 'host', next.id);
    }
  }
  leave(id) {
    const p = this.players.get(id);
    if (!p) return;
    const page = this.pages.get(id);
    this.players.delete(id);
    this.pages.delete(id);
    if (page) {
      page.closed = true;
      page.connected = false;
    }
    if (this.host === id) this.passHost(id);
    this.broadcast(null, 'leave', p, false);
  }
  broadcast(from, ev, ...args) {
    for (const [pid, page] of [...this.pages]) {
      if (page.closed) continue;
      if (from && pid === from) continue;
      page.emit(ev, ...args);
    }
  }
  write(from, k, v) {
    if (v === null) delete this.state[k];
    else this.state[k] = v;
    for (const [pid, page] of [...this.pages]) {
      if (pid === from || page.closed) continue;
      if (v === null) delete page.state[k];
      else page.state[k] = clone(v);
      page.emit('state', k, v === null ? undefined : clone(v), from);
    }
  }
  route(from, data, to) {
    const sender = this.players.get(from);
    if (!sender) return;
    const at = this.now();
    for (const [pid, page] of [...this.pages]) {
      if (pid === from || page.closed || (to && pid !== to)) continue;
      page.emit('message', clone(data), { id: sender.id, name: sender.name }, at, this.matchNow());
    }
  }
  canStart() {
    const online = [...this.players.values()].filter((p) => p.connected !== false);
    return online.length >= 1 && online.every((p) => p.id === this.host || p.ready);
  }
  start(from) {
    if (from !== this.host || this.match.phase !== 'lobby' || !this.canStart()) return;
    const participants = [...this.players.values()].filter((p) => p.id === this.host || p.ready).map((p) => p.id);
    this.counter++;
    this.frozen = { ...this.settings };
    this.match = { phase: 'playing', n: this.counter, id: `m${this.counter}`, seed: 1000 + this.counter, participants };
    this.startedAt = this.now();
    for (const p of this.players.values()) delete p.ready;
    this.broadcast(null, 'match', this.match);
    this.broadcast(null, 'starting', this.match);
    this.broadcast(null, 'matchstart', this.match);
  }
  end(from) {
    if (from !== this.host || this.match.phase === 'lobby') return;
    const previous = this.match;
    this.match = { phase: 'lobby', n: previous.n, id: '', seed: 0, participants: [] };
    this.frozen = null;
    for (const p of this.players.values()) delete p.ready;
    this.broadcast(null, 'matchend', this.match, previous);
    this.broadcast(null, 'match', this.match, previous);
  }
  admit(from, ids) {
    if (from !== this.host) return;
    for (const id of ids) if (!this.match.participants.includes(id)) this.match.participants.push(id);
    this.broadcast(null, 'match', this.match);
  }
}
