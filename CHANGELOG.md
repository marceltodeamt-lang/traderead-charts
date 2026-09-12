# Changelog

## 1.2.0 — 2026-09-13

- **In-widget timeframe picker** (`timeframes: {list, active, onSelect}`):
  the host page's own TF buttons disappear under a fullscreen widget —
  the pill in the header opens a grid menu that rides inside the frame,
  works in fullscreen, closes on outside tap.

## 1.1.0 — 2026-09-13

First npm release (`npm install traderead-charts`). Since 1.0.0:

- **Mobile**: fullscreen host-override + iOS fake-fullscreen fallback,
  scrollable tool rail in short frames, price/time axis drag zoom,
  one-finger vertical pan of the price pane, menus close on outside tap.
- **Small embeds**: type menu and indicator panel clamp inside the frame,
  pane titles clear the tool rail, compact logo under 560px that slides
  aside when the rail would overlap it.
- **Attribution**: the badge link carries `utm_source=widget`; hosts can
  override it via the `logoHref` option.

## 1.0.0 — 7 Sep 2026
First production release. The engine renders every chart on
traderead.ai: the interactive widget, the AI-read captures and the
images posted to X.

Built from first principles in the week of 5–7 Sep 2026:
- Candles, hollow candles, Heikin Ashi, OHLC bars, line, area, baseline
- Oscillator sub-panes with own scales, titles, guides, draggable separators
- Built-in indicators (multi EMA/SMA, VWAP, Bollinger, RSI, MACD, Stochastic)
  with a TradingView-style panel: add, remove, rename, recolor, edit params
- Drawing set: trend, horizontal, rectangle, Fibonacci, text — two-click or
  drag, select/move/resize, floating style bar, per-key persistence
- Symbol search by ticker or name with a pluggable data source
- Live `tick()` with the bucket roll built in; `prependBars` lazy history
  with time-anchored drawings; explicit `setTimeframe`
- Momentum pan, cursor-anchored zoom, price-axis vertical zoom, fit
- Legend with live values, per-pane titles, last-value axis tags
- Share (Web Share / clipboard), snapshot preview (no auto-download),
  fullscreen, light & dark themes, `resample()` for custom timeframes
- Edition gate (`maxIndicators`) for open-core Standard/Pro builds
