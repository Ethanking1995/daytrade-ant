// ============================================================================
// ANT IPO Live Leg-In Copilot (v2.0 Mega-Cap Calibrated)
// Incorporates:
//   1. Mega-Cap Target Calibration (+6.0% T1, VWAP/1:30p trail vs $1B float greed)
//   2. Lowered Overheated Cutoff (+34.5% / $111.50 = +43% above $78 range / $2.0T)
//   3. 15-Minute Hands-Off Cooling Window + Confirmed 15m ORH / ORL + VWAP triggers
//   4. Live QQQ Intraday VWAP / LOD Veto + VIX >24 (-28% Auto Haircut) + Short Borrow Gate
//   5. Corrected Week-1 Calendar: Day 2 T+1 Borrow, Day 3 Options Gamma, Day 5 Noon Cutoff
// ============================================================================

const OFFER_PRICE = 83.00;
const ORIG_RANGE_TOP = 78.00;
const BASE_VAL_T = 1.50;
const OVERHEATED_PRICE = 111.50; // +34.3% vs $83 (+42.9% vs $78 original top, >$2.01T)

let liveData = null;
let cohortData = null;
let baseRiskUsd = 1000;
let activeScenario = "live";
let chartTF = "5m";
let cohortFilter = "mega"; // Default to Mega/Large Deals first so user sees realistic comps!

let position = JSON.parse(localStorage.getItem("ant_copilot_pos_v2") || "null") || {
  side: null,
  shares: 0,
  avgEntry: 0,
  scaledT1: false,
  legsCount: 0,
};

function savePosition() {
  localStorage.setItem("ant_copilot_pos_v2", JSON.stringify(position));
}

// Rehearsal Scenarios calibrated to v2 Playbook
const SCENARIOS = {
  lockout_15m: { day: 1, noop: 98.00, price: 97.40, mins: 8,  qqq: "BULLISH_ABOVE_VWAP", label: "First 15m Hands-Off Lockout (8m Post-Cross)" },
  lane1_cold:  { day: 1, noop: 88.00, price: 89.40, mins: 20, qqq: "BULLISH_ABOVE_VWAP", label: "Lane 1 Cold Cross ($88) • Confirmed 15m ORH Break" },
  lane2_orh:   { day: 1, noop: 98.00, price: 99.85, mins: 24, qqq: "BULLISH_ABOVE_VWAP", label: "Lane 2 Sweet-Spot ($98) • 15m ORH Break (+6% T1)" },
  orl_break:   { day: 1, noop: 98.00, price: 94.80, mins: 34, qqq: "CAUTION_BELOW_VWAP", label: "Lane 2 Bear Path • Confirmed 15m Close < ORL ($95.80)" },
  lane3_hot:   { day: 1, noop: 116.00, price: 114.20, mins: 35, qqq: "BULLISH_ABOVE_VWAP", label: "Lane 3 Euphoric Cross ($116 > +35%) • Zero Longs / Fade" },
  day3_opts:   { day: 3, noop: 98.00, price: 104.20, mins: 65, qqq: "BULLISH_ABOVE_VWAP", label: "Day 3 (Mon Nov 23) • Options Listing Gamma Breakout" },
};

function toggleTheme() {
  const html = document.documentElement;
  html.classList.toggle("light");
  document.getElementById("themeToggle").textContent = html.classList.contains("light") ? "🌙 Dark" : "☀️ Light";
  drawPriceChart();
}

function setRisk(val) {
  baseRiskUsd = val;
  document.getElementById("customRiskInput").value = val;
  document.querySelectorAll(".hero-grid .risk-selector .risk-btn").forEach(btn => {
    btn.classList.toggle("active", btn.textContent.replace(/[^0-9]/g, "") === String(val));
  });
  renderAll();
}

function setCustomRisk(val) {
  const n = parseFloat(val);
  if (!isNaN(n) && n >= 50) {
    baseRiskUsd = n;
    document.querySelectorAll(".hero-grid .risk-selector .risk-btn").forEach(b => b.classList.remove("active"));
    renderAll();
  }
}

function getEffectiveRiskUsd() {
  const vix = liveData?.macro?.VIX || 25.0;
  const applyHaircut = document.getElementById("vixHaircutToggle")?.checked && vix >= 24.0;
  const eff = applyHaircut ? Math.round(baseRiskUsd * 0.72) : baseRiskUsd;
  const lbl = document.getElementById("vixHaircutLbl");
  if (lbl) {
    lbl.textContent = vix >= 24.0
      ? `VIX ${vix.toFixed(1)} Haircut (${applyHaircut ? "-28% → $" + eff : "Off"})`
      : `VIX ${vix.toFixed(1)} Normal ($${eff})`;
  }
  return eff;
}

function selectScenario(key) {
  activeScenario = key;
  document.querySelectorAll(".scenario-bar > .chip-btn").forEach(b => {
    b.classList.toggle("active", b.id === "mode-" + key);
  });
  const simBox = document.getElementById("simControls");
  if (key === "live") {
    simBox.classList.remove("visible");
  } else {
    simBox.classList.add("visible");
    const sc = SCENARIOS[key];
    if (sc) {
      document.getElementById("simDay").value = String(sc.day);
      document.getElementById("simNoop").value = sc.noop;
      document.getElementById("simPrice").value = sc.price;
      document.getElementById("simMins").value = sc.mins;
      document.getElementById("simQqqState").value = sc.qqq;
    }
  }
  renderAll();
}

function onCustomSimChange() {
  renderAll();
}

function setChartTF(tf) {
  chartTF = tf;
  ["5m", "15m", "1h"].forEach(k => {
    document.getElementById("tf-" + k).classList.toggle("active", k === tf);
  });
  drawPriceChart();
}

function setCohortFilter(flt) {
  cohortFilter = flt;
  ["mega", "all", "sweet", "hot"].forEach(k => {
    document.getElementById("flt-" + k).classList.toggle("active", k === flt);
  });
  renderCohortTable();
}

// ============================================================================
// Effective Market Context (Live Feeds + Rehearsal / Manual Cross Overrides)
// ============================================================================
function getEffectiveContext() {
  const perpMid = liveData?.hyperliquid?.perp_mid || 98.50;
  const nasdaq = liveData?.nasdaq_ant || { is_live: false, trading_day_num: 0 };
  const mac = liveData?.macro || {};
  const manualNoopRaw = parseFloat(document.getElementById("manualNoopInput")?.value);
  const hasManualNoop = !isNaN(manualNoopRaw) && manualNoopRaw > 40;
  const shortRail = document.getElementById("shortRailSelect")?.value || "none";

  if (activeScenario !== "live") {
    const day = parseInt(document.getElementById("simDay").value, 10);
    const noop = parseFloat(document.getElementById("simNoop").value);
    const price = parseFloat(document.getElementById("simPrice").value);
    const mins = parseInt(document.getElementById("simMins").value, 10);
    const qqqState = document.getElementById("simQqqState").value;

    document.getElementById("simDayLbl").textContent = `Day ${day}`;
    document.getElementById("simNoopLbl").textContent = `$${noop.toFixed(2)}`;
    document.getElementById("simPriceLbl").textContent = `$${price.toFixed(2)}`;
    document.getElementById("simMinsLbl").textContent = `${mins}m`;

    const or15High = +(noop * 1.012).toFixed(2);
    const or15Low = +(noop * 0.978).toFixed(2);
    const high = Math.max(or15High, price, noop * 1.015);
    const low = Math.min(or15Low, price);
    const vwap = +(noop * 0.45 + price * 0.55).toFixed(2);
    const etHour = day === 1 ? +(11.75 + mins / 60.0).toFixed(2) : +(9.5 + mins / 60.0).toFixed(2);

    return {
      isSim: true,
      isNasdaqLive: true,
      dayNum: day,
      noop,
      price,
      high,
      low,
      vwap,
      minsSinceCross: mins,
      or15Complete: mins >= 15,
      or15High,
      or15Low,
      confirmed15mBreakOrl: mins >= 30 && price < or15Low && price < noop,
      confirmedRed15mVwap: mins >= 30 && price < vwap && (high >= noop * 1.065 || noop > OVERHEATED_PRICE),
      etHour,
      qqqState,
      shortRail,
      priorHigh: +(noop * 1.035).toFixed(2),
      d1Broken: day >= 2 && price < noop * 0.96,
    };
  }

  // LIVE MODE
  const qqqState = mac.QQQ_tape_state || "BULLISH_ABOVE_VWAP";
  if (!nasdaq.is_live) {
    const estNoop = hasManualNoop ? manualNoopRaw : perpMid;
    return {
      isSim: false,
      isNasdaqLive: false,
      dayNum: 0,
      noop: estNoop,
      price: perpMid,
      high: Math.max(estNoop, perpMid),
      low: Math.min(estNoop, perpMid),
      vwap: perpMid,
      minsSinceCross: 0,
      or15Complete: false,
      or15High: +(estNoop * 1.012).toFixed(2),
      or15Low: +(estNoop * 0.978).toFixed(2),
      confirmed15mBreakOrl: false,
      confirmedRed15mVwap: false,
      etHour: liveData?.et_hour_float || 21.0,
      qqqState,
      shortRail,
      priorHigh: estNoop,
      d1Broken: false,
    };
  }

  const noop = hasManualNoop ? manualNoopRaw : (nasdaq.noop || nasdaq.spot_price);
  const price = nasdaq.spot_price || perpMid;
  const priors = nasdaq.prior_days || [];
  const lastPrior = priors.length > 0 ? priors[priors.length - 1] : null;
  const d1Bar = priors.length > 0 ? priors[0] : null;

  return {
    isSim: false,
    isNasdaqLive: true,
    dayNum: nasdaq.trading_day_num || 1,
    noop,
    price,
    high: nasdaq.day_high || price,
    low: nasdaq.day_low || price,
    vwap: nasdaq.day_vwap || price,
    minsSinceCross: nasdaq.minutes_since_cross || 0,
    or15Complete: Boolean(nasdaq.or15_complete),
    or15High: nasdaq.or15_high || +(noop * 1.012).toFixed(2),
    or15Low: nasdaq.or15_low || +(noop * 0.978).toFixed(2),
    confirmed15mBreakOrl: Boolean(nasdaq.confirmed_15m_break_below_orl),
    confirmedRed15mVwap: Boolean(nasdaq.confirmed_red_15m_below_vwap),
    etHour: liveData?.et_hour_float || 12.0,
    qqqState,
    shortRail,
    priorHigh: lastPrior ? lastPrior.high : (nasdaq.day_high || noop),
    d1Broken: d1Bar ? ((d1Bar.close / d1Bar.open - 1) * 100 < -2.0) : false,
  };
}

