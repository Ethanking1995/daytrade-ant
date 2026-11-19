"""
ANT IPO Live Trading Copilot & Strategy Web Server (v2.0 Mega-Cap Calibrated)
=============================================================================
Serves the v2.0 trading copilot at http://localhost:8765 featuring:
  - Live Nasdaq Spot (`ANT`) 1m/1d feed with 15-Minute Opening Range (ORH/ORL),
    minutes-since-cross cooling timer, intraday VWAP, and confirmed 15m candle breaks.
  - Live 24/7 Perpetual (`xyz:ANT` + `vntl:ANTHROPIC`) with Spot-vs-Perp basis monitor.
  - Live Single-Stock Inverse/Leveraged ETF tracker (`ANS` -2x, `ANDD` -2x, `AIL` +2x).
  - Live Macro Tape Filter: `QQQ` intraday 1m VWAP & LOD veto, `^VIX` (>24 size haircut),
    `10Y Yield (^TNX)`, and AI peer rotation (`NVDA`, `AMD`, `AVGO`, `SPCX`, `CRWV`).
"""

import datetime
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from typing import Any, Dict, Optional

from ant_ipo_strategy_engine import load_and_clean_cohort, run_day1_backtests, run_week1_backtests

PORT = 8765
OFFER_PRICE = 83.00
BASE_VALUATION_T = 1.50
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(BASE_DIR, "static")


def http_get_json(url: str, timeout: float = 5.0) -> Any:
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


def http_post_json(url: str, payload: Dict, timeout: float = 5.0) -> Any:
    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(
        url,
        data=body,
        headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0"},
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode("utf-8"))


