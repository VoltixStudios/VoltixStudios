// The rankings and the weekly leagues of Matsuri Lights (docs/COMPETITION.md).
//
// It runs as a Cloudflare Pages Function at /play/* on the studio's site, on the free plan, and keeps
// its tables in D1: a database bound as PLAY if there is one, otherwise the studio's analytics
// database (VA), in tables of its own that all begin with play_. The shared design is
// ~/voltix_company/company/briefs/2026-11-12-daily-leagues-seasons.md, section 4.
//
// What a player is: an anonymous random id made on the phone for this alone (not the analytics id) and a name
// drawn from two lists of Japanese words, so there is no free text to moderate. Nothing else is kept.
//
// What is checked: every result comes with the lanterns that lit the courtyard, and the server runs
// the game's own rules (server/matsuri-rules.js, copied from game/index.html) to see that they light
// it. A time is taken as sent, within plausible bounds; it cannot be proved from the lanterns alone.
//
// The weeks close lazily: there is no scheduled job. The first time a player of a group is seen in a
// new week, that group's old week is settled (promotions, demotions) for everyone in it at once.

import { FAR } from './matsuri-rules.js';

export const GAME = 'matsurilights';
const ID = /^[A-Za-z0-9-]{8,64}$/;
const DAY = 864e5;
export const TIERS = 10;
export const GROUP = 30;
export const WORDS_A = ['Hoshi', 'Tsuki', 'Hana', 'Kaze', 'Yuki', 'Sora', 'Umi', 'Mori', 'Kumo', 'Hikari', 'Nami', 'Akari', 'Momiji', 'Sakura', 'Kawa', 'Yama'];
export const WORDS_B = ['Koi', 'Tsuru', 'Usagi', 'Kitsune', 'Tanuki', 'Hotaru', 'Suzume', 'Kame', 'Neko', 'Shika', 'Fukuro', 'Tombo', 'Kujira', 'Chocho', 'Hato', 'Risu'];

export const dayNum = ms => Math.floor(ms / DAY);
// Weeks run Monday 00:00 to Sunday 23:59 UTC; day 0 (1 January 1970) was a Thursday.
export const weekOf = ms => Math.floor((dayNum(ms) + 3) / 7);
export const weekEnd = w => (w * 7 - 3 + 7) * DAY;
const dayStr = n => new Date(n * DAY).toISOString().slice(0, 10);
const strDay = s => /^\d{4}-\d{2}-\d{2}$/.test(s) ? dayNum(Date.parse(s + 'T00:00:00Z')) : NaN;