// ============================================================================
// v2.0 Mega-Cap Calibrated Decision Engine
// ============================================================================
function computeLegInRecommendation(ctx) {
  const effRisk = getEffectiveRiskUsd();
  const {
    isNasdaqLive, dayNum, noop, price, high, vwap, minsSinceCross,
    or15Complete, or15High, or15Low, confirmed15mBreakOrl, confirmedRed15mVwap,
    etHour, qqqState, shortRail, priorHigh, d1Broken
  } = ctx;

  const crossPop = ((noop / OFFER_PRICE) - 1) * 100;
  const range78Pop = ((noop / ORIG_RANGE_TOP) - 1) * 100;
  const hasCleanShort = shortRail !== "none";
  const isInverseEtf = shortRail === "etf"; // -2x daily ETF (ANS / ANDD) requires 0.5x notional!

  const calcLongShares = (entryPx, stopPx) => Math.max(2, Math.floor(effRisk / Math.max(0.20, Math.abs(entryPx - stopPx))));
  const calcShortSizeDesc = (entryPx, stopPx) => {
    const rawSh = Math.max(2, Math.floor(effRisk / Math.max(0.20, Math.abs(stopPx - entryPx))));
    if (!hasCleanShort) return { sh: 0, label: "0 sh (Exit Only)", notional: 0 };
    if (isInverseEtf) {
      // -2x ETF moves 2% for every 1% ANT move -> allocate 0.5x of underlying notional!
      const etfNotional = Math.round((rawSh * entryPx) * 0.5);
      return { sh: rawSh, label: `$${etfNotional.toLocaleString()} in ANS/ANDD (-2x)`, notional: etfNotional };
    }
    return { sh: rawSh, label: `${rawSh} sh Short`, notional: Math.round(rawSh * entryPx) };
  };

  // --------------------------------------------------------------------------
  // 0. MANDATORY CUTOFFS: 3:55 PM ET Daily Flat OR Day-5 Wed Nov 25 Noon Chop Cutoff
  // --------------------------------------------------------------------------
  if (isNasdaqLive && dayNum === 5 && etHour >= 12.0) {
    return {
      tone: "amber",
      tag: "🦃 DAY 5 PRE-THANKSGIVING NOON CUTOFF (12:00 PM ET)",
      evText: "Holiday Liquidity Protection",
      headline: "Stand Down & Flatten — Pre-Thanksgiving Afternoon Is Low-Volume Chop",
      why: "Wednesday Nov 25 afternoon liquidity dries up ahead of Thursday's Thanksgiving market closure, turning price action into erratic low-volume chop rather than a clean trend.",
      recommendedSide: "FLAT",
      tranches: [
        { step: "Open Positions", badge: "FLATTEN", main: "Close Remaining Shares Now", desc: "Lock in Week-1 gains before holiday illiquidity sets in.", highlight: true },
        { step: "New Afternoon Trades", badge: "0 SHARES", main: "Desk Closed for Holiday", desc: "Avoid forcing low-liquidity afternoon fades.", highlight: false },
        { step: "Overnight Exposure", badge: "$0 RISK", main: "100% Cash Into Thanksgiving", desc: "Zero 3.5-day holiday gap risk.", stop: true },
        { step: "Review", badge: "WEEK 1 DONE", main: "Wait for Post-Holiday Volume", desc: "Friday Nov 27 is a 1:00 PM ET half-day.", target: true },
      ],
      activeStratId: "FLAT",
    };
  }

  if (isNasdaqLive && etHour >= 15.91 && etHour <= 16.25) {
    return {
      tone: "amber",
      tag: "⏰ 3:55 PM ET ZERO-OVERNIGHT BELL",
      evText: "Strict 0% Overnight Hold",
      headline: "Flatten All Intraday Positions Before 4:00 PM ET Close",
      why: "Eliminate overnight gap risk in a VIX ~25 tape. Friday (Day 2 T+1 settlement) and Monday (Day 3 Options Listing) will give clean reference levels without overnight exposure.",
      recommendedSide: "FLAT",
      tranches: [
        { step: "Immediate Action", badge: "NOW", main: "Exit 100% of Open Shares", desc: "Close before 4:00 PM closing cross.", highlight: true },
        { step: "New Entries", badge: "LOCKED", main: "No Entries After 3:55 PM", desc: "Never carry IPO inventory overnight.", highlight: false },
        { step: "Overnight Risk", badge: "$0", main: "100% Cash Overnight", desc: "Avoids Day-2 9:30 AM retail gap-fade trap.", stop: true },
        { step: "Next Session Prep", badge: `DAY ${dayNum + 1}`, main: `Mark $${high.toFixed(2)} HOD & $${or15Low.toFixed(2)} ORL`, desc: "Real reference levels unlock higher-EV Day 2–3 trades.", target: true },
      ],
      activeStratId: "FLAT",
    };
  }

  // --------------------------------------------------------------------------
  // 1. PRE-CROSS STANDBY (IPO EVE / WAITING FOR NASDAQ PRINT ~11:00a–12:00p ET)
  // --------------------------------------------------------------------------
  if (!isNasdaqLive || dayNum === 0) {
    const laneNum = noop <= 92.0 ? 1 : (noop <= OVERHEATED_PRICE ? 2 : 3);
    if (laneNum <= 2) {
      const stopPx = laneNum === 1 ? +Math.max(82.75, noop * 0.965).toFixed(2) : +(noop * 0.965).toFixed(2);
      const totalSh = calcLongShares(noop, stopPx);
      const t1Px = +(noop * 1.06).toFixed(2);
      return {
        tone: laneNum === 1 ? "green" : "blue",
        tag: laneNum === 1
          ? "💎 PRE-CROSS • LANE 1 COLD CROSS ($83–$92 • BEST R/R)"
          : "🔵 PRE-CROSS • LANE 2 SWEET-SPOT ($92–$111.50 • HANDS OFF FIRST 15M)",
        evText: laneNum === 1 ? "Mega-Deal Lane 1 EV: +7.75% (SPCX/ARM)" : "Mega-Deal Lane 2 EV: +4.36% (PF 6.40 • +6% T1)",
        headline: laneNum === 1
          ? `Implied Open ~$${noop.toFixed(2)} Near $83 Wall — Stalk Patient 15m ORH Long`
          : `Implied Open ~$${noop.toFixed(2)} (+${crossPop.toFixed(1)}% / +${range78Pop.toFixed(0)}% vs $78) — Wait 15m Post-Cross, Trade ORH vs ORL`,
        why: laneNum === 1
          ? `Backed by a $12.2B Reg-M greenshoe wall at $83.00! Let retail flippers clear for 10–15m after cross (~11:00a–12:00p ET), then buy a confirmed 15m ORH break. Zero shorts.`
          : `At an $81.3B mega-float (980M shares, ~$16B retail), DO NOT buy blind dips in the first 15 minutes and DO NOT hold out for +20%! Wait 15m to mark ORH/ORL/VWAP, then take +5% to +7% (+6% T1 = $${t1Px}) on a confirmed ORH break.`,
        recommendedSide: "LONG",
        tranches: [
          { step: "Step 0 • First 15 Mins", badge: "HANDS OFF", main: "0 Shares During First 15m", desc: "Let ~$16B retail flippers & institutional market orders establish 15m ORH, ORL & VWAP.", highlight: true },
          { step: "Leg 1 & 2 • 15m ORH Break", badge: `${totalSh} sh VIX-adj`, main: `Buy > 15m ORH (~$${(noop * 1.012).toFixed(2)})`, desc: `50% (${Math.ceil(totalSh / 2)} sh) on 15m ORH break + 50% (${Math.floor(totalSh / 2)} sh) on VWAP hold (requires QQQ > VWAP).`, highlight: false },
          { step: "Anti-Whipsaw Stop", badge: `-$${effRisk}`, main: `Stop < 15m ORL (~$${stopPx.toFixed(2)})`, desc: hasCleanShort ? "If 15m candle closes < ORL & fails VWAP retest, evaluate Short." : "Hard exit only (No Short Borrow selected — do not force shorts!).", stop: true },
          { step: "Mega-Cap Scale Targets", badge: "+6% T1", main: `50% @ $${t1Px.toFixed(2)} (+6%) • Trail VWAP`, desc: `Pay yourself early at +6% (SPCX Day-1 closed +7.3%, SKHY -1.2%), lock BE, trail rest to 1:30 PM.`, target: true },
        ],
        activeStratId: laneNum === 1 ? "LANE1" : "LANE2",
      };
    } else {
      // Pre-Cross Lane 3 (> $111.50 / > +34.3%)
      const shInfo = calcShortSizeDesc(noop * 0.98, noop * 1.02);
      return {
        tone: "amber",
        tag: "🔥 PRE-CROSS • LANE 3 EUPHORIC (> $111.50 / > +35% / > $2.0T)",
        evText: hasCleanShort ? "Afternoon Exhaustion Fade Mode" : "Stand-Down / Cash Mode (No Short Borrow)",
        headline: `Implied Open $${noop.toFixed(2)} (+${crossPop.toFixed(1)}% vs $83 / +${range78Pop.toFixed(0)}% vs $78) Is Overheated — Zero Morning Longs`,
        why: `GS/MS already hiked the offer +$5 above range and added 155M shares. Opening above $111.50 ($2.01T+) in a VIX ~25 tape leaves zero institutional margin of safety. Stand down on morning longs completely.`,
        recommendedSide: hasCleanShort ? "SHORT" : "FLAT",
        tranches: [
          { step: "Morning Longs", badge: "FORBIDDEN", main: "0 Long Shares Above $111.50", desc: "Avoids CBRS ($350→$300) & CHYM blow-off bull traps.", highlight: true },
          { step: "Short Trigger", badge: shInfo.label, main: hasCleanShort ? "Wait for Red 15m/30m < VWAP" : "Stand Down (No Clean Borrow)", desc: hasCleanShort ? "Short only after first blow-off push fails & closes 15m/30m below VWAP." : "Select ANS/ANDD ETF or HTB Borrow above only if verified.", highlight: false },
          { step: "Hard Stop", badge: hasCleanShort ? `-$${effRisk}` : "$0", main: `HOD × 1.005 (Max -4.5%)`, desc: "Never fight a runaway squeeze without a closed red candle.", stop: true },
          { step: "Greenshoe Buffer", badge: "Cover ≥$88", main: "Target VWAP / $90 • Floor $85", desc: "Cover well above Goldman/MS's $83.00 Reg-M wall.", target: true },
        ],
        activeStratId: "LANE3",
      };
    }
  }

  // --------------------------------------------------------------------------
  // 2. DAYS 2–5: FIRST-WEEK PLAYBOOK (CORRECTED OPTIONS & T+1 CALENDAR)
  // --------------------------------------------------------------------------
  if (dayNum >= 2) {
    if (dayNum === 4) {
      // Tuesday Nov 24 (Day 4): Post-Day-3 Options Gamma Unwind (SPCX D4 -8.6% analog)
      const stopPx = +(price * 1.04).toFixed(2);
      const shInfo = calcShortSizeDesc(price, stopPx);
      return {
        tone: hasCleanShort ? "purple" : "amber",
        tag: "🟣 DAY 4 (TUE NOV 24) • W3 POST-OPTIONS GAMMA UNWIND",
        evText: "Tier-1 Day-4 Unwind EV: +4.63% (WR 75.0%, PF 5.31)",
        headline: hasCleanShort
          ? "Post-Day-3 Options Peak — Leg Into W3 Intraday Unwind on VWAP Failure"
          : "Post-Options Digestion Window — Stay Flat Unless Clean Short / Put Access",
        why: "Just like SpaceX (whose options listed Day 3, fueling a $225.64 gamma blow-off before dropping -8.6% on Day 4), Day 4 unwinds Monday's dealer call-gamma hedges.",
        recommendedSide: hasCleanShort ? "SHORT" : "FLAT",
        tranches: [
          { step: "Leg 1 • VWAP Loss", badge: shInfo.label, main: hasCleanShort ? `Short < $${vwap.toFixed(2)} VWAP (or Day-4 Puts)` : "Stand Down / Buy Listed Puts Only", desc: "Listed ANT options are now live (since Mon Day 3) — defined-risk puts available!", highlight: true },
          { step: "Leg 2 • Lower High", badge: "50% Add", main: `Add on Failed Retest of $${vwap.toFixed(2)}`, desc: "Confirm lower high below Day-3 blow-off wick.", highlight: false },
          { step: "Hard Stop", badge: `-$${effRisk}`, main: `Stop @ $${stopPx.toFixed(2)} (-4.0%)`, desc: "Exit if bulls reclaim morning ORH.", stop: true },
          { step: "Targets", badge: "Flat 3:55 PM", main: `50% @ $${(price * 0.94).toFixed(2)} (-6%) • 50% @ 3:55 PM`, desc: "Flatten before Wed pre-Thanksgiving session.", target: true },
        ],
        activeStratId: "W3",
      };
    }

    if (d1Broken && dayNum === 2) {
      // Friday Nov 20 (Day 2): T+1 Settlement Complete -> Clean Stock Borrow + Real D1 Levels!
      const stopPx = +(price * 1.04).toFixed(2);
      const shInfo = calcShortSizeDesc(price, stopPx);
      return {
        tone: hasCleanShort ? "red" : "amber",
        tag: "🔴 DAY 2 (FRI NOV 20 • T+1 SETTLED) • W2 OVERHEAD SUPPLY SHORT",
        evText: "Tier-1 EV: +3.16% (WR 80.0%, PF 4.63)",
        headline: hasCleanShort
          ? "T+1 Borrow Unlocked & D1 Broken — Short Failed Bounce Below Day-1 VWAP"
          : "Day 1 Closed Weak — Avoid Longs (Verify T+1 Borrow or ANS ETF to Short)",
        why: "Friday T+1 settlement unlocks institutional stock borrow while $81.3B of Day-1 buyers sit trapped overhead (CBRS +5.7%, KLAR +5.6%, QNT +5.6%).",
        recommendedSide: hasCleanShort ? "SHORT" : "FLAT",
        tranches: [
          { step: "Leg 1 • Failed Bounce", badge: shInfo.label, main: hasCleanShort ? `Short Rejection < $${vwap.toFixed(2)}` : "Stay Flat (Protect Capital)", desc: "Wait for 15m morning bounce to fail below Day-1 Close.", highlight: true },
          { step: "Leg 2 • 15m ORL Break", badge: "50% Add", main: `Add < $${or15Low.toFixed(2)} ORL`, desc: "Confirm breakdown on volume.", highlight: false },
          { step: "Hard Stop", badge: `-$${effRisk}`, main: `Stop @ $${stopPx.toFixed(2)} (-4.0%)`, desc: "Cover above morning ORH.", stop: true },
          { step: "Targets", badge: "Flat 3:55 PM", main: `50% @ $${(price * 0.94).toFixed(2)} • Floor $85`, desc: "Cover well above $83 greenshoe wall; flat 3:55 PM.", target: true },
        ],
        activeStratId: "W2",
      };
    }

    // Day 2 (Fri T+1 Clean Reference Levels) OR Day 3 (Mon Nov 23 Earliest Options Listing Gamma Breakout!)
    const trigPx = +(priorHigh * 1.005).toFixed(2);
    const stopPx = +(trigPx * 0.965).toFixed(2);
    const totalSh = calcLongShares(trigPx, stopPx);
    const brokeOut = price >= trigPx && qqqState !== "BREAKING_LOWS";
    const isDay3Opts = dayNum === 3;

    return {
      tone: qqqState === "BREAKING_LOWS" ? "amber" : (brokeOut ? "green" : "blue"),
      tag: isDay3Opts
        ? "⚡ DAY 3 (MON NOV 23 • OPTIONS LISTING DAY!) • W1 GAMMA / COILED BREAKOUT"
        : "🔵 DAY 2 (FRI NOV 20 • T+1 CLEAN LEVELS) • W1 PRIOR-HIGH BREAKOUT",
      evText: "Tier-1 EV: +9.23% (7/7 = 100% Historical WR: SPCX D2/D3, CRWV D3, RDDT D3)",
      headline: qqqState === "BREAKING_LOWS"
        ? "QQQ Breaking Intraday Lows — Hold Off on Longs Until Macro Stabilizes"
        : (brokeOut
          ? `Cleared Prior High ($${priorHigh.toFixed(2)})! Leg Into ${isDay3Opts ? "Day-3 Options Gamma" : "Day-2"} Breakout`
          : `Cleaner Than Day-1 Chaos: Wait for Break Above $${trigPx.toFixed(2)} (Skip 9:30 AM Trap)`),
      why: isDay3Opts
        ? `Monday Nov 23 is ANT's earliest exchange options listing day—the exact catalyst that drove SpaceX's Day-3 surge to $225.64 and CoreWeave's +36.5% Day-3 breakout! Take profits into afternoon call-wall stalls.`
        : `75% of strong Day-1 IPOs fade at the Day-2 9:30 AM open. Let morning sellers clear and only leg in if ANT breaks +0.5% above Thursday's high ($${trigPx.toFixed(2)}).`,
      recommendedSide: "LONG",
      tranches: [
        { step: "Leg 1 • Prior High +0.5%", badge: `${Math.ceil(totalSh / 2)} sh`, main: `Buy Stop @ $${trigPx.toFixed(2)}`, desc: `Requires QQQ holding above intraday lows (${qqqState.replace(/_/g, " ")}).`, highlight: brokeOut },
        { step: "Leg 2 • 5m Hold Add", badge: `${Math.floor(totalSh / 2)} sh`, main: `Add @ $${(trigPx * 1.008).toFixed(2)}`, desc: "Add on confirmed hold above prior day's HOD.", highlight: false },
        { step: "Hard Stop", badge: `-$${effRisk}`, main: `Stop @ $${stopPx.toFixed(2)} (-3.5%)`, desc: "Immediate exit if breakout fails back into range.", stop: true },
        { step: "Scale Targets", badge: "+6.5% / +10%", main: `50% @ $${(trigPx * 1.065).toFixed(2)} • Trail VWAP`, desc: isDay3Opts ? "Watch for afternoon gamma blow-off top (SPCX Day-3 pattern); flat 3:55 PM!" : "Trail runner along VWAP to 3:55 PM ET.", target: true },
      ],
      activeStratId: "W1",
    };
  }

  // --------------------------------------------------------------------------
  // 3. DAY 1 LIVE TRADING (THU NOV 19, 2026) — ANTI-WHIPSAW + 3-LANE RULES
  // --------------------------------------------------------------------------

  // GUARDRAIL A: MANDATORY FIRST 15-MINUTE HANDS-OFF COOLING WINDOW!
  if (!or15Complete || minsSinceCross < 15) {
    const minsLeft = Math.max(1, 15 - minsSinceCross);
    return {
      tone: "amber",
      tag: `🛑 FIRST 15-MIN HANDS-OFF LOCKOUT (${minsLeft}m REMAINING)`,
      evText: "Anti-Whipsaw Protection Active",
      headline: `Hands Off the Trigger for ${minsLeft} More Min — Let 15m ORH ($${or15High.toFixed(2)}) & ORL ($${or15Low.toFixed(2)}) Form`,
      why: `~$16B of retail allocations (Robinhood/SoFi/Schwab) and $81.3B of institutional cross orders are colliding right now. Buying blind dips or flipping on raw wicks in the first 15m causes double-whipsaws. Mark ORH, ORL, and VWAP ($${vwap.toFixed(2)}) first!`,
      recommendedSide: "FLAT",
      tranches: [
        { step: "Current Action", badge: `WAIT ${minsLeft}M`, main: "0 Shares — Observe Tape Only", desc: `Cross printed $${noop.toFixed(2)} (${crossPop >= 0 ? "+" : ""}${crossPop.toFixed(1)}%). Let initial volatility settle.`, highlight: true },
        { step: "Developing 15m ORH", badge: "BULL LEVEL", main: `Tracking ORH: $${or15High.toFixed(2)}`, desc: noop <= OVERHEATED_PRICE ? "Will become our Long breakout trigger once 15m completes." : "Overheated cross (>$111.50) — no morning longs even above ORH!", highlight: false },
        { step: "Developing 15m ORL", badge: "BEAR LEVEL", main: `Tracking ORL: $${or15Low.toFixed(2)}`, desc: "Only a confirmed 15m candle close below ORL & NOOP triggers exit/short.", stop: true },
        { step: "Live VWAP & QQQ", badge: qqqState === "BULLISH_ABOVE_VWAP" ? "QQQ OK" : "QQQ WARN", main: `ANT VWAP $${vwap.toFixed(2)}`, desc: `QQQ state: ${qqqState.replace(/_/g, " ")}.`, target: true },
      ],
      activeStratId: "LOCKOUT",
    };
  }

  // LANE 3: EUPHORIC CROSS (> $111.50 | > +34.3% vs $83 / > +43% vs $78 / > $2.0T)
  if (noop > OVERHEATED_PRICE) {
    const stopPx = +Math.min(price * 1.045, high * 1.005).toFixed(2);
    const shInfo = calcShortSizeDesc(price, stopPx);
    return {
      tone: confirmedRed15mVwap && hasCleanShort ? "purple" : "amber",
      tag: "🔥 LANE 3 EUPHORIC CROSS (> $111.50 / > +35% / > $2.0T)",
      evText: hasCleanShort ? "Wait for Red 15m/30m < VWAP" : "Zero Morning Longs • Cash Preservation",
      headline: confirmedRed15mVwap
        ? (hasCleanShort ? `Blow-Off Failed Below VWAP ($${vwap.toFixed(2)}) — Leg Into Exhaustion Short` : "Blow-Off Failing Below VWAP — Stay Flat (No Clean Short Selected)")
        : `Euphoric Valuation ($${noop.toFixed(2)} NOOP) — Zero Morning Longs, Wait for First Push to Fail`,
      why: `Above $111.50 (+43%+ above original $78 range top), ANT exceeds $2.0T on Day 1. Stand down on all morning longs; only fade once a 15m/30m red candle closes below VWAP ($${vwap.toFixed(2)}) AND you have clean borrow/ETF execution.`,
      recommendedSide: (confirmedRed15mVwap && hasCleanShort) ? "SHORT" : "FLAT",
      tranches: [
        { step: "Morning Longs", badge: "BLOCKED", main: "0 Long Shares (> $111.50)", desc: "Protects against CBRS ($350→$300) valuation compression.", highlight: !confirmedRed15mVwap },
        { step: "Short Entry (If Armed)", badge: shInfo.label, main: confirmedRed15mVwap && hasCleanShort ? `Short @ $${price.toFixed(2)} (< VWAP)` : `Wait for 15m Close < $${vwap.toFixed(2)}`, desc: hasCleanShort ? "Scale 50% on red close < VWAP, 50% on lower-high retest." : "No borrow selected — stay safely in cash!", highlight: confirmedRed15mVwap && hasCleanShort },
        { step: "Hard Stop", badge: hasCleanShort ? `-$${effRisk}` : "$0", main: `Stop @ $${stopPx.toFixed(2)} (Above HOD)`, desc: "Strict invalidation if new HOD prints.", stop: true },
        { step: "Targets & Floor", badge: "Floor $85", main: `50% @ $${Math.max(88, +(price * 0.94).toFixed(2))} • Flat 3:55 PM`, desc: "Cover well above $83–$85 Reg-M greenshoe wall.", target: true },
      ],
      activeStratId: "LANE3",
    };
  }

  // LANE 2 AIR-POCKET PATH: Confirmed 15m Break & Failed VWAP Retest Below ORL & NOOP (when NOOP >= $93)
  if (noop > 92.0 && (confirmed15mBreakOrl || (price < or15Low && price < noop && price < vwap))) {
    const stopPx = +Math.max(or15Low * 1.01, vwap * 1.005).toFixed(2);
    const shInfo = calcShortSizeDesc(price, stopPx);
    return {
      tone: "red",
      tag: hasCleanShort
        ? "🔻 CONFIRMED 15M ORL BREAKDOWN • AIR-POCKET SHORT ARMED"
        : "🛑 CONFIRMED 15M ORL BREAKDOWN • KILL ALL LONGS / STAND DOWN",
      evText: hasCleanShort ? "Tier-1 Confirmed Breakdown EV: +4.39% (PF 48.8)" : "Capital Saved • Do Not Force Unlocated Shorts",
      headline: hasCleanShort
        ? `Lost NOOP & 15m ORL ($${or15Low.toFixed(2)}) — Exit Longs & Leg Into Short Toward $88–$90`
        : `Lost NOOP & 15m ORL ($${or15Low.toFixed(2)}) — Kill All Longs & Stay in Cash`,
      why: `ANT broke below both NOOP ($${noop.toFixed(2)}) and its 15m ORL ($${or15Low.toFixed(2)}) below VWAP ($${vwap.toFixed(2)})—the KLAR/SKHY air-pocket path. Goldman/MS's $12.2B greenshoe bid sits down at $83.00, not up here.`,
      recommendedSide: hasCleanShort ? "SHORT" : "FLAT",
      tranches: [
        { step: "Long Inventory", badge: "KILL LONGS", main: "0 Long Shares Below ORL", desc: "Never hold underwater IPO longs below NOOP & 15m ORL.", highlight: !hasCleanShort },
        { step: "Short Entry (VWAP Reject)", badge: shInfo.label, main: hasCleanShort ? `Short Failed Retest ≤ $${or15Low.toFixed(2)}` : "Stand Down (No Clean Borrow)", desc: hasCleanShort ? "Enter on confirmed 15m close / failed retest below ORL & VWAP." : "Wait for Friday T+1 borrow or Monday options rather than forcing bad fills.", highlight: hasCleanShort },
        { step: "Hard Stop", badge: hasCleanShort ? `-$${effRisk}` : "$0", main: `Stop > $${stopPx.toFixed(2)} (VWAP Reclaim)`, desc: "Cover immediately if price reclaims VWAP & ORL.", stop: true },
        { step: "Target & $85 Buffer", badge: "Cover $88–$90", main: "Target $88.00–$90.00 • Hard Floor $85.00", desc: "Take profits BEFORE the $83–$85 Reg-M greenshoe wall!", target: true },
      ],
      activeStratId: "D1_SHORT",
    };
  }

  // AFTERNOON EXHAUSTION CHECK (1:30 PM+ ET after morning pop >= +6.5%)
  const extPct = ((high / noop) - 1) * 100;
  if (etHour >= 13.5 && extPct >= 6.0 && (confirmedRed15mVwap || price < vwap)) {
    const stopPx = +Math.min(price * 1.04, high * 1.005).toFixed(2);
    const shInfo = calcShortSizeDesc(price, stopPx);
    return {
      tone: "purple",
      tag: "🟣 1:30 PM+ AFTERNOON EXHAUSTION • LOCK LONGS / FADE BELOW VWAP",
      evText: "69.2% of Hyped IPOs Fade Post-1:30 PM (SPCX -8.6% PM Fade)",
      headline: hasCleanShort
        ? `Morning Drive Stalled Below VWAP ($${vwap.toFixed(2)}) — Harvest Longs & Fade Toward NOOP`
        : `Morning Drive Stalled Below VWAP ($${vwap.toFixed(2)}) — Lock Remaining Long Profits Now`,
      why: `Even SpaceX faded from $172.28 (1:30 PM) to $157.44 (3:30 PM) on Day 1. Protect morning gains once price slips under intraday VWAP ($${vwap.toFixed(2)}).`,
      recommendedSide: hasCleanShort ? "SHORT" : "FLAT",
      tranches: [
        { step: "Morning Longs", badge: "TAKE PROFIT", main: "Close Trailing Long Runner", desc: "VWAP trail triggered — bank morning profits.", highlight: !hasCleanShort },
        { step: "PM Short (Optional)", badge: shInfo.label, main: hasCleanShort ? `Short < $${vwap.toFixed(2)} VWAP` : "Stay Flat Into Close", desc: hasCleanShort ? "Light afternoon mean-reversion fade only." : "Job done for Day 1 — prep for Friday Day 2!", highlight: hasCleanShort },
        { step: "Hard Stop", badge: hasCleanShort ? `-$${effRisk}` : "$0", main: `Stop @ $${stopPx.toFixed(2)}`, desc: "Above afternoon lower-high / HOD.", stop: true },
        { step: "Time Exit", badge: "3:55 PM ET", main: `Cover @ $${Math.max(86, noop).toFixed(2)} or 3:55 PM`, desc: "Zero overnight positions.", target: true },
      ],
      activeStratId: "PM_FADE",
    };
  }

  // MACRO QQQ INTRADAY LOWS VETO ON LONGS!
  if (qqqState === "BREAKING_LOWS") {
    return {
      tone: "amber",
      tag: "⚠️ MACRO TAPE VETO • QQQ BREAKING INTRADAY LOWS",
      evText: "QQQ VWAP Filter Active",
      headline: "Pause New ANT Longs — QQQ Is Breaking Session Lows in a VIX-25 Tape",
      why: "With S&P coming off a 5-day losing streak and 10Y yields near 5.07%, do not step in front of broad Nasdaq index liquidation. Wait for QQQ to reclaim/stabilize before buying ANT's ORH break.",
      recommendedSide: "FLAT",
      tranches: [
        { step: "New Long Entries", badge: "PAUSED", main: "Wait for QQQ Stabilization", desc: "QQQ breaking intraday lows vetoes new long legs.", highlight: true },
        { step: "If Already Long", badge: "TIGHTEN", main: `Raise Stop to $${Math.max(or15Low, vwap * 0.99).toFixed(2)}`, desc: "Do not hold ANT longs if both QQQ & ANT lose VWAP.", stop: true },
        { step: "ANT Key Bull Trigger", badge: `ORH $${or15High.toFixed(2)}`, main: "Re-Arm Once QQQ Stabilizes", desc: "Relative strength during a QQQ dip = coiled spring once QQQ bounces!", highlight: false },
        { step: "Target Once Re-Armed", badge: "+6% T1", main: `$${(or15High * 1.06).toFixed(2)} Scale-Out`, desc: "Keep targets disciplined at +5% to +7%.", target: true },
      ],
      activeStratId: "MACRO_VETO",
    };
  }

  // LANE 1 ($83–$92 Cold Cross) OR LANE 2 ($92–$111.50 Sweet-Spot Cross) BULL PATH!
  const isLane1 = noop <= 92.0;
  const entryRef = Math.max(price, or15High);
  const stopPx = isLane1 ? +Math.max(82.75, or15Low - 0.25, entryRef * 0.965).toFixed(2) : +Math.max(or15Low - 0.20, entryRef * 0.965).toFixed(2);
  const totalSh = calcLongShares(entryRef, stopPx);
  const leg1Sh = Math.ceil(totalSh / 2);
  const leg2Sh = Math.floor(totalSh / 2);
  const t1Px = +(entryRef * 1.06).toFixed(2); // Calibrated +6.0% (+5% to +7% band)!
  const t2Px = +(entryRef * 1.10).toFixed(2);

  const clearedOrh = price >= or15High && price >= vwap;
  const overExtended = price >= noop * 1.055; // Already up +5.5%+ -> harvest, don't chase!

  if (overExtended) {
    return {
      tone: "green",
      tag: "💰 +6% MEGA-CAP TARGET ZONE REACHED • PAY YOURSELF EARLY!",
      evText: "Calibrated for $81.3B Mega-Float (SPCX Day-1 Closed +7.3%)",
      headline: `ANT Hit $${price.toFixed(2)} (+${((price / noop - 1) * 100).toFixed(1)}% vs NOOP) — Lock 50% Profit Now & Trail VWAP!`,
      why: `On an $81.3B float in a VIX-25 market, +5% to +7% IS the meat of the Day-1 move (don't wait for $1B-float +20% fantasies). Sell 50% here, lock your stop at breakeven, and trail the rest on VWAP ($${vwap.toFixed(2)}).`,
      recommendedSide: "LONG",
      tranches: [
        { step: "New Long Chases", badge: "DO NOT CHASE", main: "Too Extended Above ORH", desc: "Wait for a VWAP test if flat; never buy +6% extensions on a $1.8T cap.", highlight: false },
        { step: "Target 1 Harvest", badge: "SELL 50% NOW", main: `Take 50% Profit @ $${price.toFixed(2)}`, desc: "Banks core profit into morning institutional demand.", highlight: true },
        { step: "Risk-Free Stop", badge: "$0 RISK", main: "Move Stop → Breakeven / VWAP", desc: `Trail runner stop along intraday VWAP ($${vwap.toFixed(2)}).`, stop: true },
        { step: "Runner Exit", badge: "1:30 PM ET", main: `Exit Rest @ $${t2Px} or 1:30 PM`, desc: "Step off before afternoon exhaustion window.", target: true },
      ],
      activeStratId: isLane1 ? "LANE1" : "LANE2",
    };
  }

  return {
    tone: clearedOrh ? "green" : "blue",
    tag: isLane1
      ? (clearedOrh ? "💎 LANE 1 COLD CROSS • 15M ORH CONFIRMED — LEG IN LONG!" : "💎 LANE 1 COLD CROSS ($83 WALL) • WAIT FOR 15M ORH BREAK")
      : (clearedOrh ? "🚀 LANE 2 SWEET-SPOT • 15M ORH & VWAP CONFIRMED — LEG IN LONG!" : "🔵 LANE 2 SWEET-SPOT • CONSOLIDATING — AWAIT 15M ORH BREAK"),
    evText: isLane1 ? "Best R/R Setup • Protected by $12.2B Greenshoe @ $83" : "Mega-Deal EV +4.36% (PF 6.40) • Pay Yourself @ +5%–+7%",
    headline: clearedOrh
      ? `15m ORH ($${or15High.toFixed(2)}) & VWAP ($${vwap.toFixed(2)}) Cleared — Leg Into Long (${totalSh} VIX-Adj Shares)`
      : `15m Range Set ($${or15Low.toFixed(2)} – $${or15High.toFixed(2)}) — Buy Confirmed Break > $${or15High.toFixed(2)}`,
    why: isLane1
      ? `Cold cross ($${noop.toFixed(2)}) gives asymmetric protection right above Goldman/MS's $83.00 greenshoe wall. Zero shorts in Lane 1.`
      : `15m cooling period is complete and ANT is holding above ORL ($${or15Low.toFixed(2)}). Require price > 15m ORH ($${or15High.toFixed(2)}) & VWAP ($${vwap.toFixed(2)}), then pay yourself early at +6% ($${t1Px.toFixed(2)}).`,
    recommendedSide: "LONG",
    tranches: [
      { step: "Leg 1 • 15m ORH Break (50%)", badge: `${leg1Sh} sh`, main: `Buy > $${or15High.toFixed(2)} ORH`, desc: `${leg1Sh} sh ($${Math.round(leg1Sh * entryRef).toLocaleString()}) once price holds > VWAP ($${vwap.toFixed(2)}).`, highlight: clearedOrh },
      { step: "Leg 2 • VWAP / ORH Retest (50%)", badge: `${leg2Sh} sh`, main: `Add @ $${vwap.toFixed(2)} – $${or15High.toFixed(2)}`, desc: `Add ${leg2Sh} sh on constructive higher-low hold above VWAP.`, highlight: false },
      { step: "Structure Stop (Below ORL)", badge: `-$${effRisk}`, main: `Stop @ $${stopPx.toFixed(2)}`, desc: isLane1 ? "Tightly protected by $83.00 Reg-M wall; zero shorts." : "Hard exit below 15m ORL; no raw tick-flip whipsaws!", stop: true },
      { step: "Calibrated Mega-Cap Targets", badge: "+6% Early Pay", main: `50% @ $${t1Px.toFixed(2)} (+6%) • Trail VWAP`, desc: `Lock +6% early, raise stop to BE, trail runner into $${t2Px.toFixed(2)} / 1:30 PM.`, target: true },
    ],
    activeStratId: isLane1 ? "LANE1" : "LANE2",
  };
}

