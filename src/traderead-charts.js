/*!
 * TradeRead Charts v0.10.0
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
    ui: true,               // the bundled rail + indicator panel + type switcher + camera
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
    // The price pane scales from BARS alone: overlays ride the frame. An
    // EMA200 far from price once pinned the candles to the top of the pane
    // (owner, 28 Aug: "TV e central") — that lesson is now structural.
    if (this.kind !== "price") for (id in this.lines) {
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
    min -= pad; max += pad;
    if (this.kind === "price" && this.chart._vZoom !== 1) {
      var mid = (min + max) / 2, halfR = (max - min) / 2 * this.chart._vZoom;
      min = mid - halfR; max = mid + halfR;
    }
    this.min = min; this.max = max;
  };

  function Chart(container, options) {
    var self = this;
    this.el = container;
    this.opt = Object.assign({}, DEFAULTS, options || {});
    this.bars = [];
    this.panes = [new Pane(this, "price")];
    this.priceLines = [];
    this.drawings = [];             // {id, type, t1,p1, t2,p2, text?, size?} in (time, price) space
    this.tool = null;               // null = cursor (select/move); tools mirror the production rail
    this._draft = null;
    this._selected = null;
    this._dragDraw = null;          // {d, handle:"p2"|null, t0, v0, orig}
    this._persistKey = null;
    this._saveT = null;
    this._sepDrag = null;           // {i, y0, h0} while a pane separator is dragged
    this._vZoom = 1;                // vertical stretch of the price pane (wheel on the axis)
    this.indicators = [];           // built-in indicator list (see addIndicator)
    this._indColor = 0;
    this.chartType = "candles";     // "candles" | "bars" | "line" | "area" | "baseline"
    this.markers = [];              // {time, position:"above"|"below", shape, color, text}
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
    if (this.opt.ui) this._mountUI();

    this._ro = new ResizeObserver(function () { self._resize(); });
    this._ro.observe(container);
    this._resize();
    this._bind();
  }


  // ── Bundled UI: the plus over the bare engine ────────────────────────
  // ui: true (default) mounts the production-style rail: drawing tools,
  // the TradingView-style indicator panel (many EMAs, SMA, add/remove,
  // editable params), the chart-type switcher and a PNG camera.
  var SVGI = function (inner) {
    return '<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round">' + inner + "</svg>";
  };
  var ICONS = {
    cursor: SVGI('<path d="M4 2 L12 8.5 L8.2 9.3 L6.2 13.5 Z" fill="currentColor" stroke="none"/>'),
    trend: SVGI('<line x1="3" y1="13" x2="13" y2="3"/><circle cx="3" cy="13" r="1.4" fill="currentColor" stroke="none"/><circle cx="13" cy="3" r="1.4" fill="currentColor" stroke="none"/>'),
    hline: SVGI('<line x1="2" y1="8" x2="14" y2="8"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/>'),
    rect: SVGI('<rect x="3" y="4.5" width="10" height="7" rx="1"/>'),
    fib: SVGI('<line x1="2.5" y1="4" x2="13.5" y2="4"/><line x1="2.5" y1="8" x2="13.5" y2="8" opacity="0.55"/><line x1="2.5" y1="12" x2="13.5" y2="12"/>'),
    text: SVGI('<path d="M4 4 H12 M8 4 V12.5" />'),
    trash: SVGI('<line x1="4" y1="4" x2="12" y2="12"/><line x1="12" y1="4" x2="4" y2="12"/>'),
    ind: SVGI('<path d="M2.5 11 L6 7 L9 9.5 L13.5 4"/><circle cx="13.5" cy="4" r="1.3" fill="currentColor" stroke="none"/>'),
    camera: SVGI('<rect x="2.5" y="5" width="11" height="8" rx="1.5"/><path d="M6 5 L7 3.2 H9 L10 5"/><circle cx="8" cy="9" r="2.2"/>'),
    candles: SVGI('<line x1="5" y1="2.5" x2="5" y2="13.5"/><rect x="3.4" y="5" width="3.2" height="5" fill="currentColor" stroke="none" rx="0.6"/><line x1="11" y1="2.5" x2="11" y2="13.5"/><rect x="9.4" y="4" width="3.2" height="6.5" fill="currentColor" stroke="none" rx="0.6"/>'),
    bars: SVGI('<line x1="5" y1="3" x2="5" y2="13"/><line x1="3.5" y1="6" x2="5" y2="6"/><line x1="5" y1="10" x2="6.5" y2="10"/><line x1="11" y1="3" x2="11" y2="13"/><line x1="9.5" y1="7" x2="11" y2="7"/><line x1="11" y1="11" x2="12.5" y2="11"/>'),
    line: SVGI('<path d="M2.5 11 L6 7 L9 9.5 L13.5 4"/>'),
    area: SVGI('<path d="M2.5 11 L6 7 L9 9.5 L13.5 4 V13 H2.5 Z" fill="currentColor" opacity="0.35" stroke="none"/><path d="M2.5 11 L6 7 L9 9.5 L13.5 4"/>'),
    baseline: SVGI('<line x1="2" y1="8" x2="14" y2="8" stroke-dasharray="2 2"/><path d="M2.5 10.5 L6 5.5 L9 9 L13.5 4"/>'),
    hollow: SVGI('<line x1="5" y1="2.5" x2="5" y2="13.5"/><rect x="3.4" y="5" width="3.2" height="5" rx="0.6"/><line x1="11" y1="2.5" x2="11" y2="13.5"/><rect x="9.4" y="4" width="3.2" height="6.5" fill="currentColor" stroke="none" rx="0.6"/>'),
    heikin: SVGI('<rect x="2.8" y="6" width="3.4" height="6" rx="1.6"/><rect x="9.8" y="3.5" width="3.4" height="6" rx="1.6" fill="currentColor" stroke="none"/>'),
    share: SVGI('<path d="M8 10 V2.8 M5.5 5 L8 2.5 L10.5 5"/><path d="M4 8.5 H3 V13.5 H13 V8.5 H12"/>'),
    fit: SVGI('<path d="M6 2.5 V6 H2.5 M13.5 6 H10 V2.5 M10 13.5 V10 H13.5 M2.5 10 H6 V13.5"/>'),
  };
  var TYPE_LIST = [
    ["candles", "Candles"], ["hollow", "Hollow candles"], ["heikin", "Heikin Ashi"],
    ["bars", "OHLC bars"], ["line", "Line"], ["area", "Area"], ["baseline", "Baseline"],
  ];

  Chart.prototype._mountUI = function () {
    var self = this, o = this.opt;
    var rail = document.createElement("div");
    rail.className = "trc-rail";
    rail.style.cssText = "position:absolute;left:8px;top:10px;z-index:6;display:flex;flex-direction:column;gap:3px;" +
      "background:" + o.background + ";border:1px solid " + o.separatorColor + ";border-radius:10px;padding:4px;";
    function btn(icon, tip, fn) {
      var b = document.createElement("button");
      b.type = "button"; b.innerHTML = icon; b.title = tip;
      b.style.cssText = "border:none;background:none;color:" + o.textColor + ";width:26px;height:26px;" +
        "border-radius:7px;cursor:pointer;font:700 13px -apple-system,'Segoe UI',sans-serif;line-height:1;";
      b.addEventListener("click", function () { fn(b); });
      rail.appendChild(b);
      return b;
    }
    function mark(active) {
      rail.querySelectorAll("button").forEach(function (b) {
        b.style.background = b === active ? "rgba(99,102,241,0.3)" : "none";
      });
    }
    var toolBtns = {};
    [[ICONS.cursor, "Select / move", null], [ICONS.trend, "Trend line", "trend"], [ICONS.hline, "Horizontal line", "hline"],
     [ICONS.rect, "Rectangle", "rect"], [ICONS.fib, "Fibonacci retracement", "fib"], [ICONS.text, "Text", "text"]].forEach(function (t) {
      toolBtns[t[2] || "cursor"] = btn(t[0], t[1], function (b) { self.setTool(t[2]); mark(t[2] ? b : toolBtns.cursor); });
    });
    mark(toolBtns.cursor);
    this.onToolDone(function () { mark(toolBtns.cursor); });
    btn(ICONS.trash, "Delete selected (Del)", function () { self.deleteSelected(); });
    var sep = document.createElement("div");
    sep.style.cssText = "height:1px;background:" + o.separatorColor + ";margin:3px 2px;";
    rail.appendChild(sep);
    btn(ICONS.ind, "Indicators", function () { self._toggleIndPanel(); });
    var typeBtn = btn(ICONS.candles, "Chart type", function () { self._toggleTypeMenu(typeBtn); });
    this._typeBtn = typeBtn;
    btn(ICONS.camera, "Screenshot (PNG)", function () { self.snapshot(); });
    btn(ICONS.share, "Share chart", function (b) { self.share(b); });
    btn(ICONS.fit, "Fit chart", function () { self.fit(); });
    this.el.appendChild(rail);
    this._rail = rail;

    // fullscreen, bottom-right (owner, 7 Sep 2026)
    var fsIcon = SVGI('<path d="M2.5 6 V2.5 H6 M10 2.5 H13.5 V6 M13.5 10 V13.5 H10 M6 13.5 H2.5 V10"/>');
    var fsExit = SVGI('<path d="M6 2.5 V6 H2.5 M13.5 6 H10 V2.5 M10 13.5 V10 H13.5 M2.5 10 H6 V13.5"/>');
    var fsBtn = document.createElement("button");
    fsBtn.type = "button"; fsBtn.title = "Fullscreen"; fsBtn.innerHTML = fsIcon;
    // visibly a button, not axis furniture (owner: nobody would find the
    // faint one): accent tint, larger hit area, brightens on hover
    fsBtn.style.cssText = "position:absolute;right:" + (o.priceAxisWidth + 10) + "px;bottom:" + (o.timeAxisHeight + 10) + "px;z-index:6;" +
      "width:34px;height:34px;border:1px solid rgba(129,140,248,0.55);border-radius:10px;" +
      "background:rgba(99,102,241,0.22);color:" + o.tagText + ";cursor:pointer;" +
      "display:flex;align-items:center;justify-content:center;box-shadow:0 2px 10px rgba(0,0,0,0.25);";
    fsBtn.addEventListener("mouseenter", function () { fsBtn.style.background = "rgba(99,102,241,0.4)"; });
    fsBtn.addEventListener("mouseleave", function () { fsBtn.style.background = "rgba(99,102,241,0.22)"; });
    fsBtn.addEventListener("click", function () {
      if (document.fullscreenElement === self.el) document.exitFullscreen();
      else if (self.el.requestFullscreen) self.el.requestFullscreen();
    });
    document.addEventListener("fullscreenchange", function () {
      fsBtn.innerHTML = document.fullscreenElement === self.el ? fsExit : fsIcon;
    });
    this.el.appendChild(fsBtn);
  };

  // A picker list, not a blind cycle: seven types, current one checked.

  // ── Symbol search ────────────────────────────────────────────────────
  // The selector ships with the widget; the DATA behind it is pluggable:
  //   symbolSearch: {
  //     search: function (query, cb) { cb([{symbol, display, name, exchange}]) },
  //     onSelect: function (item) { ... host loads bars ... },
  //   }
  // Matches by ticker or by name; several results = the dropdown decides.
  Chart.prototype._toggleSearch = function () {
    var self = this, o = this.opt;
    var cfg = o.symbolSearch;
    if (!cfg || !cfg.search) return;
    if (this._searchBox) { this._searchBox.remove(); this._searchBox = null; return; }
    var wrap = document.createElement("div");
    wrap.className = "trc-search";
    wrap.style.cssText = "position:absolute;inset:0;z-index:22;display:flex;align-items:flex-start;justify-content:center;" +
      "background:rgba(0,0,0,0.5);padding-top:48px;";
    var box = document.createElement("div");
    box.style.cssText = "width:min(420px,92%);background:" + o.background + ";border:1px solid " + o.separatorColor + ";" +
      "border-radius:14px;padding:10px;box-shadow:0 12px 40px rgba(0,0,0,0.4);";
    var inp = document.createElement("input");
    inp.type = "text";
    inp.placeholder = "Search ticker or name…";
    inp.style.cssText = "width:100%;box-sizing:border-box;background:none;border:1px solid " + o.separatorColor + ";" +
      "border-radius:9px;color:" + o.tagText + ";font:600 14px -apple-system,'Segoe UI',sans-serif;padding:9px 12px;outline:none;";
    var list = document.createElement("div");
    list.style.cssText = "margin-top:8px;max-height:300px;overflow:auto;";
    box.appendChild(inp); box.appendChild(list);
    wrap.appendChild(box);
    wrap.addEventListener("click", function (e) { if (e.target === wrap) close(); });
    this.el.appendChild(wrap);
    this._searchBox = wrap;
    inp.focus();

    var items = [], active = -1, timer = null;
    function close() { wrap.remove(); self._searchBox = null; }
    function paint() {
      list.innerHTML = "";
      items.forEach(function (it, i) {
        var row = document.createElement("button");
        row.type = "button";
        row.style.cssText = "display:flex;align-items:center;gap:10px;width:100%;text-align:left;border:none;" +
          "background:" + (i === active ? "rgba(99,102,241,0.25)" : "none") + ";color:" + o.tagText + ";" +
          "font:600 13px -apple-system,'Segoe UI',sans-serif;border-radius:8px;padding:8px 10px;cursor:pointer;";
        row.innerHTML = '<span style="min-width:64px;font-weight:800;">' + (it.display || it.symbol) + "</span>" +
          '<span style="flex:1;color:' + o.textColor + ';overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">' + (it.name || "") + "</span>" +
          (it.exchange ? '<span style="font-size:10px;font-weight:800;color:' + o.textColor + ';border:1px solid ' + o.separatorColor + ';border-radius:5px;padding:1px 5px;">' + it.exchange + "</span>" : "");
        row.addEventListener("click", function () { pick(it); });
        row.addEventListener("mouseenter", function () { active = i; paint(); });
        list.appendChild(row);
      });
      if (!items.length && inp.value.trim()) {
        list.innerHTML = '<div style="color:' + o.textColor + ';font:12px -apple-system,sans-serif;padding:10px;">No matches.</div>';
      }
    }
    function pick(it) {
      close();
      if (cfg.onSelect) cfg.onSelect(it);
    }
    inp.addEventListener("input", function () {
      clearTimeout(timer);
      timer = setTimeout(function () {
        var q = inp.value.trim();
        if (!q) { items = []; active = -1; paint(); return; }
        cfg.search(q, function (res) { items = res || []; active = items.length ? 0 : -1; paint(); });
      }, 160);
    });
    inp.addEventListener("keydown", function (e) {
      if (e.key === "Escape") close();
      else if (e.key === "ArrowDown") { active = Math.min(active + 1, items.length - 1); paint(); e.preventDefault(); }
      else if (e.key === "ArrowUp") { active = Math.max(active - 1, 0); paint(); e.preventDefault(); }
      else if (e.key === "Enter" && active >= 0 && items[active]) pick(items[active]);
    });
  };

  // A picker list, not a blind cycle: seven types, current one checked.
  Chart.prototype._toggleTypeMenu = function (anchorBtn) {
    var self = this, o = this.opt;
    if (this._typeMenu) { this._typeMenu.remove(); this._typeMenu = null; return; }
    var m = document.createElement("div");
    m.className = "trc-type-menu";
    m.style.cssText = "position:absolute;left:44px;top:" + (anchorBtn ? anchorBtn.offsetTop + 4 : 40) + "px;z-index:8;" +
      "background:" + o.background + ";border:1px solid " + o.separatorColor + ";border-radius:12px;padding:6px;" +
      "color:" + o.textColor + ";font:12px -apple-system,'Segoe UI',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.35);";
    TYPE_LIST.forEach(function (t) {
      var row = document.createElement("button");
      row.type = "button";
      row.style.cssText = "display:flex;align-items:center;gap:9px;width:100%;text-align:left;border:none;" +
        "background:" + (self.chartType === t[0] ? "rgba(99,102,241,0.25)" : "none") + ";color:inherit;font:inherit;" +
        "border-radius:8px;padding:6px 10px;cursor:pointer;white-space:nowrap;";
      row.innerHTML = ICONS[t[0]] + "<span>" + t[1] + "</span>";
      row.addEventListener("click", function () {
        self.setChartType(t[0]);
        if (self._typeBtn) { self._typeBtn.innerHTML = ICONS[t[0]]; self._typeBtn.title = "Chart type: " + t[1]; }
        m.remove();
        self._typeMenu = null;
      });
      m.appendChild(row);
    });
    this.el.appendChild(m);
    this._typeMenu = m;
  };

  Chart.prototype._toggleIndPanel = function () {
    var self = this, o = this.opt;
    if (this._indPanel) { this._indPanel.remove(); this._indPanel = null; return; }
    var p = document.createElement("div");
    p.className = "trc-ind-panel";
    p.style.cssText = "position:absolute;left:44px;top:10px;z-index:7;min-width:230px;max-height:70%;overflow:auto;" +
      "background:" + o.background + ";border:1px solid " + o.separatorColor + ";border-radius:12px;padding:10px;" +
      "color:" + o.textColor + ";font:12px -apple-system,'Segoe UI',sans-serif;box-shadow:0 8px 30px rgba(0,0,0,0.35);";
    function repaint() {
      var h = '<div style="font-weight:800;margin-bottom:8px;">Indicators</div>';
      var list = self.getIndicators();
      if (!list.length) h += '<div style="opacity:0.6;margin-bottom:8px;">None active.</div>';
      list.forEach(function (ind) {
        var def = IND_DEFS[ind.kind];
        h += '<div style="display:flex;align-items:center;gap:6px;padding:4px 0;" data-row="' + ind.id + '">' +
          '<input type="color" data-color="' + ind.id + '" value="' + (ind.color || "#8b949e") + '" title="Line color" ' +
            'style="width:18px;height:18px;padding:0;border:none;border-radius:4px;background:none;cursor:pointer;">' +
          '<input type="text" data-label="' + ind.id + '" value="' + (ind.label || "") + '" placeholder="' + def.label + '" title="Rename" ' +
            'style="flex:1;min-width:60px;background:none;border:1px solid transparent;border-radius:5px;color:inherit;font:inherit;padding:1px 4px;" ' +
            'onfocus="this.style.borderColor=\'rgba(139,148,158,0.4)\'" onblur="this.style.borderColor=\'transparent\'">';
        Object.keys(ind.params).forEach(function (k) {
          h += '<input data-ind="' + ind.id + '" data-k="' + k + '" type="number" step="any" value="' + ind.params[k] + '" ' +
            'style="width:42px;background:none;border:1px solid ' + o.separatorColor + ';border-radius:5px;color:inherit;font:inherit;padding:1px 3px;">';
        });
        h += '<button data-del="' + ind.id + '" style="border:none;background:none;color:inherit;cursor:pointer;opacity:0.7;font:inherit;">✕</button></div>';
      });
      h += '<div style="border-top:1px solid ' + o.separatorColor + ';margin:8px 0;"></div>';
      Object.keys(IND_DEFS).forEach(function (kind) {
        h += '<button data-add="' + kind + '" style="border:1px solid ' + o.separatorColor + ';background:none;color:inherit;' +
          'cursor:pointer;font:inherit;border-radius:7px;padding:3px 8px;margin:2px 3px 2px 0;">+ ' + IND_DEFS[kind].label + '</button>';
      });
      p.innerHTML = h;
      p.querySelectorAll("[data-add]").forEach(function (b) {
        b.addEventListener("click", function () { self.addIndicator(b.getAttribute("data-add")); repaint(); });
      });
      p.querySelectorAll("[data-del]").forEach(function (b) {
        b.addEventListener("click", function () { self.removeIndicator(b.getAttribute("data-del")); repaint(); });
      });
      p.querySelectorAll("input[data-color]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          self.setIndicatorStyle(inp.getAttribute("data-color"), { color: inp.value });
        });
      });
      p.querySelectorAll("input[data-label]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          self.setIndicatorStyle(inp.getAttribute("data-label"), { label: inp.value.trim() });
        });
      });
      p.querySelectorAll("input[data-ind]").forEach(function (inp) {
        inp.addEventListener("change", function () {
          var patch = {};
          patch[inp.getAttribute("data-k")] = parseFloat(inp.value);
          self.updateIndicator(inp.getAttribute("data-ind"), patch);
        });
      });
    }
    repaint();
    this.el.appendChild(p);
    this._indPanel = p;
  };

  Chart.prototype._composite = function () {
    var out = document.createElement("canvas");
    out.width = this.canvas.width; out.height = this.canvas.height;
    var c = out.getContext("2d");
    c.fillStyle = this.opt.background;
    c.fillRect(0, 0, out.width, out.height);
    c.drawImage(this.canvas, 0, 0);
    c.drawImage(this.drawCanvas, 0, 0);
    return out;
  };
  // Share: the native sheet where it exists (phones), clipboard otherwise —
  // same intent as the production widget's share button.
  Chart.prototype.share = function (btnEl) {
    var self = this;
    this._composite().toBlob(function (blob) {
      var file = new File([blob], "traderead-chart.png", { type: "image/png" });
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file], title: "TradeRead chart" }).catch(function () {});
      } else if (navigator.clipboard && window.ClipboardItem) {
        navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]).then(function () {
          if (btnEl) { var t = btnEl.title; btnEl.title = "Copied to clipboard"; setTimeout(function () { btnEl.title = t; }, 1500); }
        }).catch(function () { self.snapshot(); });
      } else self.snapshot();
    });
  };

  // PNG snapshot. Nothing downloads by itself (owner, 7 Sep 2026): the
  // camera opens a preview with explicit Download / Copy / Close actions.
  Chart.prototype.snapshot = function (filename) {
    var self = this, o = this.opt;
    var out = this._composite();
    if (this._snapModal) this._snapModal.remove();
    var wrap = document.createElement("div");
    wrap.className = "trc-snap";
    wrap.style.cssText = "position:absolute;inset:0;z-index:20;display:flex;align-items:center;justify-content:center;" +
      "background:rgba(0,0,0,0.55);";
    var box = document.createElement("div");
    box.style.cssText = "max-width:86%;max-height:86%;display:flex;flex-direction:column;gap:10px;" +
      "background:" + o.background + ";border:1px solid " + o.separatorColor + ";border-radius:14px;padding:12px;";
    var img = document.createElement("img");
    img.src = out.toDataURL("image/png");
    img.style.cssText = "max-width:100%;max-height:60vh;border-radius:8px;display:block;";
    var row = document.createElement("div");
    row.style.cssText = "display:flex;gap:8px;justify-content:flex-end;";
    function act(label, fn) {
      var b = document.createElement("button");
      b.type = "button"; b.textContent = label;
      b.style.cssText = "border:1px solid " + o.separatorColor + ";background:none;color:" + o.tagText + ";" +
        "font:700 12px -apple-system,'Segoe UI',sans-serif;border-radius:8px;padding:7px 14px;cursor:pointer;";
      b.addEventListener("click", fn);
      row.appendChild(b);
      return b;
    }
    act("Download", function () {
      var a = document.createElement("a");
      a.download = filename || "traderead-chart.png";
      a.href = img.src;
      a.click();
    });
    if (navigator.clipboard && window.ClipboardItem) {
      var copyBtn = act("Copy", function () {
        out.toBlob(function (blob) {
          navigator.clipboard.write([new ClipboardItem({ "image/png": blob })])
            .then(function () { copyBtn.textContent = "Copied ✓"; setTimeout(function () { copyBtn.textContent = "Copy"; }, 1500); })
            .catch(function () { copyBtn.textContent = "Copy failed"; });
        });
      });
    }
    act("Close", function () { wrap.remove(); self._snapModal = null; });
    wrap.addEventListener("click", function (e) { if (e.target === wrap) { wrap.remove(); self._snapModal = null; } });
    box.appendChild(img); box.appendChild(row); wrap.appendChild(box);
    this.el.appendChild(wrap);
    this._snapModal = wrap;
  };

  Chart.prototype._mountLogo = function () {
    // The mark is a LINK to traderead.ai — that is the licence's attribution
    // in its working form, so it stays clickable (owner, 7 Sep 2026).
    var d = document.createElement("a");
    d.className = "trc-logo";
    d.href = "https://traderead.ai/";
    d.target = "_blank";
    d.rel = "noopener";
    d.style.cssText = "position:absolute;left:8px;bottom:" + (this.opt.timeAxisHeight + 8) +
      "px;z-index:3;display:flex;align-items:center;gap:7px;font:800 13.5px -apple-system,'Segoe UI',sans-serif;" +
      "color:rgba(139,148,158,0.78);text-decoration:none;cursor:pointer;user-select:none;";
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
  // ±4px around an oscillator pane's top edge grabs the separator.
  Chart.prototype._separatorAt = function (y) {
    for (var i = 1; i < this.panes.length; i++) {
      if (Math.abs(y - this.panes[i].y0) <= 4) return i;
    }
    return null;
  };
  Chart.prototype._paneAt = function (y) {
    for (var i = 0; i < this.panes.length; i++) {
      var pn = this.panes[i];
      if (y >= pn.y0 && y < pn.y0 + pn.h) return pn;
    }
    return null;
  };

  // Drawings anchor to (time, price): the production widget's lazy history
  // PREPENDS bars and shifts every index — a lesson already paid for once.
  Chart.prototype.timeToIndex = function (t) {
    var b = this.bars, n = b.length;
    if (!n) return 0;
    var sec = this._barSec || 3600;
    if (t <= b[0].time) return (t - b[0].time) / sec;
    if (t >= b[n - 1].time) return n - 1 + (t - b[n - 1].time) / sec;
    var lo = 0, hi = n - 1;
    while (hi - lo > 1) { var m = (lo + hi) >> 1; if (b[m].time <= t) lo = m; else hi = m; }
    return lo + (t - b[lo].time) / Math.max(1, b[hi].time - b[lo].time);
  };
  Chart.prototype.indexToTime = function (i) {
    var b = this.bars, n = b.length;
    if (!n) return 0;
    var sec = this._barSec || 3600;
    var r = Math.round(i);
    if (r >= 0 && r < n) return b[r].time + (i - r) * sec;
    if (r < 0) return b[0].time + i * sec;
    return b[n - 1].time + (i - (n - 1)) * sec;
  };
  Chart.prototype.timeToX = function (t) { return this.indexToX(this.timeToIndex(t)); };

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
    this._ha = null;
    if (this.indicators.length) this._applyIndicators();
    else this._paint();
  };
  Chart.prototype.update = function (bar) {
    var n = this.bars.length;
    if (n && this.bars[n - 1].time === bar.time) this.bars[n - 1] = bar;
    else {
      var atRight = Math.abs(this.rightIndex - (n - 1)) < 2;
      this.bars.push(bar);
      if (atRight) this.rightIndex = this.bars.length - 1;
    }
    this._ha = null;
    this._paintHeader();
    if (this.indicators.length) this._applyIndicators();
    else this._paint();
  };
  // Live tick with the bucket roll built in: when the clock crosses the bar
  // boundary a NEW candle opens at the last close. On the production site,
  // candles once froze at their close because only "update the last bar"
  // existed — that class of bug ends here, inside the library.
  Chart.prototype.tick = function (price, volume, nowSec) {
    var n = this.bars.length;
    if (!n || !isNum(price)) return;
    var sec = this._barSec || 3600;
    var now = isNum(nowSec) ? nowSec : Math.floor(Date.now() / 1000);
    var last = this.bars[n - 1];
    var bucket = Math.floor(now / sec) * sec;
    if (bucket > last.time) {
      this.update({ time: bucket, open: last.close, high: Math.max(last.close, price),
        low: Math.min(last.close, price), close: price, volume: volume || 0 });
    } else {
      this.update({ time: last.time, open: last.open, high: Math.max(last.high, price),
        low: Math.min(last.low, price), close: price, volume: (last.volume || 0) + (volume || 0) });
    }
    this._paintHeader();
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

  // ── Built-in indicators ──────────────────────────────────────────────
  // The library ships batteries included: the caller can still push raw
  // series, but add/remove/configure of the standard set is one call —
  // and the bundled panel (ui: true) gives end users the TradingView-style
  // workflow the production widget has: many EMAs, SMA, delete, params.
  var IND_PALETTE = ["#00d97e", "#f0b429", "#58a6ff", "#f85149", "#c084fc", "#22d3ee", "#fb923c", "#a3e635"];
  var IND_DEFS = {
    ema:   { label: "EMA",        overlay: true,  params: { p: 20 } },
    sma:   { label: "SMA",        overlay: true,  params: { p: 50 } },
    vwap:  { label: "VWAP",       overlay: true,  params: {} },
    bb:    { label: "Bollinger",  overlay: true,  params: { p: 20, mult: 2 } },
    rsi:   { label: "RSI",        overlay: false, params: { p: 14 } },
    macd:  { label: "MACD",       overlay: false, params: { f: 12, s: 26, sig: 9 } },
    stoch: { label: "Stochastic", overlay: false, params: { k: 14, d: 3, s: 3 } },
  };

  function calcEMA(bars, period, key) {
    var k = 2 / (period + 1), out = [], prev = null;
    for (var i = 0; i < bars.length; i++) {
      var v = key ? bars[i][key] : bars[i].close;
      prev = prev === null ? v : v * k + prev * (1 - k);
      out.push({ time: bars[i].time, value: prev });
    }
    return out;
  }
  function calcSMA(bars, period) {
    var out = [], sum = 0;
    for (var i = 0; i < bars.length; i++) {
      sum += bars[i].close;
      if (i >= period) sum -= bars[i - period].close;
      if (i >= period - 1) out.push({ time: bars[i].time, value: sum / period });
    }
    return out;
  }
  function calcVWAP(bars) {
    var out = [], pv = 0, vol = 0, day = null;
    for (var i = 0; i < bars.length; i++) {
      var b = bars[i], d = Math.floor(b.time / 86400);
      if (d !== day) { day = d; pv = 0; vol = 0; }        // session reset at the UTC day open
      var typ = (b.high + b.low + b.close) / 3;
      pv += typ * (b.volume || 1); vol += (b.volume || 1);
      out.push({ time: b.time, value: pv / vol });
    }
    return out;
  }
  function calcBB(bars, period, mult) {
    var mid = [], up = [], lo = [], win = [];
    for (var i = 0; i < bars.length; i++) {
      win.push(bars[i].close);
      if (win.length > period) win.shift();
      if (win.length === period) {
        var m = 0, j;
        for (j = 0; j < period; j++) m += win[j];
        m /= period;
        var s2 = 0;
        for (j = 0; j < period; j++) s2 += (win[j] - m) * (win[j] - m);
        var sd = Math.sqrt(s2 / period);
        mid.push({ time: bars[i].time, value: m });
        up.push({ time: bars[i].time, value: m + mult * sd });
        lo.push({ time: bars[i].time, value: m - mult * sd });
      }
    }
    return { mid: mid, up: up, lo: lo };
  }
  function calcRSI(bars, period) {                        // Wilder smoothing
    var out = [], gain = 0, loss = 0;
    for (var i = 1; i < bars.length; i++) {
      var ch = bars[i].close - bars[i - 1].close;
      if (i <= period) { gain += Math.max(ch, 0); loss += Math.max(-ch, 0); }
      if (i === period) { gain /= period; loss /= period; }
      else if (i > period) {
        gain = (gain * (period - 1) + Math.max(ch, 0)) / period;
        loss = (loss * (period - 1) + Math.max(-ch, 0)) / period;
      }
      if (i >= period) out.push({ time: bars[i].time, value: loss === 0 ? 100 : 100 - 100 / (1 + gain / loss) });
    }
    return out;
  }
  function emaOfSeries(values, period) {
    var k = 2 / (period + 1), out = [], prev = null;
    for (var i = 0; i < values.length; i++) {
      prev = prev === null ? values[i].value : values[i].value * k + prev * (1 - k);
      out.push({ time: values[i].time, value: prev });
    }
    return out;
  }
  function calcMACD(bars, f, sl, sig) {
    var closes = [];
    for (var i = 0; i < bars.length; i++) closes.push({ time: bars[i].time, value: bars[i].close });
    var ef = emaOfSeries(closes, f), es = emaOfSeries(closes, sl);
    var line = [];
    for (i = sl - 1; i < closes.length; i++) line.push({ time: closes[i].time, value: ef[i].value - es[i].value });
    var signal = emaOfSeries(line, sig);
    var hist = [];
    for (i = 0; i < line.length; i++) hist.push({ time: line[i].time, value: line[i].value - signal[i].value });
    return { line: line, signal: signal, hist: hist };
  }
  function smaOfSeries(values, period) {
    var out = [], sum = 0;
    for (var i = 0; i < values.length; i++) {
      sum += values[i].value;
      if (i >= period) sum -= values[i - period].value;
      if (i >= period - 1) out.push({ time: values[i].time, value: sum / period });
    }
    return out;
  }
  function calcStoch(bars, kP, dP, smooth) {
    var raw = [];
    for (var i = kP - 1; i < bars.length; i++) {
      var hh = -Infinity, ll = Infinity;
      for (var j = i - kP + 1; j <= i; j++) { if (bars[j].high > hh) hh = bars[j].high; if (bars[j].low < ll) ll = bars[j].low; }
      raw.push({ time: bars[i].time, value: hh === ll ? 50 : (bars[i].close - ll) / (hh - ll) * 100 });
    }
    var k = smooth > 1 ? smaOfSeries(raw, smooth) : raw;
    return { k: k, d: smaOfSeries(k, dP) };
  }

  Chart.prototype.addIndicator = function (kind, params, color) {
    var def = IND_DEFS[kind];
    if (!def) return null;
    var ind = {
      id: "i" + Math.round(performance.now() * 1000) + "_" + this.indicators.length,
      kind: kind,
      params: Object.assign({}, def.params, params || {}),
      color: color || IND_PALETTE[this._indColor++ % IND_PALETTE.length],
    };
    this.indicators.push(ind);
    this._applyIndicators();
    this._persistInd();
    return ind.id;
  };
  Chart.prototype.removeIndicator = function (id) {
    this.indicators = this.indicators.filter(function (x) { return x.id !== id; });
    this._applyIndicators();
    this._persistInd();
  };
  Chart.prototype.updateIndicator = function (id, params) {
    for (var i = 0; i < this.indicators.length; i++) {
      if (this.indicators[i].id === id) Object.assign(this.indicators[i].params, params || {});
    }
    this._applyIndicators();
    this._persistInd();
  };
  Chart.prototype.setIndicatorStyle = function (id, style) {
    for (var i = 0; i < this.indicators.length; i++) {
      if (this.indicators[i].id === id) {
        if (style && style.color) this.indicators[i].color = style.color;
        if (style && "label" in style) this.indicators[i].label = style.label || undefined;
      }
    }
    this._applyIndicators();
    this._persistInd();
  };
  Chart.prototype.getIndicators = function () { return this.indicators.slice(); };
  // Per-bar markers: entries, exits, signals. Sorted once; drawn above the
  // bar's high or below its low with a small gap that scales with spacing.
  // "BTC · 1H · 79,822 −0.02%" — the render header the production widget
  // shows; price and change refresh with every setData/update.
  Chart.prototype.setSymbolInfo = function (info) {
    this._symbolInfo = info || null;
    if (!this._header) {
      var h = document.createElement("div");
      h.className = "trc-header";
      var clickable = !!(this.opt.symbolSearch && this.opt.symbolSearch.search);
      h.style.cssText = "position:absolute;left:46px;top:10px;z-index:4;display:flex;align-items:baseline;gap:8px;" +
        "font:800 15px -apple-system,'Segoe UI',sans-serif;user-select:none;" +
        (clickable ? "cursor:pointer;" : "pointer-events:none;");
      if (clickable) {
        var self2 = this;
        h.title = "Search ticker or name";
        h.addEventListener("click", function () { self2._toggleSearch(); });
      }
      this.el.appendChild(h);
      this._header = h;
    }
    this._paintHeader();
  };
  Chart.prototype._paintHeader = function () {
    if (!this._header) return;
    var o = this.opt, inf = this._symbolInfo || {};
    var n = this.bars.length;
    var last = n ? this.bars[n - 1] : null;
    var prev = n > 1 ? this.bars[n - 2] : null;
    var px = last ? fmtPrice(last.close, last.close >= 1000 ? 2 : 4) : "";
    var chg = last && prev ? (last.close - prev.close) / prev.close * 100 : null;
    var up = chg !== null && chg >= 0;
    this._header.innerHTML =
      '<span style="color:' + (o.tagText || "#e6edf3") + ';font-size:17px;">' + (inf.ticker || "") + "</span>" +
      (inf.tf ? '<span style="color:' + o.textColor + ';font-weight:700;font-size:12px;">' + inf.tf + "</span>" : "") +
      (px ? '<span style="color:' + (up ? o.upColor : o.downColor) + ';">' + px + "</span>" : "") +
      (chg !== null ? '<span style="color:' + (up ? o.upColor : o.downColor) + ';font-weight:700;font-size:12px;">' +
        (up ? "+" : "") + chg.toFixed(2) + "%</span>" : "") +
      (inf.title ? '<span style="color:' + o.textColor + ';font-weight:600;font-size:12px;">' + inf.title + "</span>" : "");
  };

  // The indicator legend with LIVE numbers: label in the series color plus
  // the value under the crosshair (or the last bar when the cursor is away).
  Chart.prototype._paintLegend = function (barTime) {
    if (!this.indicators.length) { if (this._legend) this._legend.innerHTML = ""; return; }
    if (!this._legend) {
      var lg = document.createElement("div");
      lg.className = "trc-legend";
      lg.style.cssText = "position:absolute;left:46px;top:34px;right:80px;z-index:4;display:flex;flex-wrap:wrap;gap:2px 12px;" +
        "font:700 11px -apple-system,'Segoe UI',sans-serif;pointer-events:none;user-select:none;";
      this.el.appendChild(lg);
      this._legend = lg;
    }
    var t = barTime;
    if (t === undefined || t === null) {
      var n = this.bars.length;
      t = n ? this.bars[n - 1].time : null;
    }
    var html = "";
    for (var i = 0; i < this.indicators.length; i++) {
      var ind = this.indicators[i], def = IND_DEFS[ind.kind];
      var label = ind.label || (def.label + (ind.params.p ? " " + ind.params.p : ind.kind === "macd" ? " " + ind.params.f + "/" + ind.params.s + "/" + ind.params.sig : ind.kind === "stoch" ? " " + ind.params.k + "/" + ind.params.d + "/" + ind.params.s : ""));
      var val = "";
      if (t !== null && ind._legendRef) {
        var v = ind._legendRef.byTime.get(t);
        if (isNum(v)) val = " " + fmtPrice(v, v >= 1000 ? 2 : v >= 10 ? 2 : 4);
      }
      html += '<span style="color:' + (ind.color || "#8b949e") + ';white-space:nowrap;">' + label + val + "</span>";
    }
    this._legend.innerHTML = html;
  };

  Chart.prototype.setMarkers = function (list) {
    this.markers = (list || []).slice().sort(function (a, b) { return a.time - b.time; });
    this._paint();
  };
  Chart.prototype._heikin = function () {
    if (this._ha) return this._ha;
    var out = [], po = null, pc = null;
    for (var i = 0; i < this.bars.length; i++) {
      var b = this.bars[i];
      var hc = (b.open + b.high + b.low + b.close) / 4;
      var ho = po === null ? (b.open + b.close) / 2 : (po + pc) / 2;
      out.push({ time: b.time, open: ho, close: hc,
        high: Math.max(b.high, ho, hc), low: Math.min(b.low, ho, hc), volume: b.volume });
      po = ho; pc = hc;
    }
    this._ha = out;
    return out;
  };
  Chart.prototype.setChartType = function (t) {
    if (["candles", "hollow", "heikin", "bars", "line", "area", "baseline"].indexOf(t) < 0) return;
    this.chartType = t;
    this._paint();
  };
  Chart.prototype._persistInd = function () {
    if (!this._persistKey) return;
    try { localStorage.setItem(this._persistKey + ":ind", JSON.stringify(this.indicators)); } catch (e) {}
  };

  // Recompute everything the indicator list implies: overlay lines on the
  // price pane, one oscillator pane per oscillator, guides included.
  Chart.prototype._applyIndicators = function () {
    var self = this;
    // wipe indicator-owned series (ids prefixed "@") and every osc pane
    for (var pi = 0; pi < this.panes.length; pi++) {
      var pn = this.panes[pi], id;
      for (id in pn.lines) if (id.charAt(0) === "@") delete pn.lines[id];
      for (id in pn.hists) if (id.charAt(0) === "@") delete pn.hists[id];
    }
    this.panes = [this.panes[0]];
    this.panes[0].guides = [];
    var bars = this.bars, pane = 1;
    this.indicators.forEach(function (ind) {
      var P = ind.params, key = "@" + ind.id;
      var defL = IND_DEFS[ind.kind];
      var indLabel = ind.label || (defL.label + (P.p ? " " + P.p
        : ind.kind === "macd" ? " " + (P.f || 12) + "/" + (P.s || 26) + "/" + (P.sig || 9)
        : ind.kind === "stoch" ? " " + (P.k || 14) + "/" + (P.d || 3) + "/" + (P.s || 3) : ""));
      if (ind.kind === "ema") self.addLine(key, calcEMA(bars, P.p || 20), ind.color, 1.4);
      else if (ind.kind === "sma") self.addLine(key, calcSMA(bars, P.p || 50), ind.color, 1.4);
      else if (ind.kind === "vwap") self.addLine(key, calcVWAP(bars), ind.color, 1.4);
      else if (ind.kind === "bb") {
        var bb = calcBB(bars, P.p || 20, P.mult || 2);
        self.addLine(key + "u", bb.up, ind.color, 1);
        self.addLine(key + "m", bb.mid, ind.color, 1);
        self.addLine(key + "l", bb.lo, ind.color, 1);
      } else if (ind.kind === "rsi") {
        self.addLine(key, calcRSI(bars, P.p || 14), ind.color, 1.4, pane);
        self.addGuide(pane, 70, "rgba(248,81,73,0.5)");
        self.addGuide(pane, 30, "rgba(0,217,126,0.5)");
        self.panes[pane].title = indLabel;
        self.panes[pane].titleColor = ind.color;
        pane++;
      } else if (ind.kind === "macd") {
        var m = calcMACD(bars, P.f || 12, P.s || 26, P.sig || 9);
        self.addHistogram(key + "h", m.hist, pane);
        self.addLine(key, m.line, "#58a6ff", 1.2, pane);
        self.addLine(key + "s", m.signal, "#f0b429", 1.2, pane);
        self.addGuide(pane, 0, "rgba(139,148,158,0.4)");
        self.panes[pane].title = indLabel;
        self.panes[pane].titleColor = ind.color;
        pane++;
      } else if (ind.kind === "stoch") {
        var st = calcStoch(bars, P.k || 14, P.d || 3, P.s || 3);
        self.addLine(key, st.k, "#58a6ff", 1.2, pane);
        self.addLine(key + "d", st.d, "#f0b429", 1.2, pane);
        self.addGuide(pane, 80, "rgba(248,81,73,0.5)");
        self.addGuide(pane, 20, "rgba(0,217,126,0.5)");
        self.panes[pane].title = indLabel;
        self.panes[pane].titleColor = ind.color;
        pane++;
      }
      // legend reference: the indicator's primary line, wherever it landed
      var refKey = "@" + ind.id;
      ind._legendRef = null;
      for (var pi3 = 0; pi3 < self.panes.length; pi3++) {
        if (self.panes[pi3].lines[refKey]) { ind._legendRef = self.panes[pi3].lines[refKey]; break; }
        if (self.panes[pi3].lines[refKey + "m"]) { ind._legendRef = self.panes[pi3].lines[refKey + "m"]; break; }
      }
    });
    this._paintLegend(null);
    this._paint();
  };


  Chart.prototype.addPriceLine = function (price, color, label) {
    this.priceLines.push({ price: price, color: color || "#8b949e", label: label });
    this._paint();
  };
  Chart.prototype.clearPriceLines = function () { this.priceLines = []; this._paint(); };
  Chart.prototype.onCrosshair = function (cb) { this.crosshairCb = cb; };
  // ── Drawings ─────────────────────────────────────────────────────────
  // The production widget's full set, ported (it is TradeRead code): trend,
  // hline, rect, fib retracement, text; cursor selects, moves and resizes;
  // Delete removes the selection; persistence is debounced and strips the
  // cached text width, and a persist key makes saving per-symbol.
  Chart.prototype.setTool = function (t) {
    this.tool = t || null;
    this.el.style.cursor = t ? "crosshair" : "";
    this._touchLock();
  };
  // While a tool is armed or a shape is being dragged, the chart owns the
  // touch: without touch-action none the browser steals the gesture, fires
  // a cancel and kills the line mid-draw (paid for once in production).
  Chart.prototype._touchLock = function () {
    this.overlay.style.touchAction = (this.tool || this._draft || this._dragDraw || this._sepDrag) ? "none" : "";
  };
  Chart.prototype.onToolDone = function (cb) { this._toolDoneCb = cb; };
  Chart.prototype.clearDrawings = function () { this.drawings = []; this._draft = null; this._selected = null; this._persist(); this._paintDrawings(); };
  Chart.prototype.deleteSelected = function () {
    if (!this._selected) return;
    var id = this._selected;
    this.drawings = this.drawings.filter(function (d) { return d.id !== id; });
    this._selected = null;
    this._persist();
    this._paintDrawings();
  };
  Chart.prototype.serializeDrawings = function () {
    return JSON.stringify(this.drawings, function (k, v) { return k === "_tw" ? undefined : v; });
  };
  Chart.prototype.loadDrawings = function (json) {
    try { this.drawings = (typeof json === "string" ? JSON.parse(json) : json) || []; } catch (e) { this.drawings = []; }
    this._selected = null;
    this._paintDrawings();
  };
  Chart.prototype.setPersistKey = function (key) {
    this._persistKey = key || null;
    if (key) {
      try { this.loadDrawings(localStorage.getItem(key)); } catch (e) { this.loadDrawings([]); }
      try {
        var ind = JSON.parse(localStorage.getItem(key + ":ind"));
        if (Array.isArray(ind)) { this.indicators = ind; this._applyIndicators(); }
      } catch (e) {}
    }
  };
  Chart.prototype._persist = function () {
    var self = this;
    if (!this._persistKey) return;
    clearTimeout(this._saveT);
    this._saveT = setTimeout(function () {
      try { localStorage.setItem(self._persistKey, self.serializeDrawings()); } catch (e) {}
    }, 300);
  };

  var FIB_LEVELS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];
  var DRAW_COLOR = "#818cf8";

  Chart.prototype._paintDrawings = function () {
    var c = this.dctx, W = this._plotW(), pp = this.panes[0], self = this;
    c.clearRect(0, 0, this.w, this.h);
    var dec = stepDecimals(niceStep(pp.max - pp.min, 8));
    var list = this._draft ? this.drawings.concat([this._draft]) : this.drawings;
    for (var k = 0; k < list.length; k++) {
      var d = list[k];
      var sel = d.id && d.id === this._selected;
      c.strokeStyle = DRAW_COLOR;
      c.fillStyle = DRAW_COLOR;
      c.lineWidth = sel ? 2 : 1.4;
      var x1 = isNum(d.t1) ? this.timeToX(d.t1) : null, y1 = isNum(d.p1) ? pp.toY(d.p1) : null;
      var x2 = isNum(d.t2) ? this.timeToX(d.t2) : null, y2 = isNum(d.p2) ? pp.toY(d.p2) : null;
      if (d.type === "hline") {
        if (y1 === null || y1 < pp.y0 || y1 > pp.y0 + pp.h) continue;
        c.beginPath(); c.moveTo(0, Math.round(y1) + 0.5); c.lineTo(W, Math.round(y1) + 0.5); c.stroke();
      } else if (d.type === "trend") {
        c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
        if (sel) { c.fillRect(x1 - 3, y1 - 3, 6, 6); c.fillRect(x2 - 3, y2 - 3, 6, 6); }
      } else if (d.type === "rect") {
        c.save(); c.globalAlpha = 0.12;
        c.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        c.restore();
        c.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        if (sel) c.fillRect(x2 - 3, y2 - 3, 6, 6);
      } else if (d.type === "fib") {
        var xa = Math.min(x1, x2), xb = Math.max(x1, x2);
        c.font = "10px -apple-system, sans-serif";
        for (var f = 0; f < FIB_LEVELS.length; f++) {
          var lv = FIB_LEVELS[f];
          var price = d.p2 - (d.p2 - d.p1) * lv;
          var fy = pp.toY(price);
          c.globalAlpha = lv === 0 || lv === 1 ? 0.9 : 0.55;
          c.beginPath(); c.moveTo(xa, Math.round(fy) + 0.5); c.lineTo(xb, Math.round(fy) + 0.5); c.stroke();
          c.fillText(lv.toFixed(3) + "  " + fmtPrice(price, dec), xb + 5, fy + 3);
          c.globalAlpha = 1;
        }
        if (sel) c.fillRect(x2 - 3, y2 - 3, 6, 6);
      } else if (d.type === "text") {
        var fs = d.size || 12;
        c.font = "600 " + fs + "px -apple-system, sans-serif";
        d._tw = c.measureText(d.text || "").width;   // cached for hit-testing, never persisted
        c.fillText(d.text || "", x1, y1);
        if (sel) {
          c.save(); c.globalAlpha = 0.35;
          c.strokeRect(x1 - 3, y1 - fs - 2, d._tw + 6, fs + 8);
          c.restore();
          c.fillRect(x1 + d._tw + 3, y1 - 3, 6, 6);   // size grip: drag down = bigger
        }
      }
    }
  };

  function distToSeg(x, y, a, b) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len2 = dx * dx + dy * dy;
    var t = len2 ? clamp(((x - a.x) * dx + (y - a.y) * dy) / len2, 0, 1) : 0;
    var px = a.x + t * dx, py = a.y + t * dy;
    return Math.sqrt((x - px) * (x - px) + (y - py) * (y - py));
  }

  // Topmost hit wins (reverse order); a selected shape's handle beats its body.
  Chart.prototype._hitTest = function (x, y) {
    var pp = this.panes[0];
    for (var k = this.drawings.length - 1; k >= 0; k--) {
      var d = this.drawings[k];
      var x1 = isNum(d.t1) ? this.timeToX(d.t1) : null, y1 = isNum(d.p1) ? pp.toY(d.p1) : null;
      var x2 = isNum(d.t2) ? this.timeToX(d.t2) : null, y2 = isNum(d.p2) ? pp.toY(d.p2) : null;
      if (d.id === this._selected && x2 !== null && Math.abs(x - x2) < 7 && Math.abs(y - y2) < 7 &&
          (d.type === "rect" || d.type === "fib" || d.type === "trend")) return { d: d, handle: "p2" };
      if (d.id === this._selected && d.type === "text") {
        var fsz = d.size || 12, tw2 = d._tw || (d.text || "").length * fsz * 0.62;
        if (Math.abs(x - (x1 + tw2 + 6)) < 8 && Math.abs(y - y1) < 8) return { d: d, handle: "size" };
      }
      if (d.id === this._selected && d.type === "trend" && Math.abs(x - x1) < 7 && Math.abs(y - y1) < 7) return { d: d, handle: "p1" };
      if (d.type === "hline") { if (Math.abs(y - y1) < 6) return { d: d, handle: null }; }
      else if (d.type === "trend") { if (distToSeg(x, y, { x: x1, y: y1 }, { x: x2, y: y2 }) < 6) return { d: d, handle: null }; }
      else if (d.type === "rect" || d.type === "fib") {
        if (x >= Math.min(x1, x2) - 4 && x <= Math.max(x1, x2) + 4 &&
            y >= Math.min(y1, y2) - 4 && y <= Math.max(y1, y2) + 4) return { d: d, handle: null };
      } else if (d.type === "text") {
        var fs = d.size || 12, tw = d._tw || (d.text || "").length * fs * 0.62;
        if (x >= x1 - 4 && x <= x1 + tw + 4 && y >= y1 - fs - 4 && y <= y1 + 6) return { d: d, handle: null };
      }
    }
    return null;
  };
  Chart.prototype.applyOptions = function (o) { Object.assign(this.opt, o || {}); this.el.style.background = this.opt.background; this._paint(); };
  Chart.prototype.scrollToRealtime = function () { this.rightIndex = this.bars.length - 1; this._paint(); };
  // Fit: back to the default frame — bar spacing, right edge and vertical
  // zoom all reset (the production widget's refit, whole-chart edition).
  Chart.prototype.fit = function () {
    this.barSpacing = this.opt.barSpacing;
    this.rightIndex = this.bars.length - 1;
    this._vZoom = 1;
    this._paint();
  };
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
    var ct = this.chartType;
    if (ct === "baseline") {
      // The base sits at the middle of the VISIBLE scale (the TradingView
      // default): half the frame is always up-territory and half down, so
      // baseline never degenerates into a plain area on a trending window
      // (owner's catch, 7 Sep 2026).
      var baseV = (pp.min + pp.max) / 2;
      var baseY = clamp(pp.toY(baseV), pp.y0, pp.y0 + pp.h);
      var seg = [];
      for (i = lo; i <= hi; i++) {
        b = this.bars[i]; if (!b) continue;
        seg.push([this.indexToX(i), pp.toY(b.close)]);
      }
      if (seg.length > 1) {
        var passes = [
          { clipY0: pp.y0, clipH: baseY - pp.y0, stroke: o.upColor, fillA: "rgba(0,217,126,0.22)", fillB: "rgba(0,217,126,0)" },
          { clipY0: baseY, clipH: pp.y0 + pp.h - baseY, stroke: o.downColor, fillA: "rgba(248,81,73,0)", fillB: "rgba(248,81,73,0.22)" },
        ];
        for (var pi2 = 0; pi2 < passes.length; pi2++) {
          var ps = passes[pi2];
          if (ps.clipH <= 0) continue;
          c.save();
          c.beginPath(); c.rect(0, ps.clipY0, W, ps.clipH); c.clip();
          c.beginPath();
          c.moveTo(seg[0][0], seg[0][1]);
          for (i = 1; i < seg.length; i++) c.lineTo(seg[i][0], seg[i][1]);
          var grB = c.createLinearGradient(0, pp.y0, 0, pp.y0 + pp.h);
          grB.addColorStop(0, ps.fillA);
          grB.addColorStop(1, ps.fillB);
          c.lineTo(seg[seg.length - 1][0], baseY); c.lineTo(seg[0][0], baseY); c.closePath();
          c.fillStyle = grB;
          c.fill();
          c.beginPath();
          c.moveTo(seg[0][0], seg[0][1]);
          for (i = 1; i < seg.length; i++) c.lineTo(seg[i][0], seg[i][1]);
          c.strokeStyle = ps.stroke; c.lineWidth = 1.6;
          c.stroke();
          c.restore();
        }
        c.strokeStyle = o.textColor; c.lineWidth = 1; c.setLineDash([3, 3]);
        c.beginPath(); c.moveTo(0, Math.round(baseY) + 0.5); c.lineTo(W, Math.round(baseY) + 0.5); c.stroke();
        c.setLineDash([]);
      }
    } else if (ct === "line" || ct === "area") {
      c.save();
      c.beginPath(); c.rect(0, pp.y0, W, pp.h); c.clip();
      c.strokeStyle = o.upColor; c.lineWidth = 1.6;
      c.beginPath();
      var startedM = false, firstX = null, lastX = null;
      for (i = lo; i <= hi; i++) {
        b = this.bars[i]; if (!b) continue;
        var mx = this.indexToX(i), my = pp.toY(b.close);
        if (!startedM) { c.moveTo(mx, my); startedM = true; firstX = mx; } else c.lineTo(mx, my);
        lastX = mx;
      }
      c.stroke();
      if (ct === "area" && startedM) {
        var gr = c.createLinearGradient(0, pp.y0, 0, pp.y0 + pp.h);
        gr.addColorStop(0, "rgba(0,217,126,0.25)");
        gr.addColorStop(1, "rgba(0,217,126,0)");
        c.lineTo(lastX, pp.y0 + pp.h); c.lineTo(firstX, pp.y0 + pp.h); c.closePath();
        c.fillStyle = gr;
        c.fill();
      }
      c.restore();
    } else if (ct === "bars") {
      for (i = lo; i <= hi; i++) {
        b = this.bars[i]; if (!b) continue;
        var bx2 = this.indexToX(i);
        if (bx2 < -this.barSpacing || bx2 > W + this.barSpacing) continue;
        var bup = b.close >= b.open;
        c.strokeStyle = bup ? o.upColor : o.downColor;
        c.lineWidth = 1;
        var xR = Math.round(bx2) + 0.5;
        c.beginPath();
        c.moveTo(xR, pp.toY(b.high)); c.lineTo(xR, pp.toY(b.low));
        c.moveTo(xR - half, pp.toY(b.open)); c.lineTo(xR, pp.toY(b.open));
        c.moveTo(xR, pp.toY(b.close)); c.lineTo(xR + half, pp.toY(b.close));
        c.stroke();
      }
    } else {
      var hollow = ct === "hollow";
      var src = ct === "heikin" ? this._heikin() : this.bars;
      for (i = lo; i <= hi; i++) {
        b = src[i]; if (!b) continue;
        var cx = this.indexToX(i);
        if (cx < -this.barSpacing || cx > W + this.barSpacing) continue;
        var up = b.close >= b.open;
        var yO = pp.toY(b.open), yC = pp.toY(b.close);
        var yH = pp.toY(b.high), yL = pp.toY(b.low);
        c.strokeStyle = up ? o.wickUp : o.wickDown;
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(Math.round(cx) + 0.5, yH); c.lineTo(Math.round(cx) + 0.5, yL); c.stroke();
        var bodyY = Math.min(yO, yC), bodyH = Math.max(1, Math.abs(yC - yO));
        if (hollow && up) {
          c.strokeStyle = o.upColor;
          c.strokeRect(cx - half + 0.5, bodyY + 0.5, half * 2 - 1, bodyH);
        } else {
          c.fillStyle = up ? o.upColor : o.downColor;
          c.fillRect(cx - half, bodyY, half * 2, bodyH);
        }
      }
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

      // last-value tags on the axis, one per oscillator line — the numbers
      // the production widget shows at the scale (owner, 7 Sep 2026)
      if (pn.kind === "osc") {
        c.textBaseline = "middle";
        for (id in pn.lines) {
          var lnT = pn.lines[id];
          var lastB = this.bars[hi];
          var lastV = lastB ? lnT.byTime.get(lastB.time) : undefined;
          if (!isNum(lastV)) continue;
          var lyT = pn.toY(lastV);
          if (lyT < pn.y0 + 2 || lyT > pn.y0 + pn.h - 2) continue;
          var decT = stepDecimals(niceStep(pn.max - pn.min, 8));
          var txtT = fmtPrice(lastV, decT);
          c.fillStyle = lnT.color;
          c.fillRect(W, lyT - 8, o.priceAxisWidth, 16);
          c.fillStyle = "#0d1117";
          c.font = o.font;
          c.fillText(txtT, W + 5, lyT);
        }
      }
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
        // the pane says what it is (owner, 7 Sep 2026)
        if (pn.title) {
          c.font = "800 10.5px -apple-system, 'Segoe UI', sans-serif";
          c.fillStyle = pn.titleColor || o.textColor;
          c.save(); c.globalAlpha = 0.9;
          c.fillText(pn.title, 8, pn.y0 + 13);
          c.restore();
          c.font = o.font;
        }
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

    // markers
    if (this.markers.length) {
      c.save();
      c.beginPath(); c.rect(0, pp.y0, W, pp.h); c.clip();
      var msz = clamp(this.barSpacing * 0.5, 4, 9);
      c.font = "700 10px -apple-system, sans-serif";
      for (i = 0; i < this.markers.length; i++) {
        var mk = this.markers[i];
        var mi = Math.round(this.timeToIndex(mk.time));
        b = this.bars[mi];
        if (!b || mi < lo || mi > hi) continue;
        var mx2 = this.indexToX(mi);
        var above = mk.position !== "below";
        var my2 = above ? pp.toY(b.high) - 7 : pp.toY(b.low) + 7;
        c.fillStyle = mk.color || (above ? o.downColor : o.upColor);
        c.beginPath();
        if (mk.shape === "circle") {
          c.arc(mx2, my2, msz * 0.55, 0, Math.PI * 2);
        } else if (above) {           // arrow pointing down at the bar
          c.moveTo(mx2, my2); c.lineTo(mx2 - msz * 0.6, my2 - msz); c.lineTo(mx2 + msz * 0.6, my2 - msz);
        } else {                      // arrow pointing up at the bar
          c.moveTo(mx2, my2); c.lineTo(mx2 - msz * 0.6, my2 + msz); c.lineTo(mx2 + msz * 0.6, my2 + msz);
        }
        c.closePath(); c.fill();
        if (mk.text) {
          var mtw = c.measureText(mk.text).width;
          c.fillText(mk.text, mx2 - mtw / 2, above ? my2 - msz - 4 : my2 + msz + 12);
        }
      }
      c.restore();
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
    this._paintLegend(b ? b.time : null);
    if (this.crosshairCb) this.crosshairCb(b ? { bar: b, index: i, price: this.panes[0].toValue(y), paneValue: val } : null);
  };

  Chart.prototype._bind = function () {
    var self = this, el = this.overlay;
    var drag = null, pinch = null;
    // Momentum: the pan keeps gliding after release, decaying each frame —
    // the "thrown" feel every charting tool has. Any new input kills it.
    var glide = { v: 0, raf: 0, lastX: 0, lastT: 0 };
    function stopGlide() { if (glide.raf) cancelAnimationFrame(glide.raf); glide.raf = 0; glide.v = 0; }
    function startGlide() {
      if (Math.abs(glide.v) < 0.05) return;
      var last = performance.now();
      function step(now) {
        var dt = now - last; last = now;
        self.rightIndex = clamp(self.rightIndex - glide.v * dt / self.barSpacing,
          0, self.bars.length - 1 + self.opt.rightPadBars * 2);
        self._paint();
        glide.v *= Math.pow(0.94, dt / 16.7);
        if (Math.abs(glide.v) >= 0.05) glide.raf = requestAnimationFrame(step);
        else glide.raf = 0;
      }
      glide.raf = requestAnimationFrame(step);
    }

    el.addEventListener("mousemove", function (e) {
      var r = el.getBoundingClientRect();
      self._cross = { x: e.clientX - r.left, y: e.clientY - r.top };
      if (self._draft) {
        self._draft.t2 = self.indexToTime(self.xToIndex(self._cross.x));
        self._draft.p2 = self.panes[0].toValue(self._cross.y);
        self._paintDrawings();
        self._paintCross();
        return;
      }
      if (self._sepDrag) {
        var sd = self._sepDrag;
        // dragging DOWN moves the pane's top edge down = the pane shrinks
        self.panes[sd.i].hPx = clamp(sd.h0 - (self._cross.y - sd.y0), 42, self._plotH() * 0.6);
        self._paint();
        return;
      }
      if (!self.tool && !drag && !self._draft && !self._dragDraw) {
        el.style.cursor = self._separatorAt(self._cross.y) !== null ? "ns-resize" : "";
      }
      if (self._dragDraw) {
        var dd = self._dragDraw, ppm = self.panes[0];
        var tNow = self.indexToTime(self.xToIndex(self._cross.x)), vNow = ppm.toValue(self._cross.y);
        if (dd.handle === "size") {
          if (dd._fs0 === undefined) { dd._fs0 = dd.d.size || 12; dd._ys = self._cross.y; }
          dd.d.size = clamp(Math.round(dd._fs0 + (self._cross.y - dd._ys) * 0.25), 8, 64);
        }
        else if (dd.handle === "p2") { dd.d.t2 = tNow; dd.d.p2 = vNow; }
        else if (dd.handle === "p1") { dd.d.t1 = tNow; dd.d.p1 = vNow; }
        else {
          var dt = tNow - dd.t0, dv = vNow - dd.v0;
          dd.t0 = tNow; dd.v0 = vNow;
          if (isNum(dd.d.t1)) dd.d.t1 += dt;
          if (isNum(dd.d.t2)) dd.d.t2 += dt;
          if (isNum(dd.d.p1)) dd.d.p1 += dv;
          if (isNum(dd.d.p2)) dd.d.p2 += dv;
        }
        self._paintDrawings();
        self._paintCross();
        return;
      }
      if (drag) {
        var nowT = performance.now(), nowX = e.clientX - r.left;
        if (glide.lastT) {
          var inst = (nowX - glide.lastX) / Math.max(1, nowT - glide.lastT);
          glide.v = glide.v * 0.75 + inst * 0.25;     // smoothed px/ms
        }
        glide.lastX = nowX; glide.lastT = nowT;
        self.rightIndex = drag.right0 + (drag.x0 - nowX) / self.barSpacing;
        self.rightIndex = clamp(self.rightIndex, 0, self.bars.length - 1 + self.opt.rightPadBars * 2);
        self._paint();
      } else self._paintCross();
    });
    el.addEventListener("mouseleave", function () { self._cross = null; drag = null; self._paintCross(); self._paintLegend(null); if (self.crosshairCb) self.crosshairCb(null); });
    function newId() { return "d" + Math.round(performance.now() * 1000) + "_" + self.drawings.length; }
    el.addEventListener("mousedown", function (e) {
      var r = el.getBoundingClientRect();
      var x = e.clientX - r.left, y = e.clientY - r.top;
      var pp = self.panes[0];
      if (self.tool && self._paneAt(y) === pp) {
        var t0 = self.indexToTime(self.xToIndex(x)), v0 = pp.toValue(y);
        if (self.tool === "hline") {
          self.drawings.push({ id: newId(), type: "hline", t1: t0, p1: v0 });
          self.setTool(null);
          if (self._toolDoneCb) self._toolDoneCb();
          self._persist();
          self._paintDrawings();
        } else if (self.tool === "text") {
          var ask = self.opt.textPrompt || function (initial, cb) { cb(window.prompt("Text:", initial || "")); };
          ask("", function (txt) {
            if (txt) {
              self.drawings.push({ id: newId(), type: "text", t1: t0, p1: v0, text: txt, size: 12 });
              self._persist();
              self._paintDrawings();
            }
          });
          self.setTool(null);
          if (self._toolDoneCb) self._toolDoneCb();
        } else if (self._draft) {
          // second click of the two-click flow: commit where the preview is
          self._draft.t2 = t0; self._draft.p2 = v0;
          self.drawings.push(self._draft);
          self._selected = self._draft.id;
          self._draft = null;
          self.setTool(null);
          if (self._toolDoneCb) self._toolDoneCb();
          self._persist();
          self._paintDrawings();
        } else {
          self._draft = { id: newId(), type: self.tool, t1: t0, p1: v0, t2: t0, p2: v0, _x0: x, _y0: y };
        }
        e.preventDefault();
        return;
      }
      // separator drag: resize the oscillator pane under it
      var sep = self._separatorAt(y);
      if (sep !== null) {
        self._sepDrag = { i: sep, y0: y, h0: self.panes[sep].hPx };
        e.preventDefault();
        return;
      }
      // cursor: select, grab a handle, or start moving the whole shape
      var hit = self._hitTest(x, y);
      if (hit) {
        self._selected = hit.d.id;
        self._dragDraw = { d: hit.d, handle: hit.handle,
          t0: self.indexToTime(self.xToIndex(x)), v0: pp.toValue(y) };
        self._paintDrawings();
        e.preventDefault();
        return;
      }
      if (self._selected) { self._selected = null; self._paintDrawings(); }
      stopGlide();
      glide.lastX = x; glide.lastT = 0;
      drag = { x0: x, right0: self.rightIndex };
      e.preventDefault();
    });
    window.addEventListener("mouseup", function () {
      if (drag) startGlide();
      drag = null;
      if (self._draft) {
        var f = self._draft;
        var movedPx = self._cross ? Math.abs(self._cross.x - f._x0) + Math.abs(self._cross.y - f._y0) : 0;
        // released after a real drag → classic drag-to-draw commit;
        // released in place → the draft stays armed for the second click
        if (movedPx > 6) {
          delete f._x0; delete f._y0;
          self.drawings.push(f);
          self._selected = f.id;
          self._draft = null;
          self.setTool(null);
          if (self._toolDoneCb) self._toolDoneCb();
          self._persist();
          self._paintDrawings();
        }
      }
      if (self._dragDraw) { self._dragDraw = null; self._persist(); }
      self._sepDrag = null;
    });
    window.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && self._draft) {
        self._draft = null;
        self.setTool(null);
        if (self._toolDoneCb) self._toolDoneCb();
        self._paintDrawings();
      }
    });
    // Delete removes the selection — but never while typing in a form field.
    window.addEventListener("keydown", function (e) {
      if ((e.key === "Delete" || e.key === "Backspace") && self._selected) {
        var tag = (document.activeElement && document.activeElement.tagName) || "";
        if (tag === "INPUT" || tag === "TEXTAREA") return;
        e.preventDefault();
        self.deleteSelected();
      }
    });
    el.addEventListener("dblclick", function (e) {
      var r = el.getBoundingClientRect();
      if (e.clientX - r.left > self._plotW()) { self._vZoom = 1; self._paint(); return; }
      var hit = self._hitTest(e.clientX - r.left, e.clientY - r.top);
      if (hit && hit.d.type === "text") {
        var ask = self.opt.textPrompt || function (initial, cb) { cb(window.prompt("Text:", initial || "")); };
        ask(hit.d.text || "", function (txt) {
          if (txt !== null && txt !== undefined && txt !== "") { hit.d.text = txt; self._persist(); self._paintDrawings(); }
        });
        return;
      }
      self.scrollToRealtime();
    });

    el.addEventListener("wheel", function (e) {
      e.preventDefault();
      stopGlide();
      var r = el.getBoundingClientRect();
      var x = e.clientX - r.left;
      // over the price axis the wheel stretches the vertical scale — the
      // grid gets denser or sparser, TV-style; dblclick there resets
      if (x > self._plotW()) {
        self._vZoom = clamp(self._vZoom * Math.exp(e.deltaY * 0.0015), 0.15, 8);
        self._paint();
        return;
      }
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
      if (e.touches.length === 1) {
        var tx = e.touches[0].clientX - r.left, ty = e.touches[0].clientY - r.top;
        var pp = self.panes[0];
        if (self.tool && self._paneAt(ty) === pp) {
          var t0 = self.indexToTime(self.xToIndex(tx)), v0 = pp.toValue(ty);
          if (self.tool === "hline") {
            self.drawings.push({ id: "d" + Math.round(performance.now() * 1000), type: "hline", t1: t0, p1: v0 });
            self.setTool(null);
            if (self._toolDoneCb) self._toolDoneCb();
            self._persist(); self._paintDrawings();
          } else if (self.tool === "text") {
            var ask = self.opt.textPrompt || function (initial, cb) { cb(window.prompt("Text:", initial || "")); };
            ask("", function (txt) {
              if (txt) { self.drawings.push({ id: "d" + Math.round(performance.now() * 1000), type: "text", t1: t0, p1: v0, text: txt, size: 12 }); self._persist(); self._paintDrawings(); }
            });
            self.setTool(null);
            if (self._toolDoneCb) self._toolDoneCb();
          } else {
            self._draft = { id: "d" + Math.round(performance.now() * 1000), type: self.tool, t1: t0, p1: v0, t2: t0, p2: v0 };
            self._touchLock();
          }
          return;
        }
        var sep = self._separatorAt(ty);
        if (sep !== null) { self._sepDrag = { i: sep, y0: ty, h0: self.panes[sep].hPx }; self._touchLock(); return; }
        var hit = self._hitTest(tx, ty);
        if (hit) {
          self._selected = hit.d.id;
          self._dragDraw = { d: hit.d, handle: hit.handle, t0: self.indexToTime(self.xToIndex(tx)), v0: pp.toValue(ty) };
          self._touchLock();
          self._paintDrawings();
          return;
        }
        stopGlide();
        glide.lastX = tx; glide.lastT = 0;
        drag = { x0: tx, right0: self.rightIndex };
      } else if (e.touches.length === 2) {
        // a second finger means navigation: commit whatever was in flight
        if (self._draft) { self.drawings.push(self._draft); self._selected = self._draft.id; self._draft = null; self._persist(); self._paintDrawings(); }
        self._dragDraw = null; self._sepDrag = null; drag = null;
        self._touchLock();
        var dx = e.touches[0].clientX - e.touches[1].clientX;
        pinch = { d0: Math.abs(dx) || 1, spacing0: self.barSpacing };
      }
    }, { passive: true });
    el.addEventListener("touchmove", function (e) {
      var r = el.getBoundingClientRect();
      if (e.touches.length === 1 && (self._draft || self._dragDraw || self._sepDrag)) {
        var tx = e.touches[0].clientX - r.left, ty = e.touches[0].clientY - r.top;
        var pp = self.panes[0];
        if (self._draft) {
          self._draft.t2 = self.indexToTime(self.xToIndex(tx));
          self._draft.p2 = pp.toValue(ty);
          self._paintDrawings();
        } else if (self._sepDrag) {
          var sd = self._sepDrag;
          self.panes[sd.i].hPx = clamp(sd.h0 - (ty - sd.y0), 42, self._plotH() * 0.6);
          self._paint();
        } else {
          var dd = self._dragDraw;
          var tNow = self.indexToTime(self.xToIndex(tx)), vNow = pp.toValue(ty);
          if (dd.handle === "p2") { dd.d.t2 = tNow; dd.d.p2 = vNow; }
          else if (dd.handle === "p1") { dd.d.t1 = tNow; dd.d.p1 = vNow; }
          else {
            var dt = tNow - dd.t0, dv = vNow - dd.v0;
            dd.t0 = tNow; dd.v0 = vNow;
            if (isNum(dd.d.t1)) dd.d.t1 += dt;
            if (isNum(dd.d.t2)) dd.d.t2 += dt;
            if (isNum(dd.d.p1)) dd.d.p1 += dv;
            if (isNum(dd.d.p2)) dd.d.p2 += dv;
          }
          self._paintDrawings();
        }
        e.preventDefault();
        return;
      }
      if (pinch && e.touches.length === 2) {
        var d = Math.abs(e.touches[0].clientX - e.touches[1].clientX) || 1;
        self.barSpacing = clamp(pinch.spacing0 * d / pinch.d0, self.opt.minBarSpacing, self.opt.maxBarSpacing);
        self._paint();
      } else if (drag && e.touches.length === 1) {
        var tNowT = performance.now(), tNowX = e.touches[0].clientX - r.left;
        if (glide.lastT) {
          var tInst = (tNowX - glide.lastX) / Math.max(1, tNowT - glide.lastT);
          glide.v = glide.v * 0.75 + tInst * 0.25;
        }
        glide.lastX = tNowX; glide.lastT = tNowT;
        self.rightIndex = drag.right0 + (drag.x0 - tNowX) / self.barSpacing;
        self.rightIndex = clamp(self.rightIndex, 0, self.bars.length - 1 + self.opt.rightPadBars * 2);
        self._paint();
        e.preventDefault();
      }
    }, { passive: false });
    function endTouch(e) {
      if (e.touches.length) return;
      if (drag) startGlide();
      drag = null; pinch = null;
      if (self._draft) {
        var f = self._draft;
        if (f.t1 !== f.t2 || f.p1 !== f.p2) { self.drawings.push(f); self._selected = f.id; self._persist(); }
        self._draft = null;
        self.setTool(null);
        if (self._toolDoneCb) self._toolDoneCb();
        self._paintDrawings();
      }
      if (self._dragDraw) { self._dragDraw = null; self._persist(); }
      self._sepDrag = null;
      self._touchLock();
    }
    el.addEventListener("touchend", endTouch, { passive: true });
    // a browser-fired cancel must COMMIT the in-flight shape, not destroy it
    el.addEventListener("touchcancel", endTouch, { passive: true });
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
    version: "0.15.0",
    themes: THEMES,
    createChart: function (el, options) { return new Chart(el, options); },
  };
})(typeof window !== "undefined" ? window : this);
