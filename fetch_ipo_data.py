import urllib.request
import json
import datetime
import os
import time

# Comprehensive cohort of "Hyped" & Major Benchmark IPOs (Late 2023 - Nov 2026)
# Fields: ticker, name, ipo_date, ipo_price, deal_size_b (USD billions), init_val_b (USD billions),
#         priced_vs_range ('above', 'top', 'in_range', 'below'), sector, hype_tier
IPO_COHORT = [
    # 2026 Mega / AI / DeepTech Cohort
    {"ticker": "SPCX", "name": "SpaceX", "ipo_date": "2026-06-12", "ipo_price": 135.0, "deal_size_b": 86.0, "init_val_b": 1770.0, "priced_vs_range": "top", "sector": "Aerospace / Frontier Tech", "retail_hype": 10, "ai_frontier": 8},
    {"ticker": "CBRS", "name": "Cerebras Systems", "ipo_date": "2026-05-14", "ipo_price": 185.0, "deal_size_b": 5.55, "init_val_b": 38.0, "priced_vs_range": "above", "sector": "AI Semiconductors", "retail_hype": 9, "ai_frontier": 10},
    {"ticker": "SKHY", "name": "SK hynix (US IPO)", "ipo_date": "2026-07-10", "ipo_price": 149.0, "deal_size_b": 26.5, "init_val_b": 115.0, "priced_vs_range": "in_range", "sector": "AI Memory / HBM", "retail_hype": 7, "ai_frontier": 9},
    {"ticker": "QNT",  "name": "Quantinuum", "ipo_date": "2026-06-04", "ipo_price": 60.0, "deal_size_b": 1.68, "init_val_b": 12.0, "priced_vs_range": "top", "sector": "Quantum Computing", "retail_hype": 8, "ai_frontier": 8},
    {"ticker": "BSP",  "name": "Bending Spoons", "ipo_date": "2026-07-01", "ipo_price": 29.0, "deal_size_b": 1.68, "init_val_b": 11.0, "priced_vs_range": "above", "sector": "AI Consumer Software", "retail_hype": 7, "ai_frontier": 7},

    # 2025 AI / Tech / Crypto / Fintech Hyped Cohort
    {"ticker": "CRWV", "name": "CoreWeave", "ipo_date": "2025-03-28", "ipo_price": 40.0, "deal_size_b": 1.50, "init_val_b": 23.0, "priced_vs_range": "below", "sector": "AI Cloud / Neocloud", "retail_hype": 9, "ai_frontier": 10},
    {"ticker": "FIG",  "name": "Figma", "ipo_date": "2025-07-31", "ipo_price": 33.0, "deal_size_b": 1.22, "init_val_b": 19.3, "priced_vs_range": "above", "sector": "AI Design SaaS", "retail_hype": 10, "ai_frontier": 8},
    {"ticker": "CRCL", "name": "Circle", "ipo_date": "2025-06-05", "ipo_price": 31.0, "deal_size_b": 1.05, "init_val_b": 6.9, "priced_vs_range": "above", "sector": "Crypto / Stablecoin", "retail_hype": 10, "ai_frontier": 5},
    {"ticker": "BLSH", "name": "Bullish", "ipo_date": "2025-08-13", "ipo_price": 37.0, "deal_size_b": 1.10, "init_val_b": 5.4, "priced_vs_range": "above", "sector": "Crypto Exchange", "retail_hype": 8, "ai_frontier": 4},
    {"ticker": "KLAR", "name": "Klarna", "ipo_date": "2025-09-10", "ipo_price": 40.0, "deal_size_b": 1.37, "init_val_b": 15.1, "priced_vs_range": "above", "sector": "AI Fintech / BNPL", "retail_hype": 9, "ai_frontier": 6},
    {"ticker": "CHYM", "name": "Chime", "ipo_date": "2025-06-12", "ipo_price": 27.0, "deal_size_b": 0.86, "init_val_b": 11.6, "priced_vs_range": "above", "sector": "Neobank Fintech", "retail_hype": 8, "ai_frontier": 4},
    {"ticker": "FIGR", "name": "Figure Tech", "ipo_date": "2025-09-11", "ipo_price": 25.0, "deal_size_b": 0.79, "init_val_b": 5.3, "priced_vs_range": "above", "sector": "Blockchain Fintech", "retail_hype": 7, "ai_frontier": 5},
    {"ticker": "GEMI", "name": "Gemini", "ipo_date": "2025-09-12", "ipo_price": 28.0, "deal_size_b": 0.43, "init_val_b": 3.3, "priced_vs_range": "above", "sector": "Crypto Exchange", "retail_hype": 8, "ai_frontier": 4},
    {"ticker": "NTSK", "name": "Netskope", "ipo_date": "2025-09-18", "ipo_price": 19.0, "deal_size_b": 0.99, "init_val_b": 8.8, "priced_vs_range": "above", "sector": "AI Cloud Security", "retail_hype": 7, "ai_frontier": 8},
    {"ticker": "NAVN", "name": "Navan", "ipo_date": "2025-10-30", "ipo_price": 25.0, "deal_size_b": 0.92, "init_val_b": 6.2, "priced_vs_range": "in_range", "sector": "AI Enterprise SaaS", "retail_hype": 7, "ai_frontier": 7},
    {"ticker": "ETOR", "name": "eToro", "ipo_date": "2025-05-14", "ipo_price": 52.0, "deal_size_b": 0.62, "init_val_b": 4.2, "priced_vs_range": "above", "sector": "Retail Brokerage", "retail_hype": 8, "ai_frontier": 4},
    {"ticker": "STUB", "name": "StubHub", "ipo_date": "2025-09-17", "ipo_price": 23.5, "deal_size_b": 0.80, "init_val_b": 8.6, "priced_vs_range": "in_range", "sector": "Consumer Marketplace", "retail_hype": 8, "ai_frontier": 3},
    {"ticker": "SAIL", "name": "SailPoint", "ipo_date": "2025-02-13", "ipo_price": 23.0, "deal_size_b": 1.38, "init_val_b": 12.8, "priced_vs_range": "above", "sector": "Enterprise Security", "retail_hype": 6, "ai_frontier": 7},

    # 2024 & Late-2023 Bellwether AI / Tech Hyped Cohort
    {"ticker": "TTAN", "name": "ServiceTitan", "ipo_date": "2024-12-12", "ipo_price": 71.0, "deal_size_b": 0.62, "init_val_b": 6.3, "priced_vs_range": "above", "sector": "Vertical SaaS", "retail_hype": 8, "ai_frontier": 6},
    {"ticker": "TEM",  "name": "Tempus AI", "ipo_date": "2024-06-14", "ipo_price": 37.0, "deal_size_b": 0.41, "init_val_b": 6.1, "priced_vs_range": "top", "sector": "Healthcare AI", "retail_hype": 8, "ai_frontier": 9},
    {"ticker": "RBRK", "name": "Rubrik", "ipo_date": "2024-04-25", "ipo_price": 32.0, "deal_size_b": 0.75, "init_val_b": 5.6, "priced_vs_range": "above", "sector": "AI Data Security", "retail_hype": 8, "ai_frontier": 8},
    {"ticker": "RDDT", "name": "Reddit", "ipo_date": "2024-03-21", "ipo_price": 34.0, "deal_size_b": 0.75, "init_val_b": 6.4, "priced_vs_range": "top", "sector": "Social / AI Data", "retail_hype": 10, "ai_frontier": 8},
    {"ticker": "ALAB", "name": "Astera Labs", "ipo_date": "2024-03-20", "ipo_price": 36.0, "deal_size_b": 0.71, "init_val_b": 5.5, "priced_vs_range": "above", "sector": "AI Connectivity Chips", "retail_hype": 9, "ai_frontier": 10},
    {"ticker": "ARM",  "name": "Arm Holdings", "ipo_date": "2023-09-14", "ipo_price": 51.0, "deal_size_b": 4.87, "init_val_b": 54.5, "priced_vs_range": "top", "sector": "AI / Mobile Chips", "retail_hype": 10, "ai_frontier": 9},
]