// ============================================================================
// Position Tracker Actions
// ============================================================================
function logLeg() {
  const ctx = getEffectiveContext();
  const rec = computeLegInRecommendation(ctx);
  if (!rec.recommendedSide || rec.recommendedSide === "FLAT") return;

  const effRisk = getEffectiveRiskUsd();
  const stopDist = Math.max(0.30, ctx.noop * 0.035);
  const halfShares = Math.max(1, Math.round((effRisk / stopDist) / 2));
  const fillPx = ctx.price;

  if (!position.side || position.side !== rec.recommendedSide || position.shares === 0) {
    position = { side: rec.recommendedSide, shares: halfShares, avgEntry: fillPx, scaledT1: false, legsCount: 1 };
  } else {
    const newTotal = position.shares + halfShares;
    position.avgEntry = +(((position.shares * position.avgEntry) + (halfShares * fillPx)) / newTotal).toFixed(2);
    position.shares = newTotal;
    position.legsCount = Math.min(2, position.legsCount + 1);
  }
  savePosition();
  renderAll();
}

function logScaleT1() {
  if (!position.side || position.shares <= 0) return;
  position.shares = Math.max(1, Math.floor(position.shares / 2));
  position.scaledT1 = true;
  savePosition();
  renderAll();
}

function resetPosition() {
  position = { side: null, shares: 0, avgEntry: 0, scaledT1: false, legsCount: 0 };
  savePosition();
  renderAll();
}

