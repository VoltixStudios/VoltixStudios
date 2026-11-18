// The rankings of Reef & Seek: the Daily Reef's ranking and the weekly tournament (docs/DECISIONS.md RS-013,
// RS-034). Forked on 18 November 2026 from Matsuri Lights' server (MatsuriLights/server/play.js), whose
// shape it keeps: the same tables, the same groups of 30, the same ten ranks, the same lazy weeks.
//
// It runs as a Cloudflare Pages Function at /reef/* on the studio's site, on the free plan, and keeps its
// rows in D1: a database bound as PLAY if there is one, otherwise the studio's analytics database (VA). The
// tables are Matsuri Lights' own (play_player, play_daily and the rest, every row tagged with its game), so
// both games share one schema and neither can see the other's players.
//
// What a player is: an anonymous random id made on the phone for this alone (not the analytics id), a name
// of two sea words and two digits chosen in the game from fixed lists, and one of the game's twelve fish
// icons. There is no free text to moderate. Nothing else is kept.
//
// What is checked: every result comes with every tap of the reef, in order (a continue is -1). The server
// deals the same reef from the same seed with the game's own rules (server/reef-rules.js, copied from
// game/index.html by server/sync-rules.mjs) and plays the taps again. Only a reef that the taps really
// clear counts, and the hearts kept, the taps and the continue are the replay's, not the phone's. The hints
// used are taken as sent: a hint only shows advice and leaves no trace in the reef.
//
// The weeks close lazily: there is no scheduled job. The first time a player of a group is seen in a new
// week, that group's old week is settled (promotions, demotions) for everyone in it at once.

import { MAZ } from './reef-rules.js';

export const GAME = 'reefseek';
const ID = /^[A-Za-z0-9-]{5,64}$/;
const DAY = 864e5;
export const TIERS = 10;
export const GROUP = 30;
// The game's lists (game/index.html WORDS_A, WORDS_B, AVATARS); server/test.mjs checks they are the same.
export const WORDS_A = ['Coral', 'Tide', 'Pearl', 'Wave', 'Reef', 'Sandy', 'Bubble', 'Kelp', 'Lagoon', 'Shell', 'Marina', 'Sunny', 'Misty', 'Azure', 'Ripple', 'Foam'];
export const WORDS_B = ['Minnow', 'Puffer', 'Tang', 'Goby', 'Wrasse', 'Seahorse', 'Octopus', 'Turtle', 'Ray', 'Dolphin', 'Otter', 'Crab', 'Starfish', 'Urchin', 'Jelly', 'Shrimp'];
export const AVATARS = ['minnow', 'clown', 'puffer', 'me', 'barracuda', 'shark', 'minnow2', 'clown2', 'puffer2', 'me2', 'barracuda2', 'shark2'];

export const dayNum = ms => Math.floor(ms / DAY);
// Weeks run Monday 00:00 to Sunday 23:59 UTC; day 0 (1 January 1970) was a Thursday. The game's weekNow().
export const weekOf = ms => Math.floor((dayNum(ms) + 3) / 7);
export const weekEnd = w => (w * 7 - 3 + 7) * DAY;
const dayStr = n => new Date(n * DAY).toISOString().slice(0, 10);
const strDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? dayNum(Date.parse(s + 'T00:00:00Z')) : NaN;

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
// A name for a player who has not chosen one: two words and two digits, as the game draws them.
export function nameFor(i) { const h = hash('me:' + i); return WORDS_A[h % WORDS_A.length] + ' ' + WORDS_B[(h >>> 4) % WORDS_B.length] + ' ' + (10 + (h >>> 8) % 90); }
// A name the player chose in the game: { a, b, n }, two indexes into the lists and two digits.
export function chosenName(nm) {
  if (!nm || !Number.isInteger(nm.a) || !Number.isInteger(nm.b) || !Number.isInteger(nm.n)) return null;
  if (nm.a < 0 || nm.a >= WORDS_A.length || nm.b < 0 || nm.b >= WORDS_B.length || nm.n < 10 || nm.n > 99) return null;
  return WORDS_A[nm.a] + ' ' + WORDS_B[nm.b] + ' ' + nm.n;
}
// What the group sees of a player: playing, a tournament reef cleared in the last three minutes; live, any
// request in the last five; offline otherwise. 'seen' is written at most once a minute.
export const presence = (now, seen, act) => act && now - act < 180000 ? 'playing' : seen && now - seen < 300000 ? 'live' : 'offline';
// How many of a group of n move up and down at the end of a week (the game's zonesOf).
export function zones(n) {
  if (n >= 10) return { up: Math.round(n * 7 / 30), down: Math.round(n * 5 / 30) };
  if (n >= 4) return { up: 1, down: 1 };
  if (n >= 2) return { up: 1, down: 0 };
  return { up: 0, down: 0 };
}

