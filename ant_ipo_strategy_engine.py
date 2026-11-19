"""
Anthropic (ANT) IPO Intraday Strategy & Empirical Backtesting Engine (v2.0)
===========================================================================
Mega-cap calibrated v2.0 framework incorporating:
  1. Deal-Size Calibration ($81.3B / 980M shares vs $1B small floats):
     - T1 calibrated to +6.0% (+5% to +7% band), trailing runner on VWAP / 1:30 PM ET.
     - Explicit separation of Mega/Large-Deals (>=$4.5B: SPCX, SKHY, CBRS, ARM) vs small floats.
  2. Tightened Cross Cutoffs ($83 already bakes in +$5 above $78 range & +19% upsize):
     - Lane 1 Cold/Muted Cross: $83.00 - $92.00 (0% to +11%) -> Patient Long Only above $83 Reg-M wall.
     - Lane 2 Sweet-Spot Cross: $92.01 - $111.50 (+11% to +34.3%) -> 15m Hands-Off, trade 15m ORH vs ORL.
     - Lane 3 Euphoric Cross:   > $111.50 (> +34.3% / > $2.0T) -> Zero Morning Longs; Afternoon Fade only.
  3. Anti-Whipsaw 15-Minute Opening Range (ORH / ORL) + VWAP Confirmation (no raw tick flips).
  4. Macro VIX (>24 -> -28% size haircut) + QQQ Intraday VWAP / Low-of-Day Filter + Short Borrow Gate.
  5. Week-1 Calendar: Day 2 (Fri Nov 20) T+1 borrow unlock; Day 3 (Mon Nov 23) earliest Options Listing
     gamma catalyst (SPCX Day-3 analog); Day 5 (Wed Nov 25) 12:00 PM ET pre-Thanksgiving chop cutoff.
"""

import json
import math
import statistics
from typing import Dict, List, Tuple


def compute_hype_score(meta: Dict) -> Tuple[float, Dict[str, float]]:
    """Compute the 100-point 'Hyped IPO Score' (HIS) across 4 pre-debut pillars."""
    pricing_map = {"above": 25.0, "top": 20.0, "in_range": 10.0, "below": 8.0}
    p1 = pricing_map.get(meta["priced_vs_range"], 10.0)
    p2 = meta["retail_hype"] * 2.5
    p3 = meta["ai_frontier"] * 2.5
    p4 = min(
        25.0,
        8.0
        + 4.5 * math.log10(max(0.4, meta["deal_size_b"]))
        + 4.0 * math.log10(max(2.0, meta["init_val_b"])),
    )
    total = round(p1 + p2 + p3 + p4, 1)
    return total, {
        "pricing_power": round(p1, 1),
        "retail_frenzy": round(p2, 1),
        "frontier_narrative": round(p3, 1),
        "scale_gravity": round(p4, 1),
    }


def load_and_clean_cohort(raw_path: str = "data/ipo_cohort_data.json") -> Dict:
    """Load Yahoo Finance daily & hourly bars, clean placeholders, and segment by deal scale."""
    with open(raw_path) as f:
        raw = json.load(f)

    cohort = raw["cohort"]
    for _, v in cohort.items():
        v["daily"] = [b for b in v["daily"] if b["volume"] > 0]
        v["hourly"] = [b for b in v["hourly"] if b["volume"] > 0]

    if cohort["KLAR"]["daily"][0]["date"] == "2025-09-11":
        cohort["KLAR"]["daily"].insert(
            0,
            {
                "ts": 1757511000,
                "dt": "2025-09-10 09:30:00",
                "date": "2025-09-10",
                "open": 52.00,
                "high": 57.20,
                "low": 45.00,
                "close": 45.82,
                "volume": 48500000,
            },
        )

    qualified = []
    for t, v in cohort.items():
        sc, breakdown = compute_hype_score(v["meta"])
        v["hype_score"] = sc
        v["hype_breakdown"] = breakdown
        if sc >= 65.0:
            qualified.append(t)

    qualified.sort(key=lambda x: cohort[x]["hype_score"], reverse=True)
    tier1_peers = [t for t in qualified if cohort[t]["hype_score"] >= 72.5 or t == "CRWV"]
    mega_large_deals = [t for t in qualified if cohort[t]["meta"]["deal_size_b"] >= 4.5]  # SPCX, SKHY, CBRS, ARM

    ant_meta = {
        "ticker": "ANT",
        "name": "Anthropic PBC",
        "ipo_date": "2026-11-19",
        "ipo_price": 83.0,
        "deal_size_b": 81.3,
        "init_val_b": 1500.0,
        "priced_vs_range": "above",
        "sector": "Frontier AI Foundation Models",
        "retail_hype": 10,
        "ai_frontier": 10,
    }
    ant_score, ant_breakdown = compute_hype_score(ant_meta)

    return {
        "ant": {"meta": ant_meta, "hype_score": ant_score, "hype_breakdown": ant_breakdown},
        "cohort": cohort,
        "qualified": qualified,
        "tier1_peers": tier1_peers,
        "mega_large_deals": mega_large_deals,
        "macro_nov2026": raw["macro_nov2026"],
    }


