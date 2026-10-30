/* Voltix Analytics — the dashboard page (D-072, phase 4).
 *
 * Fetches one JSON answer per page from /va/api/<page> and draws it with
 * plain elements and inline SVG: no library and no other site's script, as
 * the page's Content-Security-Policy requires. Every string that came from a
 * player (a phone model, a campaign) is written with textContent, never as
 * HTML. Nothing is kept but the chosen game, range and builds, in this
 * browser's own storage.
 */
(function () {
  "use strict";
  const DAY0 = Date.UTC(2026, 0, 1);
  const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  const LOOMS = { e: "Easy", n: "Normal", h: "Hard", "": "Before the looms" };
  const TITLES = { overview: "Overview", acquisition: "Acquisition", retention: "Retention", engagement: "Engagement",
                   progress: "Player progress", money: "Money", health: "Health" };
  const SUBS = { overview: "The game at a glance", acquisition: "Who arrives, from where, and whether they start",
                 retention: "Do they come back, and who does", engagement: "How much they play, when, and what they use",
                 progress: "How far they get", money: "Offers, purchases Google signed, and adverts",
                 health: "Errors, late data, the collector and the nightly run" };
  const NS = "http://www.w3.org/2000/svg";

  /* ---------- small helpers ---------- */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v === null || v === undefined) continue;
      if (k === "class") el.className = v;
      else if (k === "style") for (const s in v) { if (s.startsWith("--")) el.style.setProperty(s, v[s]); else el.style[s] = v[s]; }
      else if (k === "text") el.textContent = v;
      else el.setAttribute(k, v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false)
      el.appendChild(typeof kid === "object" ? kid : document.createTextNode(String(kid)));
    return el;
  }
  const store = { get(k, d) { try { return localStorage.getItem("va." + k) || d; } catch (e) { return d; } },
                  set(k, v) { try { localStorage.setItem("va." + k, v); } catch (e) {} } };
  const dayLabel = (d) => { const t = new Date(DAY0 + d * 86400000); return t.getUTCDate() + " " + MONTHS[t.getUTCMonth()]; };
  const int = (n) => (n === null || n === undefined ? "–" : Math.round(n).toLocaleString("en-GB"));
  const share = (r, n) => (!n ? "–" : n < 5 ? "under 5" : Math.round((100 * (r || 0)) / n) + "%");
  const money = (micros) => (micros ? (micros / 1e6).toFixed(2) + " €" : "0 €");
  const dur = (s) => { if (s === null || s === undefined) return "–"; s = Math.round(s);
    return s < 60 ? s + " s" : Math.floor(s / 60) + " m " + String(s % 60).padStart(2, "0") + " s"; };
  const sumBy = (rows, f) => rows.reduce((a, r) => a + (f(r) || 0), 0);
  const pick = (rows, name, value) => rows.filter((r) => r.name === name && (value === undefined || r.value === value));
  const card = (title, ...kids) => h("section", { class: "card" }, title ? h("h2", { text: title }) : null, ...kids);
  const empty = (t) => h("p", { class: "empty", text: t || "Nothing yet for this game, range and builds." });

  function tiles(list) {
    return h("div", { class: "tiles" }, list.map((t) =>
      h("div", { class: "tile" }, h("div", { class: "l", text: t[0] }), h("div", { class: "v", text: t[1] }), h("div", { class: "l", text: t[2] || "" }))));
  }
  /* Stacked vertical bars: rows of { label, parts: [value...], tip }, colours by part. */
  function bars(rows, colours, height) {
    const max = Math.max(1, ...rows.map((r) => r.parts.reduce((a, b) => a + b, 0)));
    const box = h("div", { class: "bars", role: "img", "aria-label": "bar chart", style: { height: (height || 180) + "px" } });
    for (const r of rows) {
      const col = h("div", { title: r.tip || "" });
      r.parts.slice().reverse().forEach((v, i) => {
        const ci = r.parts.length - 1 - i;
        col.appendChild(h("div", { style: { height: (v / max * ((height || 180) - 4)) + "px", background: colours[ci] } }));
      });
      box.appendChild(col);
    }
    return box;
  }
  function axis(labels) { return h("div", { class: "axis" }, labels.map((l) => h("span", { text: l }))); }
  function legend(items) { return h("div", { class: "legend" }, items.map(([c, t]) => h("span", { style: { "--c": c }, text: t }))); }
  /* Horizontal bars: rows of { label, n }, as a share of `total` (or of the largest). */
  function hbars(rows, total, fmt) {
    if (!rows.length) return empty();
    const top = total || Math.max(1, ...rows.map((r) => r.n));
    return h("div", { style: { display: "flex", flexDirection: "column", gap: "8px" } }, rows.map((r) =>
      h("div", { class: "hrow" }, h("span", { text: String(r.label), title: String(r.label), style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }),
        h("div", { class: "track" }, h("div", { style: { width: Math.min(100, (100 * r.n) / top) + "%" } })),
        h("span", { class: "num", text: fmt ? fmt(r) : (total ? share(r.n, total) : int(r.n)) }))));
  }
  function series(from, to, f) { const out = []; for (let d = from; d <= to; d++) out.push(f(d)); return out; }
  function dayAxis(from, to) { const n = to - from; return axis([0, 0.25, 0.5, 0.75, 1].map((p) => dayLabel(from + Math.round(n * p)))); }
  function chip(kind, text) { return h("span", { class: "chip " + kind, text }); }
  /* A table: the first column left-aligned. A cell is text, or an element made with h("td"). */
  function table(headers, rows) {
    const head = h("tr", null, headers.map((t, i) => h("th", { class: i ? null : "left", text: t })));
    const body = rows.map((cells) => h("tr", null, cells.map((c, i) =>
      (c && typeof c === "object") ? c : h("td", { class: i ? null : "left", text: c === null || c === undefined ? "–" : String(c) }))));
    return h("div", { class: "scroll" }, h("table", null, h("thead", null, head), h("tbody", null, body)));
  }

  /* ---------- the pages ---------- */
  const PAGES = {};

  PAGES.overview = (d) => {
    const today = d.series.find((r) => r.day === d.today) || { players: 0, new: 0 };
    const new30 = sumBy(d.series, (r) => r.new);
    const out = [tiles([
      ["Players today", int(today.players), "active on the game day"],
      ["New players today", int(today.new), int(new30) + " in " + d.range + " days"],
      ["D1 return", share(d.d1.r, d.d1.n), "new players of the last 14 days"],
      ["Stickiness", share(d.stick.dau, d.stick.mau), "today / last 30 days"],
      ["Time in game", dur(d.stick.seconds), "per player today"],
      ["Money, " + d.range + " days", money(d.stick.money), "verified purchases + adverts"],
    ])];
    const byDay = new Map(d.series.map((r) => [r.day, r]));
    out.push(card("Players per day", legend([["var(--a)", "Returning"], ["var(--a2)", "New"]]),
      bars(series(d.from, d.today, (day) => { const r = byDay.get(day) || { players: 0, new: 0 };
        return { parts: [r.players - r.new, r.new], tip: dayLabel(day) + ": " + (r.players - r.new) + " returning, " + r.new + " new" }; }),
        ["var(--a)", "var(--a2)"]), dayAxis(d.from, d.today)));
    out.push(h("div", { class: "grid2" },
      card("New players by source", hbars(d.sources, sumBy(d.sources, (r) => r.n))),
      card("Versions in use, last 7 days", hbars(d.versions.map((r) => ({ label: r.label ? "Version " + r.label : "Unknown", n: r.n })),
        sumBy(d.versions, (r) => r.n)))));
    if (d.gates.length) out.push(gates(d.gates));
    return out;
  };

  function gates(list) {
    const rows = list.map((g) => {
      let status = chip("wait", "Not enough players"), reading = g.reading;
      if (g.kind === "week") {
        const w = g.week.filter((r) => r.n >= 5).map((r) => ({ dow: r.dow, rate: r.s / r.n }));
        const mon = w.find((r) => r.dow === 0);
        if (mon && w.length >= 3) {
          const collapse = w.some((r) => r.rate < mon.rate * 0.5);
          status = collapse ? chip("below", "A collapse") : chip("pass", "Dips, no collapse");
          reading += ": " + w.sort((a, b) => a.dow - b.dow).map((r) => DOW[r.dow] + " " + Math.round(r.rate * 100) + "%").join(", ");
        }
      } else if (g.kind === "any") {
        status = g.num > 0 ? chip("pass", "Pass") : chip("wait", "None yet");
        reading += ": " + g.num;
      } else if (g.den >= (g.min || 5)) {
        const r = g.num / g.den;
        reading += ": " + Math.round(r * 100) + "% (" + g.num + " of " + g.den + ")";
        if (g.kind === "line") status = r > g.line ? chip("pass", "Pass") : chip("below", "Below");
        else if (g.kind === "low") status = r < 0.25 ? chip("pass", "Rare") : chip("below", "Common");
        else status = chip("wait", "Watching");
      } else reading += g.den ? " (" + g.den + " so far)" : "";
      return h("div", { class: "gate" }, h("strong", { class: "small", text: String(g.n) }),
        h("div", null, h("div", { style: { fontWeight: 600 }, text: g.name }), h("div", { class: "small", text: reading })), status);
    });
    return card("The eight gates (GDD §21)", ...rows);
  }

  PAGES.acquisition = (d) => {
    const bySource = {};
    for (const r of d.series) bySource[r.source] = (bySource[r.source] || 0) + r.n;
    const sources = Object.keys(bySource).sort((a, b) => bySource[b] - bySource[a]);
    const top = sources.slice(0, 3);
    const total = sumBy(d.series, (r) => r.n);
    const step = (s) => sumBy(pick(d.steps, "first_session_step", s), (r) => r.players);
    const firstResult = step("first_result");
    const out = [tiles([
      ["New players, " + d.range + " days", int(total)],
      ["Got a first result", share(firstResult, total), "of new players, first day"],
      ["Chose a first loom", share(step("loom_chosen"), total)],
      ["Sources", int(sources.length)],
    ])];
    const colours = ["var(--a)", "var(--a2)", "var(--a3)"];
    out.push(card("New players per day, by source",
      legend(top.map((s, i) => [colours[i], s]).concat(sources.length > 3 ? [["var(--a3)", "others"]] : [])),
      bars(series(d.from, d.today, (day) => {
        const rows = d.series.filter((r) => r.day === day);
        const parts = top.map((s) => sumBy(rows.filter((r) => r.source === s), (r) => r.n));
        if (sources.length > 3) parts[2] += sumBy(rows.filter((r) => top.indexOf(r.source) < 0), (r) => r.n);
        return { parts, tip: dayLabel(day) + ": " + parts.reduce((a, b) => a + b, 0) + " new" };
      }), colours), dayAxis(d.from, d.today)));
    const steps = ["intro", "demo_done", "loom_chosen", "first_weave", "first_result", "reminder_offered"];
    const names = { intro: "Saw the first-day card", demo_done: "Watched the demonstration", loom_chosen: "Chose a loom",
                    first_weave: "First weave", first_result: "First result", reminder_offered: "Offered the reminder" };
    const campHead = h("tr", null, ["Source / campaign", "New", "First result", "D1"].map((t, i) => h("th", { class: i ? null : "left", text: t })));
    const campRows = d.campaigns.map((c) => h("tr", null,
      h("td", { class: "left", text: c.campaign ? c.source + ": " + c.campaign : c.source }),
      h("td", { text: int(c.n) }), h("td", { text: share(c.first, c.n) }), h("td", { text: share(c.d1r, c.d1n) })));
    const campTable = h("div", { class: "scroll" }, h("table", null, h("thead", null, campHead), h("tbody", null, campRows)));
    out.push(h("div", { class: "grid2" },
      card("The first day, step by step", total ? hbars(steps.map((s) => ({ label: names[s], n: step(s) })), total) : empty()),
      card("By source and campaign", d.campaigns.length ? campTable : empty())));
    out.push(h("div", { class: "grid3" },
      card("Country", hbars(d.country, total)), card("Phone", hbars(d.model, total)), card("Android version", hbars(d.os, total))));
    return out;
  };

  PAGES.retention = (d) => {
    const size = new Map(d.sizes.map((r) => [r.fd, r.n]));
    const cell = new Map(d.cells.map((r) => [r.fd + ":" + r.k, r.r]));
    /* Curves: each day n over the cohorts old enough to have reached it. */
    const classic = [], rolling = [];
    const lastBy = new Map();
    for (const r of d.last) { const a = lastBy.get(r.fd) || []; a.push(r); lastBy.set(r.fd, a); }
    for (let k = 1; k <= 30; k++) {
      let n = 0, r = 0, rr = 0;
      for (const [fd, s] of size) if (fd + k <= d.today) {
        n += s; r += cell.get(fd + ":" + k) || 0;
        rr += sumBy((lastBy.get(fd) || []).filter((x) => x.lastk >= k), (x) => x.n);
      }
      classic.push(n >= 5 ? r / n : null); rolling.push(n >= 5 ? rr / n : null);
    }
    const at = (k) => classic[k - 1] === null ? "–" : Math.round(classic[k - 1] * 100) + "%";
    const out = [tiles([["D1", at(1)], ["D7", at(7)], ["D30", at(30)],
      ["Came back after a week away", int(d.returned), "in " + d.range + " days"]])];
    out.push(card("Return curve, day 1 to day 30",
      legend([["var(--a)", "Classic: played exactly on day n"], ["var(--a2)", "Rolling: day n or any day after"]]),
      curve([classic, rolling], ["var(--a)", "var(--a2)"]), axis(["D1", "D8", "D15", "D22", "D30"])));
    /* The table shows the last month (or the range, if longer); the curve above
       also uses the month before, so that D30 has cohorts old enough to read. */
    const cohorts = d.sizes.filter((r) => r.n > 0 && r.fd > d.today - Math.max(d.range, 31));
    if (!cohorts.length) out.push(card("Retention by cohort, day by day", empty()));
    else {
      const head = h("tr", null, h("th", { class: "left", text: "First day" }), h("th", { text: "New" }), d.cols.map((k) => h("th", { text: "D" + k })));
      const body = cohorts.map((c) => h("tr", null, h("td", { class: "left", text: dayLabel(c.fd) }), h("td", { text: int(c.n) }),
        d.cols.map((k) => {
          if (c.fd + k > d.today) return h("td", { text: "–", style: { color: "var(--muted)" } });
          if (c.n < 5) return h("td", { text: "under 5", style: { color: "var(--muted)", fontSize: "11px" } });
          const v = (cell.get(c.fd + ":" + k) || 0) / c.n, a = Math.min(0.92, v * 2.5);
          return h("td", { text: Math.round(v * 100) + "%", style: { background: "rgba(47,91,234," + a.toFixed(2) + ")", color: a > 0.5 ? "#fff" : "inherit", fontWeight: 600 } });
        })));
      out.push(card("Retention by cohort, day by day",
        h("div", { class: "small", text: "One row per first day. Each cell: the share of that day's new players who played again exactly n days later." }),
        h("div", { class: "scroll", style: { maxHeight: "560px" } }, h("table", null, h("thead", null, head), h("tbody", null, body)))));
    }
    const seg = (title, rows, fmt) => h("div", null, h("div", { class: "small", text: title }),
      hbars(rows.map((r) => ({ label: fmt ? fmt(r.label) : r.label, n: r.r, of: r.n })), null, (r) => share(r.n, r.of)));
    out.push(h("div", { class: "grid2" },
      card("D7 return, by what happened on day one",
        seg("Source", d.segments.source),
        d.segments.loom.length ? seg("First loom", d.segments.loom, (l) => LOOMS[l] || l) : null,
        d.segments.first.length ? seg("First day's result", d.segments.first) : null),
      card("Streak on the last day played", h("div", { class: "small", text: "Players who stopped (7 days without playing), by the streak they had" }),
        hbars(["1", "2", "3", "4–6", "7–13", "14+"].map((l) => ({ label: l, n: (d.churn.find((r) => r.label === l) || {}).n || 0 })),
          sumBy(d.churn, (r) => r.n) || null))));
    return out;
  };

  function curve(lines, colours) {
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 580 200"); svg.setAttribute("preserveAspectRatio", "none");
    svg.setAttribute("role", "img"); svg.setAttribute("aria-label", "retention curves");
    svg.style.width = "100%"; svg.style.height = "200px";
    for (const y of [0, 50, 100, 150, 199]) {
      const l = document.createElementNS(NS, "line");
      l.setAttribute("x1", 0); l.setAttribute("x2", 580); l.setAttribute("y1", y); l.setAttribute("y2", y);
      l.setAttribute("stroke", "var(--soft)"); l.setAttribute("vector-effect", "non-scaling-stroke"); svg.appendChild(l);
    }
    const top = Math.max(0.1, ...lines.flat().filter((v) => v !== null));
    lines.forEach((vals, i) => {
      const pts = vals.map((v, k) => v === null ? null : (k * 20) + "," + (200 - (v / top) * 196).toFixed(1)).filter(Boolean);
      if (pts.length < 2) return;
      const p = document.createElementNS(NS, "polyline");
      p.setAttribute("points", pts.join(" ")); p.setAttribute("fill", "none"); p.setAttribute("stroke", colours[i]);
      p.setAttribute("stroke-width", "2.5"); p.setAttribute("vector-effect", "non-scaling-stroke"); svg.appendChild(p);
    });
    const wrap = h("div", null, svg);
    wrap.appendChild(h("div", { class: "small", text: "Top of the chart: " + Math.round(top * 100) + "%" }));
    return wrap;
  }

  PAGES.engagement = (d) => {
    const k = d.k;
    const out = [tiles([["Players today", int(k.dau)], ["This week", int(k.wau), "rolling 7 days"], ["This month", int(k.mau), "rolling 30 days"],
      ["Sittings a day", k.spd ? k.spd.toFixed(1) : "–", "per active player"], ["Time in game", dur(k.seconds), "per player per day"]])];
    const hmax = Math.max(1, ...d.heat.map((r) => r.n));
    const grid = h("div", { class: "heat", role: "img", "aria-label": "sittings by hour and weekday" });
    for (let w = 0; w < 7; w++) {
      grid.appendChild(h("span", { class: "small", text: DOW[w] }));
      for (let hr = 0; hr < 24; hr++) {
        const n = (d.heat.find((r) => r.dow === w && r.hour === hr) || {}).n || 0;
        grid.appendChild(h("div", { title: DOW[w] + " " + hr + ":00, " + n, style: { background: "rgba(47,91,234," + (0.06 + 0.86 * n / hmax).toFixed(2) + ")" } }));
      }
    }
    grid.appendChild(h("span"));
    for (let hr = 0; hr < 24; hr++) grid.appendChild(h("span", { class: "small", style: { textAlign: "center" }, text: hr % 3 ? "" : String(hr) }));
    out.push(card("When they play", h("div", { class: "small", text: "Sittings by hour and weekday, on each player's own clock" }), h("div", { class: "scroll" }, grid)));
    const LB = ["< 1 m", "1–2 m", "2–5 m", "5–10 m", "10–20 m", "20 m +"];
    const lt = sumBy(d.lengths, (r) => r.n);
    const fw = sumBy(d.firstWeek, (r) => r.n);
    out.push(h("div", { class: "grid2" },
      card("Sitting length", h("div", { class: "small", text: "Median " + dur(d.median) }),
        hbars(LB.map((l, i) => ({ label: l, n: (d.lengths.find((r) => r.b === i) || {}).n || 0 })), lt || null)),
      card("Days played in the first week", h("div", { class: "small", text: "New players whose first week is over" }),
        hbars([1, 2, 3, 4, 5, 6, 7].map((n) => ({ label: n + (n === 1 ? " day" : " days"), n: (d.firstWeek.find((r) => r.days === n) || {}).n || 0 })), fw || null))));
    const t = (n) => sumBy(pick(d.totals, n, ""), (r) => r.players);
    const open = (c) => sumBy(pick(d.opens, "app_open", c), (r) => r.events);
    const ot = sumBy(d.opens, (r) => r.events);
    out.push(h("div", { class: "grid3" },
      card("What opened the game", hbars(["launcher", "reminder", "link"].map((c) => ({ label: c, n: open(c) })), ot || null)),
      card("The reminder", hbars([["Offered", t("reminder_offered")], ["Accepted", t("reminder_accepted")], ["Declined", t("reminder_declined")],
        ["Refused by Android", t("reminder_permission_denied")], ["Opened the game", t("reminder_opened")]].map(([l, n]) => ({ label: l, n })), null)),
      card("What they use", h("div", { class: "small", text: "Share of player-days" }),
        hbars([["Statistics", "stats_opened"], ["Quilt", "quilt_opened"], ["Archive", "archive_opened"], ["Replayed solution", "solution_replayed"],
          ["Help", "help_opened"], ["Shared a result", "share_pressed"]].map(([l, n]) => ({ label: l, n: t(n) })), d.playerDays || null))));
    return out;
  };

  PAGES.progress = (d) => {
    if (d.note) return [card(null, empty(d.note))];
    const looms = ["e", "n", "h", ""].filter((l) => d.results.some((r) => r.loom === l) || pick(d.opened, "day_opened", l).length);
    if (!looms.length) return [card("The day, per loom", empty())];
    const n = (l, res) => (d.results.find((r) => r.loom === l && r.result === res) || {}).n || 0;
    const all = (res) => sumBy(d.results.filter((r) => r.result === res), (r) => r.n);
    const resolved = all("solved") + all("failed") + all("left");
    const out = [tiles([["Solved", share(all("solved"), resolved), "of days touched"], ["Left unfinished", share(all("left"), resolved)],
      ["Current streak", d.streak === null ? "–" : d.streak + (d.streak === 1 ? " day" : " days"), "median, players today"],
      ["Quilt squares", d.quilt === null ? "–" : int(d.quilt), "median, all players"]])];
    out.push(card("The day, per loom", table(["Loom", "Opened", "Solved", "Failed", "Left", "Median time to solve"],
      looms.map((l) => { const tot = n(l, "solved") + n(l, "failed") + n(l, "left");
        return [LOOMS[l], int(sumBy(pick(d.opened, "day_opened", l), (r) => r.events)),
                share(n(l, "solved"), tot), share(n(l, "failed"), tot), share(n(l, "left"), tot), dur(d.secs[l])]; }))));
    out.push(h("div", { class: "grid3" }, looms.filter((l) => l).map((l) => {
      const rows = d.tries.filter((r) => r.loom === l);
      return card("Tries to solve: " + LOOMS[l], hbars([1, 2, 3, 4, 5].map((t) => ({ label: t === 5 ? "5+" : String(t), n: (rows.find((r) => r.t === t) || {}).n || 0 })),
        sumBy(rows, (r) => r.n) || null));
    })));
    const wk = h("tbody", null, looms.map((l) => h("tr", null, h("td", { class: "left", text: LOOMS[l] }), DOW.map((x, i) => {
      const r = d.weekday.find((w) => w.loom === l && w.dow === i) || { solved: 0, failed: 0 };
      const tot = r.solved + r.failed;
      if (tot < 5) return h("td", { text: tot ? "under 5" : "–", style: { color: "var(--muted)", fontSize: "11px" } });
      const v = r.solved / tot, a = Math.max(0.08, Math.min(0.9, v));
      return h("td", { text: Math.round(v * 100) + "%", style: { background: "rgba(47,91,234," + a.toFixed(2) + ")", color: a > 0.5 ? "#fff" : "inherit", fontWeight: 600 } });
    }))));
    out.push(card("Solve rate by weekday (gate 7)", h("div", { class: "scroll" }, h("table", null,
      h("thead", null, h("tr", null, h("th", { class: "left", text: "Loom" }), DOW.map((x) => h("th", { text: x })))), wk))));
    const L = d.ladder || {};
    const ev = (name) => sumBy(pick(d.events, name, ""), (r) => r.events);
    out.push(h("div", { class: "grid2" },
      card("The ladder: days played, ever", hbars([["1 day", L.d1], ["3 days", L.d3], ["7 days", L.d7], ["14 days", L.d14], ["30 days", L.d30],
        ["60 days", L.d60], ["100 days", L.d100]].map(([l, v]) => ({ label: l, n: v || 0 })), L.d1 || null,
        (r) => (r.n < 5 && r.n > 0 ? "under 5" : share(r.n, L.d1)) + " (" + int(r.n) + ")")),
      card("Looms, hints and milestones", hbars([["Loom advice shown", ev("loom_advice_shown")], ["Loom advice taken", ev("loom_advice_taken")],
        ["Hints taken", ev("hint_taken")], ["Extra weaves taken", ev("extra_weave_taken")], ["Archive days opened", ev("archive_opened")],
        ["Streak of 7 days or more, today", (d.s7 && d.s7.s7) || 0]].concat(d.milestones.map((m) => ["Milestone " + m.value, m.players])).map(([l, v]) => ({ label: l, n: v })), null))));
    return out;
  };

  PAGES.money = (d) => {
    const k = d.k;
    const rev = k.rev || 0, ads = k.ads || 0;
    const out = [tiles([["Purchases (verified)", money(rev)], ["Adverts", money(ads)],
      ["Per player-day", k.playerDays ? ((rev + ads) / 1e6 / k.playerDays).toFixed(4) + " €" : "–", "ARPDAU"],
      ["Payers", share(k.payers, k.players), "of players in the range"]])];
    const places = [...new Set(d.offers.map((r) => r.value))];
    const s = (name, p) => int(sumBy(pick(d.offers, name, p), (r) => r.events));
    out.push(card("The offer, by placement", places.length
      ? table(["Placement", "Shown", "Dismissed", "Purchase started", "Completed"],
              places.map((p) => [p, s("offer_shown", p), s("offer_dismissed", p), s("purchase_started", p), s("purchase_completed", p)]))
      : empty()));
    const rp = [...new Set(d.rewarded.map((r) => r.value))];
    const rs = (name, p) => int(sumBy(pick(d.rewarded, name, p), (r) => r.events));
    const rewardedTable = rp.length
      ? table(["Placement", "Offered", "Started", "Completed"],
              rp.map((p) => [p, rs("rewarded_ad_offered", p), rs("rewarded_ad_started", p), rs("rewarded_ad_completed", p)]))
      : empty();
    out.push(h("div", { class: "grid2" },
      card("Rewarded adverts, by placement", rewardedTable,
        h("div", { class: "small", text: "Interstitials shown: " + int(sumBy(d.inter, (r) => r.events)) })),
      card("Why purchases failed", hbars(d.failed.map((r) => ({ label: r.value, n: r.events })), null))));
    out.push(card("Purchases, day by day", d.revenue.length
      ? table(["Day", "Product", "Count", "Amount", "Google signed"],
              d.revenue.map((r) => [dayLabel(r.day), r.sku, int(r.n),
                r.micros ? (r.micros / 1e6).toFixed(2) + " " + (r.currency || "") : null, r.verified ? "yes" : "no"]))
      : empty("No purchases in this range.")));
    return out;
  };

  PAGES.health = (d) => {
    const it = d.intake;
    const today = it.find((r) => r.day === d.today) || { batches: 0, kept: 0, refused: 0 };
    const n = d.nightly;
    const out = [tiles([
      ["Batches today", int(today.batches), "rows the collector wrote; the free limit is 100,000 a day"],
      ["Events refused", int(sumBy(it, (r) => r.refused)), "since " + dayLabel(d.since)],
      ["Waited offline over an hour", share(d.delay.late, d.delay.n), "average wait " + dur(d.delay.avg)],
      ["Last nightly run", n ? dayLabel(Math.floor((Date.parse(n.at) - DAY0) / 86400000)) + ", " + n.at.slice(11, 16) : "not yet", n ? "rebuilt from " + dayLabel(n.from) + ", " + n.ms + " ms" : "the first runs at 02:10 UTC"],
    ])];
    out.push(card("Script errors, since " + dayLabel(d.since), d.errors.length
      ? table(["Version", "Kind", "Line:column", "Where", "Count"],
              d.errors.map((e) => [e.vc, e.kind, (e.line || 0) + ":" + (e.col || 0), e.place, int(e.n)]))
      : empty("No script errors.")));
    out.push(h("div", { class: "grid3" },
      card("Versions, last 7 days", hbars(d.versions.map((r) => ({ label: r.vc ? "Version " + r.vc : "Unknown", n: r.n })), sumBy(d.versions, (r) => r.n) || null)),
      card("Consent answers", hbars(d.consent.map((r) => ({ label: r.value, n: r.players })), null)),
      card("Logins and deletions", hbars([["Logins, last day", (d.logins && d.logins.ok) || 0], ["Failed logins, last day", (d.logins && d.logins.failed) || 0],
        ["Players' deletion requests", d.deleted]].map(([l, v]) => ({ label: l, n: v })), null))));
    return out;
  };

  /* ---------- the frame ---------- */
  const state = { page: "overview", game: store.get("game", "loom"), range: store.get("range", "30"), build: store.get("build", "release") };
  let ticket = 0;

  async function show() {
    const page = (location.hash || "#overview").slice(1);
    state.page = PAGES[page] ? page : "overview";
    document.querySelectorAll("nav a").forEach((a) => { if (a.getAttribute("href") === "#" + state.page) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current"); });
    document.querySelectorAll("[data-range]").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.range === state.range)));
    document.getElementById("title").textContent = TITLES[state.page];
    const box = document.getElementById("page");
    const mine = ++ticket;
    box.replaceChildren(h("p", { class: "empty", text: "Loading…" }));
    try {
      const q = new URLSearchParams({ game: state.game, range: state.range, build: state.build });
      const r = await fetch("/va/api/" + state.page + "?" + q, { credentials: "same-origin", headers: { Accept: "application/json" } });
      if (r.status === 401) { location.href = "/va/login"; return; }
      const d = await r.json();
      if (mine !== ticket) return;
      if (!r.ok) throw new Error(d.detail || d.error || r.status);
      document.getElementById("subtitle").textContent = SUBS[state.page] + " · " + dayLabel(d.from) + " to " + dayLabel(d.today);
      box.replaceChildren(h("div", { style: { display: "flex", flexDirection: "column", gap: "20px" } }, PAGES[state.page](d)));
    } catch (e) {
      if (mine !== ticket) return;
      box.replaceChildren(h("p", { class: "err", text: "Could not load this page: " + (e && e.message || e) }));
    }
  }

  function start() {
    const g = document.getElementById("game"), b = document.getElementById("build");
    g.value = state.game; b.value = state.build;
    g.addEventListener("change", () => { state.game = g.value; store.set("game", g.value); show(); });
    b.addEventListener("change", () => { state.build = b.value; store.set("build", b.value); show(); });
    document.querySelectorAll("[data-range]").forEach((btn) => btn.addEventListener("click", () => {
      state.range = btn.dataset.range; store.set("range", state.range); show(); }));
    addEventListener("hashchange", show);
    show();
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
})();
