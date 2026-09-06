/*!
 * TradeRead Charts v0.4.0
 * Copyright (c) 2026 Marcel Todea / TradeRead — traderead.ai
 * Original work, written from first principles. TradeRead Community License
 * (see LICENSE.md): free to use, the TradeRead mark stays visible.
 */
(function (global) {
  "use strict";

  var DEFAULTS = {
    background: "#0d1117",
    textColor: "#8b949e",
    gridColor: "rgba(139,148,158,0.12)",
    separatorColor: "rgba(139,148,158,0.25)",
    upColor: "#00d97e",
    downColor: "#f85149",
    wickUp: "#00d97e",
    wickDown: "#f85149",
    volumeUp: "rgba(0,217,126,0.35)",
    volumeDown: "rgba(248,81,73,0.35)",
    crosshair: "rgba(139,148,158,0.45)",
    tagBg: "#2a2e39",
    tagText: "#e6edf3",
    font: "11px -apple-system, 'Segoe UI', system-ui, sans-serif",
    priceAxisWidth: 64,
    timeAxisHeight: 24,
    barSpacing: 8,
    minBarSpacing: 1.5,
    maxBarSpacing: 60,
    rightPadBars: 5,
    volumeHeightPct: 0.18,
    autoScalePadPct: 0.08,
    oscPaneHeight: 110,       // default px height of an oscillator pane
    minPricePaneFrac: 0.45,   // price pane never shrinks below this share
    logo: true,
  };

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  function niceStep(span, n) {
    var raw = span / Math.max(1, n);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 2 ? 2.5 : norm >= 1 ? 2 : 1;
    return step * mag;
  }
  function stepDecimals(step) {
    if (step >= 1) return step % 1 === 0 ? 0 : 2;
    var d = 0, s = step;
    while (s < 1 && d < 10) { s *= 10; d++; }
    return d + (Math.round(s) !== s ? 1 : 0);
  }
  function fmtPrice(v, dec) {
    if (Math.abs(v) < Math.pow(10, -(dec + 3))) v = 0;   // float dust must not read "-0"
    return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  // A pane owns a horizontal slice of the plot and its own value scale.
  // Pane 0 is the price pane (candles, volume band, overlay lines); every
  // further pane is an oscillator: lines, histograms and fixed guides.
  function Pane(chart, kind) {
    this.chart = chart;
    this.kind = kind;               // "price" | "osc"
    this.hPx = kind === "osc" ? chart.opt.oscPaneHeight : null;
    this.lines = {};                // id → {byTime, color, width}
    this.hists = {};                // id → {byTime, pos, neg}   (osc only)
    this.guides = [];               // {value, color}            (osc only)
    this.y0 = 0; this.h = 0;        // set by layout
    this.min = 0; this.max = 1;     // set per paint
  }
  Pane.prototype.toY = function (v) {
    var usable = this.kind === "price" ? this.h * (1 - this.chart.opt.volumeHeightPct * 0.35) : this.h - 8;
    var off = this.kind === "price" ? 0 : 4;
    return this.y0 + off + (this.max - v) / (this.max - this.min) * usable;
  };
  Pane.prototype.toValue = function (y) {
    var usable = this.kind === "price" ? this.h * (1 - this.chart.opt.volumeHeightPct * 0.35) : this.h - 8;
    var off = this.kind === "price" ? 0 : 4;
    return this.max - ((y - this.y0 - off) / usable) * (this.max - this.min);
  };
  Pane.prototype.computeScale = function (lo, hi) {
    var min = Infinity, max = -Infinity, i, b, v, id;
    var bars = this.chart.bars;
    if (this.kind === "price") {
      for (i = lo; i <= hi; i++) {
        b = bars[i]; if (!b) continue;
        if (b.low < min) min = b.low;
        if (b.high > max) max = b.high;
      }
    }
    for (id in this.lines) {
      var ln = this.lines[id];
      for (i = lo; i <= hi; i++) {
        b = bars[i]; if (!b) continue;
        v = ln.byTime.get(b.time);
        if (isNum(v)) { if (v < min) min = v; if (v > max) max = v; }
      }
    }
    for (id in this.hists) {
      var hs = this.hists[id];
      for (i = lo; i <= hi; i++) {
        b = bars[i]; if (!b) continue;
        v = hs.byTime.get(b.time);
        if (isNum(v)) { if (v < min) min = v; if (v > max) max = v; if (0 < min) min = 0; if (0 > max) max = 0; }
      }
    }
    for (i = 0; i < this.guides.length; i++) {
      v = this.guides[i].value;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { min -= 0.5; max += 0.5; }
    var pad = (max - min) * this.chart.opt.autoScalePadPct;
    this.min = min - pad; this.max = max + pad;
  };

  function Chart(container, options) {
    var self = this;
    this.el = container;
    this.opt = Object.assign({}, DEFAULTS, options || {});
    this.bars = [];
    this.panes = [new Pane(this, "price")];
    this.priceLines = [];
    this.drawings = [];             // {type:"trend"|"hline"|"rect", i1,p1, i2,p2} in bar-index/price space
    this.tool = null;               // null = cursor; "trend"|"hline"|"rect"
    this._draft = null;
    this.barSpacing = this.opt.barSpacing;
    this.rightIndex = 0;
    this.crosshairCb = null;
    this._cross = null;

    container.style.position = container.style.position || "relative";
    container.style.background = this.opt.background;
    container.style.overflow = "hidden";

    this.canvas = document.createElement("canvas");
    this.drawCanvas = document.createElement("canvas");
    this.overlay = document.createElement("canvas");
    [this.canvas, this.drawCanvas, this.overlay].forEach(function (c) {
      c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;";
      container.appendChild(c);
    });
    this.ctx = this.canvas.getContext("2d");
    this.dctx = this.drawCanvas.getContext("2d");
    this.octx = this.overlay.getContext("2d");

    if (this.opt.logo) this._mountLogo();

    this._ro = new ResizeObserver(function () { self._resize(); });
    this._ro.observe(container);
    this._resize();
    this._bind();
  }

  Chart.prototype._mountLogo = function () {
    var d = document.createElement("div");
    d.className = "trc-logo";
    d.style.cssText = "position:absolute;left:8px;bottom:" + (this.opt.timeAxisHeight + 8) +
      "px;z-index:3;display:flex;align-items:center;gap:7px;font:800 13.5px -apple-system,'Segoe UI',sans-serif;" +
      "color:rgba(139,148,158,0.78);pointer-events:none;user-select:none;";
    d.innerHTML = '<svg width="20" height="20" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">' +
      '<line x1="5" y1="3" x2="5" y2="7" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/><rect x="2.5" y="7" width="5" height="8" rx="1" fill="#ef4444"/>' +
      '<line x1="5" y1="15" x2="5" y2="20" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/><line x1="14" y1="2" x2="14" y2="6" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round"/>' +
      '<rect x="11.5" y="6" width="5" height="13" rx="1" fill="#22c55e"/><line x1="14" y1="19" x2="14" y2="24" stroke="#22c55e" stroke-width="1.5" stroke-linecap="round"/>' +
      '<line x1="23" y1="6" x2="23" y2="10" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/><rect x="20.5" y="10" width="5" height="6" rx="1" fill="#ef4444"/>' +
      '<line x1="23" y1="16" x2="23" y2="21" stroke="#ef4444" stroke-width="1.5" stroke-linecap="round"/></svg><span>TradeRead</span>';
    this.el.appendChild(d);
  };

  Chart.prototype._resize = function () {
    var dpr = window.devicePixelRatio || 1;
    this.w = this.el.clientWidth;
    this.h = this.el.clientHeight;
    [this.canvas, this.drawCanvas, this.overlay].forEach(function (c) {
      c.width = Math.round(this.w * dpr);
      c.height = Math.round(this.h * dpr);
    }, this);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paint();
  };

  // ── Layout: stack the panes inside the plot column ───────────────────
  Chart.prototype._plotW = function () { return this.w - this.opt.priceAxisWidth; };
  Chart.prototype._plotH = function () { return this.h - this.opt.timeAxisHeight; };
  Chart.prototype._layout = function () {
    var H = this._plotH();
    var fixed = 0, i;
    for (i = 1; i < this.panes.length; i++) fixed += this.panes[i].hPx;
    // The price pane defends its share: squeeze osc panes proportionally
    // when there are too many for the frame.
    var minPrice = H * this.opt.minPricePaneFrac;
    var scale = fixed > 0 && H - fixed < minPrice ? (H - minPrice) / fixed : 1;
    var y = 0;
    this.panes[0].y0 = 0;
    this.panes[0].h = H - Math.round(fixed * scale);
    y = this.panes[0].h;
    for (i = 1; i < this.panes.length; i++) {
      this.panes[i].y0 = y;
      this.panes[i].h = Math.round(this.panes[i].hPx * scale);
      y += this.panes[i].h;
    }
  };
  Chart.prototype._paneAt = function (y) {
    for (var i = 0; i < this.panes.length; i++) {
      var pn = this.panes[i];
      if (y >= pn.y0 && y < pn.y0 + pn.h) return pn;
    }
    return null;
  };

  Chart.prototype.indexToX = function (i) {
    return this._plotW() - (this.rightIndex + this.opt.rightPadBars - i) * this.barSpacing;
  };
  Chart.prototype.xToIndex = function (x) {
    return this.rightIndex + this.opt.rightPadBars - (this._plotW() - x) / this.barSpacing;
  };
  Chart.prototype._visibleRange = function () {
    var lo = Math.floor(this.xToIndex(0)), hi = Math.ceil(this.xToIndex(this._plotW()));
    return [clamp(lo, 0, this.bars.length - 1), clamp(hi, 0, this.bars.length - 1)];
  };
  // Back-compat shorthands for the price pane
  Chart.prototype.priceToY = function (v) { return this.panes[0].toY(v); };
  Chart.prototype.yToPrice = function (y) { return this.panes[0].toValue(y); };

  // ── Data API ─────────────────────────────────────────────────────────
  Chart.prototype.setData = function (bars) {
    this.bars = (bars || []).slice().sort(function (a, b) { return a.time - b.time; });
    this.rightIndex = this.bars.length - 1;
    // The label alphabet depends on the bar size: intraday alternates
    // day-marks with clock times, daily and up never shows a clock.
    var n = this.bars.length;
    this._barSec = n > 1 ? Math.max(1, Math.round((this.bars[n - 1].time - this.bars[0].time) / (n - 1))) : 3600;
    this._paint();
  };
  Chart.prototype.update = function (bar) {
    var n = this.bars.length;
    if (n && this.bars[n - 1].time === bar.time) this.bars[n - 1] = bar;
    else {
      var atRight = Math.abs(this.rightIndex - (n - 1)) < 2;
      this.bars.push(bar);
      if (atRight) this.rightIndex = this.bars.length - 1;
    }
    this._paint();
  };
  function toByTime(data) {
    var m = new Map();
    (data || []).forEach(function (d) { m.set(d.time, d.value); });
    return m;
  }
  Chart.prototype.addLine = function (id, data, color, width, paneIndex) {
    var pn = this._ensurePane(paneIndex || 0);
    pn.lines[id] = { byTime: toByTime(data), color: color || "#58a6ff", width: width || 1.4 };
    this._paint();
  };
  Chart.prototype.addHistogram = function (id, data, paneIndex, posColor, negColor) {
    var pn = this._ensurePane(paneIndex);
    pn.hists[id] = { byTime: toByTime(data), pos: posColor || "rgba(0,217,126,0.55)", neg: negColor || "rgba(248,81,73,0.55)" };
    this._paint();
  };
  Chart.prototype.addGuide = function (paneIndex, value, color) {
    this._ensurePane(paneIndex).guides.push({ value: value, color: color || "rgba(139,148,158,0.4)" });
    this._paint();
  };
  Chart.prototype._ensurePane = function (i) {
    if (!i) return this.panes[0];
    while (this.panes.length <= i) this.panes.push(new Pane(this, "osc"));
    return this.panes[i];
  };
  Chart.prototype.setPaneHeight = function (i, px) {
    if (this.panes[i] && this.panes[i].kind === "osc") { this.panes[i].hPx = px; this._paint(); }
  };
  Chart.prototype.removeOscPanes = function () { this.panes = [this.panes[0]]; this._paint(); };
  Chart.prototype.removeLine = function (id, paneIndex) {
    var pn = this.panes[paneIndex || 0];
    if (pn) { delete pn.lines[id]; delete pn.hists[id]; }
    this._paint();
  };
  Chart.prototype.addPriceLine = function (price, color, label) {
    this.priceLines.push({ price: price, color: color || "#8b949e", label: label });
    this._paint();
  };
  Chart.prototype.clearPriceLines = function () { this.priceLines = []; this._paint(); };
  Chart.prototype.onCrosshair = function (cb) { this.crosshairCb = cb; };
  // Drawings live in (bar index, price) space so pan and zoom reproject them.
  Chart.prototype.setTool = function (t) { this.tool = t || null; this.el.style.cursor = t ? "crosshair" : ""; };
  Chart.prototype.clearDrawings = function () { this.drawings = []; this._draft = null; this._paintDrawings(); };
  Chart.prototype.onToolDone = function (cb) { this._toolDoneCb = cb; };
  Chart.prototype._paintDrawings = function () {
    var c = this.dctx, W = this._plotW(), pp = this.panes[0];
    c.clearRect(0, 0, this.w, this.h);
    var list = this._draft ? this.drawings.concat([this._draft]) : this.drawings;
    for (var k = 0; k < list.length; k++) {
      var d = list[k];
      c.strokeStyle = "#6366f1"; c.lineWidth = 1.5;
      if (d.type === "hline") {
        var hy = pp.toY(d.p1);
        if (hy < pp.y0 || hy > pp.y0 + pp.h) continue;
        c.beginPath(); c.moveTo(0, Math.round(hy) + 0.5); c.lineTo(W, Math.round(hy) + 0.5); c.stroke();
      } else if (d.type === "trend") {
        c.beginPath();
        c.moveTo(this.indexToX(d.i1), pp.toY(d.p1));
        c.lineTo(this.indexToX(d.i2), pp.toY(d.p2));
        c.stroke();
      } else if (d.type === "rect") {
        var x1 = this.indexToX(d.i1), x2 = this.indexToX(d.i2);
        var y1 = pp.toY(d.p1), y2 = pp.toY(d.p2);
        c.fillStyle = "rgba(99,102,241,0.12)";
        c.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        c.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
      }
    }
  };
  Chart.prototype.applyOptions = function (o) { Object.assign(this.opt, o || {}); this.el.style.background = this.opt.background; this._paint(); };
  Chart.prototype.scrollToRealtime = function () { this.rightIndex = this.bars.length - 1; this._paint(); };
  Chart.prototype.remove = function () { this._ro.disconnect(); this.el.innerHTML = ""; };

  // ── Painting ─────────────────────────────────────────────────────────
  Chart.prototype._paint = function () {
    var c = this.ctx, o = this.opt, W = this._plotW(), H = this._plotH();
    if (!W || !H) return;
    this._layout();
    var rng = this._visibleRange(), lo = rng[0], hi = rng[1];
    for (var pi = 0; pi < this.panes.length; pi++) this.panes[pi].computeScale(lo, hi);

    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = o.background;
    c.fillRect(0, 0, this.w, this.h);
    c.font = o.font;

    var i, b, x, y, v;

    // time grid first (spans all panes)
    var barStep = Math.max(1, Math.round(90 / this.barSpacing));
    var lastDay = null;
    c.textBaseline = "top";
    for (i = lo - (lo % barStep); i <= hi; i += barStep) {
      b = this.bars[i]; if (!b) continue;
      x = this.indexToX(i);
      if (x < 0 || x > W) continue;
      c.strokeStyle = o.gridColor;
      c.beginPath(); c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, H); c.stroke();
      var d = new Date(b.time * 1000);
      var daily = (this._barSec || 3600) >= 86400;
      var key = daily ? (d.getUTCFullYear() + "-" + d.getUTCMonth()) : (d.getUTCMonth() + "-" + d.getUTCDate());
      var label;
      if (daily) {
        label = key !== lastDay ? MONTHS[d.getUTCMonth()] + (d.getUTCMonth() === 0 ? " " + d.getUTCFullYear() : "") : "" + d.getUTCDate();
      } else {
        label = key !== lastDay
          ? (d.getUTCDate() === 1 ? MONTHS[d.getUTCMonth()] : d.getUTCDate() + " " + MONTHS[d.getUTCMonth()])
          : pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
      }
      lastDay = key;
      c.fillStyle = o.textColor;
      c.fillText(label, x - c.measureText(label).width / 2, H + 7);
    }

    // ── price pane ──
    var pp = this.panes[0];
    var span = pp.max - pp.min;
    var step = niceStep(span, Math.max(3, Math.round(pp.h / 55)));
    var dec = stepDecimals(step);
    var first = Math.ceil(pp.min / step) * step;
    c.textBaseline = "middle";
    for (v = first; v <= pp.max; v += step) {
      y = pp.toY(v);
      if (y < pp.y0 + 4 || y > pp.y0 + pp.h - 4) continue;
      c.strokeStyle = o.gridColor; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(W, Math.round(y) + 0.5); c.stroke();
      c.fillStyle = o.textColor;
      c.fillText(fmtPrice(v, dec), W + 8, y);
    }

    var volTop = pp.h * (1 - o.volumeHeightPct);
    var maxVol = 0;
    for (i = lo; i <= hi; i++) { b = this.bars[i]; if (b && b.volume > maxVol) maxVol = b.volume; }
    if (maxVol > 0) {
      var bw = Math.max(1, this.barSpacing * 0.7);
      for (i = lo; i <= hi; i++) {
        b = this.bars[i]; if (!b || !b.volume) continue;
        var vx = this.indexToX(i);
        var vh = (b.volume / maxVol) * (pp.h - volTop - 2);
        c.fillStyle = b.close >= b.open ? o.volumeUp : o.volumeDown;
        c.fillRect(vx - bw / 2, pp.y0 + pp.h - vh, bw, vh);
      }
    }

    var half = Math.max(0.5, this.barSpacing * 0.35);
    for (i = lo; i <= hi; i++) {
      b = this.bars[i]; if (!b) continue;
      var cx = this.indexToX(i);
      if (cx < -this.barSpacing || cx > W + this.barSpacing) continue;
      var up = b.close >= b.open;
      var yO = pp.toY(b.open), yC = pp.toY(b.close);
      var yH = pp.toY(b.high), yL = pp.toY(b.low);
      c.strokeStyle = up ? o.wickUp : o.wickDown;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(Math.round(cx) + 0.5, yH); c.lineTo(Math.round(cx) + 0.5, yL); c.stroke();
      c.fillStyle = up ? o.upColor : o.downColor;
      c.fillRect(cx - half, Math.min(yO, yC), half * 2, Math.max(1, Math.abs(yC - yO)));
    }

    // ── every pane: histograms, guides, lines (price pane has only lines) ──
    for (pi = 0; pi < this.panes.length; pi++) {
      var pn = this.panes[pi];
      c.save();
      c.beginPath(); c.rect(0, pn.y0, W, pn.h); c.clip();

      var id;
      for (id in pn.hists) {
        var hs = pn.hists[id];
        var zeroY = pn.toY(0);
        var hw = Math.max(1, this.barSpacing * 0.55);
        for (i = lo; i <= hi; i++) {
          b = this.bars[i]; if (!b) continue;
          v = hs.byTime.get(b.time);
          if (!isNum(v)) continue;
          var hx = this.indexToX(i);
          var hy = pn.toY(v);
          c.fillStyle = v >= 0 ? hs.pos : hs.neg;
          c.fillRect(hx - hw / 2, Math.min(zeroY, hy), hw, Math.max(1, Math.abs(zeroY - hy)));
        }
      }
      for (i = 0; i < pn.guides.length; i++) {
        var g = pn.guides[i];
        var gy = pn.toY(g.value);
        c.strokeStyle = g.color; c.lineWidth = 1; c.setLineDash([4, 3]);
        c.beginPath(); c.moveTo(0, Math.round(gy) + 0.5); c.lineTo(W, Math.round(gy) + 0.5); c.stroke();
        c.setLineDash([]);
      }
      for (id in pn.lines) {
        var ln = pn.lines[id];
        c.strokeStyle = ln.color; c.lineWidth = ln.width;
        c.beginPath();
        var started = false;
        for (i = lo; i <= hi; i++) {
          b = this.bars[i]; if (!b) continue;
          v = ln.byTime.get(b.time);
          if (!isNum(v)) { started = false; continue; }
          var lx = this.indexToX(i), ly = pn.toY(v);
          if (!started) { c.moveTo(lx, ly); started = true; } else c.lineTo(lx, ly);
        }
        c.stroke();
      }
      c.restore();

      // osc pane: right-axis labels for its own scale (top & bottom values)
      if (pn.kind === "osc") {
        var oStep = niceStep(pn.max - pn.min, Math.max(2, Math.round(pn.h / 45)));
        var oDec = stepDecimals(oStep);
        var oFirst = Math.ceil(pn.min / oStep) * oStep;
        c.textBaseline = "middle"; c.fillStyle = o.textColor;
        for (v = oFirst; v <= pn.max; v += oStep) {
          y = pn.toY(v);
          if (y < pn.y0 + 8 || y > pn.y0 + pn.h - 8) continue;
          c.fillText(fmtPrice(v, oDec), W + 8, y);
        }
        // separator above the pane
        c.strokeStyle = o.separatorColor;
        c.beginPath(); c.moveTo(0, pn.y0 + 0.5); c.lineTo(this.w, pn.y0 + 0.5); c.stroke();
      }
    }

    // price lines + last-price tag (price pane only)
    var last = this.bars[this.bars.length - 1];
    var tags = this.priceLines.slice();
    if (last) tags.push({ price: last.close, color: last.close >= last.open ? o.upColor : o.downColor, _last: true });
    for (i = 0; i < tags.length; i++) {
      var t = tags[i];
      var ty = pp.toY(t.price);
      if (ty < pp.y0 || ty > pp.y0 + pp.h) continue;
      c.strokeStyle = t.color; c.lineWidth = 1; c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(0, Math.round(ty) + 0.5); c.lineTo(W, Math.round(ty) + 0.5); c.stroke();
      c.setLineDash([]);
      var txt = fmtPrice(t.price, dec);
      c.fillStyle = t._last ? t.color : o.tagBg;
      c.fillRect(W, ty - 9, o.priceAxisWidth, 18);
      c.fillStyle = t._last ? "#0d1117" : o.tagText;
      c.textBaseline = "middle";
      c.fillText(txt, W + 5, ty);
    }

    c.strokeStyle = o.gridColor;
    c.beginPath(); c.moveTo(W + 0.5, 0); c.lineTo(W + 0.5, this.h); c.stroke();
    c.beginPath(); c.moveTo(0, H + 0.5); c.lineTo(this.w, H + 0.5); c.stroke();

    this._paintDrawings();
    this._paintCross();
  };

  Chart.prototype._paintCross = function () {
    var c = this.octx, o = this.opt, W = this._plotW(), H = this._plotH();
    c.clearRect(0, 0, this.w, this.h);
    if (!this._cross) return;
    var x = this._cross.x, y = this._cross.y;
    if (x > W || y > H) return;
    var i = clamp(Math.round(this.xToIndex(x)), 0, this.bars.length - 1);
    var b = this.bars[i];
    var bx = this.indexToX(i);
    c.strokeStyle = o.crosshair; c.lineWidth = 1; c.setLineDash([4, 3]);
    c.beginPath(); c.moveTo(Math.round(bx) + 0.5, 0); c.lineTo(Math.round(bx) + 0.5, H); c.stroke();
    c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(W, Math.round(y) + 0.5); c.stroke();
    c.setLineDash([]);
    c.font = o.font; c.textBaseline = "middle";
    // the y tag speaks the scale of the pane under the cursor
    var pn = this._paneAt(y) || this.panes[0];
    var val = pn.toValue(y);
    var dec = stepDecimals(niceStep(pn.max - pn.min, 8));
    var py = fmtPrice(val, dec);
    c.fillStyle = o.tagBg;
    c.fillRect(W, y - 9, o.priceAxisWidth, 18);
    c.fillStyle = o.tagText;
    c.fillText(py, W + 5, y);
    if (b) {
      var d = new Date(b.time * 1000);
      var xt = (this._barSec || 3600) >= 86400
        ? d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + d.getUTCFullYear()
        : d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
      var tw = c.measureText(xt).width + 12;
      c.fillStyle = o.tagBg;
      c.fillRect(clamp(bx - tw / 2, 0, W - tw), H, tw, o.timeAxisHeight - 2);
      c.fillStyle = o.tagText;
      c.fillText(xt, clamp(bx - tw / 2, 0, W - tw) + 6, H + o.timeAxisHeight / 2 - 1);
    }
    if (this.crosshairCb) this.crosshairCb(b ? { bar: b, index: i, price: this.panes[0].toValue(y), paneValue: val } : null);
  };

  Chart.prototype._bind = function () {
    var self = this, el = this.overlay;
    var drag = null, pinch = null;

    el.addEventListener("mousemove", function (e) {
      var r = el.getBoundingClientRect();
      self._cross = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (self._draft) {
        self._draft.i2 = self.xToIndex(self._cross.x);
        self._draft.p2 = self.panes[0].toValue(self._cross.y);
        self._paintDrawings();
        self._paintCross();
        return;
      }
      if (drag) {
        self.rightIndex = drag.right0 + (drag.x0 - (e.clientX - r.left)) / self.barSpacing;
        self.rightIndex = clamp(self.rightIndex, 0, self.bars.length - 1 + self.opt.rightPadBars * 2);
        self._paint();
      } else self._paintCross();
    });
    el.addEventListener("mouseleave", function () { self._cross = null; drag = null; self._paintCross(); if (self.crosshairCb) self.crosshairCb(null); });
    el.addEventListener("mousedown", function (e) {
      var r = el.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      if (self.tool && self._paneAt(y) === self.panes[0]) {
        var i0 = self.xToIndex(x), v0 = self.panes[0].toValue(y);
        if (self.tool === "hline") {
          self.drawings.push({ type: "hline", p1: v0 });
          self.setTool(null);
          if (self._toolDoneCb) self._toolDoneCb();
          self._paintDrawings();
        } else {
          self._draft = { type: self.tool, i1: i0, p1: v0, i2: i0, p2: v0 };
        }
        e.preventDefault();
        return;
      }
      drag = { x0: x, right0: self.rightIndex };
      e.preventDefault();
    });
    window.addEventListener("mouseup", function () {
      drag = null;
      if (self._draft) {
        var f = self._draft;
        if (f.i1 !== f.i2 || f.p1 !== f.p2) self.drawings.push(f);
        self._draft = null;
        self.setTool(null);
        if (self._toolDoneCb) self._toolDoneCb();
        self._paintDrawings();
      }
    });
    el.addEventListener("dblclick", function () { self.scrollToRealtime(); });

    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = el.getBoundingClientRect();
      var x = e.clientX - r.left;
      // A Mac trackpad swipes horizontally with deltaX: that is a PAN, the
      // way every charting tool treats it. Vertical wheel stays zoom.
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
        self.rightIndex = clamp(self.rightIndex + e.deltaX / self.barSpacing,
          0, self.bars.length - 1 + self.opt.rightPadBars * 2);
        self._paint();
        return;
      }
      var anchor = self.xToIndex(x);
      var k = Math.exp(-e.deltaY * 0.0015);
      self.barSpacing = clamp(self.barSpacing * k, self.opt.minBarSpacing, self.opt.maxBarSpacing);
      self.rightIndex = anchor - (self.xToIndex(x) - self.rightIndex);
      self._paint();
    }, { passive: false });

    el.addEventListener("touchstart", function (e) {
      var r = el.getBoundingClientRect();
      if (e.touches.length === 1) drag = { x0: e.touches[0].clientX - r.left, right0: self.rightIndex };
      else if (e.touches.length === 2) {
        drag = null;
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        pinch = { d0: Math.abs(dx) || 1, spacing0: self.barSpacing };
      }
    }, { passive: true });
    el.addEventListener("touchmove", function (e) {
      var r = el.getBoundingClientRect();
      if (pinch && e.touches.length === 2) {
        var d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1;
        self.barSpacing = clamp(pinch.spacing0 * d / pinch.d0, self.opt.minBarSpacing, self.opt.maxBarSpacing);
        self._paint();
      } else if (drag && e.touches.length === 1) {
        self.rightIndex = drag.right0 + (drag.x0 - (e.touches[0].clientX - r.left)) / self.barSpacing;
        self.rightIndex = clamp(self.rightIndex, 0, self.bars.length - 1 + self.opt.rightPadBars * 2);
        self._paint();
        e.preventDefault();
      }
    }, { passive: false });
    el.addEventListener("touchend", function (e) { if (!e.touches.length) { drag = null; pinch = null; } }, { passive: true });
  };

  // Ready-made palettes; pass one to createChart or applyOptions. Colors are
  // read at paint time, so switching themes live is one applyOptions call.
  var THEMES = {
    dark: {},                               // DEFAULTS already are the dark look
    light: {
      background: "#ffffff",
      textColor: "#5f6b7c",
      gridColor: "rgba(42,46,57,0.10)",
      separatorColor: "rgba(42,46,57,0.28)",
      crosshair: "rgba(95,107,124,0.45)",
      tagBg: "#e0e3eb",
      tagText: "#131722",
      volumeUp: "rgba(8,153,129,0.30)",
      volumeDown: "rgba(242,54,69,0.30)",
      upColor: "#089981", downColor: "#f23645",
      wickUp: "#089981", wickDown: "#f23645",
    },
  };

  global.TRCharts = {
    version: "0.4.0",
    themes: THEMES,
    createChart: function (el, options) { return new Chart(el, options); },
  };
})(typeof window !== "undefined" ? window : this);