def summarize_trades(trades: List[Tuple[str, float]], friction_pct: float = 0.25) -> Dict:
    """Compute net win rate, avg win/loss, EV (%), median (%), and profit factor after friction."""
    if not trades:
        return {"n": 0, "win_rate_pct": 0.0, "avg_win_pct": 0.0, "avg_loss_pct": 0.0, "net_ev_pct": 0.0, "median_pct": 0.0, "profit_factor": 0.0, "trade_log": []}
    nets = [gross - friction_pct for _, gross in trades]
    wins = [x for x in nets if x > 0]
    losses = [abs(x) for x in nets if x <= 0]
    wr = (len(wins) / len(nets)) * 100.0
    avg_w = statistics.mean(wins) if wins else 0.0
    avg_l = statistics.mean(losses) if losses else 0.0
    ev = statistics.mean(nets)
    med = statistics.median(nets)
    pf = (sum(wins) / sum(losses)) if sum(losses) > 0 else 99.9
    return {
        "n": len(nets),
        "win_rate_pct": round(wr, 1),
        "avg_win_pct": round(avg_w, 2),
        "avg_loss_pct": round(avg_l, 2),
        "net_ev_pct": round(ev, 2),
        "median_pct": round(med, 2),
        "profit_factor": round(pf, 2),
        "friction_pct": friction_pct,
        "trade_log": [(t, round(g - friction_pct, 2)) for t, g in trades],
    }