class LiveMarketTracker:
    """Thread-safe poller for Nasdaq ANT, 15m ORH/ORL, QQQ VWAP tape filter, ETFs, and Hyperliquid."""

    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._state: Dict[str, Any] = {
            "engine_version": "2.0",
            "updated_at": None,
            "updated_epoch": 0,
            "et_time_str": "",
            "et_date_str": "",
            "et_hour_float": 0.0,
            "nasdaq_ant": {
                "is_live": False,
                "trading_day_num": 0,
                "spot_price": None,
                "noop": None,
                "day_open": None,
                "day_high": None,
                "day_low": None,
                "day_vwap": None,
                "day_volume": 0,
                "minutes_since_cross": 0,
                "or15_complete": False,
                "or15_high": None,
                "or15_low": None,
                "confirmed_15m_break_below_orl": False,
                "confirmed_red_15m_below_vwap": False,
                "intraday_candles": [],
                "prior_days": [],
            },
            "ant_etfs": {
                "ANS": None,   # GraniteShares 2x Short ANT Daily ETF
                "ANDD": None,  # Leverage Shares 2x Short ANT Daily ETF
                "AIL": None,   # GraniteShares 2x Long ANT Daily ETF
            },
            "hyperliquid": {
                "perp_mid": None,
                "best_bid": None,
                "best_ask": None,
                "spread_bps": None,
                "perp_vs_spot_basis_bps": None,
                "val_index_b": None,
                "peers": {},
                "book_bids": [],
                "book_asks": [],
                "candles_5m": [],
                "candles_15m": [],
                "candles_1h": [],
            },
            "macro": {
                "VIX": None,
                "TNX_10Y": None,
                "QQQ": None,
                "QQQ_vwap": None,
                "QQQ_day_low": None,
                "QQQ_day_high": None,
                "QQQ_tape_state": "NEUTRAL",  # BULLISH_ABOVE_VWAP | CAUTION_BELOW_VWAP | BREAKING_LOWS
                "SPY": None,
                "NVDA": None,
                "AMD": None,
                "AVGO": None,
                "SPCX": None,
                "CRWV": None,
            },
        }
        self._last_macro_fetch = 0.0
        self._last_etf_fetch = 0.0
        self._last_15m_fetch = 0.0
        self._running = True

    def start(self) -> None:
        self._refresh_once()
        t = threading.Thread(target=self._loop, daemon=True)
        t.start()

    def _loop(self) -> None:
        while self._running:
            time.sleep(3.0)
            try:
                self._refresh_once()
            except Exception:
                pass

    def get_snapshot(self) -> Dict[str, Any]:
        with self._lock:
            return json.loads(json.dumps(self._state))

    def _refresh_once(self) -> None:
        now_utc = datetime.datetime.now(datetime.timezone.utc)
        et_tz = datetime.timezone(datetime.timedelta(hours=-5))
        now_et = now_utc.astimezone(et_tz)
        et_hour_float = now_et.hour + now_et.minute / 60.0 + now_et.second / 3600.0

        nasdaq_data = self._fetch_nasdaq_ant()
        hl_data = self._fetch_hyperliquid(nasdaq_data.get("spot_price") if nasdaq_data else None)

        now_s = time.time()
        macro_data = None
        if now_s - self._last_macro_fetch >= 15.0 or self._state["macro"]["VIX"] is None:
            macro_data = self._fetch_macro()
            self._last_macro_fetch = now_s

        etf_data = None
        if now_s - self._last_etf_fetch >= 30.0:
            etf_data = self._fetch_ant_etfs()
            self._last_etf_fetch = now_s

        with self._lock:
            self._state["updated_at"] = now_et.strftime("%Y-%m-%d %H:%M:%S EST")
            self._state["updated_epoch"] = int(now_s)
            self._state["et_time_str"] = now_et.strftime("%I:%M:%S %p EST")
            self._state["et_date_str"] = now_et.strftime("%a %b %d, %Y")
            self._state["et_hour_float"] = round(et_hour_float, 4)
            if nasdaq_data:
                self._state["nasdaq_ant"] = nasdaq_data
            if hl_data:
                if not hl_data.get("candles_15m"):
                    hl_data["candles_15m"] = self._state["hyperliquid"].get("candles_15m", [])
                if not hl_data.get("candles_1h"):
                    hl_data["candles_1h"] = self._state["hyperliquid"].get("candles_1h", [])
                self._state["hyperliquid"] = hl_data
            if macro_data:
                self._state["macro"].update(macro_data)
            if etf_data is not None:
                self._state["ant_etfs"].update(etf_data)

    def _fetch_nasdaq_ant(self) -> Optional[Dict[str, Any]]:
        try:
            d1_raw = http_get_json(
                "https://query1.finance.yahoo.com/v8/finance/chart/ANT?range=10d&interval=1d&includePrePost=false",
                timeout=4.0,
            )
            res_d = d1_raw["chart"]["result"][0]
            meta = res_d.get("meta", {})
            ts_d = res_d.get("timestamp") or []
            q_d = (res_d.get("indicators", {}).get("quote") or [{}])[0]

            daily_bars = []
            for i, ts in enumerate(ts_d):
                vol = int((q_d.get("volume") or [0])[i] or 0)
                op = (q_d.get("open") or [None])[i]
                cl = (q_d.get("close") or [None])[i]
                if vol > 0 and op is not None and cl is not None:
                    daily_bars.append(
                        {
                            "date": datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
                            "open": round(float(op), 4),
                            "high": round(float(q_d["high"][i]), 4),
                            "low": round(float(q_d["low"][i]), 4),
                            "close": round(float(cl), 4),
                            "volume": vol,
                        }
                    )

            reg_price = meta.get("regularMarketPrice")
            if not daily_bars and reg_price is None:
                return {
                    "is_live": False,
                    "trading_day_num": 0,
                    "spot_price": None,
                    "noop": None,
                    "day_open": None,
                    "day_high": None,
                    "day_low": None,
                    "day_vwap": None,
                    "day_volume": 0,
                    "minutes_since_cross": 0,
                    "or15_complete": False,
                    "or15_high": None,
                    "or15_low": None,
                    "confirmed_15m_break_below_orl": False,
                    "confirmed_red_15m_below_vwap": False,
                    "intraday_candles": [],
                    "prior_days": [],
                }

            m1_raw = http_get_json(
                "https://query1.finance.yahoo.com/v8/finance/chart/ANT?range=1d&interval=1m&includePrePost=false",
                timeout=4.0,
            )
            res_m = m1_raw["chart"]["result"][0]
            ts_m = res_m.get("timestamp") or []
            q_m = (res_m.get("indicators", {}).get("quote") or [{}])[0]

            m1_bars = []
            cum_pv = 0.0
            cum_v = 0
            for i, ts in enumerate(ts_m):
                op = (q_m.get("open") or [None])[i]
                cl = (q_m.get("close") or [None])[i]
                hi = (q_m.get("high") or [None])[i]
                lo = (q_m.get("low") or [None])[i]
                vol = int((q_m.get("volume") or [0])[i] or 0)
                if op is None or cl is None or vol <= 0:
                    continue
                typ = (float(hi) + float(lo) + float(cl)) / 3.0
                cum_pv += typ * vol
                cum_v += vol
                m1_bars.append(
                    {
                        "t": ts * 1000,
                        "o": round(float(op), 4),
                        "h": round(float(hi), 4),
                        "l": round(float(lo), 4),
                        "c": round(float(cl), 4),
                        "v": vol,
                        "vwap": round(cum_pv / cum_v, 4) if cum_v > 0 else round(float(cl), 4),
                    }
                )

            day_num = max(1, len(daily_bars))
            noop = daily_bars[0]["open"] if daily_bars else (m1_bars[0]["o"] if m1_bars else float(reg_price))
            cur_open = m1_bars[0]["o"] if m1_bars else (daily_bars[-1]["open"] if daily_bars else float(reg_price))
            cur_high = max((b["h"] for b in m1_bars), default=float(meta.get("regularMarketDayHigh") or reg_price))
            cur_low = min((b["l"] for b in m1_bars), default=float(meta.get("regularMarketDayLow") or reg_price))
            cur_spot = float(reg_price) if reg_price is not None else m1_bars[-1]["c"]
            vwap = round(cum_pv / cum_v, 4) if cum_v > 0 else cur_spot

            # 15-Minute Opening Range & Anti-Whipsaw Candle-Close Confirmations
            mins_since_cross = len(m1_bars)
            or15_complete = mins_since_cross >= 15
            or15_slice = m1_bars[:15] if m1_bars else []
            or15_high = round(max((b["h"] for b in or15_slice), default=cur_high), 4)
            or15_low = round(min((b["l"] for b in or15_slice), default=cur_low), 4)

            confirmed_15m_break_orl = False
            confirmed_red_15m_vwap = False
            if mins_since_cross >= 30:
                num_15m = mins_since_cross // 15
                running_hod = or15_high
                for k in range(1, num_15m):
                    c15 = m1_bars[k * 15 : (k + 1) * 15]
                    c15_open = c15[0]["o"]
                    c15_close = c15[-1]["c"]
                    c15_high = max(x["h"] for x in c15)
                    c15_vwap = c15[-1]["vwap"]
                    running_hod = max(running_hod, c15_high)
                    if c15_close < or15_low and c15_close < noop:
                        confirmed_15m_break_orl = True
                    ext_pct = (running_hod / cur_open - 1.0) * 100.0
                    pop_pct = (noop / OFFER_PRICE - 1.0) * 100.0
                    if (ext_pct >= 6.5 or pop_pct >= 34.5) and (c15_close < c15_open) and (c15_close < c15_vwap):
                        confirmed_red_15m_vwap = True

            return {
                "is_live": True,
                "trading_day_num": day_num,
                "spot_price": round(cur_spot, 4),
                "noop": round(noop, 4),
                "day_open": round(cur_open, 4),
                "day_high": round(cur_high, 4),
                "day_low": round(cur_low, 4),
                "day_vwap": vwap,
                "day_volume": cum_v or int(meta.get("regularMarketVolume") or 0),
                "minutes_since_cross": mins_since_cross,
                "or15_complete": or15_complete,
                "or15_high": or15_high,
                "or15_low": or15_low,
                "confirmed_15m_break_below_orl": confirmed_15m_break_orl,
                "confirmed_red_15m_below_vwap": confirmed_red_15m_vwap,
                "intraday_candles": m1_bars[-120:],
                "prior_days": daily_bars[:-1] if len(daily_bars) > 1 else [],
            }
        except Exception:
            return None

    def _fetch_ant_etfs(self) -> Dict[str, Optional[float]]:
        out: Dict[str, Optional[float]] = {}
        for sym in ["ANS", "ANDD", "AIL"]:
            try:
                d = http_get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{sym}?range=1d&interval=5m", timeout=2.5)
                px = d["chart"]["result"][0]["meta"].get("regularMarketPrice")
                out[sym] = round(float(px), 2) if px is not None else None
            except Exception:
                out[sym] = None
        return out

    def _fetch_hyperliquid(self, spot_price: Optional[float] = None) -> Optional[Dict[str, Any]]:
        try:
            mids_xyz = http_post_json("https://api.hyperliquid.xyz/info", {"type": "allMids", "dex": "xyz"}, timeout=4.0)
            ant_mid = float(mids_xyz["xyz:ANT"]) if "xyz:ANT" in mids_xyz else None

            val_b = None
            try:
                mids_vntl = http_post_json("https://api.hyperliquid.xyz/info", {"type": "allMids", "dex": "vntl"}, timeout=3.0)
                if "vntl:ANTHROPIC" in mids_vntl:
                    val_b = round(float(mids_vntl["vntl:ANTHROPIC"]), 1)
            except Exception:
                pass

            book = http_post_json("https://api.hyperliquid.xyz/info", {"type": "l2Book", "coin": "xyz:ANT"}, timeout=4.0)
            bids_raw = (book.get("levels") or [[], []])[0][:6]
            asks_raw = (book.get("levels") or [[], []])[1][:6]
            bids = [{"px": float(b["px"]), "sz": float(b["sz"]), "n": int(b["n"])} for b in bids_raw]
            asks = [{"px": float(a["px"]), "sz": float(a["sz"]), "n": int(a["n"])} for a in asks_raw]

            best_bid = bids[0]["px"] if bids else ant_mid
            best_ask = asks[0]["px"] if asks else ant_mid
            spread_bps = round((best_ask - best_bid) / ant_mid * 10000, 2) if (ant_mid and best_bid and best_ask) else 0.0
            basis_bps = round((ant_mid - spot_price) / spot_price * 10000, 1) if (ant_mid and spot_price) else None

            now_ms = int(time.time() * 1000)
            c5_raw = http_post_json(
                "https://api.hyperliquid.xyz/info",
                {"type": "candleSnapshot", "req": {"coin": "xyz:ANT", "interval": "5m", "startTime": now_ms - 8 * 3600 * 1000, "endTime": now_ms}},
                timeout=4.0,
            )
            candles_5m = [
                {"t": int(c["t"]), "o": float(c["o"]), "h": float(c["h"]), "l": float(c["l"]), "c": float(c["c"]), "v": float(c["v"])}
                for c in (c5_raw or [])[-75:]
            ]

            candles_15m = []
            candles_1h = []
            if time.time() - self._last_15m_fetch >= 15.0 or not self._state["hyperliquid"]["candles_15m"]:
                self._last_15m_fetch = time.time()
                try:
                    c15_raw = http_post_json(
                        "https://api.hyperliquid.xyz/info",
                        {"type": "candleSnapshot", "req": {"coin": "xyz:ANT", "interval": "15m", "startTime": now_ms - 24 * 3600 * 1000, "endTime": now_ms}},
                        timeout=4.0,
                    )
                    candles_15m = [
                        {"t": int(c["t"]), "o": float(c["o"]), "h": float(c["h"]), "l": float(c["l"]), "c": float(c["c"]), "v": float(c["v"])}
                        for c in (c15_raw or [])[-75:]
                    ]
                    c1h_raw = http_post_json(
                        "https://api.hyperliquid.xyz/info",
                        {"type": "candleSnapshot", "req": {"coin": "xyz:ANT", "interval": "1h", "startTime": now_ms - 72 * 3600 * 1000, "endTime": now_ms}},
                        timeout=4.0,
                    )
                    candles_1h = [
                        {"t": int(c["t"]), "o": float(c["o"]), "h": float(c["h"]), "l": float(c["l"]), "c": float(c["c"]), "v": float(c["v"])}
                        for c in (c1h_raw or [])[-72:]
                    ]
                except Exception:
                    pass

            return {
                "perp_mid": round(ant_mid, 4) if ant_mid else None,
                "best_bid": round(best_bid, 4) if best_bid else None,
                "best_ask": round(best_ask, 4) if best_ask else None,
                "spread_bps": spread_bps,
                "perp_vs_spot_basis_bps": basis_bps,
                "val_index_b": val_b,
                "peers": {
                    "SPCX": round(float(mids_xyz["xyz:SPCX"]), 2) if "xyz:SPCX" in mids_xyz else None,
                    "CRWV": round(float(mids_xyz["xyz:CRWV"]), 2) if "xyz:CRWV" in mids_xyz else None,
                    "NVDA": round(float(mids_xyz["xyz:NVDA"]), 2) if "xyz:NVDA" in mids_xyz else None,
                },
                "book_bids": bids,
                "book_asks": asks,
                "candles_5m": candles_5m,
                "candles_15m": candles_15m,
                "candles_1h": candles_1h,
            }
        except Exception:
            return None

    def _fetch_macro(self) -> Dict[str, Any]:
        out: Dict[str, Any] = {}
        # 1. Live QQQ 1m Intraday VWAP & Low-of-Day Veto Filter
        try:
            qd = http_get_json("https://query1.finance.yahoo.com/v8/finance/chart/QQQ?range=1d&interval=1m&includePrePost=false", timeout=3.5)
            qres = qd["chart"]["result"][0]
            qmeta = qres["meta"]
            qts = qres.get("timestamp") or []
            qq = (qres.get("indicators", {}).get("quote") or [{}])[0]
            cum_pv, cum_v = 0.0, 0
            q_lows, q_highs = [], []
            for i in range(len(qts)):
                hi = (qq.get("high") or [None])[i]
                lo = (qq.get("low") or [None])[i]
                cl = (qq.get("close") or [None])[i]
                vol = int((qq.get("volume") or [0])[i] or 0)
                if hi is not None and lo is not None and cl is not None:
                    q_lows.append(float(lo))
                    q_highs.append(float(hi))
                    cum_pv += ((float(hi) + float(lo) + float(cl)) / 3.0) * vol
                    cum_v += vol
            q_px = float(qmeta.get("regularMarketPrice") or (qq["close"][-1] if qts else 0))
            q_vwap = round(cum_pv / cum_v, 2) if cum_v > 0 else q_px
            q_low = round(min(q_lows), 2) if q_lows else q_px
            q_high = round(max(q_highs), 2) if q_highs else q_px
            out["QQQ"] = round(q_px, 2)
            out["QQQ_vwap"] = q_vwap
            out["QQQ_day_low"] = q_low
            out["QQQ_day_high"] = q_high
            if q_px <= q_low * 1.0015 and q_px < q_vwap:
                out["QQQ_tape_state"] = "BREAKING_LOWS"
            elif q_px >= q_vwap:
                out["QQQ_tape_state"] = "BULLISH_ABOVE_VWAP"
            else:
                out["QQQ_tape_state"] = "CAUTION_BELOW_VWAP"
        except Exception:
            pass

        # 2. VIX, 10Y Yield (^TNX), SPY, NVDA, AMD, AVGO, SPCX, CRWV
        for sym, key in [
            ("^VIX", "VIX"),
            ("^TNX", "TNX_10Y"),
            ("SPY", "SPY"),
            ("NVDA", "NVDA"),
            ("AMD", "AMD"),
            ("AVGO", "AVGO"),
            ("SPCX", "SPCX"),
            ("CRWV", "CRWV"),
        ]:
            try:
                enc = urllib.parse.quote(sym)
                d = http_get_json(f"https://query1.finance.yahoo.com/v8/finance/chart/{enc}?range=2d&interval=1d", timeout=3.0)
                px = d["chart"]["result"][0]["meta"].get("regularMarketPrice")
                if px is not None:
                    out[key] = round(float(px), 2)
            except Exception:
                pass
        return out