// Matsuri Lights' schema, word for word: whichever game's server runs first makes the tables.
const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS play_player (g TEXT NOT NULL, i TEXT NOT NULL, name TEXT NOT NULL, tier INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
     renames INTEGER NOT NULL DEFAULT 0, renamed_day INTEGER NOT NULL DEFAULT -1, moved INTEGER NOT NULL DEFAULT 0, moved_week INTEGER NOT NULL DEFAULT -1, av TEXT NOT NULL DEFAULT 'sakura',
     seen INTEGER NOT NULL DEFAULT 0, act INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, i))`,
  // a player's tournament run this week: the last reef counted and how many in a row
  `CREATE TABLE IF NOT EXISTS play_run (g TEXT NOT NULL, i TEXT NOT NULL, w INTEGER NOT NULL, last INTEGER NOT NULL DEFAULT -1, run INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, i, w))`,
  // the Daily Reef: here t is the taps the replay counted and h is 1 when a continue was used (not ranked)
  `CREATE TABLE IF NOT EXISTS play_daily (g TEXT NOT NULL, d TEXT NOT NULL, i TEXT NOT NULL, t INTEGER NOT NULL, h INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (g, d, i))`,
  `CREATE INDEX IF NOT EXISTS play_daily_rank ON play_daily (g, d, h, t)`,
  `CREATE TABLE IF NOT EXISTS play_group (g TEXT NOT NULL, w INTEGER NOT NULL, grp INTEGER NOT NULL, tier INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, w, grp))`,
  `CREATE TABLE IF NOT EXISTS play_member (g TEXT NOT NULL, w INTEGER NOT NULL, i TEXT NOT NULL, grp INTEGER NOT NULL, pts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, w, i))`,
  `CREATE INDEX IF NOT EXISTS play_member_grp ON play_member (g, w, grp)`,
  `CREATE INDEX IF NOT EXISTS play_member_i ON play_member (g, i, w)`,
  `CREATE INDEX IF NOT EXISTS play_daily_i ON play_daily (g, i)`,
  // the Daily Reef's ranking as counts per number of taps, so that a rank reads a few hundred rows at most
  `CREATE TABLE IF NOT EXISTS play_dhist (g TEXT NOT NULL, d TEXT NOT NULL, b INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, d, b))`,
];
let schemaReady = null;
async function ready(db) {
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map(q => db.prepare(q))).catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) });

// Plays a ranked reef again: the reef dealt as the game deals it, its middle patch opened, then every tap.
// Returns the finished run and whether a continue was used, or null when the taps do not clear the reef.
export function replay(deal, log) {
  if (!Array.isArray(log) || log.length > 3000) return null;
  const S = MAZ.newRun(deal.seed, deal.sp.depth, {}, deal.sp), n = deal.sp.w * deal.sp.h;
  MAZ.tap(S, deal.start);
  let cont = 0;
  for (const c of log) {
    if (S.won) return null;                                   // nothing is tapped after the reef is cleared
    if (c === -1) { if (!S.over || cont) return null; cont = 1; MAZ.revive(S); continue; }
    if (S.over || !Number.isInteger(c) || c < 0 || c >= n) return null;
    MAZ.tap(S, c);
  }
  return S.won ? { S, cont } : null;
}

async function player(db, i, now, nm, av) {
  let p = await db.prepare('SELECT * FROM play_player WHERE g = ? AND i = ?').bind(GAME, i).first();
  if (!p) {
    await db.prepare('INSERT OR IGNORE INTO play_player (g, i, name, tier, created, av) VALUES (?, ?, ?, 0, ?, ?)')
      .bind(GAME, i, chosenName(nm) || nameFor(i), now, AVATARS.includes(av) ? av : 'clown').run();
    p = await db.prepare('SELECT * FROM play_player WHERE g = ? AND i = ?').bind(GAME, i).first();
  }
  return p;
}

// Settles every earlier week this player was in that is still open: their whole group moves at once.
async function settle(db, i, w) {
  const old = await db.prepare('SELECT m.w AS w, m.grp AS grp FROM play_member m JOIN play_group gr ON gr.g = m.g AND gr.w = m.w AND gr.grp = m.grp WHERE m.g = ? AND m.i = ? AND m.w < ? AND gr.closed = 0').bind(GAME, i, w).all();
  for (const o of old.results || []) {
    const rows = (await db.prepare('SELECT i, pts FROM play_member WHERE g = ? AND w = ? AND grp = ? ORDER BY pts DESC, i').bind(GAME, o.w, o.grp).all()).results || [];
    const z = zones(rows.length), ups = [], downs = [];
    rows.forEach((r, k) => { if (k < z.up && r.pts > 0) ups.push(r.i); else if (k >= rows.length - z.down) downs.push(r.i); });
    const q = [db.prepare('UPDATE play_group SET closed = 1 WHERE g = ? AND w = ? AND grp = ? AND closed = 0').bind(GAME, o.w, o.grp)];
    for (const r of rows) {
      const mv = ups.includes(r.i) ? 1 : downs.includes(r.i) ? -1 : 0;
      // a player is in one group a week, so moved_week < w lets each player move once for that week
      q.push(db.prepare(`UPDATE play_player SET tier = MAX(0, MIN(${TIERS - 1}, tier + ?)), moved = ?, moved_week = ? WHERE g = ? AND i = ? AND moved_week < ?`).bind(mv, mv, o.w, GAME, r.i, o.w));
    }
    await db.batch(q);
  }
}

async function membership(db, p, w, join) {
  const m = await db.prepare('SELECT * FROM play_member WHERE g = ? AND w = ? AND i = ?').bind(GAME, w, p.i).first();
  if (m || !join) return m;
  const gr = await db.prepare('SELECT grp FROM play_group WHERE g = ? AND w = ? AND tier = ? AND n < ? AND closed = 0 ORDER BY grp DESC LIMIT 1').bind(GAME, w, p.tier, GROUP).first();
  let grp;
  if (gr) grp = gr.grp;
  else {
    const mx = await db.prepare('SELECT MAX(grp) AS m FROM play_group WHERE g = ? AND w = ?').bind(GAME, w).first();
    grp = ((mx && mx.m !== null && mx.m !== undefined) ? mx.m : 0) + 1;
    await db.prepare('INSERT OR IGNORE INTO play_group (g, w, grp, tier, n, closed) VALUES (?, ?, ?, ?, 0, 0)').bind(GAME, w, grp, p.tier).run();
  }
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO play_member (g, w, i, grp, pts) VALUES (?, ?, ?, ?, 0)').bind(GAME, w, p.i, grp),
    db.prepare('UPDATE play_group SET n = n + 1 WHERE g = ? AND w = ? AND grp = ?').bind(GAME, w, grp),
  ]);
  return db.prepare('SELECT * FROM play_member WHERE g = ? AND w = ? AND i = ?').bind(GAME, w, p.i).first();
}

async function dailyStanding(db, d, i) {
  const me = await db.prepare('SELECT t, h FROM play_daily WHERE g = ? AND d = ? AND i = ?').bind(GAME, d, i).first();
  const hist = (await db.prepare('SELECT b, n FROM play_dhist WHERE g = ? AND d = ?').bind(GAME, d).all()).results || [];
  let count = 0, below = 0; const mb = me && me.h === 0 ? me.t : -1;
  for (const r of hist) { count += r.n; if (r.b < mb) below += r.n; }
  return { count, rank: mb >= 0 ? 1 + below : null, mine: me ? { taps: me.t, cont: me.h } : null };
}

export async function handle(request, env, now = Date.now()) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const db = env.PLAY || env.VA;
  if (!db || typeof db.prepare !== 'function') return json({ error: 'no store' }, 503);
  if (env.REEF_PLAY_OFF === '1') return json({ error: 'off' }, 503);
  await ready(db);
  const url = new URL(request.url), path = url.pathname.replace(/^\/reef\/?/, '').replace(/\/$/, '');
  let b = {};
  if (request.method === 'POST') { try { b = JSON.parse(await request.text()); } catch (e) { return json({ error: 'body' }, 400); } }
  else b = Object.fromEntries(url.searchParams);
  if (!b || b.g !== GAME) return json({ error: 'game' }, 400);
  if (typeof b.i !== 'string' || !ID.test(b.i)) return json({ error: 'install' }, 400);
  const today = dayNum(now), w = weekOf(now);
  // the player is here: at most one write a minute (the row may not exist yet; then nothing is written)
  if (path !== 'forget') await db.prepare('UPDATE play_player SET seen = ? WHERE g = ? AND i = ? AND seen < ?').bind(now, GAME, b.i, now - 60000).run();

  if (path === 'profile' && request.method === 'POST') {
    const p = await player(db, b.i, now, b.nm, b.av);
    const out = { name: p.name, av: p.av };
    if (b.av !== undefined) {
      if (!AVATARS.includes(b.av)) return json({ error: 'avatar' }, 400);
      if (b.av !== p.av) await db.prepare('UPDATE play_player SET av = ? WHERE g = ? AND i = ?').bind(b.av, GAME, b.i).run();
      out.av = b.av;
    }
    if (b.nm !== undefined) {
      const name = chosenName(b.nm);
      if (!name) return json({ error: 'name' }, 400);
      if (name !== p.name) {
        const n = p.renamed_day === today ? p.renames : 0;
        if (n >= 3) return json(Object.assign(out, { error: 'renames' }), 429);
        await db.prepare('UPDATE play_player SET name = ?, renames = ?, renamed_day = ? WHERE g = ? AND i = ?').bind(name, n + 1, today, GAME, b.i).run();
        out.name = name;
      }
    }
    return json(out);
  }
  if (path === 'forget' && request.method === 'POST') {
    const gone = (await db.prepare('SELECT d, t FROM play_daily WHERE g = ? AND i = ? AND h = 0').bind(GAME, b.i).all()).results || [];
    await db.batch(gone.map(r => db.prepare('UPDATE play_dhist SET n = n - 1 WHERE g = ? AND d = ? AND b = ? AND n > 0').bind(GAME, r.d, r.t))
      .concat(['play_player', 'play_daily', 'play_member', 'play_run'].map(t => db.prepare(`DELETE FROM ${t} WHERE g = ? AND i = ?`).bind(GAME, b.i))));
    return json({ ok: 1 });
  }
  if (path === 'result' && request.method === 'POST') {
    const k = b.k, hints = Math.max(0, Math.min(99, b.h | 0)), secs = b.t | 0;
    let deal, d = null, ln = -1;
    if (k === 'daily') {
      d = typeof b.d === 'string' ? b.d : ''; const n = strDay(d);
      if (!(n >= today - 1 && n <= today + 1)) return json({ error: 'day' }, 400);
      deal = MAZ.daily(d);
    } else if (k === 'league') {
      // this week's reefs only; the server deals the same reef from the player's id
      if ((b.w | 0) !== w) return json({ error: 'week' }, 400);
      ln = b.n; if (!Number.isInteger(ln) || ln < 0 || ln > 5000) return json({ error: 'n' }, 400);
      deal = MAZ.league(b.i, w, ln);
    } else return json({ error: 'kind' }, 400);
    const r = replay(deal, b.log);
    if (!r) return json({ error: 'not cleared' }, 422);
    // a reef cleared faster than a fifth of a second a tap was not played by a person
    if (secs < Math.max(3, Math.floor(r.S.taps * 0.2))) return json({ error: 'time' }, 422);
    const pl = await player(db, b.i, now, b.nm, b.av);
    let fresh = false, pts = 0, run = 0;
    if (k === 'daily') {
      fresh = (await db.prepare('INSERT OR IGNORE INTO play_daily (g, d, i, t, h, at) VALUES (?, ?, ?, ?, ?, ?)').bind(GAME, d, b.i, r.S.taps, r.cont, now).run()).meta.changes > 0;
      if (fresh && !r.cont) await db.prepare('INSERT INTO play_dhist (g, d, b, n) VALUES (?, ?, ?, 1) ON CONFLICT (g, d, b) DO UPDATE SET n = n + 1').bind(GAME, d, r.S.taps).run();
    } else {
      // the run: one more if this is the next reef after the last counted with no hint and no continue;
      // a reef skipped, a hint or a continue starts it again (the game's won())
      const rr = await db.prepare('SELECT last, run FROM play_run WHERE g = ? AND i = ? AND w = ?').bind(GAME, b.i, w).first();
      const last = rr ? rr.last : -1, before = rr ? rr.run : 0;
      fresh = ln > last;
      if (fresh) {
        run = hints || r.cont ? 0 : (ln === last + 1 ? before + 1 : 1);
        pts = MAZ.leaguePts(deal.sp, r.S.hp, r.S.max, run, hints, r.cont);
        await db.batch([db.prepare('INSERT INTO play_run (g, i, w, last, run) VALUES (?, ?, ?, ?, ?) ON CONFLICT (g, i, w) DO UPDATE SET last = excluded.last, run = excluded.run').bind(GAME, b.i, w, ln, run),
          db.prepare('UPDATE play_player SET act = ?, seen = ? WHERE g = ? AND i = ?').bind(now, now, GAME, b.i)]);
        await settle(db, b.i, w);
        const me = await player(db, b.i, now);
        await membership(db, me, w, true);
        if (pts) await db.prepare('UPDATE play_member SET pts = pts + ? WHERE g = ? AND w = ? AND i = ?').bind(pts, GAME, w, b.i).run();
      } else run = before;
    }
    const out = { ok: 1, fresh: fresh ? 1 : 0, pts, name: pl.name, week: w, taps: r.S.taps, hp: r.S.hp, cont: r.cont };
    if (k === 'league') Object.assign(out, { run, mult: hints || r.cont ? 1 : MAZ.mult(run) });
    if (k === 'daily') out.daily = await dailyStanding(db, d, b.i);
    return json(out);
  }
  if (path === 'daily' && request.method === 'GET') {
    const d = typeof b.d === 'string' ? b.d : dayStr(today);
    if (isNaN(strDay(d))) return json({ error: 'day' }, 400);
    const st = await dailyStanding(db, d, b.i);
    const top = (await db.prepare('SELECT p.name AS name, p.av AS av, d.t AS t, d.i = ? AS me FROM play_daily d JOIN play_player p ON p.g = d.g AND p.i = d.i WHERE d.g = ? AND d.d = ? AND d.h = 0 ORDER BY d.t, d.at LIMIT 20').bind(b.i, GAME, d).all()).results || [];
    return json(Object.assign(st, { d, top: top.map(r => ({ name: r.name, av: r.av, taps: r.t, me: r.me ? 1 : 0 })) }));
  }
  if (path === 'league' && request.method === 'GET') {
    await settle(db, b.i, w);
    const p = await player(db, b.i, now);
    const rr = await db.prepare('SELECT last, run FROM play_run WHERE g = ? AND i = ? AND w = ?').bind(GAME, b.i, w).first();
    const out = { week: w, ends: weekEnd(w), now, tier: p.tier, name: p.name, av: p.av, last: rr ? rr.last : -1, run: rr ? rr.run : 0, moved: p.moved_week === w - 1 ? p.moved : 0, joined: 0, group: [], up: 0, down: 0 };
    const m = await membership(db, p, w, false);
    if (m) {
      const rows = (await db.prepare('SELECT p.name AS name, p.av AS av, p.seen AS seen, p.act AS act, m.pts AS pts, m.i = ? AS me FROM play_member m JOIN play_player p ON p.g = m.g AND p.i = m.i WHERE m.g = ? AND m.w = ? AND m.grp = ? ORDER BY m.pts DESC, p.name').bind(b.i, GAME, w, m.grp).all()).results || [];
      const z = zones(rows.length);
      Object.assign(out, { joined: 1, group: rows.map(r => ({ name: r.name, av: r.av, pts: r.pts, me: r.me ? 1 : 0, ps: presence(now, r.seen, r.act) })), up: z.up, down: z.down });
    }
    return json(out);
  }
  return json({ error: 'path' }, 404);
}