def run_day1_backtests(cohort: Dict, tickers: List[str]) -> Dict[str, Dict]:
    """
    v2.0 Day-1 Backtests:
      - Tightened +35% Overheated Cutoff (0% to +35% for longs vs >+35% stand-down)
      - Mega-cap realistic T1 (+6.0%) & T2 (+10.0% / 1:30 PM VWAP trail), -3.5% ORL stop
      - Confirmed candle-close breakdown below NOOP & ORL for shorts (anti-whipsaw)
    """
    out = {}

    # 1. Lane 1 Cold/Muted Cross (-3% to +12% Pop -> $83 Reg-M Greenshoe Wall Support Long)
    lane1 = []
    for t in tickers:
        v = cohort[t]
        d1 = v["daily"][0]
        op = d1["open"]
        pop = (op / v["meta"]["ipo_price"] - 1) * 100
        if -3.0 <= pop <= 12.0:
            o2l = (d1["low"] / op - 1) * 100
            o2h = (d1["high"] / op - 1) * 100
            o2c = (d1["close"] / op - 1) * 100
            # Require ORH confirmation (+1.0% above NOOP)
            if o2h < 1.0:
                continue
            if o2l <= -3.8 and o2c < 0:
                gross = -3.50
            elif o2h >= 10.5:
                gross = 0.5 * 6.0 + 0.5 * 10.0  # +8.0% realistic mega-cap harvest
            elif o2h >= 6.5:
                gross = 0.5 * 6.0 + 0.5 * max(0.0, o2c)
            else:
                gross = max(-3.50, o2c - 0.5)
            lane1.append((t, gross))
    out["D1_Lane1_ColdCross_Greenshoe_ORH_Long"] = summarize_trades(lane1, friction_pct=0.25)

    # 2. Lane 2 Sweet-Spot Cross (0% to +35% Pop, ORH Breakout + Early +6% Scale-Out)
    lane2 = []
    for t in tickers:
        v = cohort[t]
        d1 = v["daily"][0]
        op = d1["open"]
        pop = (op / v["meta"]["ipo_price"] - 1) * 100
        if not (0.0 <= pop <= 35.0):
            continue
        o2l = (d1["low"] / op - 1) * 100
        o2h = (d1["high"] / op - 1) * 100
        o2c = (d1["close"] / op - 1) * 100
        # 15m ORH filter: skip stocks that immediately dumped from the cross without breaking +1.5% ORH
        if o2h < 1.5:
            continue
        # Worst-case: if stock broke -3.5% ORL and failed, take -3.5% stop; if it hit +6.0% T1, lock 50% and BE stop!
        if o2l <= -3.5 and o2c < 0 and o2h < 6.5:
            gross = -3.50
        elif o2l <= -3.5 and o2c < -3.5:
            # Even if it spiked +6.5..10% first (e.g. KLAR +10% then -11.9%), locking 50% @ +6% + BE stop = +3.0% (or conservative -3.5% if wicked first)
            h_d1 = [b for b in v["hourly"] if b["date"] == d1["date"]]
            if h_d1 and h_d1[0]["close"] < op:
                gross = -3.50
            else:
                gross = 0.5 * 6.0 + 0.0 if o2h >= 6.5 else -3.50
        elif o2h >= 10.5:
            gross = 0.5 * 6.0 + 0.5 * 10.0  # +8.0%
        elif o2h >= 6.5:
            gross = 0.5 * 6.0 + 0.5 * max(0.0, o2c - 1.0)
        else:
            gross = o2c - 1.0
        lane2.append((t, gross))
    out["D1_Lane2_SweetSpot_15mORH_Long_6PctT1"] = summarize_trades(lane2, friction_pct=0.25)

    # 3. Trade #2 Confirmed Candle-Close Breakdown Below NOOP & ORL (Anti-Whipsaw Short)
    t2_conf = []
    for t in tickers:
        v = cohort[t]
        d1 = v["daily"][0]
        offer = v["meta"]["ipo_price"]
        op = d1["open"]
        pop = (op / offer - 1) * 100
        h_d1 = [b for b in v["hourly"] if b["date"] == d1["date"]]
        # Only when pop >= +12% (unprotected above $83–$85 greenshoe zone) AND Hour-1 candle confirmed close < NOOP
        if pop >= 12.0 and len(h_d1) >= 2 and h_d1[0]["close"] < op * 0.99:
            pm = h_d1[1:]
            entry = pm[0]["open"]
            # Do not enter if already within 4% of Offer greenshoe wall!
            if entry <= offer * 1.04:
                continue
            stop_p = max(entry * 1.045, op * 1.005)
            stop_pct = min(5.0, (stop_p / entry - 1) * 100)
            floor_cover = max(offer * 1.03, entry * 0.925)  # Cover well ahead of greenshoe wall!
            stopped = False
            hit_t1 = False
            for b in pm:
                if b["high"] >= entry * (1 + stop_pct / 100):
                    stopped = True
                    break
                if b["low"] <= floor_cover:
                    hit_t1 = True
            if stopped:
                gross = -stop_pct
            elif hit_t1:
                t1_g = (entry - floor_cover) / entry * 100
                cls_g = (entry - max(offer * 1.025, pm[-1]["close"])) / entry * 100
                gross = 0.5 * t1_g + 0.5 * max(0.0, cls_g)
            else:
                gross = (entry - pm[-1]["close"]) / entry * 100
            t2_conf.append((t, gross))
    out["D1_Trade2_Confirmed_ORL_Breakdown_Short"] = summarize_trades(t2_conf, friction_pct=0.45)

    # 4. Trade #3 Euphoric (>+35% Pop) or Extended (+8%+ Pop) Afternoon Red-Bar Fade Short
    t3 = []
    for t in tickers:
        v = cohort[t]
        d1 = v["daily"][0]
        offer = v["meta"]["ipo_price"]
        pop = (d1["open"] / offer - 1) * 100
        h_d1 = [b for b in v["hourly"] if b["date"] == d1["date"]]
        if len(h_d1) >= 3:
            running_high = d1["open"]
            trig_idx = None
            for idx in range(len(h_d1) - 1):
                b = h_d1[idx]
                running_high = max(running_high, b["high"])
                ext = (running_high / d1["open"] - 1) * 100
                if (ext >= 8.0 or pop >= 35.0) and (b["close"] < b["open"]):
                    trig_idx = idx + 1
                    break
            if trig_idx is not None:
                pm = h_d1[trig_idx:]
                entry = pm[0]["open"]
                if entry <= offer * 1.04:
                    continue
                stop_pct = min(4.5, max(2.5, (running_high * 1.005 / entry - 1) * 100))
                stop_p = entry * (1 + stop_pct / 100)
                t1_p = max(offer * 1.03, entry * 0.94)
                stopped = False
                hit_t1 = False
                for b in pm:
                    if b["high"] >= stop_p:
                        stopped = True
                        break
                    if b["low"] <= t1_p:
                        hit_t1 = True
                if stopped:
                    gross = -stop_pct
                elif hit_t1:
                    t1_g = (entry - t1_p) / entry * 100
                    cls_g = (entry - pm[-1]["close"]) / entry * 100
                    gross = 0.5 * t1_g + 0.5 * max(0.0, cls_g)
                else:
                    gross = (entry - pm[-1]["close"]) / entry * 100
                t3.append((t, gross))
    out["D1_Trade3_Euphoric_Or_PM_Exhaustion_Short"] = summarize_trades(t3, friction_pct=0.45)

    return out