// ============================================================================
// UI Rendering
// ============================================================================
function renderAll() {
  const ctx = getEffectiveContext();
  const rec = computeLegInRecommendation(ctx);
  const hl = liveData?.hyperliquid || {};
  const mac = liveData?.macro || {};
  const nasdaq = liveData?.nasdaq_ant || {};
  const etfs = liveData?.ant_etfs || {};

  document.getElementById("clockDisplay").textContent = liveData?.et_time_str || "--:--:-- EST";
  document.getElementById("feedStatusText").textContent = activeScenario === "live"
    ? (nasdaq.is_live ? "LIVE: Nasdaq ANT + 15m OR + QQQ VWAP" : "LIVE: 24/7 Perp (xyz:ANT) + Macro • Auto-Polling Nasdaq Cross")
    : `REHEARSAL: ${SCENARIOS[activeScenario]?.label || "Custom"}`;

  // Topbar Quote Pills
  if (nasdaq.is_live) {
    document.getElementById("nasdaqPrice").textContent = `$${nasdaq.spot_price.toFixed(2)}`;
    document.getElementById("nasdaqSub").textContent = nasdaq.or15_complete
      ? `15m OR: $${nasdaq.or15_low.toFixed(2)}–$${nasdaq.or15_high.toFixed(2)}`
      : `Cooling (${nasdaq.minutes_since_cross}/15m) • NOOP $${nasdaq.noop.toFixed(2)}`;
  } else {
    document.getElementById("nasdaqPrice").textContent = activeScenario === "live" ? "Awaiting Cross" : `$${ctx.price.toFixed(2)} (Sim)`;
    document.getElementById("nasdaqSub").textContent = activeScenario === "live"
      ? "Thu Nov 19 (~11:00a–12:00p ET)"
      : `Sim 15m OR: $${ctx.or15Low.toFixed(2)}–$${ctx.or15High.toFixed(2)}`;
  }

  if (hl.perp_mid) {
    document.getElementById("perpPrice").textContent = `$${hl.perp_mid.toFixed(2)}`;
    const basisTxt = hl.perp_vs_spot_basis_bps != null ? ` • Basis ${hl.perp_vs_spot_basis_bps > 0 ? "+" : ""}${hl.perp_vs_spot_basis_bps}bp` : "";
    document.getElementById("perpSub").textContent = `$${(hl.best_bid || hl.perp_mid).toFixed(2)} / $${(hl.best_ask || hl.perp_mid).toFixed(2)}${basisTxt}`;
  }

  const refPx = ctx.price;
  const impliedVal = BASE_VAL_T * (refPx / OFFER_PRICE);
  const pop83 = ((refPx / OFFER_PRICE) - 1) * 100;
  const pop78 = ((refPx / ORIG_RANGE_TOP) - 1) * 100;
  document.getElementById("valDisplay").textContent = `$${impliedVal.toFixed(2)}T`;
  document.getElementById("popFromOffer").innerHTML =
    `<span class="${pop83 >= 0 ? "text-green" : "text-red"}">${pop83 >= 0 ? "+" : ""}${pop83.toFixed(1)}%</span> vs $83 • <strong>+${pop78.toFixed(0)}%</strong> vs $78`;

  // Macro & QQQ VWAP Pill
  const vixTxt = mac.VIX ? `VIX ${mac.VIX.toFixed(2)}` : "VIX --";
  const tnxTxt = mac.TNX_10Y ? ` • 10Y ${mac.TNX_10Y.toFixed(2)}%` : "";
  document.getElementById("vixDisplay").textContent = `${vixTxt}${tnxTxt}`;

  const qIcon = ctx.qqqState === "BULLISH_ABOVE_VWAP" ? "🟢 QQQ > VWAP" : (ctx.qqqState === "BREAKING_LOWS" ? "🔴 QQQ < LOD" : "🟡 QQQ < VWAP");
  const qPxTxt = mac.QQQ ? ` ($${mac.QQQ})` : "";
  document.getElementById("macroSub").textContent = `${qIcon}${qPxTxt}`;

  // Short ETF & Basis Info Strip
  const ansTxt = etfs.ANS ? `$${etfs.ANS}` : "Awaiting Listing";
  const anddTxt = etfs.ANDD ? `$${etfs.ANDD}` : "Awaiting Listing";
  const basisWarn = hl.perp_vs_spot_basis_bps != null
    ? `Live Perp Basis: ${hl.perp_vs_spot_basis_bps} bps`
    : "Spot not crossed yet (watch perp basis disconnect at open!)";
  document.getElementById("etfBasisStrip").innerHTML =
    `<strong>-2x Short ETFs:</strong> GraniteShares <code>ANS</code> (${ansTxt}) • LeverageShares <code>ANDD</code> (${anddTxt}) • ${basisWarn}`;

  // Hero Banner & Tranches
  const banner = document.getElementById("copilotBanner");
  banner.className = `copilot-banner tone-${rec.tone}`;
  document.getElementById("decisionStateTag").textContent = rec.tag;
  document.getElementById("decisionEvPill").textContent = rec.evText;
  document.getElementById("decisionHeadline").textContent = rec.headline;
  document.getElementById("decisionWhy").textContent = rec.why;

  document.getElementById("trancheCards").innerHTML = rec.tranches.map(t => `
    <div class="tranche-box ${t.highlight ? "highlight" : ""} ${t.stop ? "stop-box" : ""} ${t.target ? "target-box" : ""}">
      <div class="tranche-step">
        <span>${t.step}</span>
        <strong>${t.badge}</strong>
      </div>
      <div class="tranche-main">${t.main}</div>
      <div class="tranche-desc">${t.desc}</div>
    </div>
  `).join("");

  // Price Ladder ($83 Wall -> ORL -> ORH -> +6% T1 -> $111.50 Euphoric Cutoff)
  const minPx = 81.5;
  const maxPx = Math.max(115.0, ctx.price * 1.05, ctx.noop * 1.12);
  const pctPos = Math.max(3, Math.min(97, ((ctx.price - minPx) / (maxPx - minPx)) * 100));
  document.getElementById("ladderMarker").style.left = `${pctPos}%`;
  document.getElementById("ladderPinLabel").textContent = `$${ctx.price.toFixed(2)}`;

  document.getElementById("ladderTicks").innerHTML = `
    <span><strong>$83.00</strong> Reg-M Wall</span>
    <span class="text-red">$${ctx.or15Low.toFixed(1)} 15m ORL</span>
    <span><strong>$${ctx.or15High.toFixed(1)} 15m ORH</strong></span>
    <span class="text-green">$${(ctx.noop * 1.06).toFixed(1)} (+6% T1)</span>
    <span class="text-amber">$111.50 (+35% Cap)</span>
  `;

  if (ctx.isNasdaqLive && ctx.dayNum === 5 && ctx.etHour < 12.0) {
    const minsLeft = Math.max(0, Math.round((12.0 - ctx.etHour) * 60));
    document.getElementById("flattenCountdown").textContent = `Pre-Thanksgiving Noon Cutoff In: ${minsLeft}m (12:00 PM ET)`;
  } else if (ctx.isNasdaqLive && ctx.etHour < 15.92) {
    const minsLeft = Math.max(0, Math.round((15.9167 - ctx.etHour) * 60));
    document.getElementById("flattenCountdown").textContent = `Zero-Overnight Flatten In: ${Math.floor(minsLeft / 60)}h ${minsLeft % 60}m (3:55 PM ET)`;
  } else {
    document.getElementById("flattenCountdown").textContent = "Mandatory Flat: 3:55 PM ET Daily (12:00 PM Wed Nov 25)";
  }

  // Position Tracker
  const posBadge = document.getElementById("posDirectionBadge");
  if (!position.side || position.shares === 0) {
    posBadge.className = "strat-badge badge-muted";
    posBadge.textContent = "FLAT (0 SH)";
    document.getElementById("posShares").textContent = "0";
    document.getElementById("posAvgEntry").textContent = "--";
    document.getElementById("posUnrealized").textContent = "$0.00";
    document.getElementById("posUnrealized").className = "v";
    document.getElementById("posGuidanceText").textContent =
      "Currently flat. Wait 15m post-cross for ORH/ORL before committing capital.";
  } else {
    const mult = position.side === "LONG" ? 1 : -1;
    const pnl = (ctx.price - position.avgEntry) * position.shares * mult;
    const pnlPct = ((ctx.price - position.avgEntry) / position.avgEntry) * 100 * mult;
    posBadge.className = `strat-badge ${position.side === "LONG" ? "badge-green" : "badge-amber"}`;
    posBadge.textContent = `${position.side} (${position.legsCount}/2 LEGS)`;
    document.getElementById("posShares").textContent = `${position.shares.toLocaleString()} sh`;
    document.getElementById("posAvgEntry").textContent = `$${position.avgEntry.toFixed(2)}`;
    const uEl = document.getElementById("posUnrealized");
    uEl.textContent = `${pnl >= 0 ? "+" : ""}$${pnl.toFixed(0)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(1)}%)`;
    uEl.className = `v ${pnl >= 0 ? "text-green" : "text-red"}`;

    if (position.scaledT1) {
      document.getElementById("posGuidanceText").textContent =
        `+6% T1 banked! Keep stop at breakeven ($${position.avgEntry.toFixed(2)}) and trail remaining ${position.shares} sh along VWAP ($${ctx.vwap.toFixed(2)}) into 1:30 PM.`;
    } else if (position.side === "LONG" && pnlPct >= 5.5) {
      document.getElementById("posGuidanceText").textContent =
        `💰 Up +${pnlPct.toFixed(1)}%! Click 'Paid Self 50% @ +6% T1' now and lock breakeven stop!`;
    } else {
      document.getElementById("posGuidanceText").textContent =
        `Active ${position.side} (${position.shares} sh @ $${position.avgEntry.toFixed(2)}). Respect 15m ORL ($${ctx.or15Low.toFixed(2)}) & QQQ VWAP!`;
    }
  }

  renderOrderBook(hl);
  renderStrategyRadar(ctx, rec.activeStratId);
  drawPriceChart(ctx);
}