function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
export function nameFor(i, n) {
  const h = hash(i + ':' + n), h2 = hash(n + ':' + i);
  return WORDS_A[h % WORDS_A.length] + ' ' + WORDS_B[(h >>> 8) % WORDS_B.length] + ' ' + String(10 + h2 % 90);
}
// A name the player chose from the two lists; its two digits stay the player's own.
export function chosenName(i, a, b) { return WORDS_A[a] + ' ' + WORDS_B[b] + ' ' + String(10 + hash('n:' + i) % 90); }
// The player icons, the game's crests (game/index.html AVATARS); which one a player shows is all that is kept.
export const AVATARS = ['sakura', 'ume', 'tsuki', 'seigaiha', 'momiji', 'hanabi', 'kikyo', 'asanoha', 'yukiwa', 'icho', 'tomoe', 'kiku'];
// What the group sees of a player (ML-031): playing, a tournament puzzle lit in the last three minutes;
// live, any request in the last five; offline otherwise. 'seen' is written at most once a minute.
export const presence = (now, seen, act) => act && now - act < 180000 ? 'playing' : seen && now - seen < 300000 ? 'live' : 'offline';
// How many of a group of n move up and down at the end of a week.
export function zones(n) {
  if (n >= 10) return { up: Math.round(n * 7 / 30), down: Math.round(n * 5 / 30) };
  if (n >= 4) return { up: 1, down: 1 };
  if (n >= 2) return { up: 1, down: 0 };
  return { up: 0, down: 0 };
}
// Points come from the league's own endless courtyards only (ML-022): the courtyard's size times the
// run's multiplier, FAR.leaguePts, the same function the game shows them with. Tonight is a ranking of
// its own and earns no points; the 96 courtyards of the festivals earn none.

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS play_player (g TEXT NOT NULL, i TEXT NOT NULL, name TEXT NOT NULL, tier INTEGER NOT NULL DEFAULT 0, created INTEGER NOT NULL,
     renames INTEGER NOT NULL DEFAULT 0, renamed_day INTEGER NOT NULL DEFAULT -1, moved INTEGER NOT NULL DEFAULT 0, moved_week INTEGER NOT NULL DEFAULT -1, av TEXT NOT NULL DEFAULT 'sakura',
     seen INTEGER NOT NULL DEFAULT 0, act INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, i))`,
  // a player's league run this week: the last courtyard counted and how many in a row without hints
  `CREATE TABLE IF NOT EXISTS play_run (g TEXT NOT NULL, i TEXT NOT NULL, w INTEGER NOT NULL, last INTEGER NOT NULL DEFAULT -1, run INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, i, w))`,
  `CREATE TABLE IF NOT EXISTS play_daily (g TEXT NOT NULL, d TEXT NOT NULL, i TEXT NOT NULL, t INTEGER NOT NULL, h INTEGER NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (g, d, i))`,
  `CREATE INDEX IF NOT EXISTS play_daily_rank ON play_daily (g, d, h, t)`,
  `CREATE TABLE IF NOT EXISTS play_group (g TEXT NOT NULL, w INTEGER NOT NULL, grp INTEGER NOT NULL, tier INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, closed INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, w, grp))`,
  `CREATE TABLE IF NOT EXISTS play_member (g TEXT NOT NULL, w INTEGER NOT NULL, i TEXT NOT NULL, grp INTEGER NOT NULL, pts INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, w, i))`,
  `CREATE INDEX IF NOT EXISTS play_member_grp ON play_member (g, w, grp)`,
  // what one install has: read when a result settles old weeks, and when it asks to be forgotten
  `CREATE INDEX IF NOT EXISTS play_member_i ON play_member (g, i, w)`,
  `CREATE INDEX IF NOT EXISTS play_daily_i ON play_daily (g, i)`,
  // Tonight's ranking as counts per time bucket, so that a rank reads a few hundred rows at most
  // however many play (D1's free plan reads 5 million rows a day for the whole account)
  `CREATE TABLE IF NOT EXISTS play_dhist (g TEXT NOT NULL, d TEXT NOT NULL, b INTEGER NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (g, d, b))`,
];
// The bucket of a time for Tonight's ranking: to the second under two minutes, then 2, 5 and 15
// seconds, so a night has at most 750 buckets. Players in the same bucket share a rank.
export const bucket = t => t < 120 ? t : t < 300 ? t - t % 2 : t < 900 ? t - t % 5 : t - t % 15;
let schemaReady = null;
async function ready(db) {
  if (!schemaReady) schemaReady = db.batch(SCHEMA.map(q => db.prepare(q))).catch(e => { schemaReady = null; throw e; });
  return schemaReady;
}

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: Object.assign({ 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }, CORS) });

async function player(db, i, now) {
  let p = await db.prepare('SELECT * FROM play_player WHERE g = ? AND i = ?').bind(GAME, i).first();
  if (!p) {
    await db.prepare('INSERT OR IGNORE INTO play_player (g, i, name, tier, created) VALUES (?, ?, ?, 0, ?)').bind(GAME, i, nameFor(i, 0), now).run();
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
      // A player is in one group a week, so moved_week < w lets each player move once for that week,
      // even when two requests settle the same group at the same moment.
      q.push(db.prepare(`UPDATE play_player SET tier = MAX(0, MIN(${TIERS - 1}, tier + ?)), moved = ?, moved_week = ? WHERE g = ? AND i = ? AND moved_week < ?`).bind(mv, mv, o.w, GAME, r.i, o.w));
    }
    await db.batch(q);
  }
}

async function membership(db, p, w, join) {
  const m = await db.prepare('SELECT * FROM play_member WHERE g = ? AND w = ? AND i = ?').bind(GAME, w, p.i).first();
  if (m || !join) return m;
  let gr = await db.prepare('SELECT grp FROM play_group WHERE g = ? AND w = ? AND tier = ? AND n < ? AND closed = 0 ORDER BY grp DESC LIMIT 1').bind(GAME, w, p.tier, GROUP).first();
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

// Do these lanterns light this courtyard?
export function lights(p, lamps) {
  if (!p || !Array.isArray(lamps) || lamps.length > p.w * p.h) return false;
  const P = FAR.parse(p), b = new Int8Array(P.n);
  for (const c of lamps) { if (!Number.isInteger(c) || c < 0 || c >= P.n || P.wall[c] || b[c]) return false; b[c] = 1; }
  return FAR.finished(P, b);
}

async function dailyStanding(db, d, i) {
  const me = await db.prepare('SELECT t, h FROM play_daily WHERE g = ? AND d = ? AND i = ?').bind(GAME, d, i).first();
  const hist = (await db.prepare('SELECT b, n FROM play_dhist WHERE g = ? AND d = ?').bind(GAME, d).all()).results || [];
  let count = 0, below = 0; const mb = me && me.h === 0 ? bucket(me.t) : -1;
  for (const r of hist) { count += r.n; if (r.b < mb) below += r.n; }
  return { count, rank: mb >= 0 ? 1 + below : null, mine: me ? { t: me.t, h: me.h } : null };
}

export async function handle(request, env, now = Date.now()) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  const db = env.PLAY || env.VA;
  if (!db || typeof db.prepare !== 'function') return json({ error: 'no store' }, 503);
  if (env.PLAY_OFF === '1') return json({ error: 'off' }, 503);
  await ready(db);
  const url = new URL(request.url), path = url.pathname.replace(/^\/play\/?/, '').replace(/\/$/, '');
  let b = {};
  if (request.method === 'POST') { try { b = JSON.parse(await request.text()); } catch (e) { return json({ error: 'body' }, 400); } }
  else b = Object.fromEntries(url.searchParams);
  if (b.g !== GAME) return json({ error: 'game' }, 400);
  if (typeof b.i !== 'string' || !ID.test(b.i)) return json({ error: 'install' }, 400);
  const today = dayNum(now), w = weekOf(now);
  // the player is here: at most one write a minute (the row may not exist yet; then nothing is written)
  if (path !== 'forget') await db.prepare('UPDATE play_player SET seen = ? WHERE g = ? AND i = ? AND seen < ?').bind(now, GAME, b.i, now - 60000).run();

  if (path === 'hello' && request.method === 'POST') {
    const p = await player(db, b.i, now);
    return json({ name: p.name, tier: p.tier, av: p.av });
  }
  if (path === 'avatar' && request.method === 'POST') {
    if (!AVATARS.includes(b.av)) return json({ error: 'avatar' }, 400);
    await player(db, b.i, now);
    await db.prepare('UPDATE play_player SET av = ? WHERE g = ? AND i = ?').bind(b.av, GAME, b.i).run();
    return json({ av: b.av });
  }
  if (path === 'name' && request.method === 'POST') {
    const p = await player(db, b.i, now);
    const n = p.renamed_day === today ? p.renames : 0;
    if (n >= 3) return json({ error: 'renames', name: p.name }, 429);
    const chose = Number.isInteger(b.a) && Number.isInteger(b.b) && b.a >= 0 && b.a < WORDS_A.length && b.b >= 0 && b.b < WORDS_B.length;
    const name = chose ? chosenName(b.i, b.a, b.b) : nameFor(b.i, p.created % 1000 + (p.renames || 0) + 1 + n * 7);
    await db.prepare('UPDATE play_player SET name = ?, renames = ?, renamed_day = ? WHERE g = ? AND i = ?').bind(name, n + 1, today, GAME, b.i).run();
    return json({ name });
  }
  if (path === 'forget' && request.method === 'POST') {
    const gone = (await db.prepare('SELECT d, t FROM play_daily WHERE g = ? AND i = ? AND h = 0').bind(GAME, b.i).all()).results || [];
    await db.batch(gone.map(r => db.prepare('UPDATE play_dhist SET n = n - 1 WHERE g = ? AND d = ? AND b = ? AND n > 0').bind(GAME, r.d, bucket(r.t)))
      .concat(['play_player', 'play_daily', 'play_member', 'play_run'].map(t => db.prepare(`DELETE FROM ${t} WHERE g = ? AND i = ?`).bind(GAME, b.i))));
    return json({ ok: 1 });
  }
  if (path === 'result' && request.method === 'POST') {
    const k = b.k, hints = Math.max(0, Math.min(99, b.h | 0)), t = b.t | 0;
    let p, d = null, ln = -1;
    if (k === 'daily') {
      d = typeof b.d === 'string' ? b.d : ''; const n = strDay(d);
      if (!(n >= today - 1 && n <= today + 1)) return json({ error: 'day' }, 400);
      p = FAR.daily(d);
    } else if (k === 'league') {
      // this week's courtyards only; the server makes the same courtyard from the player's id
      if ((b.w | 0) !== w) return json({ error: 'week' }, 400);
      ln = b.n; if (!Number.isInteger(ln) || ln < 0 || ln > 5000) return json({ error: 'n' }, 400);
      p = FAR.league(b.i, w, ln);
      // the lanterns placed while solving (each placement, right or wrong): the accuracy that scales the points
      if (!Number.isInteger(b.pl) || b.pl < (Array.isArray(b.lamps) ? b.lamps.length : 0) || b.pl > 999) return json({ error: 'placed' }, 400);
    } else return json({ error: 'kind' }, 400);
    if (!lights(p, b.lamps)) return json({ error: 'not lit' }, 422);
    if (t < Math.max(3, Math.ceil(b.lamps.length * 0.4)) || t > 7200) return json({ error: 'time' }, 422);
    const pl = await player(db, b.i, now);
    let fresh;
    if (k === 'daily') {
      fresh = (await db.prepare('INSERT OR IGNORE INTO play_daily (g, d, i, t, h, at) VALUES (?, ?, ?, ?, ?, ?)').bind(GAME, d, b.i, t, hints, now).run()).meta.changes > 0;
      if (fresh && hints === 0) await db.prepare('INSERT INTO play_dhist (g, d, b, n) VALUES (?, ?, ?, 1) ON CONFLICT (g, d, b) DO UPDATE SET n = n + 1').bind(GAME, d, bucket(t)).run();
    }
    let pts = 0, run = 0;
    if (k === 'league') {
      // the run: one more if this is the next courtyard after the last counted and no hint was used;
      // a courtyard skipped (left unfinished) or a hint starts it again
      const r = await db.prepare('SELECT last, run FROM play_run WHERE g = ? AND i = ? AND w = ?').bind(GAME, b.i, w).first();
      const last = r ? r.last : -1, before = r ? r.run : 0;
      fresh = ln > last;
      if (fresh) {
        run = hints ? 0 : (ln === last + 1 ? before + 1 : 1);
        pts = FAR.leaguePts(p, run, hints, b.pl);
        await db.batch([db.prepare('INSERT INTO play_run (g, i, w, last, run) VALUES (?, ?, ?, ?, ?) ON CONFLICT (g, i, w) DO UPDATE SET last = excluded.last, run = excluded.run').bind(GAME, b.i, w, ln, run),
          db.prepare('UPDATE play_player SET act = ?, seen = ? WHERE g = ? AND i = ?').bind(now, now, GAME, b.i)]);
      } else run = before;
    }
    if (pts) {
      await settle(db, b.i, w);
      const me = await player(db, b.i, now);
      await membership(db, me, w, true);
      await db.prepare('UPDATE play_member SET pts = pts + ? WHERE g = ? AND w = ? AND i = ?').bind(pts, GAME, w, b.i).run();
    }
    const out = { ok: 1, fresh: fresh ? 1 : 0, pts, name: pl.name, week: w };
    if (k === 'league') Object.assign(out, { run, mult: hints ? 1 : FAR.mult(run), acc: Math.round(FAR.accuracy(p, b.pl) * 100) });
    if (k === 'daily') out.daily = await dailyStanding(db, d, b.i);
    return json(out);
  }
  if (path === 'daily' && request.method === 'GET') {
    const d = typeof b.d === 'string' ? b.d : dayStr(today);
    if (isNaN(strDay(d))) return json({ error: 'day' }, 400);
    const st = await dailyStanding(db, d, b.i);
    const top = (await db.prepare('SELECT p.name AS name, p.av AS av, d.t AS t, d.i = ? AS me FROM play_daily d JOIN play_player p ON p.g = d.g AND p.i = d.i WHERE d.g = ? AND d.d = ? AND d.h = 0 ORDER BY d.t, d.at LIMIT 20').bind(b.i, GAME, d).all()).results || [];
    return json(Object.assign(st, { top: top.map(r => ({ name: r.name, av: r.av, t: r.t, me: r.me ? 1 : 0 })) }));
  }
  if (path === 'league' && request.method === 'GET') {
    await settle(db, b.i, w);
    const p = await player(db, b.i, now);
    const run = await db.prepare('SELECT last, run FROM play_run WHERE g = ? AND i = ? AND w = ?').bind(GAME, b.i, w).first();
    const out = { week: w, ends: weekEnd(w), now, tier: p.tier, name: p.name, av: p.av, last: run ? run.last : -1, run: run ? run.run : 0, moved: p.moved_week === w - 1 ? p.moved : 0, joined: 0, group: [], up: 0, down: 0 };
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
