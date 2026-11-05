/* Voltix Studios — electricity on the home page.
 *
 * Two effects, both drawn on canvases that take no clicks:
 *   - arcs that crackle around the ring of the V in the hero lockup: some crawl along the
 *     ring, some jump off it, now and then one crosses inside it;
 *   - two live rails down the left and right edges of the screen, with a current that runs
 *     along them and a bolt that strikes down one now and then. Only where the screen is wide
 *     enough to leave the page's margins empty, so they never cross text.
 *
 * Nothing runs for anyone whose system asks for reduced motion, nothing is drawn while the
 * tab is hidden, and the hero's arcs stop once the hero is scrolled away. No library.
 */
(function () {
  "use strict";
  if (!window.matchMedia || !window.requestAnimationFrame) return;
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  var DPR = Math.min(window.devicePixelRatio || 1, 2);
  var COLORS = [
    { glow: "rgba(53, 163, 255, 0.85)", core: "rgba(226, 244, 255, 0.95)" },  /* volt blue */
    { glow: "rgba(160, 107, 255, 0.85)", core: "rgba(240, 230, 255, 0.95)" }, /* violet */
    { glow: "rgba(64, 224, 255, 0.85)", core: "rgba(235, 252, 255, 0.95)" }   /* cyan */
  ];
  var rnd = function (a, b) { return a + Math.random() * (b - a); };
  var pick = function (list) { return list[(Math.random() * list.length) | 0]; };

  /* A jagged line between two points: the midpoint pushed sideways, recursively. */
  function jag(x1, y1, x2, y2, spread, depth, out) {
    if (depth === 0) { out.push(x2, y2); return; }
    var mx = (x1 + x2) / 2, my = (y1 + y2) / 2;
    var dx = x2 - x1, dy = y2 - y1, len = Math.sqrt(dx * dx + dy * dy) || 1;
    var off = rnd(-spread, spread);
    mx += (-dy / len) * off; my += (dx / len) * off;
    jag(x1, y1, mx, my, spread / 2, depth - 1, out);
    jag(mx, my, x2, y2, spread / 2, depth - 1, out);
  }
  function bolt(x1, y1, x2, y2, spread, depth) {
    var pts = [x1, y1]; jag(x1, y1, x2, y2, spread, depth, pts); return pts;
  }

  function stroke(ctx, pts, color, width, alpha) {
    if (pts.length < 4) return;
    ctx.globalAlpha = alpha;
    ctx.beginPath(); ctx.moveTo(pts[0], pts[1]);
    for (var i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.lineCap = "round"; ctx.lineJoin = "round";
    ctx.strokeStyle = color.glow; ctx.lineWidth = width * 3.2; ctx.shadowColor = color.glow; ctx.shadowBlur = 18 * DPR;
    ctx.stroke();
    ctx.shadowBlur = 0; ctx.strokeStyle = color.core; ctx.lineWidth = width;
    ctx.stroke();
    ctx.globalAlpha = 1;
  }

  function sizeCanvas(canvas) {
    var r = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(r.width * DPR)), h = Math.max(1, Math.round(r.height * DPR));
    if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
    return { w: w, h: h };
  }

  /* ── the ring ─────────────────────────────────────────────────────────── */
  /* Where the ring sits in assets/img/voltix-lockup.webp (1000 × 931), measured from the
     image: centre at 49.75 % across and 40.3 % down, radius 27.5 % of its width. The canvas
     overhangs the image by OVER on every side, so arcs can leave the ring. */
  var RING = { cx: 0.4975, cy: 0.4033, r: 0.275 }, OVER = 0.22;

  function ring() {
    var img = document.querySelector(".hero__lockup");
    if (!img) return;
    var canvas = document.createElement("canvas");
    canvas.className = "hero__sparks";
    canvas.setAttribute("aria-hidden", "true");
    img.parentNode.insertBefore(canvas, img.nextSibling);
    var ctx = canvas.getContext("2d");
    var arcs = [], visible = true, running = false, nextAt = 0;

    function place() {
      var host = img.offsetParent || document.body;
      var w = img.offsetWidth, h = img.offsetHeight;
      canvas.style.left = (img.offsetLeft - w * OVER) + "px";
      canvas.style.top = (img.offsetTop - w * OVER) + "px";
      canvas.style.width = (w * (1 + 2 * OVER)) + "px";
      canvas.style.height = (h + 2 * w * OVER) + "px";
      return host;
    }
    function geometry() {
      var s = sizeCanvas(canvas), w = img.offsetWidth * DPR, o = w * OVER;
      return { cx: o + RING.cx * w, cy: o + RING.cy * img.offsetHeight * DPR, r: RING.r * w, unit: w / 400 };
    }

    function spawn(now) {
      var g = geometry(), a = rnd(0, Math.PI * 2), kind = Math.random(), color = pick(COLORS);
      var life = rnd(150, 340), make;
      if (kind < 0.55) {            /* crawls along the ring */
        var span = rnd(0.25, 0.85) * (Math.random() < 0.5 ? -1 : 1);
        make = function () {
          var pts = [], n = 12;
          for (var i = 0; i <= n; i++) {
            var t = a + span * (i / n), rr = g.r + rnd(-5, 5) * g.unit;
            pts.push(g.cx + Math.cos(t) * rr, g.cy + Math.sin(t) * rr);
          }
          return [pts];
        };
      } else if (kind < 0.9) {      /* jumps off the ring, with a branch */
        var len = rnd(26, 70) * g.unit;
        make = function () {
          var x1 = g.cx + Math.cos(a) * g.r, y1 = g.cy + Math.sin(a) * g.r;
          var b = a + rnd(-0.35, 0.35), x2 = g.cx + Math.cos(b) * (g.r + len), y2 = g.cy + Math.sin(b) * (g.r + len);
          var main = bolt(x1, y1, x2, y2, 14 * g.unit, 4), k = 2 * ((main.length / 2 * rnd(0.3, 0.7)) | 0);
          var bx = main[k], by = main[k + 1], c = b + rnd(-0.8, 0.8);
          return [main, bolt(bx, by, bx + Math.cos(c) * len * 0.45, by + Math.sin(c) * len * 0.45, 8 * g.unit, 3)];
        };
      } else {                      /* crosses inside the ring */
        var b2 = a + rnd(0.6, 1.4);
        make = function () {
          return [bolt(g.cx + Math.cos(a) * g.r, g.cy + Math.sin(a) * g.r,
                       g.cx + Math.cos(b2) * g.r, g.cy + Math.sin(b2) * g.r, 26 * g.unit, 5)];
        };
      }
      arcs.push({ born: now, life: life, color: color, make: make, shape: make(), flick: now, width: rnd(1.1, 1.9) * DPR * Math.max(0.7, g.unit) });
    }

    function frame(now) {
      if (!visible || document.hidden) { running = false; ctx.clearRect(0, 0, canvas.width, canvas.height); return; }
      if (now >= nextAt) { spawn(now); if (Math.random() < 0.4) spawn(now); nextAt = now + rnd(90, 480); }
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.globalCompositeOperation = "lighter";
      for (var i = arcs.length - 1; i >= 0; i--) {
        var arc = arcs[i], age = now - arc.born;
        if (age > arc.life) { arcs.splice(i, 1); continue; }
        if (now - arc.flick > 45) { arc.shape = arc.make(); arc.flick = now; }  /* the crackle */
        var fade = 1 - age / arc.life, alpha = fade * (Math.random() < 0.15 ? 0.35 : 1);
        for (var j = 0; j < arc.shape.length; j++) stroke(ctx, arc.shape[j], arc.color, j ? arc.width * 0.6 : arc.width, alpha);
      }
      ctx.globalCompositeOperation = "source-over";
      requestAnimationFrame(frame);
    }
    function start() { if (!running && visible && !document.hidden) { running = true; requestAnimationFrame(frame); } }

    function relayout() { place(); geometry(); }
    if (img.complete) relayout(); else img.addEventListener("load", relayout);
    window.addEventListener("resize", relayout);
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (e) { visible = e[0].isIntersecting; if (visible) start(); }).observe(img);
    }
    document.addEventListener("visibilitychange", start);
    start();
  }

  /* ── the rails ────────────────────────────────────────────────────────── */
  /* Drawn only when the page's content leaves at least MARGIN pixels empty on each side. */
  var MARGIN = 72, RAIL = 22;

  function rails() {
    /* The right canvas is the left one mirrored (CSS), so both draw toward the content. */
    var sides = ["left", "right"].map(function (side) {
      var c = document.createElement("canvas");
      c.className = "rail rail--" + side;
      c.setAttribute("aria-hidden", "true");
      document.body.appendChild(c);
      return { side: side, canvas: c, ctx: c.getContext("2d"), bolts: [], pulses: [] };
    });
    var on = false, running = false, nextBolt = 0, nextPulse = 0;

    function fits() {
      var wrap = document.querySelector(".wrap");
      var content = wrap ? wrap.getBoundingClientRect().width : 1200;
      return (window.innerWidth - Math.min(content, 1240)) / 2 >= MARGIN;
    }
    function layout() {
      on = fits();
      sides.forEach(function (s) { s.canvas.style.display = on ? "block" : "none"; if (on) sizeCanvas(s.canvas); });
      start();
    }

    function drawRail(s) {
      var ctx = s.ctx, h = s.canvas.height, x = RAIL * DPR;
      var g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, "rgba(53, 163, 255, 0)");
      g.addColorStop(0.2, "rgba(53, 163, 255, 0.38)");
      g.addColorStop(0.6, "rgba(160, 107, 255, 0.34)");
      g.addColorStop(1, "rgba(160, 107, 255, 0)");
      ctx.strokeStyle = g; ctx.lineWidth = 1 * DPR;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    function frame(now) {
      if (!on || document.hidden) { running = false; return; }
      var h = sides[0].canvas.height, x = RAIL * DPR;
      if (now >= nextBolt) {
        var s = pick(sides), y = rnd(0.05, 0.8) * h, len = rnd(160, 460) * DPR;
        s.bolts.push({ born: now, life: rnd(160, 320), y: y, len: len, color: pick(COLORS), flick: 0, shape: null });
        nextBolt = now + rnd(700, 2200);
      }
      if (now >= nextPulse) {
        pick(sides).pulses.push({ born: now, speed: rnd(0.5, 1.0) * DPR, dir: Math.random() < 0.5 ? 1 : -1, color: pick(COLORS) });
        nextPulse = now + rnd(900, 2600);
      }
      sides.forEach(function (s) {
        var ctx = s.ctx;
        ctx.clearRect(0, 0, s.canvas.width, h);
        drawRail(s);
        ctx.globalCompositeOperation = "lighter";
        for (var i = s.pulses.length - 1; i >= 0; i--) {
          var p = s.pulses[i], d = (now - p.born) * p.speed, y = p.dir > 0 ? d : h - d;
          if (y < -200 * DPR || y > h + 200 * DPR) { s.pulses.splice(i, 1); continue; }
          var tail = 140 * DPR, gr = ctx.createLinearGradient(0, y - p.dir * tail, 0, y);
          gr.addColorStop(0, "rgba(0,0,0,0)"); gr.addColorStop(1, p.color.glow);
          ctx.strokeStyle = gr; ctx.lineWidth = 2 * DPR; ctx.shadowColor = p.color.glow; ctx.shadowBlur = 10 * DPR;
          ctx.beginPath(); ctx.moveTo(x, y - p.dir * tail); ctx.lineTo(x, y); ctx.stroke(); ctx.shadowBlur = 0;
          ctx.fillStyle = p.color.core; ctx.beginPath(); ctx.arc(x, y, 1.8 * DPR, 0, Math.PI * 2); ctx.fill();
        }
        for (var j = s.bolts.length - 1; j >= 0; j--) {
          var b = s.bolts[j], age = now - b.born;
          if (age > b.life) { s.bolts.splice(j, 1); continue; }
          if (!b.shape || now - b.flick > 50) {
            var inward = 1, main = bolt(x, b.y, x + rnd(-6, 6) * DPR, b.y + b.len, 22 * DPR, 6);
            var k = 2 * ((main.length / 2 * rnd(0.25, 0.6)) | 0), bx = main[k], by = main[k + 1];
            b.shape = [main, bolt(bx, by, bx + inward * rnd(18, 40) * DPR, by + rnd(20, 70) * DPR, 10 * DPR, 4)];
            b.flick = now;
          }
          var alpha = (1 - age / b.life) * (Math.random() < 0.2 ? 0.4 : 1);
          stroke(ctx, b.shape[0], b.color, 1.2 * DPR, alpha);
          stroke(ctx, b.shape[1], b.color, 0.8 * DPR, alpha);
        }
        ctx.globalCompositeOperation = "source-over";
      });
      /* Between events the rails are still: draw them once and sleep until the next one. */
      var busy = sides.some(function (s) { return s.bolts.length || s.pulses.length; });
      if (busy) requestAnimationFrame(frame);
      else { running = false; clearTimeout(wake); wake = setTimeout(start, Math.max(16, Math.min(nextBolt, nextPulse) - now)); }
    }
    var wake = 0;
    function start() { if (on && !running && !document.hidden) { running = true; requestAnimationFrame(frame); } }

    window.addEventListener("resize", layout);
    document.addEventListener("visibilitychange", start);
    layout();
  }

  function go() { ring(); rails(); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", go); else go();
})();