function renderOrderBook(hl) {
  const bids = hl.book_bids || [];
  const asks = hl.book_asks || [];
  document.getElementById("spreadBadge").textContent = hl.spread_bps != null ? `Spread: ${hl.spread_bps} bps` : "Spread: --";
  const maxSz = Math.max(1, ...bids.map(b => b.sz), ...asks.map(a => a.sz));

  document.getElementById("bookBids").innerHTML = bids.slice(0, 5).map(b => `
    <div class="book-row">
      <div class="bg-fill" style="left:0;width:${Math.min(100, (b.sz / maxSz) * 100)}%;background:var(--green);"></div>
      <span class="text-green">$${b.px.toFixed(3)}</span>
      <span>${b.sz.toFixed(1)} sh</span>
    </div>
  `).join("") || `<div class="text-muted">Waiting for L2...</div>`;

  document.getElementById("bookAsks").innerHTML = asks.slice(0, 5).map(a => `
    <div class="book-row">
      <div class="bg-fill" style="right:0;width:${Math.min(100, (a.sz / maxSz) * 100)}%;background:var(--red);"></div>
      <span class="text-red">$${a.px.toFixed(3)}</span>
      <span>${a.sz.toFixed(1)} sh</span>
    </div>
  `).join("") || `<div class="text-muted">Waiting for L2...</div>`;
}

