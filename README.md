# ANT IPO Live Leg-In Copilot (v2.0 Mega-Cap Calibrated)

Real-time intraday execution desk and quantitative backtesting suite for **Anthropic PBC (`NASDAQ: ANT`)** — calibrated specifically for an **$81.3B / 980M-share mega-offering** (`$83.00` offer price, `$1.50T` initial valuation, `147M`-share / `$12.2B` Reg-M greenshoe wall) with **strictly zero overnight holding**.

## Key v2.0 Structural Features

1. **Mega-Cap Target Calibration (`$81.3B` vs. `$1B` Small Floats):**
   - Scales out **50% at `+5%` to `+7%` (`+6.0%` T1)** rather than waiting for small-float `+20%` moves, locking a breakeven stop and trailing the runner on intraday `VWAP` into `1:30 PM ET` (`SPCX` Day-1 closed `+7.3%`, `SKHY` `-1.2%`).
2. **Three-Lane `NOOP` Regime Framework (`+34.3%` / `$111.50` Overheated Cap):**
   - **Lane 1 (`$83.00 – $92.00` | `0%` to `+11%`):** Best R/R setup right above Goldman/MS's `$83.00` Reg-M greenshoe ceiling. Patient Long only (zero shorts) on `15m ORH` break or `VWAP` reclaim.
   - **Lane 2 (`$92.01 – $111.50` | `+11%` to `+34.3%`):** Mandatory **15-minute hands-off cooling window** post-cross. Long on `15m ORH` + `VWAP` hold; kill longs (and short toward `$88–$90` *only* with verified borrow/ETF access, covering well above `$83–$85`) on a confirmed `15m` candle close + failed `VWAP` retest below `15m ORL`.
   - **Lane 3 (`> $111.50` | `> +34.3%` vs `$83` / `> +43%` vs `$78` top of range / `> $2.0T`):** Zero morning longs; afternoon exhaustion fade only after confirmed red `15m`/`30m` close below `VWAP`.
3. **Live Macro Tape Filter & Short Execution Reality Gate:**
   - **Live `QQQ` Intraday `1m` VWAP & Session-Low Filter:** Automatically vetoes new `ANT` longs when `QQQ` breaks intraday lows.
   - **Automatic `VIX > 24` Sizing Haircut:** Reduces `1R` position size by `-28%` (`0.72x`) in elevated-volatility (`VIX ~25`, `10Y ~5.07%`) conditions.
   - **Short Access Selector:** Defaults safely to `No Clean Borrow (Long / Hard-Exit Only)`, with options for `-2x` single-stock inverse ETFs (`ANS` / `ANDD` at `0.5x` notional), confirmed spot HTB borrow, or `xyz:ANT` perpetuals (with live spot-perp basis monitoring).
4. **Week-1 Catalyst Calendar (`Fri Nov 20 – Wed Nov 25, 2026`):**
   - **Day 2 (`Fri Nov 20`):** `T+1` settlement unlocks cleaner borrow + real Day-1 `ORH/ORL/HOD/LOD` levels.
   - **Day 3 (`Mon Nov 23`):** Earliest exchange **Options Listing Day** (`SPCX` Day-3 `$225.64` gamma blow-off & `CRWV` Day-3 `+36.5%` coiled breakout analog).
   - **Day 4 (`Tue Nov 24`):** Post-options gamma unwind (`+4.63%` Tier-1 EV, `PF 5.31`).
   - **Day 5 (`Wed Nov 25`):** Enforces a **`12:00 PM ET` Noon Pre-Thanksgiving Chop Cutoff**.

## Quick Start

Uses only the Python 3 standard library (zero external package installation required):

```bash
python3 app.py
```

Then open **http://localhost:8765** in your browser.

To refresh historical 2023–2026 IPO cohort data or re-run the empirical strategy engine:

```bash
python3 fetch_ipo_data.py
python3 ant_ipo_strategy_engine.py
```