TRACKER = LiveMarketTracker()
COHORT_CACHE: Dict[str, Any] = {}


def init_cohort_cache() -> None:
    global COHORT_CACHE
    db = load_and_clean_cohort(os.path.join(BASE_DIR, "data", "ipo_cohort_data.json"))
    cohort = db["cohort"]
    rows = []
    for t in db["qualified"]:
        v = cohort[t]
        m = v["meta"]
        d1 = v["daily"][0]
        d2 = v["daily"][1] if len(v["daily"]) > 1 else None
        d3 = v["daily"][2] if len(v["daily"]) > 2 else None
        rows.append(
            {
                "ticker": t,
                "name": m["name"],
                "sector": m["sector"],
                "ipo_date": d1["date"],
                "hype_score": v["hype_score"],
                "deal_size_b": m["deal_size_b"],
                "init_val_b": m["init_val_b"],
                "is_mega_deal": m["deal_size_b"] >= 4.5,
                "offer": m["ipo_price"],
                "d1_open": d1["open"],
                "d1_high": d1["high"],
                "d1_low": d1["low"],
                "d1_close": d1["close"],
                "cross_pop_pct": round((d1["open"] / m["ipo_price"] - 1) * 100, 1),
                "d1_o2h_pct": round((d1["high"] / d1["open"] - 1) * 100, 1),
                "d1_o2l_pct": round((d1["low"] / d1["open"] - 1) * 100, 1),
                "d1_o2c_pct": round((d1["close"] / d1["open"] - 1) * 100, 1),
                "d2_o2c_pct": round((d2["close"] / d2["open"] - 1) * 100, 1) if d2 else None,
                "d3_o2c_pct": round((d3["close"] / d3["open"] - 1) * 100, 1) if d3 else None,
            }
        )
    COHORT_CACHE = {
        "engine_version": "2.0",
        "ant_profile": db["ant"],
        "cohort_rows": rows,
        "day1_stats_mega": run_day1_backtests(cohort, db["mega_large_deals"]),
        "day1_stats_tier1": run_day1_backtests(cohort, db["tier1_peers"]),
        "day1_stats_full": run_day1_backtests(cohort, db["qualified"]),
        "week1_stats_tier1": run_week1_backtests(cohort, db["tier1_peers"]),
        "week1_stats_full": run_week1_backtests(cohort, db["qualified"]),
    }


class CopilotHTTPRequestHandler(SimpleHTTPRequestHandler):
    def __init__(self, *args: Any, **kwargs: Any) -> None:
        super().__init__(*args, directory=STATIC_DIR, **kwargs)

    def log_message(self, format: str, *args: Any) -> None:
        pass

    def _send_json(self, payload: Any, status: int = 200) -> None:
        raw = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(raw)))
        self.end_headers()
        self.wfile.write(raw)

    def do_GET(self) -> None:
        parsed = urllib.parse.urlparse(self.path)
        if parsed.path == "/api/live":
            self._send_json(TRACKER.get_snapshot())
            return
        if parsed.path == "/api/cohort":
            self._send_json(COHORT_CACHE)
            return
        if parsed.path == "/" or parsed.path == "":
            self.path = "/index.html"
        return super().do_GET()


def main() -> None:
    init_cohort_cache()
    TRACKER.start()
    server = ThreadingHTTPServer(("127.0.0.1", PORT), CopilotHTTPRequestHandler)
    print(f"ANT Live IPO Trading Copilot v2.0 running at http://localhost:{PORT}")
    server.serve_forever()


if __name__ == "__main__":
    main()