function renderStrategyRadar(ctx, activeId) {
  const items = [
    {
      id: "LANE1",
      name: "Lane 1 ($83–$92): Cold Cross Greenshoe Long",
      ev: "Best R/R • $12.2B Reg-M Wall @ $83.00",
      rule: "Patient Long only (zero shorts). Wait 15m → buy 15m ORH break or VWAP reclaim; pay 50% @ +6%.",
      status: activeId === "LANE1" ? "ACTIVE" : (ctx.noop <= 92 ? "ARMED" : "INACTIVE"),
    },
    {
      id: "LANE2",
      name: "Lane 2 ($92–$111.50): 15m ORH vs ORL Play",
      ev: "Mega-Deal EV +4.36% (PF 6.40) • +6% T1",
      rule: "Hands off first 15m! Above VWAP & ORH = Long (+6% T1). Confirmed 15m close < ORL = Exit / Short ($88–$90).",
      status: (activeId === "LANE2" || activeId === "D1_SHORT") ? "ACTIVE" : (ctx.noop > 92 && ctx.noop <= OVERHEATED_PRICE ? "ARMED" : "INACTIVE"),
    },
    {
      id: "LANE3",
      name: "Lane 3 (>$111.50 / >+35%): Euphoric Stand-Down",
      ev: ">$2.0T Valuation Cap • Zero Morning Longs",
      rule: "Skip all morning longs. Fade only after red 15m/30m close < VWAP with verified ANS/ANDD/HTB borrow.",
      status: activeId === "LANE3" ? "ACTIVE" : (ctx.noop > OVERHEATED_PRICE ? "ARMED" : "STANDBY"),
    },
    {
      id: "W1",
      name: "Day 2 (Fri T+1) & Day 3 (Mon Options Gamma!)",
      ev: "Tier-1 EV +9.23% (7/7 Wins) • Highest Clarity",
      rule: "Fri Nov 20 unlocks T+1 borrow & real levels; Mon Nov 23 lists ANT options (SPCX Day-3 $225.64 gamma analog).",
      status: activeId === "W1" ? "ACTIVE" : "FRI / MON",
    },
    {
      id: "W3",
      name: "Day 4 Post-Gamma Unwind & Wed Noon Cutoff",
      ev: "Tier-1 Day-4 EV +4.63% (WR 75%, PF 5.31)",
      rule: "Tue Nov 24 unwinds Day-3 call gamma; Wed Nov 25 enforces 12:00 PM Noon pre-Thanksgiving chop cutoff.",
      status: activeId === "W3" ? "ACTIVE" : "TUE / WED",
    },
  ];

  document.getElementById("strategyRadarList").innerHTML = items.map(it => {
    const cls = it.status === "ACTIVE" ? "active-strat" : (it.status === "ARMED" ? "armed-strat" : "");
    const bCls = it.status === "ACTIVE" ? "badge-green" : (it.status === "ARMED" ? "badge-amber" : "badge-muted");
    return `
      <div class="strat-item ${cls}">
        <div class="strat-top">
          <strong style="font-size:13px;">${it.name}</strong>
          <span class="strat-badge ${bCls}">${it.status}</span>
        </div>
        <div style="font-size:11px;color:var(--primary);font-weight:700;margin:2px 0;">${it.ev}</div>
        <div style="font-size:12px;color:var(--text-muted);">${it.rule}</div>
      </div>
    `;
  }).join("");
}

