// Thinking without freezing the page. The search runs in a worker built from rules.js and ai.js; when a worker is not available
// (tests, an old browser, a blocked blob) the same code runs on the page. A driver paces a computer player like a person:
// it asks for a move the moment the turn is its, then waits out a short think before playing it.
import { chooseMove, hintMove, thinkSeconds } from './ai.js';

const MAIN = `
self.onmessage = (e) => {
  const { id, req } = e.data;
  let cell = -1;
  try {
    cell = req.hint ? hintMove(req) : (chooseMove(req) || {}).cell;
  } catch (err) {}
  self.postMessage({ id, cell: Number.isInteger(cell) ? cell : -1 });
};
`;

const strip = (src) =>
  src
    .split('\n')
    .filter((line) => !/^\s*import\s/.test(line) && !/^\s*export\s*\{/.test(line))
    .map((line) => line.replace(/^export\s+/, ''))
    .join('\n');

function syncChoose(req) {
  try {
    const cell = req.hint ? hintMove(req) : (chooseMove(req) || {}).cell;
    return Number.isInteger(cell) ? cell : -1;
  } catch {
    return -1;
  }
}

export function createBrain() {
  let worker = null;
  let nextId = 1;
  const waiting = new Map();
  let dead = false;

  function fail() {
    dead = true;
    try {
      worker?.terminate();
    } catch {}
    worker = null;
    // Whatever was waiting gets an answer from the page itself.
    for (const [, w] of waiting) w.resolve(syncChoose(w.req));
    waiting.clear();
  }

  async function start() {
    try {
      if (typeof Worker === 'undefined' || typeof fetch === 'undefined' || typeof Blob === 'undefined' || typeof URL === 'undefined' || !URL.createObjectURL) return;
      const [rules, ai] = await Promise.all([
        fetch(new URL('./rules.js', import.meta.url)).then((r) => (r.ok ? r.text() : Promise.reject(new Error('rules')))),
        fetch(new URL('./ai.js', import.meta.url)).then((r) => (r.ok ? r.text() : Promise.reject(new Error('ai')))),
      ]);
      const url = URL.createObjectURL(new Blob([strip(rules), '\n', strip(ai), '\n', MAIN], { type: 'text/javascript' }));
      const w = new Worker(url);
      w.onmessage = (e) => {
        const d = e.data;
        const job = d && waiting.get(d.id);
        if (!job) return;
        waiting.delete(d.id);
        job.resolve(d.cell);
      };
      w.onerror = () => fail();
      worker = w;
    } catch {
      dead = true;
    }
  }
  if (typeof window !== 'undefined') start();

  return {
    /** Resolves with a cell index (or -1). */
    choose(req) {
      if (!worker || dead) return Promise.resolve(syncChoose(req));
      return new Promise((resolve) => {
        const id = nextId++;
        waiting.set(id, { resolve, req });
        // If the worker never answers, the page does.
        setTimeout(() => {
          const job = waiting.get(id);
          if (job) {
            waiting.delete(id);
            job.resolve(syncChoose(req));
          }
        }, 2500);
        try {
          worker.postMessage({ id, req });
        } catch {
          waiting.delete(id);
          resolve(syncChoose(req));
        }
      });
    },
    dispose() {
      fail();
    },
  };
}

/**
 * Paces a computer player. Call update(spec, nowMs) every tick:
 *   spec = null when it is nobody's computer turn, else { key, request, delay } where key names the position.
 * It returns a cell exactly once, after the think time has passed and the search has answered.
 */
export function createDriver(brain) {
  let job = null;
  return {
    update(spec, now) {
      if (!spec) {
        job = null;
        return null;
      }
      if (!job || job.key !== spec.key) {
        const mine = { key: spec.key, due: now + spec.delay, cell: -1, done: false };
        job = mine;
        brain.choose(spec.request).then((cell) => {
          mine.cell = cell;
          mine.done = true;
        });
      }
      if (job.done && now >= job.due) {
        const cell = job.cell;
        // If the position is still the same after this (the move was refused), it thinks again after another pause.
        job = null;
        return cell >= 0 ? cell : null;
      }
      return null;
    },
    reset() {
      job = null;
    },
  };
}

export { thinkSeconds };