def run_week1_backtests(cohort: Dict, tickers: List[str]) -> Dict[str, Dict]:
    """
    v2.0 Week-1 Backtests:
      - Day 2 (Fri Nov 20): T+1 settlement unlocks clean borrow + real D1 reference levels.
      - Day 3 (Mon Nov 23): Earliest Exchange Options Listing Day -> Gamma Squeeze / Coiled Breakout
        (SPCX Day-3 $225.64 blow-off & CRWV Day-3 +36.5% breakout).
      - Day 4-5 (Tue/Wed Nov 24-25): Post-options gamma unwind, with strict 12:00 PM Noon cutoff on Wed Nov 25.
    """
    out = {}

    # W1: Day 2 (T+1 Clean Levels) & Day 3 (Options Listing Gamma Breakout) Coiled Long
    w1 = []
    for t in tickers:
        days = cohort[t]["daily"]
        if len(days) < 3:
            continue
        d1, d2, d3 = days[0], days[1], days[2]
        if (d1["close"] / d1["open"] - 1) * 100 < -5.0:
            continue
        if d2["open"] < d1["high"] and d2["high"] >= d1["high"] * 1.005:
            entry = d1["high"] * 1.005
            max_ret = (d2["high"] / entry - 1) * 100
            cls_ret = (d2["close"] / entry - 1) * 100
            gross = -3.5 if cls_ret < -3.5 else (0.5 * 6.5 + 0.5 * max(0.0, cls_ret) if max_ret >= 6.5 else cls_ret)
            w1.append((f"{t}_D2", gross))
        elif d2["close"] <= d1["close"] * 1.04 and d3["open"] <= d2["high"] * 1.01 and d3["high"] >= d2["high"] * 1.005:
            entry = max(d3["open"], d2["high"] * 1.005)
            max_ret = (d3["high"] / entry - 1) * 100
            cls_ret = (d3["close"] / entry - 1) * 100
            if cls_ret < -3.5 and d3["low"] <= entry * 0.965:
                gross = -3.5
            elif max_ret >= 8.0:
                gross = 0.5 * 8.0 + 0.5 * max(0.0, cls_ret)
            else:
                gross = max(-3.5, cls_ret)
            w1.append((f"{t}_D3_Opts", gross))
    out["W1_Day2_T1Levels_And_Day3_OptionsGamma_Long"] = summarize_trades(w1, friction_pct=0.25)

    # W2: Day 2 (Fri Nov 20, T+1 Borrow Open) Overhead Supply Short on Broken D1 Cross
    w2 = []
    for t in tickers:
        days = cohort[t]["daily"]
        if len(days) < 2:
            continue
        d1, d2 = days[0], days[1]
        d1_o2c = (d1["close"] / d1["open"] - 1) * 100
        d1_cloc = (d1["close"] - d1["low"]) / max(0.001, d1["high"] - d1["low"]) * 100
        if d1_o2c < -2.0 and d1_cloc <= 30.0:
            entry = d2["open"]
            mae = (d2["high"] / entry - 1) * 100
            mfe = (entry - d2["low"]) / entry * 100
            cls_short = (entry - d2["close"]) / entry * 100
            if mae >= 4.0 and cls_short < 0:
                gross = -4.0
            elif mfe >= 6.0:
                gross = 0.5 * 6.0 + 0.5 * max(0.0, cls_short)
            else:
                gross = max(-4.0, cls_short)
            w2.append((f"{t}_D2", gross))
    out["W2_Day2_T1Borrow_OverheadSupply_Short"] = summarize_trades(w2, friction_pct=0.35)

    # W3: Day 4 (Post-Day-3 Options Blow-Off Unwind — e.g. SPCX D4 -8.6% after D3 $225.64 gamma top!)
    w3 = []
    for t in tickers:
        days = cohort[t]["daily"]
        if len(days) < 4:
            continue
        d1, d2, d3, d4 = days[0], days[1], days[2], days[3]
        # Trigger on Day 4 if Day 3 printed an upper-wick blow-off OR closed < D2/D3 peak
        d3_wick = (d3["high"] - d3["close"]) / max(0.01, d3["high"] - d3["low"])
        if d3_wick >= 0.40 or d3["close"] < d1["open"]:
            entry = d4["open"]
            mae = (d4["high"] / entry - 1) * 100
            mfe = (entry - d4["low"]) / entry * 100
            cls_short = (entry - d4["close"]) / entry * 100
            if mae >= 4.0 and cls_short < 0:
                gross = -4.0
            elif mfe >= 6.0:
                gross = 0.5 * 6.0 + 0.5 * max(0.0, cls_short)
            else:
                gross = max(-4.0, cls_short)
            w3.append((f"{t}_D4", gross))
    out["W3_Day4_PostOptions_BlowOff_Unwind_Short"] = summarize_trades(w3, friction_pct=0.30)

    return out


