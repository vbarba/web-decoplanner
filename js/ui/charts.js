/*
 * HALDANE — visualization module
 * js/ui/charts.js
 *
 * Pure-SVG dive profile + tissue loading charts for the HALDANE deco planner.
 * Zero dependencies, no build step. Works as a plain <script> tag (window.Charts)
 * and under Node (module.exports) for the self-check at the bottom of this file.
 *
 * Reads ONLY contract fields of the engine `result` object:
 *   profile, ceilingProfile, stops, table, finalTissues, params, totalRuntime.
 *
 * API:
 *   Charts.renderProfile(containerEl, result, opts)   opts = { units: 'metric'|'imperial' }
 *   Charts.renderTissues(containerEl, result, opts)
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.Charts = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  var VERSION = '1.1.1';
  var SVG_NS = 'http://www.w3.org/2000/svg';

  // ---- visual language (must match the app shell) -------------------------
  var INK = '#d7e7f2';
  var DIM = '#6b8499';
  var PHOSPHOR = '#35e0c2';
  var AMBER = '#ffb454';
  var ALERT = '#ff5d6c';
  var GRID = 'rgba(120,180,200,.15)';
  var AXIS = 'rgba(120,180,200,.35)';
  var BUBBLE_BG = 'rgba(7,12,19,.92)';
  var BUBBLE_EDGE = 'rgba(120,180,200,.28)';
  var FONT = "'Sometype Mono', ui-monospace, Menlo, Consolas, monospace";

  var FT_PER_M = 3.28084;
  var uidCounter = 0;

  // ==========================================================================
  // Pure helpers (no DOM) — exercised by the Node self-check.
  // ==========================================================================

  function isNum(v) { return typeof v === 'number' && isFinite(v); }

  function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

  function r2(n) { return Math.round(n * 100) / 100; }

  function fmt1(n) { return String(Math.round(n * 10) / 10); }

  // Smallest "nice" step (1, 2, 2.5, 5 x 10^k) >= raw.
  function niceStep(raw) {
    if (!isNum(raw) || raw <= 0) return 1;
    var pow = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var bases = [1, 2, 2.5, 5, 10];
    for (var i = 0; i < bases.length; i++) {
      var s = bases[i] * pow;
      if (s >= raw - raw * 1e-9) return s;
    }
    return 10 * pow;
  }

  // Nice ticks covering [min, max]; returns { step, ticks }.
  function makeTicks(min, max, target) {
    if (!isNum(min)) min = 0;
    if (!isNum(max) || max <= min) max = min + 1;
    target = target || 6;
    var step = niceStep((max - min) / target);
    var start = Math.ceil(min / step - 1e-9) * step;
    var ticks = [];
    for (var v = start; v <= max + step * 1e-6 && ticks.length < 200; v += step) {
      ticks.push(Math.round(v * 1e6) / 1e6);
    }
    return { step: step, ticks: ticks };
  }

  function fmtTick(v, step) {
    return step < 1 ? (Math.round(v * 10) / 10).toFixed(1) : String(Math.round(v));
  }

  // Linear scale with invert.
  function linScale(d0, d1, r0, r1) {
    var dd = (d1 - d0) || 1;
    function s(v) { return r0 + ((v - d0) / dd) * (r1 - r0); }
    s.invert = function (r) { return d0 + ((r - r0) / ((r1 - r0) || 1)) * dd; };
    return s;
  }

  // Polyline path string from [{x,y}].
  function buildPath(pts) {
    if (!pts || !pts.length) return '';
    var d = 'M' + r2(pts[0].x) + ' ' + r2(pts[0].y);
    for (var i = 1; i < pts.length; i++) d += ' L' + r2(pts[i].x) + ' ' + r2(pts[i].y);
    return d;
  }

  // Closed area between a polyline and a horizontal baseline.
  function buildAreaPath(pts, baseY) {
    if (!pts || !pts.length) return '';
    var d = 'M' + r2(pts[0].x) + ' ' + r2(baseY);
    for (var i = 0; i < pts.length; i++) d += ' L' + r2(pts[i].x) + ' ' + r2(pts[i].y);
    d += ' L' + r2(pts[pts.length - 1].x) + ' ' + r2(baseY) + ' Z';
    return d;
  }

  function pathLength(pts) {
    var L = 0;
    for (var i = 1; i < (pts ? pts.length : 0); i++) {
      var dx = pts[i].x - pts[i - 1].x, dy = pts[i].y - pts[i - 1].y;
      L += Math.sqrt(dx * dx + dy * dy);
    }
    return L;
  }

  // Nearest sample index in an array sorted by .t (binary search).
  function nearestIndex(arr, t) {
    if (!arr || !arr.length) return -1;
    var hi = arr.length - 1, lo = 0;
    if (t <= arr[0].t) return 0;
    if (t >= arr[hi].t) return hi;
    while (hi - lo > 1) {
      var mid = (lo + hi) >> 1;
      if (arr[mid].t <= t) lo = mid; else hi = mid;
    }
    return (t - arr[lo].t) <= (arr[hi].t - t) ? lo : hi;
  }

  // GF% -> bar color ramp.
  function colorForPct(v) {
    if (!isNum(v)) return PHOSPHOR;
    if (v > 100) return ALERT;
    if (v >= 70) return AMBER;
    return PHOSPHOR;
  }

  // Split a ceilingProfile into runs where ceiling > 0, keeping one boundary
  // zero-sample on each side so dashed segments meet the surface cleanly.
  function ceilingSegments(cp) {
    var segs = [], cur = null;
    if (!cp) return segs;
    for (var i = 0; i < cp.length; i++) {
      var p = cp[i];
      var c = (p && isNum(p.ceiling)) ? p.ceiling : 0;
      if (c > 0) {
        if (!cur) {
          cur = [];
          if (i > 0 && cp[i - 1] && isNum(cp[i - 1].t)) cur.push(cp[i - 1]);
        }
        cur.push(p);
      } else if (cur) {
        if (p && isNum(p.t)) cur.push(p);
        segs.push(cur);
        cur = null;
      }
    }
    if (cur) segs.push(cur);
    return segs;
  }

  function depthFactor(units) { return units === 'imperial' ? FT_PER_M : 1; }
  function depthUnit(units) { return units === 'imperial' ? 'ft' : 'm'; }

  // ==========================================================================
  // DOM helpers
  // ==========================================================================

  function el(tag, attrs) {
    var n = document.createElementNS(SVG_NS, tag);
    if (attrs) for (var k in attrs) {
      if (Object.prototype.hasOwnProperty.call(attrs, k) && attrs[k] != null) {
        n.setAttribute(k, attrs[k]);
      }
    }
    return n;
  }

  function textEl(x, y, str, fill, size, anchor, extra) {
    var t = el('text', {
      x: r2(x), y: r2(y),
      fill: fill || DIM,
      'font-family': FONT,
      'font-size': size || 10,
      'text-anchor': anchor || 'start'
    });
    if (extra) for (var k in extra) {
      if (Object.prototype.hasOwnProperty.call(extra, k)) t.setAttribute(k, extra[k]);
    }
    t.textContent = str == null ? '' : String(str);
    return t;
  }

  function captionEl(x, y, str, anchor) {
    return textEl(x, y, str, DIM, 9, anchor || 'start', { 'letter-spacing': '2.5' });
  }

  function clearEl(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function makeSvg(W, H, label) {
    var svg = el('svg', {
      viewBox: '0 0 ' + W + ' ' + H,
      width: '100%',
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': label,
      style: 'width:100%;height:auto;display:block;background:transparent;user-select:none;'
    });
    return svg;
  }

  function prefersReducedMotion() {
    if (typeof window === 'undefined' || !window.matchMedia) return true;
    try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch (e) { return true; }
  }

  function emptyFrame(containerEl, W, H, msg, label) {
    var svg = makeSvg(W, H, label);
    svg.appendChild(el('rect', {
      x: 0.5, y: 0.5, width: W - 1, height: H - 1,
      fill: 'none', stroke: GRID
    }));
    svg.appendChild(textEl(W / 2, H / 2, msg, DIM, 11, 'middle', { 'letter-spacing': '3' }));
    containerEl.appendChild(svg);
    return svg;
  }

  // ==========================================================================
  // PROFILE CHART
  // ==========================================================================

  function renderProfile(containerEl, result, opts) {
    if (!containerEl || typeof document === 'undefined') return;
    opts = opts || {};
    result = result || {};
    var units = opts.units === 'imperial' ? 'imperial' : 'metric';
    var dF = depthFactor(units);
    var dU = depthUnit(units);

    clearEl(containerEl);

    var W = 720, H = 360;
    var M = { t: 24, r: 18, b: 42, l: 56 };
    var pL = M.l, pR = W - M.r, pT = M.t, pB = H - M.b;

    var profile = [];
    if (Array.isArray(result.profile)) {
      for (var i = 0; i < result.profile.length; i++) {
        var p = result.profile[i];
        if (p && isNum(p.t) && isNum(p.depth)) profile.push(p);
      }
    }
    if (!profile.length) {
      emptyFrame(containerEl, W, H, 'NO PROFILE DATA', 'Dive profile chart (no data)');
      return;
    }

    var ceil = [];
    if (Array.isArray(result.ceilingProfile)) {
      for (var c = 0; c < result.ceilingProfile.length; c++) {
        var cp = result.ceilingProfile[c];
        if (cp && isNum(cp.t) && isNum(cp.ceiling)) ceil.push(cp);
      }
    }

    var tEnd = 0, dMaxM = 0;
    for (var j = 0; j < profile.length; j++) {
      if (profile[j].t > tEnd) tEnd = profile[j].t;
      if (profile[j].depth > dMaxM) dMaxM = profile[j].depth;
    }
    if (isNum(result.totalRuntime) && result.totalRuntime > tEnd) tEnd = result.totalRuntime;
    if (tEnd <= 0) tEnd = 1;
    if (dMaxM <= 0) dMaxM = 1;

    var dMax = dMaxM * dF;
    var x = linScale(0, tEnd * 1.02, pL, pR);
    var y = linScale(-dMax * 0.045, dMax * 1.12, pT, pB); // depth downward, slim band above surface

    var xT = makeTicks(0, tEnd, 8);
    var yT = makeTicks(0, dMax * 1.05, 6);

    var svg = makeSvg(W, H, 'Dive profile: depth versus runtime');
    var defs = el('defs');
    var gid = 'hald-water-' + (++uidCounter);
    var fid = 'hald-glow-' + uidCounter;

    var grad = el('linearGradient', { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 });
    grad.appendChild(el('stop', { offset: '0%', 'stop-color': '#35e0c2', 'stop-opacity': '0.18' }));
    grad.appendChild(el('stop', { offset: '100%', 'stop-color': '#04070d', 'stop-opacity': '0' }));
    defs.appendChild(grad);

    var filt = el('filter', { id: fid, x: '-20%', y: '-20%', width: '140%', height: '140%' });
    filt.appendChild(el('feDropShadow', {
      dx: 0, dy: 0, stdDeviation: 2.6,
      'flood-color': PHOSPHOR, 'flood-opacity': 0.55
    }));
    defs.appendChild(filt);
    svg.appendChild(defs);

    // --- grid + axes ---
    var grid = el('g', { 'shape-rendering': 'crispEdges' });
    var k;
    for (k = 0; k < xT.ticks.length; k++) {
      var gx = x(xT.ticks[k]);
      if (gx < pL - 0.5 || gx > pR + 0.5) continue;
      grid.appendChild(el('line', { x1: r2(gx), y1: pT, x2: r2(gx), y2: pB, stroke: GRID, 'stroke-width': 1 }));
    }
    for (k = 0; k < yT.ticks.length; k++) {
      var gy = y(yT.ticks[k]);
      if (gy < pT - 0.5 || gy > pB + 0.5) continue;
      grid.appendChild(el('line', { x1: pL, y1: r2(gy), x2: pR, y2: r2(gy), stroke: GRID, 'stroke-width': 1 }));
    }
    grid.appendChild(el('line', { x1: pL, y1: pT, x2: pL, y2: pB, stroke: AXIS, 'stroke-width': 1 }));
    grid.appendChild(el('line', { x1: pL, y1: pB, x2: pR, y2: pB, stroke: AXIS, 'stroke-width': 1 }));
    svg.appendChild(grid);

    // surface line (depth 0) — slightly brighter hairline
    var ySurf = y(0);
    svg.appendChild(el('line', {
      x1: pL, y1: r2(ySurf), x2: pR, y2: r2(ySurf),
      stroke: 'rgba(215,231,242,.30)', 'stroke-width': 1, 'stroke-dasharray': '1 3'
    }));

    // tick labels
    for (k = 0; k < xT.ticks.length; k++) {
      var tx = x(xT.ticks[k]);
      if (tx < pL - 0.5 || tx > pR + 0.5) continue;
      svg.appendChild(textEl(tx, pB + 15, fmtTick(xT.ticks[k], xT.step), DIM, 10, 'middle'));
    }
    for (k = 0; k < yT.ticks.length; k++) {
      var ty = y(yT.ticks[k]);
      if (ty < pT - 0.5 || ty > pB + 0.5) continue;
      svg.appendChild(textEl(pL - 8, ty + 3, fmtTick(yT.ticks[k], yT.step), DIM, 10, 'end'));
    }

    // axis captions — spaced caps
    svg.appendChild(captionEl(8, 13, 'DEPTH · ' + dU.toUpperCase(), 'start'));
    svg.appendChild(captionEl(pR, H - 8, 'RUNTIME · MIN', 'end'));

    // --- water-column gradient area + profile line ---
    var pts = [];
    for (j = 0; j < profile.length; j++) {
      pts.push({ x: x(profile[j].t), y: y(profile[j].depth * dF) });
    }
    svg.appendChild(el('path', { d: buildAreaPath(pts, ySurf), fill: 'url(#' + gid + ')', stroke: 'none' }));

    var line = el('path', {
      d: buildPath(pts),
      fill: 'none', stroke: PHOSPHOR, 'stroke-width': 2,
      'stroke-linejoin': 'round', 'stroke-linecap': 'round',
      filter: 'url(#' + fid + ')'
    });
    svg.appendChild(line);

    // drawn-on-load animation (skipped for reduced motion / no rAF)
    if (!prefersReducedMotion() && typeof requestAnimationFrame === 'function') {
      var L = Math.max(1, Math.ceil(pathLength(pts)));
      line.style.strokeDasharray = L + ' ' + L;
      line.style.strokeDashoffset = String(L);
      requestAnimationFrame(function () {
        requestAnimationFrame(function () {
          line.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.33,0,.2,1)';
          line.style.strokeDashoffset = '0';
        });
      });
    }

    // --- ceiling line (omit layer entirely when absent) ---
    var hasCeil = false;
    if (ceil.length) {
      var segs = ceilingSegments(ceil);
      for (var s = 0; s < segs.length; s++) {
        var cpts = [];
        for (var q = 0; q < segs[s].length; q++) {
          var cv = isNum(segs[s][q].ceiling) ? segs[s][q].ceiling : 0;
          cpts.push({ x: x(segs[s][q].t), y: y(cv * dF) });
        }
        if (cpts.length > 1) {
          hasCeil = true;
          svg.appendChild(el('path', {
            d: buildPath(cpts),
            fill: 'none', stroke: AMBER, 'stroke-width': 1.5,
            'stroke-dasharray': '5 4', opacity: 0.9
          }));
        }
      }
    }

    // --- deco stop markers ---
    // Labels sit below the line (dark side); the stop staircase staggers them
    // vertically, and alternating left/right sides keeps x-extents apart too.
    var stops = Array.isArray(result.stops) ? result.stops : [];
    for (var si = 0; si < stops.length; si++) {
      var st = stops[si];
      if (!st || !isNum(st.depth) || !isNum(st.runtime)) continue;
      var dur = isNum(st.time) ? st.time : 0;
      var sx = clamp(x(st.runtime - dur / 2), pL + 8, pR - 8);
      var sy = y(st.depth * dF);
      svg.appendChild(el('line', {
        x1: r2(sx), y1: r2(sy + 3), x2: r2(sx), y2: r2(sy + 10),
        stroke: PHOSPHOR, 'stroke-width': 1.5, opacity: 0.9
      }));
      var label = Math.round(st.depth * dF) + dU + ' ' + Math.round(dur) + 'min';
      var estW = 6.2 * label.length;
      // Below-right rides the dark side of the ascent staircase (each label is
      // ~one stop-interval higher than the previous, so they never stack);
      // flip to the other side only when the label would clip the plot edge.
      var rightSide = sx + 4 + estW <= pR;
      svg.appendChild(textEl(rightSide ? sx + 4 : sx - 4, sy + 19, label,
        PHOSPHOR, 10, rightSide ? 'start' : 'end', { opacity: 0.95 }));
    }

    // --- gas switch markers (table rows, phase 'switch') ---
    var table = Array.isArray(result.table) ? result.table : [];
    for (var ti = 0; ti < table.length; ti++) {
      var row = table[ti];
      if (!row || row.phase !== 'switch' || !isNum(row.runtime)) continue;
      var swT = row.runtime - (isNum(row.duration) ? row.duration : 0);
      var swD = isNum(row.endDepth) ? row.endDepth : (isNum(row.startDepth) ? row.startDepth : 0);
      var wx = clamp(x(swT), pL + 6, pR - 6);
      var wy = y(swD * dF);
      svg.appendChild(el('path', {
        d: 'M' + r2(wx) + ' ' + r2(wy - 5) + ' L' + r2(wx + 5) + ' ' + r2(wy) +
           ' L' + r2(wx) + ' ' + r2(wy + 5) + ' L' + r2(wx - 5) + ' ' + r2(wy) + ' Z',
        fill: '#10161f', stroke: AMBER, 'stroke-width': 1.5
      }));
      var gasLabel = String(row.gasId || '?').toUpperCase();
      var flip = wx > pR - 70;
      // above the line, clear of stop labels (which hang below)
      svg.appendChild(textEl(flip ? wx - 9 : wx + 9, wy - 6, gasLabel, AMBER, 10, flip ? 'end' : 'start'));
    }

    // --- legend (top right) ---
    var lg = el('g');
    var lx = pR - (hasCeil ? 160 : 70), lyy = pT + 11;
    lg.appendChild(el('line', { x1: lx, y1: lyy - 3, x2: lx + 18, y2: lyy - 3, stroke: PHOSPHOR, 'stroke-width': 2 }));
    lg.appendChild(textEl(lx + 24, lyy, 'DIVE', DIM, 9, 'start', { 'letter-spacing': '1.5' }));
    if (hasCeil) {
      lg.appendChild(el('line', { x1: lx + 76, y1: lyy - 3, x2: lx + 94, y2: lyy - 3, stroke: AMBER, 'stroke-width': 1.5, 'stroke-dasharray': '5 4' }));
      lg.appendChild(textEl(lx + 100, lyy, 'CEILING', DIM, 9, 'start', { 'letter-spacing': '1.5' }));
    }
    svg.appendChild(lg);

    // --- hover crosshair + tooltip (pointer-only, decorative) ---
    var cross = el('g', { visibility: 'hidden', 'pointer-events': 'none', 'aria-hidden': 'true' });
    var hairline = el('line', { x1: pL, y1: pT, x2: pL, y2: pB, stroke: 'rgba(215,231,242,.35)', 'stroke-width': 1 });
    var dot = el('circle', { r: 3, fill: '#0a0f16', stroke: PHOSPHOR, 'stroke-width': 1.5 });
    var tipW = 124, tipH = 46;
    var tip = el('g');
    tip.appendChild(el('rect', { x: 0, y: 0, width: tipW, height: tipH, rx: 3, fill: BUBBLE_BG, stroke: BUBBLE_EDGE, 'stroke-width': 1 }));
    var tipT = textEl(8, 14, '', INK, 10, 'start');
    var tipD = textEl(8, 27, '', PHOSPHOR, 10, 'start');
    var tipC = textEl(8, 40, '', AMBER, 10, 'start');
    tip.appendChild(tipT); tip.appendChild(tipD); tip.appendChild(tipC);
    cross.appendChild(hairline); cross.appendChild(dot); cross.appendChild(tip);
    svg.appendChild(cross);

    var overlay = el('rect', {
      x: pL, y: pT, width: pR - pL, height: pB - pT,
      fill: '#000', 'fill-opacity': 0, 'pointer-events': 'all', cursor: 'crosshair'
    });
    svg.appendChild(overlay);

    var pendingFrame = false, lastEvt = null;
    function updateCross(e) {
      var rect;
      try { rect = svg.getBoundingClientRect(); } catch (err) { return; }
      if (!rect || !rect.width) return;
      var vx = ((e.clientX - rect.left) / rect.width) * W;
      var t = clamp(x.invert(vx), 0, tEnd);
      var idx = nearestIndex(profile, t);
      if (idx < 0) return;
      var sm = profile[idx];
      var cx = x(sm.t);
      var cy = y(sm.depth * dF);
      hairline.setAttribute('x1', r2(cx));
      hairline.setAttribute('x2', r2(cx));
      dot.setAttribute('cx', r2(cx));
      dot.setAttribute('cy', r2(cy));
      tipT.textContent = 'T     ' + fmt1(sm.t) + ' MIN';
      tipD.textContent = 'DEPTH ' + fmt1(sm.depth * dF) + ' ' + dU.toUpperCase();
      if (ceil.length) {
        var ci = nearestIndex(ceil, sm.t);
        var cval = ci >= 0 && isNum(ceil[ci].ceiling) ? ceil[ci].ceiling : 0;
        tipC.textContent = 'CEIL  ' + (cval > 0 ? fmt1(cval * dF) + ' ' + dU.toUpperCase() : '—');
      } else {
        tipC.textContent = 'CEIL  —';
      }
      var tipX = cx + 12;
      if (tipX + tipW > pR) tipX = cx - 12 - tipW;
      var tipY = clamp(cy - tipH / 2, pT + 2, pB - tipH - 2);
      tip.setAttribute('transform', 'translate(' + r2(tipX) + ' ' + r2(tipY) + ')');
      cross.setAttribute('visibility', 'visible');
    }
    overlay.addEventListener('mousemove', function (e) {
      lastEvt = e;
      if (pendingFrame) return; // rAF throttle
      pendingFrame = true;
      var rafFn = (typeof requestAnimationFrame === 'function')
        ? requestAnimationFrame : function (f) { setTimeout(f, 16); };
      rafFn(function () { pendingFrame = false; if (lastEvt) updateCross(lastEvt); });
    });
    overlay.addEventListener('mouseleave', function () {
      cross.setAttribute('visibility', 'hidden');
    });

    containerEl.appendChild(svg);
  }

  // ==========================================================================
  // TISSUE CHART
  // ==========================================================================

  function renderTissues(containerEl, result, opts) {
    if (!containerEl || typeof document === 'undefined') return;
    opts = opts || {};
    result = result || {};

    clearEl(containerEl);

    var W = 720, H = 300;
    var M = { t: 30, r: 16, b: 36, l: 48 };
    var pL = M.l, pR = W - M.r, pT = M.t, pB = H - M.b;

    var tissues = Array.isArray(result.finalTissues) ? result.finalTissues.slice(0, 16) : [];
    if (!tissues.length) {
      emptyFrame(containerEl, W, H, 'NO TISSUE DATA', 'Tissue loading chart (no data)');
      return;
    }

    // Mode: GF% when every compartment carries gfSurfacePct, else raw pressure (VPM).
    var gfMode = true;
    var i;
    for (i = 0; i < tissues.length; i++) {
      if (!tissues[i] || !isNum(tissues[i].gfSurfacePct)) { gfMode = false; break; }
    }

    function valOf(tc) {
      if (!tc) return 0;
      if (gfMode) return isNum(tc.gfSurfacePct) ? tc.gfSurfacePct : 0;
      if (isNum(tc.pTotal)) return tc.pTotal;
      var n2 = isNum(tc.pN2) ? tc.pN2 : 0, he = isNum(tc.pHe) ? tc.pHe : 0;
      return n2 + he;
    }

    var surfaceP = (result.params && isNum(result.params.surfacePressure)) ? result.params.surfacePressure : 1.013;
    var refVal = gfMode ? 100 : surfaceP;
    var refLabel = gfMode ? 'M-VALUE' : 'P.AMB';

    var vMax = refVal;
    var anyHe = false;
    for (i = 0; i < tissues.length; i++) {
      var v0 = valOf(tissues[i]);
      if (v0 > vMax) vMax = v0;
      if (tissues[i] && isNum(tissues[i].pHe) && tissues[i].pHe > 0) anyHe = true;
    }

    var y = linScale(0, vMax * 1.18, pB, pT);
    var yT = makeTicks(0, vMax * 1.1, 5);

    var svg = makeSvg(W, H, 'Tissue compartment loading at surfacing');

    // grid + axis
    var grid = el('g', { 'shape-rendering': 'crispEdges' });
    var k;
    for (k = 0; k < yT.ticks.length; k++) {
      var gy = y(yT.ticks[k]);
      if (gy < pT - 0.5 || gy > pB + 0.5) continue;
      grid.appendChild(el('line', { x1: pL, y1: r2(gy), x2: pR, y2: r2(gy), stroke: GRID, 'stroke-width': 1 }));
      svg.appendChild(textEl(pL - 8, gy + 3, gfMode ? fmtTick(yT.ticks[k], yT.step) : (Math.round(yT.ticks[k] * 100) / 100).toFixed(yT.step < 1 ? 1 : 0), DIM, 10, 'end'));
    }
    grid.appendChild(el('line', { x1: pL, y1: pT, x2: pL, y2: pB, stroke: AXIS, 'stroke-width': 1 }));
    grid.appendChild(el('line', { x1: pL, y1: pB, x2: pR, y2: pB, stroke: AXIS, 'stroke-width': 1 }));
    svg.appendChild(grid);

    // mode caption
    svg.appendChild(captionEl(8, 13,
      gfMode ? 'TISSUE LOADING · GF% AT SURFACE' : 'TISSUE TENSION · BAR · VPM MODE (P.TOTAL)',
      'start'));

    // helium legend
    if (anyHe) {
      var hx = pR - 96;
      svg.appendChild(el('rect', { x: hx, y: 6, width: 9, height: 9, fill: PHOSPHOR, opacity: 0.9 }));
      svg.appendChild(textEl(hx + 13, 14, 'N2', DIM, 9, 'start', { 'letter-spacing': '1.5' }));
      svg.appendChild(el('rect', { x: hx + 44, y: 6, width: 9, height: 9, fill: PHOSPHOR, opacity: 0.4 }));
      svg.appendChild(textEl(hx + 57, 14, 'HE', DIM, 9, 'start', { 'letter-spacing': '1.5' }));
    }

    // bars
    var slot = (pR - pL) / 16;
    var barW = Math.max(6, slot * 0.56);
    for (i = 0; i < tissues.length; i++) {
      var tc = tissues[i] || {};
      var v = Math.max(0, valOf(tc));
      var color = gfMode ? colorForPct(v) : PHOSPHOR;
      var cx = pL + slot * (i + 0.5);
      var bx = cx - barW / 2;
      var topY = y(v);
      var hTot = Math.max(0, pB - topY);

      var n2 = isNum(tc.pN2) ? Math.max(0, tc.pN2) : 0;
      var he = isNum(tc.pHe) ? Math.max(0, tc.pHe) : 0;
      var inert = n2 + he;

      if (he > 0 && inert > 0 && hTot > 0) {
        // stacked: pN2 (bottom, solid) + pHe (top, translucent), same hue
        var hN2 = hTot * (n2 / inert);
        svg.appendChild(el('rect', { x: r2(bx), y: r2(pB - hN2), width: r2(barW), height: r2(hN2), fill: color, opacity: 0.9 }));
        svg.appendChild(el('rect', { x: r2(bx), y: r2(topY), width: r2(barW), height: r2(hTot - hN2), fill: color, opacity: 0.4 }));
      } else {
        svg.appendChild(el('rect', { x: r2(bx), y: r2(topY), width: r2(barW), height: r2(hTot), fill: color, opacity: 0.9 }));
      }

      // value label on top
      var lbl = gfMode ? String(Math.round(v)) : (Math.round(v * 100) / 100).toFixed(2);
      svg.appendChild(textEl(cx, topY - 5, lbl, color, 9.5, 'middle'));
      // compartment number below
      svg.appendChild(textEl(cx, pB + 14, String(i + 1), DIM, 10, 'middle'));
    }

    // reference line (drawn above bars)
    var ry = y(refVal);
    if (ry >= pT && ry <= pB) {
      svg.appendChild(el('line', {
        x1: pL, y1: r2(ry), x2: pR, y2: r2(ry),
        stroke: gfMode ? AMBER : DIM, 'stroke-width': 1, 'stroke-dasharray': '4 3', opacity: 0.85
      }));
      svg.appendChild(textEl(pR, ry - 5, refLabel, gfMode ? AMBER : DIM, 9, 'end', { 'letter-spacing': '1.5' }));
    }

    // axis caption
    svg.appendChild(captionEl(pR, H - 6, 'COMPARTMENT · 1–16', 'end'));

    containerEl.appendChild(svg);
  }

  // ==========================================================================
  var api = {
    VERSION: VERSION,
    renderProfile: renderProfile,
    renderTissues: renderTissues,
    // pure helpers exposed for tests — not part of the UI contract
    _internal: {
      niceStep: niceStep,
      makeTicks: makeTicks,
      linScale: linScale,
      buildPath: buildPath,
      buildAreaPath: buildAreaPath,
      pathLength: pathLength,
      nearestIndex: nearestIndex,
      colorForPct: colorForPct,
      ceilingSegments: ceilingSegments,
      fmtTick: fmtTick,
      depthFactor: depthFactor,
      clamp: clamp
    }
  };
  return api;
});

/* ============================================================================
 * NODE SELF-CHECK — runs ONLY under Node (typeof window === 'undefined').
 * `node js/ui/charts.js` must pass silently (exit 0); exits 1 on any failure.
 * ========================================================================== */
