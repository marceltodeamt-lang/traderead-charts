# TradeRead Charts

A financial charting engine built from first principles by TradeRead —
candlesticks, volume, overlays, crosshair, inertia-free pan/zoom, touch,
high-DPI rendering. No third-party rendering code: every line in `src/`
is original TradeRead work, written from public behavior specifications,
so the engine is TradeRead intellectual property in full.

**Status: v0 — core engine.** Candles, volume, line overlays, adaptive
price/time scales, crosshair, wheel/drag/touch navigation, price lines,
live bar updates, built-in TradeRead mark.

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
- [ ] Sub-panes (RSI / MACD / Stochastic) with draggable separators
- [ ] Area/baseline/bar series types
- [ ] Markers, per-bar coloring API
- [ ] Kinetic scroll feel tuning; pinch anchor refinement
- [ ] Light theme palette parity

## License
Free for commercial and personal use under the TradeRead Community
License: any public page that renders charts with this engine must show
the TradeRead mark (built in, on by default). See LICENSE.md.