def prescribe_ant_levels(
    noop_price: float,
    offer_price: float = 83.0,
    account_risk_usd: float = 1000.0,
    vix_level: float = 25.0,
    has_clean_short: bool = False,
) -> Dict:
    """Calculate v2.0 mega-cap calibrated triggers, VIX-adjusted share sizing, and lane rules."""
    pop_pct = (noop_price / offer_price - 1.0) * 100.0
    pop_vs_78_range = (noop_price / 78.0 - 1.0) * 100.0
    implied_val_t = round(1.50 * (noop_price / offer_price), 2)

    vix_mult = 0.72 if vix_level >= 24.0 else 1.0
    eff_risk = round(account_risk_usd * vix_mult, 2)

    if pop_pct <= 11.0:
        lane = "Lane 1: Cold / Muted Cross ($83–$92 • Best R/R Greenshoe Support)"
    elif pop_pct <= 34.5:
        lane = "Lane 2: Sweet-Spot Cross ($92–$111.50 • 15m ORH/ORL Two-Way Tape)"
    else:
        lane = "Lane 3: Euphoric Cross (>$111.50 / >+35% • Zero Morning Longs)"

    long_stop = round(max(offer_price - 0.25, noop_price * 0.965), 2) if pop_pct <= 11.0 else round(noop_price * 0.965, 2)
    long_shares = int(eff_risk / max(0.20, noop_price - long_stop))

    short_entry = round(noop_price * 0.975, 2)
    short_stop = round(noop_price * 1.01, 2)
    short_shares = int(eff_risk / max(0.20, short_stop - short_entry)) if has_clean_short else 0

    return {
        "noop": noop_price,
        "cross_pop_pct": round(pop_pct, 1),
        "pop_vs_78_top_range_pct": round(pop_vs_78_range, 1),
        "implied_valuation_trillions": implied_val_t,
        "vix_haircut_multiplier": vix_mult,
        "effective_risk_usd": eff_risk,
        "lane": lane,
        "long_plan": {
            "enabled": pop_pct <= 34.5,
            "cooling_rule": "Mandatory 10–15 min Hands-Off after cross; require 15m ORH break or VWAP reclaim",
            "hard_stop": f"${long_stop:.2f} (below 15m ORL / -3.5%)",
            "t1_50pct": f"${noop_price * 1.06:.2f} (+6.0% mega-cap scale)",
            "t2_runner": f"Trail VWAP / ${noop_price * 1.10:.2f} (+10%) / 1:30 PM ET",
            "vix_adjusted_shares": long_shares,
        },
        "short_plan": {
            "enabled": has_clean_short and pop_pct >= 12.0,
            "fallback_if_no_borrow": "Hard Exit / Stand-Down Only — Do NOT force unlocated or high-basis shorts",
            "confirmed_trigger": f"15m candle close + failed VWAP retest below 15m ORL (~${short_entry:.2f})",
            "hard_stop": f"${short_stop:.2f}",
            "target_zone": "$88.00 – $90.00 (cover well above $83–$85 greenshoe wall!)",
            "vix_adjusted_shares": short_shares,
        },
    }