def fetch_yahoo(ticker, period1, period2, interval="1d"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker}?period1={period1}&period2={period2}&interval={interval}&includePrePost=false"
    req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urllib.request.urlopen(req, timeout=10) as r:
        data = json.loads(r.read())
    res = data["chart"]["result"][0]
    timestamps = res.get("timestamp", [])
    quote = res["indicators"]["quote"][0]
    bars = []
    for i, ts in enumerate(timestamps):
        if quote["open"][i] is None or quote["close"][i] is None:
            continue
        dt_est = datetime.datetime.fromtimestamp(ts, tz=datetime.timezone(datetime.timedelta(hours=-4))) # approx ET
        bars.append({
            "ts": ts,
            "dt": datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d %H:%M:%S"),
            "date": datetime.datetime.fromtimestamp(ts).strftime("%Y-%m-%d"),
            "open": round(quote["open"][i], 4),
            "high": round(quote["high"][i], 4),
            "low": round(quote["low"][i], 4),
            "close": round(quote["close"][i], 4),
            "volume": int(quote["volume"][i] or 0),
        })
    return bars

def main():
    os.makedirs("data", exist_ok=True)
    results = {}
    cutoff_hourly = datetime.datetime(2024, 11, 25)

    for item in IPO_COHORT:
        t = item["ticker"]
        dt0 = datetime.datetime.fromisoformat(item["ipo_date"])
        p1 = int((dt0 - datetime.timedelta(days=2)).timestamp())
        p2 = int((dt0 + datetime.timedelta(days=20)).timestamp())
        try:
            daily = fetch_yahoo(t, p1, p2, "1d")
        except Exception as e:
            print(f"Daily failed for {t}: {e}")
            daily = []

        hourly = []
        if dt0 >= cutoff_hourly:
            try:
                p2_h = int((dt0 + datetime.timedelta(days=12)).timestamp())
                hourly = fetch_yahoo(t, p1, p2_h, "1h")
            except Exception as e:
                print(f"Hourly failed for {t}: {e}")

        results[t] = {
            "meta": item,
            "daily": daily[:10],
            "hourly": hourly,
        }
        d1 = daily[0] if daily else {}
        pop_open = ((d1["open"] / item["ipo_price"]) - 1) * 100 if d1 else 0
        pop_close = ((d1["close"] / item["ipo_price"]) - 1) * 100 if d1 else 0
        oc_ret = ((d1["close"] / d1["open"]) - 1) * 100 if d1 else 0
        print(f"{t:5s} ({item['ipo_date']}) | Offer: ${item['ipo_price']:6.2f} | D1 Open: ${d1.get('open',0):6.2f} ({pop_open:+6.1f}%) | D1 H/L: {d1.get('high',0):.2f}/{d1.get('low',0):.2f} | D1 Close: ${d1.get('close',0):6.2f} (Offer->C {pop_close:+6.1f}%, Open->C {oc_ret:+6.1f}%) | 1h bars: {len(hourly)}")
        time.sleep(0.15)

    # Also fetch current macro context (QQQ, SPY, ^VIX, NVDA, SPCX, CRWV, CBRS last 20 days)
    macro = {}
    p1_m = int((datetime.datetime(2026, 10, 15)).timestamp())
    p2_m = int((datetime.datetime(2026, 11, 19)).timestamp())
    for mt in ["QQQ", "SPY", "^VIX", "NVDA", "SPCX", "CRWV", "CBRS"]:
        try:
            macro[mt] = fetch_yahoo(mt, p1_m, p2_m, "1d")
        except Exception as e:
            print(f"Macro failed {mt}: {e}")

    with open("data/ipo_cohort_data.json", "w") as f:
        json.dump({"cohort": results, "macro_nov2026": macro}, f, indent=2)
    print("Saved data/ipo_cohort_data.json successfully.")

if __name__ == "__main__":
    main()