(function () {
  if (typeof window !== 'undefined') return;                  // browser: no-op
  if (typeof module === 'undefined' || !module.exports) return;

  var Charts = module.exports;
  var H = Charts._internal;
  var failures = 0;
  function check(cond, msg) {
    console.assert(cond, msg);
    if (!cond) { failures++; console.error('SELF-CHECK FAIL: ' + msg); }
  }

  // ---- pure helper checks --------------------------------------------------
  check(H.niceStep(0.7) === 1, 'niceStep(0.7) -> 1');
  check(H.niceStep(3) === 5, 'niceStep(3) -> 5');
  check(H.niceStep(18) === 20, 'niceStep(18) -> 20');
  check(H.niceStep(0) === 1, 'niceStep(0) safe fallback');

  var tk = H.makeTicks(0, 60, 8);
  check(tk.step === 10 && tk.ticks[0] === 0 && tk.ticks[tk.ticks.length - 1] === 60, 'makeTicks(0,60,8) -> 0..60 step 10');
  var tk2 = H.makeTicks(0, 47, 6);
  check(tk2.step === 10 && tk2.ticks.length === 5, 'makeTicks(0,47,6) -> 5 ticks of 10');

  var s = H.linScale(0, 100, 50, 650);
  check(s(0) === 50 && s(100) === 650, 'linScale endpoints');
  check(Math.abs(s.invert(350) - 50) < 1e-9, 'linScale invert');
  var sFlat = H.linScale(5, 5, 0, 10);
  check(isFinite(sFlat(5)), 'linScale degenerate domain is finite');

  check(H.buildPath([{ x: 0, y: 0 }, { x: 10.123, y: 5 }]) === 'M0 0 L10.12 5', 'buildPath format');
  check(H.buildPath([]) === '', 'buildPath empty');
  check(H.buildAreaPath([{ x: 1, y: 4 }, { x: 9, y: 4 }], 2) === 'M1 2 L1 4 L9 4 L9 2 Z', 'buildAreaPath closes to baseline');
  check(H.pathLength([{ x: 0, y: 0 }, { x: 3, y: 4 }]) === 5, 'pathLength 3-4-5');

  var samples = [{ t: 0 }, { t: 1 }, { t: 3 }];
  check(H.nearestIndex(samples, 1.9) === 1, 'nearestIndex below midpoint');
  check(H.nearestIndex(samples, 2.2) === 2, 'nearestIndex above midpoint');
  check(H.nearestIndex(samples, -5) === 0 && H.nearestIndex(samples, 99) === 2, 'nearestIndex clamps');
  check(H.nearestIndex([], 1) === -1, 'nearestIndex empty');

  check(H.colorForPct(40) === '#35e0c2', 'colorForPct phosphor < 70');
  check(H.colorForPct(70) === '#ffb454' && H.colorForPct(100) === '#ffb454', 'colorForPct amber 70..100');
  check(H.colorForPct(100.5) === '#ff5d6c', 'colorForPct alert > 100');

  var segs = H.ceilingSegments([
    { t: 0, ceiling: 0 }, { t: 1, ceiling: 5 }, { t: 2, ceiling: 3 },
    { t: 3, ceiling: 0 }, { t: 4, ceiling: 0 }
  ]);
  check(segs.length === 1 && segs[0].length === 4, 'ceilingSegments keeps boundary zeros');
  check(H.ceilingSegments([]).length === 0, 'ceilingSegments empty');

  check(Math.abs(H.depthFactor('imperial') - 3.28084) < 1e-9 && H.depthFactor('metric') === 1, 'depthFactor');

  // ---- synthetic contract-valid result: 45 m trimix, 5 stops, 16 tissues ---
  var rows = [
    { phase: 'desc',   startDepth: 0,  endDepth: 45, duration: 2.5, gasId: 'tx2135' },
    { phase: 'level',  startDepth: 45, endDepth: 45, duration: 22.5, gasId: 'tx2135' },
    { phase: 'asc',    startDepth: 45, endDepth: 21, duration: 24 / 9, gasId: 'tx2135' },
    { phase: 'switch', startDepth: 21, endDepth: 21, duration: 1, gasId: 'ean50' },
    { phase: 'stop',   startDepth: 21, endDepth: 21, duration: 1, gasId: 'ean50' },
    { phase: 'asc',    startDepth: 21, endDepth: 18, duration: 3 / 9, gasId: 'ean50' },
    { phase: 'stop',   startDepth: 18, endDepth: 18, duration: 2, gasId: 'ean50' },
    { phase: 'asc',    startDepth: 18, endDepth: 12, duration: 6 / 9, gasId: 'ean50' },
    { phase: 'stop',   startDepth: 12, endDepth: 12, duration: 3, gasId: 'ean50' },
    { phase: 'asc',    startDepth: 12, endDepth: 9,  duration: 3 / 9, gasId: 'ean50' },
    { phase: 'stop',   startDepth: 9,  endDepth: 9,  duration: 5, gasId: 'ean50' },
    { phase: 'asc',    startDepth: 9,  endDepth: 6,  duration: 3 / 9, gasId: 'o2' },
    { phase: 'switch', startDepth: 6,  endDepth: 6,  duration: 1, gasId: 'o2' },
    { phase: 'stop',   startDepth: 6,  endDepth: 6,  duration: 11, gasId: 'o2' },
    { phase: 'asc',    startDepth: 6,  endDepth: 0,  duration: 6 / 9, gasId: 'o2' }
  ];
  var run = 0, table = [], profile = [], ceilingProfile = [], stops = [];
  function ceilAt(t, depth) {
    // plausible synthetic ceiling: none early, then tracking below current depth
    if (t < 12) return 0;
    return Math.max(0, Math.min(depth - 3, 21 - Math.max(0, t - 28) * 0.45));
  }
  for (var ri = 0; ri < rows.length; ri++) {
    var row = rows[ri], t0 = run;
    run += row.duration;
    table.push({
      phase: row.phase, startDepth: row.startDepth, endDepth: row.endDepth,
      duration: row.duration, runtime: run, gasId: row.gasId,
      ppO2Start: 1.0, ppO2End: 1.0
    });
    if (row.phase === 'stop') {
      stops.push({ depth: row.endDepth, time: row.duration, runtime: run, gasId: row.gasId });
    }
    var nSteps = Math.max(1, Math.ceil(row.duration / 0.5));
    for (var si2 = (ri === 0 ? 0 : 1); si2 <= nSteps; si2++) {
      var ft = si2 / nSteps;
      var t = t0 + row.duration * ft;
      var d = row.startDepth + (row.endDepth - row.startDepth) * ft;
      profile.push({ t: t, depth: d, gasId: row.gasId });
      ceilingProfile.push({ t: t, ceiling: ceilAt(t, d) });
    }
  }
  var finalTissues = [];
  for (var ci = 0; ci < 16; ci++) {
    var pN2 = 1.6 - ci * 0.055, pHe = ci < 8 ? 0.5 - ci * 0.06 : 0;
    if (pHe < 0) pHe = 0;
    finalTissues.push({
      pN2: pN2, pHe: pHe, pTotal: pN2 + pHe,
      gfSurfacePct: 95 - ci * 4.7
    });
  }
  var synthetic = {
    ok: true, errors: [], warnings: [], algorithm: 'ZHL16C',
    params: { gfLow: 50, gfHigh: 80, vpmConservatism: 2, lastStopDepth: 6, surfacePressure: 1.013, water: 'salt' },
    table: table, stops: stops, noDeco: false, ndl: null,
    firstStopDepth: 21, totalRuntime: run, totalDecoTime: 25,
    gasUsage: [
      { gasId: 'tx2135', fO2: 0.21, fHe: 0.35, liters: 2900 },
      { gasId: 'ean50', fO2: 0.50, fHe: 0, liters: 540 },
      { gasId: 'o2', fO2: 1.0, fHe: 0, liters: 320 }
    ],
    oxygen: { cns: 21.4, otu: 48.2 },
    profile: profile, ceilingProfile: ceilingProfile, finalTissues: finalTissues
  };
  check(stops.length === 5, 'synthetic has 5 stops');
  check(profile.length > 50, 'synthetic profile is fine-grained');

  // ---- render smoke test via a minimal document shim ------------------------
  function fakeEl(tag) {
    return {
      tag: tag,
      attrs: {},
      children: [],
      style: {},
      _text: '',
      setAttribute: function (k, v) { this.attrs[k] = String(v); },
      appendChild: function (c) { this.children.push(c); return c; },
      removeChild: function (c) {
        var ix = this.children.indexOf(c);
        if (ix >= 0) this.children.splice(ix, 1);
        return c;
      },
      addEventListener: function () {},
      get firstChild() { return this.children.length ? this.children[0] : null; },
      get textContent() { return this._text; },
      set textContent(v) { this._text = String(v); }
    };
  }
  function countByTag(node, tag, acc) {
    acc = acc || { n: 0 };
    if (node.tag === tag) acc.n++;
    for (var i2 = 0; i2 < (node.children || []).length; i2++) countByTag(node.children[i2], tag, acc);
    return acc.n;
  }

  var hadDoc = typeof globalThis.document !== 'undefined';
  if (!hadDoc) {
    globalThis.document = { createElementNS: function (ns, tag) { return fakeEl(tag); } };
  }
  try {
    var c1 = fakeEl('div');
    Charts.renderProfile(c1, synthetic, { units: 'metric' });
    check(c1.children.length === 1 && c1.children[0].tag === 'svg', 'renderProfile mounts exactly one svg');
    var svg1 = c1.children[0];
    check(countByTag(svg1, 'path') >= 4, 'profile svg contains area+line+ceiling+diamond paths');
    check(countByTag(svg1, 'linearGradient') === 1, 'profile svg has water-column gradient');
    check(/^0 0 \d+ \d+$/.test(svg1.attrs.viewBox) && svg1.attrs.width === '100%', 'profile svg is responsive (viewBox + width 100%)');

    Charts.renderProfile(c1, synthetic, { units: 'imperial' });   // re-render
    check(c1.children.length === 1, 'renderProfile re-render clears container');

    var c2 = fakeEl('div');
    Charts.renderTissues(c2, synthetic, { units: 'metric' });
    check(c2.children.length === 1 && c2.children[0].tag === 'svg', 'renderTissues mounts exactly one svg');
    check(countByTag(c2.children[0], 'rect') >= 16, 'tissue svg has 16+ bars');

    // weird-but-contract-valid data must never throw
    Charts.renderProfile(fakeEl('div'), {}, {});
    Charts.renderProfile(fakeEl('div'), { profile: [] }, { units: 'imperial' });
    Charts.renderTissues(fakeEl('div'), { finalTissues: [] }, {});
    var noCeil = JSON.parse(JSON.stringify(synthetic));
    delete noCeil.ceilingProfile;
    noCeil.stops = [];
    noCeil.table = [];
    Charts.renderProfile(fakeEl('div'), noCeil, { units: 'metric' });
    var vpm = JSON.parse(JSON.stringify(synthetic));
    vpm.algorithm = 'VPMB';
    for (var vi = 0; vi < vpm.finalTissues.length; vi++) vpm.finalTissues[vi].gfSurfacePct = null;
    var c3 = fakeEl('div');
    Charts.renderTissues(c3, vpm, {});
    check(c3.children.length === 1, 'renderTissues VPM fallback mode renders');
    check(true, 'degenerate inputs did not throw');
  } catch (e) {
    failures++;
    console.error('SELF-CHECK FAIL: render threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    if (!hadDoc) delete globalThis.document;
  }

  if (failures > 0) process.exit(1);
})();