// ============================================================================
// High-DPI Canvas Candlestick + v2.0 Mega-Cap Strategy Levels
// ============================================================================
function drawPriceChart(ctxOverride) {
  const canvas = document.getElementById("priceChart");
  if (!canvas) return;
  const ctx = ctxOverride || getEffectiveContext();
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.parentElement.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  const g = canvas.getContext("2d");
  g.scale(dpr, dpr);

  const W = rect.width;
  const H = rect.height;
  const isLight = document.documentElement.classList.contains("light");

  let candles = [];
  if (liveData?.nasdaq_ant?.is_live && liveData.nasdaq_ant.intraday_candles?.length > 3 && activeScenario === "live") {
    candles = liveData.nasdaq_ant.intraday_candles;
    document.getElementById("chartTitle").textContent = "Live Nasdaq: ANT (1m Intraday + 15m ORH/ORL & +6% T1)";
  } else {
    const hl = liveData?.hyperliquid || {};
    candles = chartTF === "1h" ? (hl.candles_1h || []) : (chartTF === "15m" ? (hl.candles_15m || []) : (hl.candles_5m || []));
    document.getElementById("chartTitle").textContent = `Live xyz:ANT Perpetual (${chartTF} Candles + v2.0 Mega-Cap Levels)`;
  }

  g.fillStyle = isLight ? "#f8fafc" : "#0b101b";
  g.fillRect(0, 0, W, H);

  if (!candles || candles.length === 0) {
    g.fillStyle = isLight ? "#64748b" : "#94a3b8";
    g.font = "600 13px sans-serif";
    g.fillText("Fetching live ANT candles...", W / 2 - 80, H / 2);
    return;
  }

  const vis = candles.slice(-55);
  const padL = 14, padR = 98, padT = 18, padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const t1Px = ctx.noop * 1.06;
  let minP = Math.min(...vis.map(c => c.l), ctx.or15Low, ctx.price) * 0.99;
  let maxP = Math.max(...vis.map(c => c.h), t1Px, OVERHEATED_PRICE, ctx.price) * 1.008;
  if (minP < 92) minP = Math.min(minP, 82.0);

  const yOf = p => padT + plotH * (1 - (p - minP) / Math.max(0.01, maxP - minP));

  g.strokeStyle = isLight ? "#e2e8f0" : "#1e293b";
  g.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    const y = padT + (plotH * i) / 4;
    g.beginPath();
    g.moveTo(padL, y);
    g.lineTo(W - padR, y);
    g.stroke();
  }

  // Shaded 15-Minute Opening Range Band (ORL to ORH)
  const yOrh = yOf(ctx.or15High);
  const yOrl = yOf(ctx.or15Low);
  g.fillStyle = "rgba(59, 130, 246, 0.09)";
  g.fillRect(padL, yOrh, plotW, Math.max(2, yOrl - yOrh));

  const levels = [
    { px: OFFER_PRICE, lbl: "$83 Reg-M Wall", col: "#94a3b8" },
    { px: ctx.or15Low, lbl: `15m ORL $${ctx.or15Low.toFixed(1)}`, col: "#ef4444" },
    { px: ctx.or15High, lbl: `15m ORH $${ctx.or15High.toFixed(1)}`, col: "#3b82f6" },
    { px: t1Px, lbl: `+6% T1 $${t1Px.toFixed(1)}`, col: "#10b981" },
    { px: OVERHEATED_PRICE, lbl: "$111.50 (+35% Cap)", col: "#f59e0b" },
  ];

  levels.forEach(lv => {
    if (lv.px < minP || lv.px > maxP) return;
    const y = yOf(lv.px);
    g.save();
    g.setLineDash([5, 4]);
    g.strokeStyle = lv.col;
    g.lineWidth = 1.2;
    g.beginPath();
    g.moveTo(padL, y);
    g.lineTo(W - padR, y);
    g.stroke();
    g.restore();

    g.fillStyle = lv.col;
    g.font = "700 10.5px sans-serif";
    g.fillText(lv.lbl, W - padR + 5, y + 3.5);
  });

  const stepX = plotW / vis.length;
  const bodyW = Math.max(3, Math.min(11, stepX * 0.66));

  vis.forEach((c, idx) => {
    const cx = padL + idx * stepX + stepX / 2;
    const up = c.c >= c.o;
    const col = up ? "#10b981" : "#ef4444";
    g.strokeStyle = col;
    g.fillStyle = col;
    g.lineWidth = 1.2;

    g.beginPath();
    g.moveTo(cx, yOf(c.h));
    g.lineTo(cx, yOf(c.l));
    g.stroke();

    const yTop = yOf(Math.max(c.o, c.c));
    const yBot = yOf(Math.min(c.o, c.c));
    g.fillRect(cx - bodyW / 2, yTop, bodyW, Math.max(1.5, yBot - yTop));
  });

  g.fillStyle = isLight ? "#64748b" : "#94a3b8";
  g.font = "600 10.5px sans-serif";
  [0, Math.floor(vis.length / 2), vis.length - 1].forEach(idx => {
    if (!vis[idx]) return;
    const d = new Date(vis[idx].t);
    const lbl = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    g.fillText(lbl, Math.min(W - padR - 45, padL + idx * stepX), H - 7);
  });
}