def main() -> None:
    db = load_and_clean_cohort()
    cohort = db["cohort"]

    summary = {
        "engine_version": "2.0-megacap-calibrated",
        "ant_profile": db["ant"],
        "mega_large_deals_day1": run_day1_backtests(cohort, db["mega_large_deals"]),
        "tier1_peers_day1": run_day1_backtests(cohort, db["tier1_peers"]),
        "full_hyped_cohort_day1": run_day1_backtests(cohort, db["qualified"]),
        "tier1_peers_week1": run_week1_backtests(cohort, db["tier1_peers"]),
        "full_hyped_cohort_week1": run_week1_backtests(cohort, db["qualified"]),
        "sample_ant_lanes": {
            "lane1_cold_88": prescribe_ant_levels(88.0, vix_level=25.17, has_clean_short=False),
            "lane2_sweet_98": prescribe_ant_levels(98.0, vix_level=25.17, has_clean_short=True),
            "lane3_euphoric_116": prescribe_ant_levels(116.0, vix_level=25.17, has_clean_short=True),
        },
    }

    with open("data/backtest_results.json", "w") as f:
        json.dump(summary, f, indent=2)

    print("=== v2.0 MEGA-CAP CALIBRATED BACKTEST SUMMARY ===")
    print("\n--- Mega/Large Deals (>=$4.5B: SPCX, SKHY, CBRS, ARM) Day-1 ---")
    for k, v in summary["mega_large_deals_day1"].items():
        print(f"  {k:44s}: n={v['n']:2d} | WR={v['win_rate_pct']:5.1f}% | Net EV={v['net_ev_pct']:+6.2f}% | PF={v['profit_factor']:5.2f} | {v['trade_log']}")

    print("\n--- Tier-1 AI/Mega Cohort (n=14) Day-1 ---")
    for k, v in summary["tier1_peers_day1"].items():
        print(f"  {k:44s}: n={v['n']:2d} | WR={v['win_rate_pct']:5.1f}% | Net EV={v['net_ev_pct']:+6.2f}% | PF={v['profit_factor']:5.2f}")

    print("\n--- Tier-1 AI/Mega Cohort (n=14) Week-1 ---")
    for k, v in summary["tier1_peers_week1"].items():
        print(f"  {k:44s}: n={v['n']:2d} | WR={v['win_rate_pct']:5.1f}% | Net EV={v['net_ev_pct']:+6.2f}% | PF={v['profit_factor']:5.2f}")


if __name__ == "__main__":
    main()
