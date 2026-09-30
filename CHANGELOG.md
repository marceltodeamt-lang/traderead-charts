# Changelog

## 1.3.4 — 2026-09-30

- **A pinch on a phone zooms the chart, not the page.** The plot now always
  carries `touch-action: none`. 1.3.3 cancelled the pinch in `touchmove`,
  but the browser decides to zoom the page at `touchstart`, before that
  handler can stop it — on phones the whole page still grew. Nothing else
  changes: every one-finger move on the plot was already the chart's, so the
  page never scrolled from there.
- **The version inside the file matches the package again**: the banner read
  1.3.0 and `TRCharts.version` 1.0.0 through 1.3.3.

## 1.3.3 — 2026-09-29

- **The view can be dragged past the last bar by half the plot**, not by ten
  bars. On a phone at 2 px a bar ten bars were 20 px: the latest candles
  stayed pinned to the price axis and could not be brought to the middle to
  zoom on them. The limit is now in pixels; wide bars keep the old ten.
- **Pinch zooms around the fingers**, and the bar under them stays under
  them. It used to zoom from the right edge only.
- **Pinch measures the real distance between the fingers.** A pinch made
  with one finger above the other has almost no horizontal spread; measuring
  only that made the zoom jump.
- **A pinch on the chart never zooms the page instead.** iOS ignores
  `user-scalable=no`: the touch handler now claims the gesture, and Safari's
  own `gesturestart` / `gesturechange` are cancelled on the chart.

## 1.3.2 — 2026-09-20

- **README install example unpinned from 1.2.0.** The copy-paste snippet on
  the npm page still pointed at an old build, so anyone following it landed
  three releases back, without the measure tool. It now pins 1.3.1. No code
  change; the engine is byte-identical to 1.3.0.

## 1.3.1 — 2026-09-20

- **`homepage` now points at traderead.ai**, not at the GitHub Pages docs
  host. No code change — the engine is byte-identical to 1.3.0. The npm
  listing ranks for the brand name and was sending people to GitHub rather
  than to the site the library was built for and runs in production on.
  The documentation stays where it is and is linked from the README and
  from <https://traderead.ai/charts>, which is now the library's own page.

## 1.3.0 — 2026-09-19

- **Measure tool** (ruler, in the drawing toolbar): drag between two points
  and the box reports the move three ways at once — absolute price change,
  percentage, and the span in bars and in time (`+563.22 (+0.85%)` /
  `39 bars · 1d 14h`). Green up, red down, with an arrow following the drag,
  so the sign reads from the direction you dragged rather than from the
  chart. Selectable, movable and deletable like any other drawing, and it
  works with touch.

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