function renderCohortTable() {
  if (!cohortData?.cohort_rows) return;
  const rows = cohortData.cohort_rows.filter(r => {
    if (cohortFilter === "mega") return r.deal_size_b >= 4.5 || r.ticker === "CRWV";
    if (cohortFilter === "sweet") return r.cross_pop_pct >= 0.0 && r.cross_pop_pct <= 35.0;
    if (cohortFilter === "hot") return r.cross_pop_pct > 35.0;
    return true;
  });

  const fmtPct = v => v == null ? "--" : `<span class="${v > 0 ? "text-green" : (v < 0 ? "text-red" : "")}">${v >= 0 ? "+" : ""}${v.toFixed(1)}%</span>`;

  document.getElementById("cohortTableBody").innerHTML = rows.map(r => `
    <tr>
      <td><strong>${r.ticker}</strong> ${r.deal_size_b >= 10 ? '<span class="text-amber">★MEGA</span>' : ""}</td>
      <td>${r.name} <span class="text-muted">• ${r.sector}</span></td>
      <td class="text-muted">${r.ipo_date}</td>
      <td><strong>${r.hype_score.toFixed(1)}</strong></td>
      <td><strong>$${r.deal_size_b.toFixed(2)}B</strong></td>
      <td>$${r.offer.toFixed(2)}</td>
      <td><strong>$${r.d1_open.toFixed(2)}</strong></td>
      <td>${fmtPct(r.cross_pop_pct)}</td>
      <td>${fmtPct(r.d1_o2h_pct)}</td>
      <td>${fmtPct(r.d1_o2l_pct)}</td>
      <td>${fmtPct(r.d1_o2c_pct)}</td>
      <td>${fmtPct(r.d2_o2c_pct)}</td>
      <td>${fmtPct(r.d3_o2c_pct)}</td>
    </tr>
  `).join("");
}

async function fetchLive() {
  try {
    const res = await fetch("/api/live", { cache: "no-store" });
    if (res.ok) {
      liveData = await res.json();
      renderAll();
    }
  } catch (err) {
    console.warn("Live poll error:", err);
  }
}

async function initApp() {
  try {
    const cRes = await fetch("/api/cohort");
    if (cRes.ok) {
      cohortData = await cRes.json();
      renderCohortTable();
    }
  } catch (err) {
    console.warn("Cohort load error:", err);
  }
  await fetchLive();
  setInterval(fetchLive, 3000);
  window.addEventListener("resize", () => drawPriceChart());
}

initApp();
