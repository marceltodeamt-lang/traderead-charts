# TradeRead Charts

A financial charting engine built from first principles by TradeRead —
candlesticks, volume, overlays, crosshair, inertia-free pan/zoom, touch,
high-DPI rendering. No third-party rendering code: every line in `src/`
is original TradeRead work, written from public behavior specifications,
so the engine is TradeRead intellectual property in full.

**Status: v0.5.** Candles, volume, line overlays (EMA/VWAP/Bollinger),
oscillator sub-panes (RSI/MACD/Stochastic) with per-pane scales and
guides, the full drawing set (trend, horizontal, rectangle, Fibonacci
retracement, text) with selection, move, resize, delete and per-key
persistence, adaptive price/time scales, pane-aware crosshair,
wheel/trackpad/drag/touch navigation, light & dark palettes, live bar
updates, built-in TradeRead mark.

Hard-won rules carried over from the production widget: drawings anchor
to (time, price) because lazy history prepends bars and shifts indices;
the price pane autoscales from bars alone so a distant EMA cannot squash
the candles; persisted JSON strips cached text widths; Delete never
fires while a form field has focus.

## Quick start

```html
<script src="src/traderead-charts.js"></script>
<div id="chart" style="width:800px;height:480px"></div>
<script>
  const chart = TRCharts.createChart(document.getElementById("chart"));
  chart.setData(bars);              // [{time, open, high, low, close, volume}]
  chart.addLine("ema20", ema20);    // [{time, value}]
  chart.update(lastBar);            // live tick
</script>
```

## Roadmap to parity with the production widget
- [x] Sub-panes (RSI / MACD / Stochastic)
- [x] Drawing set with selection, move, resize, persistence
- [x] Light theme palette
- [ ] Draggable pane separators
- [ ] Area/baseline/bar series types
- [ ] Markers, per-bar coloring API
- [ ] Kinetic scroll feel tuning; pinch anchor refinement
- [ ] Mobile drawing hardening (pointer capture + touch lock, as in production)

## License
Free for commercial and personal use under the TradeRead Community
License: any public page that renders charts with this engine must show
the TradeRead mark (built in, on by default). See LICENSE.md.
