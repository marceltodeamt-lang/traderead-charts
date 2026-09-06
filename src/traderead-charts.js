/*!
 * TradeRead Charts v0.1.0
 * Copyright (c) 2026 Marcel Todea / TradeRead — traderead.ai
 * Original work, written from first principles. TradeRead Community License
 * (see LICENSE.md): free to use, the TradeRead mark stays visible.
 */
(function (global) {
  "use strict";

  // ── Defaults ──────────────────────────────────────────────────────────
  var DEFAULTS = {
    background: "#0d1117",
    textColor: "#8b949e",
    gridColor: "rgba(139,148,158,0.12)",
    upColor: "#00d97e",
    downColor: "#f85149",
    wickUp: "#00d97e",
    wickDown: "#f85149",
    volumeUp: "rgba(0,217,126,0.35)",
    volumeDown: "rgba(248,81,73,0.35)",
    crosshair: "rgba(139,148,158,0.45)",
    axisBg: "#0d1117",
    tagBg: "#2a2e39",
    tagText: "#e6edf3",
    font: "11px -apple-system, 'Segoe UI', system-ui, sans-serif",
    priceAxisWidth: 64,
    timeAxisHeight: 24,
    barSpacing: 8,          // px per bar at start
    minBarSpacing: 1.5,
    maxBarSpacing: 60,
    rightPadBars: 5,        // empty bars kept right of the last candle
    volumeHeightPct: 0.18,  // bottom slice of the pane for volume
    autoScalePadPct: 0.08,
    logo: true,             // the TradeRead mark (see LICENSE.md)
  };

  // ── Small helpers ─────────────────────────────────────────────────────
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }
  function isNum(v) { return typeof v === "number" && isFinite(v); }

  // A pleasant tick step: 1, 2, 2.5, 5 × 10^k covering `span` in ~n steps.
  function niceStep(span, n) {
    var raw = span / Math.max(1, n);
    var mag = Math.pow(10, Math.floor(Math.log(raw) / Math.LN10));
    var norm = raw / mag;
    var step = norm >= 5 ? 10 : norm >= 2.5 ? 5 : norm >= 2 ? 2.5 : norm >= 1 ? 2 : 1;
    return step * mag;
  }

  // Decimal places that make `step` read cleanly (0.00025 → 5, 250 → 0).
  function stepDecimals(step) {
    if (step >= 1) return step % 1 === 0 ? 0 : 2;
    var d = 0, s = step;
    while (s < 1 && d < 10) { s *= 10; d++; }
    return d + (Math.round(s) !== s ? 1 : 0);
  }

  function fmtPrice(v, dec) {
    return v.toLocaleString("en-US", { minimumFractionDigits: dec, maximumFractionDigits: dec });
  }

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  // ── Chart ─────────────────────────────────────────────────────────────
  function Chart(container, options) {
    var self = this;
    this.el = container;
    this.opt = Object.assign({}, DEFAULTS, options || {});
    this.bars = [];              // {time(sec), open, high, low, close, volume}
    this.lines = {};             // id → {data:[{time,value}], color, width, byTime:Map}
    this.priceLines = [];        // {price, color, dash, label}
    this.barSpacing = this.opt.barSpacing;
    this.rightIndex = 0;         // fractional bar index aligned to the right edge (before pad)
    this.crosshairCb = null;
    this._cross = null;          // {x,y} in CSS px, or null

    container.style.position = container.style.position || "relative";
    container.style.background = this.opt.background;
    container.style.overflow = "hidden";

    this.canvas = document.createElement("canvas");
    this.overlay = document.createElement("canvas");
    [this.canvas, this.overlay].forEach(function (c) {
      c.style.cssText = "position:absolute;left:0;top:0;width:100%;height:100%;display:block;";
      container.appendChild(c);
    });
    this.ctx = this.canvas.getContext("2d");
    this.octx = this.overlay.getContext("2d");

    if (this.opt.logo) this._mountLogo();

    this._ro = new ResizeObserver(function () { self._resize(); });
    this._ro.observe(container);
    this._resize();
    this._bind();
  }

  Chart.prototype._mountLogo = function () {
    // The license's attribution mark (LICENSE.md §1). Kept as DOM so it
    // stays crisp at every DPR and never redraws with the data.
    var d = document.createElement("div");
    d.className = "trc-logo";
    d.style.cssText = "position:absolute;left:8px;bottom:" + (this.opt.timeAxisHeight + 8) +
      "px;z-index:3;display:flex;align-items:center;gap:5px;font:800 11px -apple-system,'Segoe UI',sans-serif;" +
      "color:rgba(139,148,158,0.6);pointer-events:none;user-select:none;";
    d.innerHTML = '<svg width="14" height="14" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">' +
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
    [this.canvas, this.overlay].forEach(function (c) {
      c.width = Math.round(this.w * dpr);
      c.height = Math.round(this.h * dpr);
    }, this);
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.octx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._paint();
  };

  // ── Coordinate frames ────────────────────────────────────────────────
  // Plot area excludes the two axes.
  Chart.prototype._plot = function () {
    return { x: 0, y: 0, w: this.w - this.opt.priceAxisWidth, h: this.h - this.opt.timeAxisHeight };
  };
  Chart.prototype.indexToX = function (i) {
    var p = this._plot();
    return p.w - (this.rightIndex + this.opt.rightPadBars - i) * this.barSpacing;
  };
  Chart.prototype.xToIndex = function (x) {
    var p = this._plot();
    return this.rightIndex + this.opt.rightPadBars - (p.w - x) / this.barSpacing;
  };
  Chart.prototype._visibleRange = function () {
    var lo = Math.floor(this.xToIndex(0)), hi = Math.ceil(this.xToIndex(this._plot().w));
    return [clamp(lo, 0, this.bars.length - 1), clamp(hi, 0, this.bars.length - 1)];
  };

  // Vertical scale is recomputed per paint from what is visible (price and
  // overlay lines both count — an EMA200 far from price must stay on-frame).
  Chart.prototype._computeScale = function () {
    var r = this._visibleRange(), lo = r[0], hi = r[1];
    var min = Infinity, max = -Infinity, i, b;
    for (i = lo; i <= hi; i++) {
      b = this.bars[i];
      if (!b) continue;
      if (b.low < min) min = b.low;
      if (b.high > max) max = b.high;
    }
    for (var id in this.lines) {
      var ln = this.lines[id];
      for (i = lo; i <= hi; i++) {
        b = this.bars[i];
        if (!b) continue;
        var v = ln.byTime.get(b.time);
        if (isNum(v)) { if (v < min) min = v; if (v > max) max = v; }
      }
    }
    if (!isFinite(min) || !isFinite(max)) { min = 0; max = 1; }
    if (min === max) { min -= 0.5; max += 0.5; }
    var pad = (max - min) * this.opt.autoScalePadPct;
    this._pMin = min - pad;
    this._pMax = max + pad;
  };
  Chart.prototype.priceToY = function (v) {
    var p = this._plot();
    var usable = p.h * (1 - this.opt.volumeHeightPct * 0.35); // candles may dip into the volume band's top
    return (this._pMax - v) / (this._pMax - this._pMin) * usable;
  };
  Chart.prototype.yToPrice = function (y) {
    var p = this._plot();
    var usable = p.h * (1 - this.opt.volumeHeightPct * 0.35);
    return this._pMax - (y / usable) * (this._pMax - this._pMin);
  };

  // ── Data API ─────────────────────────────────────────────────────────
  Chart.prototype.setData = function (bars) {
    this.bars = (bars || []).slice().sort(function (a, b) { return a.time - b.time; });
    this.rightIndex = this.bars.length - 1;
    this._paint();
  };
  Chart.prototype.update = function (bar) {
    var n = this.bars.length;
    if (n && this.bars[n - 1].time === bar.time) this.bars[n - 1] = bar;
    else {
      var atRight = Math.abs(this.rightIndex - (n - 1)) < 2;
      this.bars.push(bar);
      if (atRight) this.rightIndex = this.bars.length - 1;  // follow live only if not scrolled back
    }
    this._paint();
  };
  Chart.prototype.addLine = function (id, data, color, width) {
    var byTime = new Map();
    (data || []).forEach(function (d) { byTime.set(d.time, d.value); });
    this.lines[id] = { data: data || [], color: color || "#58a6ff", width: width || 1.4, byTime: byTime };
    this._paint();
  };
  Chart.prototype.removeLine = function (id) { delete this.lines[id]; this._paint(); };
  Chart.prototype.addPriceLine = function (price, color, label) {
    this.priceLines.push({ price: price, color: color || "#8b949e", label: label });
    this._paint();
  };
  Chart.prototype.clearPriceLines = function () { this.priceLines = []; this._paint(); };
  Chart.prototype.onCrosshair = function (cb) { this.crosshairCb = cb; };
  Chart.prototype.applyOptions = function (o) { Object.assign(this.opt, o || {}); this.el.style.background = this.opt.background; this._paint(); };
  Chart.prototype.scrollToRealtime = function () { this.rightIndex = this.bars.length - 1; this._paint(); };
  Chart.prototype.remove = function () { this._ro.disconnect(); this.el.innerHTML = ""; };

  // ── Painting ─────────────────────────────────────────────────────────
  Chart.prototype._paint = function () {
    var c = this.ctx, o = this.opt, p = this._plot();
    if (!p.w || !p.h) return;
    this._computeScale();
    c.clearRect(0, 0, this.w, this.h);
    c.fillStyle = o.background;
    c.fillRect(0, 0, this.w, this.h);
    c.font = o.font;

    // price grid + axis labels
    var span = this._pMax - this._pMin;
    var step = niceStep(span, Math.max(3, Math.round(p.h / 55)));
    var dec = stepDecimals(step);
    var first = Math.ceil(this._pMin / step) * step;
    c.textBaseline = "middle";
    for (var v = first; v <= this._pMax; v += step) {
      var y = this.priceToY(v);
      if (y < 4 || y > p.h - 4) continue;
      c.strokeStyle = o.gridColor; c.lineWidth = 1;
      c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(p.w, Math.round(y) + 0.5); c.stroke();
      c.fillStyle = o.textColor;
      c.fillText(fmtPrice(v, dec), p.w + 8, y);
    }

    // time grid + labels: pick a bar step that keeps labels ~90px apart
    var rng = this._visibleRange(), lo = rng[0], hi = rng[1];
    var barStep = Math.max(1, Math.round(90 / this.barSpacing));
    var lastDay = null;
    c.textBaseline = "top";
    for (var i = lo - (lo % barStep); i <= hi; i += barStep) {
      var b = this.bars[i];
      if (!b) continue;
      var x = this.indexToX(i);
      if (x < 0 || x > p.w) continue;
      c.strokeStyle = o.gridColor;
      c.beginPath(); c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, p.h); c.stroke();
      var d = new Date(b.time * 1000);
      var dayKey = d.getUTCMonth() + "-" + d.getUTCDate();
      var label = (dayKey !== lastDay)
        ? (d.getUTCDate() === 1 ? MONTHS[d.getUTCMonth()] : d.getUTCDate() + " " + MONTHS[d.getUTCMonth()])
        : pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
      lastDay = dayKey;
      c.fillStyle = o.textColor;
      c.fillText(label, x - c.measureText(label).width / 2, p.h + 7);
    }

    // volume band
    var volTop = p.h * (1 - o.volumeHeightPct);
    var maxVol = 0;
    for (i = lo; i <= hi; i++) { b = this.bars[i]; if (b && b.volume > maxVol) maxVol = b.volume; }
    if (maxVol > 0) {
      var bw = Math.max(1, this.barSpacing * 0.7);
      for (i = lo; i <= hi; i++) {
        b = this.bars[i]; if (!b || !b.volume) continue;
        var vx = this.indexToX(i);
        var vh = (b.volume / maxVol) * (p.h - volTop - 2);
        c.fillStyle = b.close >= b.open ? o.volumeUp : o.volumeDown;
        c.fillRect(vx - bw / 2, p.h - vh, bw, vh);
      }
    }

    // candles
    var half = Math.max(0.5, this.barSpacing * 0.35);
    for (i = lo; i <= hi; i++) {
      b = this.bars[i]; if (!b) continue;
      var cx = this.indexToX(i);
      if (cx < -this.barSpacing || cx > p.w + this.barSpacing) continue;
      var up = b.close >= b.open;
      var yO = this.priceToY(b.open), yC = this.priceToY(b.close);
      var yH = this.priceToY(b.high), yL = this.priceToY(b.low);
      c.strokeStyle = up ? o.wickUp : o.wickDown;
      c.lineWidth = 1;
      c.beginPath(); c.moveTo(Math.round(cx) + 0.5, yH); c.lineTo(Math.round(cx) + 0.5, yL); c.stroke();
      c.fillStyle = up ? o.upColor : o.downColor;
      var top = Math.min(yO, yC);
      c.fillRect(cx - half, top, half * 2, Math.max(1, Math.abs(yC - yO)));
    }

    // overlay lines (EMA & co.), clipped to the plot
    c.save();
    c.beginPath(); c.rect(0, 0, p.w, p.h); c.clip();
    for (var id in this.lines) {
      var ln = this.lines[id];
      c.strokeStyle = ln.color; c.lineWidth = ln.width;
      c.beginPath();
      var started = false;
      for (i = lo; i <= hi; i++) {
        b = this.bars[i]; if (!b) continue;
        var lv = ln.byTime.get(b.time);
        if (!isNum(lv)) { started = false; continue; }
        var lx = this.indexToX(i), ly = this.priceToY(lv);
        if (!started) { c.moveTo(lx, ly); started = true; } else c.lineTo(lx, ly);
      }
      c.stroke();
    }
    c.restore();

    // price lines + last-price tag
    var last = this.bars[this.bars.length - 1];
    var tags = this.priceLines.slice();
    if (last) tags.push({ price: last.close, color: last.close >= last.open ? o.upColor : o.downColor, _last: true });
    for (i = 0; i < tags.length; i++) {
      var t = tags[i];
      var ty = this.priceToY(t.price);
      if (ty < 0 || ty > p.h) continue;
      c.strokeStyle = t.color; c.lineWidth = 1;
      c.setLineDash([4, 3]);
      c.beginPath(); c.moveTo(0, Math.round(ty) + 0.5); c.lineTo(p.w, Math.round(ty) + 0.5); c.stroke();
      c.setLineDash([]);
      var txt = fmtPrice(t.price, dec);
      var tw = c.measureText(txt).width + 10;
      c.fillStyle = t._last ? t.color : o.tagBg;
      c.fillRect(p.w, ty - 9, Math.max(tw, o.priceAxisWidth), 18);
      c.fillStyle = t._last ? "#0d1117" : o.tagText;
      c.textBaseline = "middle";
      c.fillText(txt, p.w + 5, ty);
    }

    // axis separators
    c.strokeStyle = o.gridColor;
    c.beginPath(); c.moveTo(p.w + 0.5, 0); c.lineTo(p.w + 0.5, this.h); c.stroke();
    c.beginPath(); c.moveTo(0, p.h + 0.5); c.lineTo(this.w, p.h + 0.5); c.stroke();

    this._paintCross();
  };

  Chart.prototype._paintCross = function () {
    var c = this.octx, o = this.opt, p = this._plot();
    c.clearRect(0, 0, this.w, this.h);
    if (!this._cross) return;
    var x = this._cross.x, y = this._cross.y;
    if (x > p.w || y > p.h) return;
    var i = clamp(Math.round(this.xToIndex(x)), 0, this.bars.length - 1);
    var b = this.bars[i];
    var bx = this.indexToX(i);
    c.strokeStyle = o.crosshair; c.lineWidth = 1; c.setLineDash([4, 3]);
    c.beginPath(); c.moveTo(Math.round(bx) + 0.5, 0); c.lineTo(Math.round(bx) + 0.5, p.h); c.stroke();
    c.beginPath(); c.moveTo(0, Math.round(y) + 0.5); c.lineTo(p.w, Math.round(y) + 0.5); c.stroke();
    c.setLineDash([]);
    c.font = o.font; c.textBaseline = "middle";
    // y tag
    var span = this._pMax - this._pMin;
    var dec = stepDecimals(niceStep(span, 8));
    var py = fmtPrice(this.yToPrice(y), dec);
    c.fillStyle = o.tagBg;
    c.fillRect(p.w, y - 9, o.priceAxisWidth, 18);
    c.fillStyle = o.tagText;
    c.fillText(py, p.w + 5, y);
    // x tag
    if (b) {
      var d = new Date(b.time * 1000);
      var xt = d.getUTCDate() + " " + MONTHS[d.getUTCMonth()] + " " + pad2(d.getUTCHours()) + ":" + pad2(d.getUTCMinutes());
      var tw = c.measureText(xt).width + 12;
      c.fillStyle = o.tagBg;
      c.fillRect(clamp(bx - tw / 2, 0, p.w - tw), p.h, tw, o.timeAxisHeight - 2);
      c.fillStyle = o.tagText;
      c.fillText(xt, clamp(bx - tw / 2, 0, p.w - tw) + 6, p.h + o.timeAxisHeight / 2 - 1);
    }
    if (this.crosshairCb) this.crosshairCb(b ? { bar: b, index: i, price: this.yToPrice(y) } : null);
  };

  // ── Interaction ──────────────────────────────────────────────────────
  Chart.prototype._bind = function () {
    var self = this, el = this.overlay;
    var drag = null;          // {x0, right0}
    var pinch = null;         // {d0, spacing0, mid}

    el.addEventListener("mousemove", function (e) {
      var r = el.getBoundingClientRect();
      self._cross = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (drag) {
        self.rightIndex = drag.right0 + (drag.x0 - (e.clientX - r.left)) / self.barSpacing;
        self.rightIndex = clamp(self.rightIndex, 0, self.bars.length - 1 + self.opt.rightPadBars * 2);
        self._paint();
      } else self._paintCross();
    });
    el.addEventListener("mouseleave", function () { self._cross = null; drag = null; self._paintCross(); if (self.crosshairCb) self.crosshairCb(null); });
    el.addEventListener("mousedown", function (e) {
      var r = el.getBoundingClientRect();
      drag = { x0: e.clientX - r.left, right0: self.rightIndex };
      e.preventDefault();
    });
    window.addEventListener("mouseup", function () { drag = null; });
    el.addEventListener("dblclick", function () { self.scrollToRealtime(); });

    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      var r = el.getBoundingClientRect();
      var x = e.clientX - r.left;
      var anchor = self.xToIndex(x);              // keep the bar under the cursor put
      var k = Math.exp(-e.deltaY * 0.0015);
      self.barSpacing = clamp(self.barSpacing * k, self.opt.minBarSpacing, self.opt.maxBarSpacing);
      self.rightIndex = anchor - (self.xToIndex(x) - self.rightIndex); // re-anchor
      self._paint();
    }, { passive: false });

    el.addEventListener("touchstart", function (e) {
      var r = el.getBoundingClientRect();
      if (e.touches.length === 1) {
        drag = { x0: e.touches[0].clientX - r.left, right0: self.rightIndex };
      } else if (e.touches.length === 2) {
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

  global.TRCharts = {
    version: "0.1.0",
    createChart: function (el, options) { return new Chart(el, options); },
  };
})(typeof window !== "undefined" ? window : this);
