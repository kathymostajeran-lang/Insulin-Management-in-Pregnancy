/**
 * dosing.ts — the clinical core.
 *
 * This is the single source of clinical truth for the app (CLAUDE.md §2, §3).
 * Every export is a PURE function: no I/O, no side effects, deterministic for a
 * given input. Each rule cites its source (guideline + section). It returns
 * numbers and structured results — never formatted strings or JSX.
 *
 * Ported from the verified reference implementation `dosing_engine_reference.py`
 * and the specification `PREGNANCY_INSULIN_ALGORITHMS.md`. The regression suite
 * in dosing.test.ts pins every worked example published in the four sources.
 *
 *   NOT FOR CLINICAL USE. Decision support only — every output requires
 *   clinician confirmation. See PREGNANCY_INSULIN_ALGORITHMS.md §0 and §15.
 *
 * Sources (see insulin_parameters.json → sources for full citations):
 *   VB24  Valent & Barbour, Obstet Gynecol 2024;144:633-647
 *   UC23  UC Cincinnati MFM Diabetes & Pregnancy Pocket Guide, 2023
 *   ADA26 ADA Standards of Care in Diabetes—2026, §15
 *   ES25  Endocrine Society / ESE Joint CPG, JCEM 2025
 */

// ── Rounding ────────────────────────────────────────────────────────────────
// The reference engine uses Python's round(), which is round-half-to-EVEN
// (banker's rounding). Reproduce it exactly so this engine matches both the
// reference suite and the published worked examples — e.g. VB24's conventional
// split prints bedtime NPH = 10, which is round(10.5) → 10 under half-even.
export function pyRound(x: number, ndigits = 0): number {
  const factor = 10 ** ndigits;
  const scaled = x * factor;
  const floor = Math.floor(scaled);
  const diff = scaled - floor;
  const EPS = 1e-9;
  let r: number;
  if (Math.abs(diff - 0.5) < EPS) {
    r = floor % 2 === 0 ? floor : floor + 1; // half → even
  } else {
    r = Math.round(scaled);
  }
  return r / factor;
}

// ── Configuration (policy switches — spec §14) ──────────────────────────────
export type TDDSchedule = "VB24" | "UC23";

export interface Config {
  /** C-02: starting TDD schedule. VB24 is the recommended default. */
  tddSchedule: TDDSchedule;
  /** C-03: correction factor constant. VB24 1500 | UC23 1700. */
  correctionConstant: number;
  /** C-04: insulin-to-carb constant. VB24 400 | UC23 500. */
  icrConstant: number;
  correctionTargetMgdl: number;
  /** C-01: hypoglycemia thresholds (ADA26 default). */
  hypoThresholdMeter: number;
  hypoThresholdSensor: number;
  /** C-12: intrapartum target range. */
  intrapartumTarget: [number, number];
  /** Midpoint of the VB24 10–20% titration step. */
  adjustmentPct: number;
}

export const DEFAULT_CONFIG: Config = {
  tddSchedule: "VB24",
  correctionConstant: 1500,
  icrConstant: 400,
  correctionTargetMgdl: 100,
  hypoThresholdMeter: 70,
  hypoThresholdSensor: 63,
  intrapartumTarget: [70, 110],
  adjustmentPct: 0.15,
};

// ── §4.2 Total daily dose ───────────────────────────────────────────────────
export type Trimester = "T1" | "T2" | "T3";

/** Standard obstetric trimester boundaries (VB24 uses these; T3 ≥ 28w). */
export function trimester(gaWeeks: number): Trimester {
  if (gaWeeks < 14) return "T1";
  if (gaWeeks < 28) return "T2";
  return "T3";
}

export const VB24_STANDARD: Record<Trimester, number> = { T1: 0.7, T2: 0.8, T3: 0.9 };
export const VB24_SENSITIVE: Record<Trimester, number> = { T1: 0.5, T2: 0.6, T3: 0.7 };

/**
 * Valent & Barbour 2024 weight-based TDD. No obesity uplift — VB24 explicitly
 * warns against higher weight-based dosing in obesity (hypoglycemia, defensive
 * eating, excess gestational weight gain, worsening insulin resistance).
 */
export function tddVB24(weightKg: number, gaWeeks: number, insulinSensitive = false): number {
  const table = insulinSensitive ? VB24_SENSITIVE : VB24_STANDARD;
  return pyRound(weightKg * table[trimester(gaWeeks)], 1);
}

/** UC Cincinnati 2023 pocket-guide weight-based TDD (by GA window). */
export function tddUC23(
  weightKg: number,
  gaWeeks: number | null,
  opts: { pctDbw?: number | null; ppWeeks?: number | null } = {},
): number {
  const { pctDbw = null, ppWeeks = null } = opts;
  if (ppWeeks !== null && ppWeeks <= 6) return pyRound(weightKg * 0.4, 1);
  if (pctDbw !== null && pctDbw > 150) {
    // Source gives a 1.5–2.0 range; return the conservative (lower) end.
    return pyRound(weightKg * 1.5, 1);
  }
  if (gaWeeks === null) return pyRound(weightKg * 0.6, 1); // pre-pregnant (pump section)
  let f: number;
  if (gaWeeks < 18) f = 0.7;
  else if (gaWeeks < 26) f = 0.8;
  else if (gaWeeks < 36) f = 0.9;
  else f = 1.0;
  return pyRound(weightKg * f, 1);
}

/** UC23 obesity branch (>150% DBW): the full 1.5–2.0 u/kg range (C-02). */
export function tddUC23ObesityRange(weightKg: number): [number, number] {
  return [pyRound(weightKg * 1.5, 1), pyRound(weightKg * 2.0, 1)];
}

// ── §4.4 Regimen architectures ──────────────────────────────────────────────
export interface Regimen {
  name: string;
  components: Record<string, number>;
  source: string;
  notes: string[];
}

/** VB24 Table 3: 40% basal glargine / 60% bolus RAA across 3 meals. */
export function basalBolus(tdd: number, basalPct = 0.4): Regimen {
  const basal = pyRound(tdd * basalPct);
  const bolus = pyRound(tdd * (1 - basalPct));
  const perMeal = pyRound(bolus / 3);
  const notes: string[] = [];
  if (basal > 30) notes.push("VB24: split glargine q12h — dose exceeds 20–30 units/day");
  return {
    name: "basal_bolus",
    components: {
      basal_glargine: basal,
      bolus_total: bolus,
      bolus_breakfast: perMeal,
      bolus_lunch: perMeal,
      bolus_dinner: perMeal,
    },
    source: "VB24",
    notes,
  };
}

/**
 * VB24 Table 3: half TDD as NPH (⅓ AM, ⅔ bedtime), half as RAA across 3 meals.
 * VB24's printed example (TDD 63) prints NPH morning 10 + bedtime 20 = 30, which
 * does not sum to its stated NPH total of 32. Compute bedtime as the remainder so
 * the components reconcile.
 */
export function nphRaa(tdd: number): Regimen {
  const nphTotal = pyRound(tdd * 0.5);
  const nphMorning = pyRound(nphTotal / 3);
  const nphBedtime = nphTotal - nphMorning;
  const raaTotal = pyRound(tdd - nphTotal);
  return {
    name: "nph_raa",
    components: {
      nph_total: nphTotal,
      nph_morning: nphMorning,
      nph_bedtime: nphBedtime,
      raa_total: raaTotal,
    },
    source: "VB24",
    notes: [
      "Morning NPH ideally 4–6 h before anticipated lunch (it IS the lunch coverage)",
      "VB24's printed 10 + 20 does not sum to its stated NPH total of 32",
    ],
  };
}

/**
 * VB24 / UC23 conventional split: ⅔ AM : ⅓ PM. AM = ⅔ NPH + ⅓ short.
 * PM = ½ NPH (bedtime) + ½ short (pre-dinner).
 */
export function conventionalNphShort(tdd: number, fastingPredominant = false): Regimen {
  if (fastingPredominant) {
    // VB24 exception: NPH split 50:50 morning/bedtime instead of ⅔:⅓.
    const nphTotal = pyRound(tdd * 0.5);
    return {
      name: "conventional_fasting_predominant",
      components: { nph_morning: pyRound(nphTotal / 2), nph_bedtime: pyRound(nphTotal / 2) },
      source: "VB24",
      notes: ["Fasting-predominant exception to the ⅔:⅓ rule"],
    };
  }
  const am = pyRound((tdd * 2) / 3);
  const pm = pyRound((tdd * 1) / 3);
  return {
    name: "conventional_nph_short",
    components: {
      am_total: am,
      am_nph: pyRound((am * 2) / 3),
      am_short: pyRound((am * 1) / 3),
      pm_total: pm,
      pm_nph_bedtime: pyRound(pm * 0.5),
      pm_short_predinner: pyRound(pm * 0.5),
    },
    source: "VB24 / UC23",
    notes: [
      "If Regular insulin: administer 60 min before the meal",
      "If RAA (UC23 variant): 15–20 min before the meal",
    ],
  };
}

// ── §5.9 ICF / ICR ──────────────────────────────────────────────────────────
/** Insulin correction factor, unrounded: mg/dL lowered per unit. */
export function icfExact(tdd: number, cfg: Config = DEFAULT_CONFIG): number {
  return cfg.correctionConstant / tdd;
}
/** Insulin-to-carbohydrate ratio, unrounded: grams CHO covered per unit. */
export function icrExact(tdd: number, cfg: Config = DEFAULT_CONFIG): number {
  return cfg.icrConstant / tdd;
}
/** Display ICF. VB24 prints 1500/63 as '~25'; exact is 23.8. */
export function icf(tdd: number, cfg: Config = DEFAULT_CONFIG): number {
  return pyRound(icfExact(tdd, cfg));
}
/** Display ICR. VB24 prints 400/63 as 6; exact is 6.35. */
export function icr(tdd: number, cfg: Config = DEFAULT_CONFIG): number {
  return pyRound(icrExact(tdd, cfg));
}

/**
 * Correction dose. Compute from the UNROUNDED ratio, then round the dose —
 * rounding the ratio first introduces error that compounds at high TDD.
 */
export function correctionDose(premealBg: number, tdd: number, cfg: Config = DEFAULT_CONFIG): number {
  if (premealBg <= cfg.correctionTargetMgdl) return 0;
  return pyRound((premealBg - cfg.correctionTargetMgdl) / icfExact(tdd, cfg));
}

export function mealDose(choGrams: number, tdd: number, cfg: Config = DEFAULT_CONFIG): number {
  return pyRound(choGrams / icrExact(tdd, cfg));
}

// ── §5.10 UC23 fixed pre-meal correction scale ──────────────────────────────
// HARD CONSTRAINT (HS-01/HS-02): premeal + daytime only. Never between meals,
// never post-meal sliding scale.
export const UC23_FIXED_CORRECTION: ReadonlyArray<[number, number, number]> = [
  [0, 99, 0],
  [100, 140, 2],
  [141, 160, 3],
  [161, 180, 4],
  [181, 200, 5],
  [201, 250, 6],
  [251, 300, 8],
  [301, 10_000, 10],
];

export class HardStopError extends Error {}

export function uc23FixedCorrection(bg: number, isPremeal: boolean, isDaytime: boolean): number {
  if (!(isPremeal && isDaytime)) {
    throw new HardStopError(
      "UC23 correction table is premeal, daytime-only. Never use between meals or post-meal (source STOP warning).",
    );
  }
  for (const [lo, hi, units] of UC23_FIXED_CORRECTION) {
    if (lo <= bg && bg <= hi) return units;
  }
  return 0;
}

// ── §7 CSII initiation (UC23 — conflict C-14) ───────────────────────────────
export interface PumpSettings {
  finalTdd: number;
  totalDailyBasal: number;
  basalRate1: number; // 00:00–03:00
  basalRate2: number; // 03:00–08:00
  basalRate3: number; // 08:00–24:00 (key value)
  correctionFactor: number;
  icrGPerUnit: number;
  tddFromMdi: number | null;
  tddFromWeight: number;
}

/**
 * UC23 pump calculation.
 *
 * CONFLICT C-14: the source prose says the 3rd basal rate is "TDD ÷ 24", but the
 * printed worked example divides the TOTAL DAILY BASAL (50% of TDD) by 24.
 * Implementing the prose literally overdoses basal 2×. The worked example is
 * authoritative and is pinned in the regression suite.
 */
export function csiiInitiation(
  weightKg: number,
  gaWeeks: number | null,
  opts: { mdiTdd?: number | null; ppWeeks?: number | null } = {},
): PumpSettings {
  const { mdiTdd = null, ppWeeks = null } = opts;
  const tddFromMdi = mdiTdd !== null ? pyRound(mdiTdd * 0.75, 1) : null;
  const tddFromWeight = tddUC23(weightKg, gaWeeks, { ppWeeks });

  const candidates = [tddFromMdi, tddFromWeight].filter((t): t is number => t !== null);
  const finalTdd = Math.min(...candidates);

  const totalDailyBasal = finalTdd * 0.5;
  const rate3 = pyRound(totalDailyBasal / 24, 2); // <-- C-14
  const rate1 = pyRound(rate3 * 0.8, 2);
  const rate2 = pyRound(rate3 * 1.2, 2);

  return {
    finalTdd,
    totalDailyBasal: pyRound(totalDailyBasal, 1),
    basalRate1: rate1,
    basalRate2: rate2,
    basalRate3: rate3,
    correctionFactor: pyRound(1700 / finalTdd),
    icrGPerUnit: pyRound(500 / finalTdd),
    tddFromMdi,
    tddFromWeight,
  };
}

// ── §5 Titration ────────────────────────────────────────────────────────────
export type TitrationAction =
  | "INCREASE_DOSE"
  | "DECREASE_DOSE"
  | "EXTEND_PREBOLUS"
  | "HOLD"
  | "ALERT_PLACENTAL_INSUFFICIENCY";

export interface TitrationRec {
  action: TitrationAction;
  component: string;
  deltaUnits: number;
  newPrebolusMin: number | null;
  rationale: string;
  source: string;
}

/**
 * VB24 bolus timing gate: before increasing a bolus above 20 units for
 * persistent postprandial hyperglycemia, interrogate ADMINISTRATION TIMING
 * first — absorption slows at higher doses and later gestation.
 */
export function titrateBolus(
  component: string,
  currentDose: number,
  prebolusMinutes: number,
  aboveTarget: boolean,
  cfg: Config = DEFAULT_CONFIG,
): TitrationRec {
  if (!aboveTarget) {
    return { action: "HOLD", component, deltaUnits: 0, newPrebolusMin: null, rationale: "at target", source: "VB24" };
  }
  if (currentDose > 20 && prebolusMinutes < 30) {
    return {
      action: "EXTEND_PREBOLUS",
      component,
      deltaUnits: 0,
      newPrebolusMin: Math.min(45, prebolusMinutes + 15),
      rationale:
        "Dose >20 units with prebolus <30 min. VB24: subcutaneous absorption slows at higher doses and later gestation; extend prebolus before escalating the dose.",
      source: "VB24",
    };
  }
  return {
    action: "INCREASE_DOSE",
    component,
    deltaUnits: pyRound(currentDose * cfg.adjustmentPct),
    newPrebolusMin: null,
    rationale: "Postprandial above target; VB24 adjustment 10–20%.",
    source: "VB24",
  };
}

/**
 * ADA26 (HS-15): a rapid, significant reduction in insulin requirement at
 * GA ≥ 28 weeks may indicate placental insufficiency. ALERT ONLY — never
 * auto-reduce.
 */
export function checkFallingTdd(tddNow: number, tdd7dAgo: number, gaWeeks: number): TitrationRec | null {
  if (gaWeeks < 28 || tdd7dAgo <= 0) return null;
  const drop = (tdd7dAgo - tddNow) / tdd7dAgo;
  if (drop >= 0.15) {
    return {
      action: "ALERT_PLACENTAL_INSUFFICIENCY",
      component: "TDD",
      deltaUnits: 0,
      newPrebolusMin: null,
      rationale: `TDD fell ${Math.round(drop * 100)}% over 7 days at ${gaWeeks.toFixed(
        1,
      )} weeks. ADA26: may indicate placental insufficiency. Obtain fetal assessment. Do not auto-titrate.`,
      source: "ADA26",
    };
  }
  return null;
}

// ── §5.4 Pattern-based titration of a standing MDI regimen ──────────────────
// Move a dose on a pattern, not one reading. Each glucose window drives one
// component (spec §C.4): fasting → bedtime NPH; post-breakfast → AM lispro;
// post-lunch → AM NPH (morning NPH is the lunch coverage); post-dinner →
// dinner lispro. Magnitude is 10–20% of the component (§C.3). Total increase is
// capped at 20% of TDD; beyond that, stage the change.
export type WindowState = "in_range" | "high" | "low";

export interface StandingRegimen {
  amNph: number;
  amLispro: number;
  dinnerLispro: number;
  bedtimeNph: number;
}

export interface PatternInput {
  fasting: WindowState; // → bedtimeNph
  postBreakfast: WindowState; // → amLispro
  postLunch: WindowState; // → amNph
  postDinner: WindowState; // → dinnerLispro
}

export interface TitrationResult {
  adjusted: StandingRegimen;
  totalIncrease: number;
  capUnits: number;
  overCap: boolean;
}

function stepComponent(current: number, state: WindowState, step: number): number {
  if (state === "high") return pyRound(current * step);
  if (state === "low") return -pyRound(current * step);
  return 0;
}

/**
 * Apply pattern-based titration to a standing 4-component regimen.
 * @param step fractional step (0.10 or 0.20). Increases are capped at 20% of TDD.
 */
export function titratePattern(
  reg: StandingRegimen,
  pattern: PatternInput,
  step: number,
  tdd: number,
): TitrationResult {
  const dBed = stepComponent(reg.bedtimeNph, pattern.fasting, step);
  const dAmL = stepComponent(reg.amLispro, pattern.postBreakfast, step);
  const dAmN = stepComponent(reg.amNph, pattern.postLunch, step);
  const dDin = stepComponent(reg.dinnerLispro, pattern.postDinner, step);

  const deltas = [dBed, dAmL, dAmN, dDin];
  const totalIncrease = deltas.filter((d) => d > 0).reduce((a, b) => a + b, 0);
  const capUnits = pyRound(tdd * 0.2);
  const overCap = totalIncrease > capUnits;

  return {
    adjusted: {
      amNph: Math.max(0, reg.amNph + dAmN),
      amLispro: Math.max(0, reg.amLispro + dAmL),
      dinnerLispro: Math.max(0, reg.dinnerLispro + dDin),
      bedtimeNph: Math.max(0, reg.bedtimeNph + dBed),
    },
    totalIncrease,
    capUnits,
    overCap,
  };
}

// ── §11 Intrapartum infusion (UC23 table; C-15 gap at 80–99) ────────────────
export type IntrapartumBand = { lo: number; hi: number; rate: number | null; action: string | null };

export const UC23_INTRAPARTUM: ReadonlyArray<IntrapartumBand> = [
  { lo: 0, hi: 79, rate: 0.0, action: "discontinue drip" },
  { lo: 100, hi: 120, rate: 0.5, action: null },
  { lo: 121, hi: 140, rate: 1.0, action: null },
  { lo: 141, hi: 160, rate: 1.5, action: null },
  { lo: 161, hi: 180, rate: 2.0, action: null },
  { lo: 181, hi: 200, rate: 2.5, action: null },
  { lo: 201, hi: 300, rate: 3.0, action: null },
  { lo: 301, hi: 10_000, rate: null, action: "call MD" },
];

export class UnresolvedPolicyGap extends Error {}

/**
 * UC23 intrapartum insulin infusion.
 *
 * CONFLICT C-15: the published table has no 80–99 mg/dL row. Resolve by
 * institutional policy before deployment; until then, this band throws.
 * Returns a number (units/hr) or a string action.
 */
export function intrapartumRate(bg: number, policy8099: string | null = null): number | string {
  if (bg >= 80 && bg <= 99) {
    if (policy8099 === null) {
      throw new UnresolvedPolicyGap(
        "BG 80–99 mg/dL is not covered by the UC23 table (conflict C-15). Set INTRAPARTUM_BAND_80_99 policy before use.",
      );
    }
    return policy8099;
  }
  for (const b of UC23_INTRAPARTUM) {
    if (b.lo <= bg && bg <= b.hi) return b.action !== null ? b.action : (b.rate as number);
  }
  return 0;
}

// ── §6 / §A CGM (Module D) ──────────────────────────────────────────────────
// CRITICAL (spec §A.4): CGM aggregate metrics are a SCORECARD, not a titration
// target. The titration engine's inputs are time-tagged glucose values, never
// aggregate TIR. This module evaluates the scorecard, guards data quality
// (HS-10/HS-11), blocks eA1C/GMI (HS-09), derives the basal-hyperglycemia
// signal (D.2), and classifies tagged values that then route to titratePattern.

/** ADA26 CGM goals (§A.3). Validated for T1DM; sensor ranges endorsed for
 *  T2DM/GDM but the time-in-range goal amount is undefined (insufficient data). */
export const CGM_TARGETS = {
  sensorRange: [63, 140] as [number, number],
  tirPctMin: 70,
  tarGt140PctMax: 25,
  tbrLt63PctMax: 4,
  tbrLt54PctMax: 1,
  validatedFor: ["T1DM"] as const,
  minDaysForTitration: 10,
  minWearPctForTitration: 70,
} as const;

export interface CgmWindow {
  days: number;
  wearPct: number;
  tir63_140Pct: number;
  tarGt140Pct: number;
  tbrLt63Pct: number;
  tbrLt54Pct: number;
  meanGlucoseMgdl: number;
  overnightMeanMgdl?: number | null;
  /** Day index of the current sensor wear; 1 = first day (suppressed). */
  dayOfWear?: number | null;
}

export interface CgmMetric {
  key: string;
  label: string;
  value: number;
  goal: string;
  /** true = meets goal, false = misses, null = informational (no pass/fail). */
  meets: boolean | null;
}

/** Evaluate the CGM scorecard against ADA26 goals. Mean glucose is shown
 *  instead of eA1C/GMI, which is prohibited in pregnancy (HS-09). */
export function evaluateCgm(w: CgmWindow): CgmMetric[] {
  return [
    { key: "tir", label: "Time in range 63–140", value: w.tir63_140Pct, goal: "≥ 70%", meets: w.tir63_140Pct >= CGM_TARGETS.tirPctMin },
    { key: "tar", label: "Time above 140", value: w.tarGt140Pct, goal: "≤ 25%", meets: w.tarGt140Pct <= CGM_TARGETS.tarGt140PctMax },
    { key: "tbr63", label: "Time below 63", value: w.tbrLt63Pct, goal: "≤ 4%", meets: w.tbrLt63Pct <= CGM_TARGETS.tbrLt63PctMax },
    { key: "tbr54", label: "Time below 54", value: w.tbrLt54Pct, goal: "≤ 1%", meets: w.tbrLt54Pct <= CGM_TARGETS.tbrLt54PctMax },
    { key: "mean", label: "Mean glucose", value: w.meanGlucoseMgdl, goal: "shown instead of eA1C", meets: null },
  ];
}

export interface CgmTitrationGate {
  allowed: boolean;
  reasons: string[];
}

/**
 * Data-quality gate for CGM-derived dose recommendations (HS-10, HS-11).
 * A recommendation is BLOCKED unless ≥10 days of ≥70% wear are present and the
 * data is not day 1 of sensor wear.
 */
export function cgmTitrationGate(w: CgmWindow): CgmTitrationGate {
  const reasons: string[] = [];
  if (w.days < CGM_TARGETS.minDaysForTitration) {
    reasons.push(`Need ≥ ${CGM_TARGETS.minDaysForTitration} days of CGM data (have ${w.days}). [HS-10]`);
  }
  if (w.wearPct < CGM_TARGETS.minWearPctForTitration) {
    reasons.push(`Need ≥ ${CGM_TARGETS.minWearPctForTitration}% sensor wear (have ${w.wearPct}%). [HS-10]`);
  }
  if (w.dayOfWear === 1) {
    reasons.push("Day 1 of sensor wear is suppressed — %20/20 agreement is lowest on day 1. [HS-11]");
  }
  return { allowed: reasons.length === 0, reasons };
}

export class NotImplementedInPregnancy extends Error {}

/** GMI / estimated A1C must not be computed or displayed in pregnancy
 *  (ADA26 15.13, HS-09). Display CGM mean glucose instead. */
export function estimatedA1c(): never {
  throw new NotImplementedInPregnancy(
    "GMI / estimated A1C must not be displayed in pregnancy (ADA26 15.13, HS-09). Display mean glucose instead.",
  );
}

export interface BasalHyperglycemiaSignal {
  flag: boolean;
  overnightMean: number | null;
  message: string;
}

/**
 * D.2: basal/overnight hyperglycemia drives 66.5–74.9% of the hyperglycemic
 * burden in T1DM pregnancy (Ling 2024). When the overnight mean is above the
 * fasting target, weight the recommendation toward BASAL escalation even if
 * TIR looks acceptable.
 */
export function basalHyperglycemiaSignal(
  overnightMean: number | null | undefined,
  fastingUpper = 95,
): BasalHyperglycemiaSignal {
  if (overnightMean === null || overnightMean === undefined) {
    return { flag: false, overnightMean: null, message: "No overnight mean provided." };
  }
  if (overnightMean > fastingUpper) {
    return {
      flag: true,
      overnightMean,
      message: `Overnight mean ${overnightMean} > ${fastingUpper} mg/dL. Basal/overnight hyperglycemia is the dominant driver (Ling 2024) — favor basal escalation. Confirm with the fasting pattern on Adjust.`,
    };
  }
  return { flag: false, overnightMean, message: `Overnight mean ${overnightMean} mg/dL at or below the fasting target.` };
}

/** Classify a single tagged glucose value against a [lo, hi] target window.
 *  lo may be null (e.g. GDM A1 has no lower bound). Feeds titratePattern. */
export function classifyWindow(value: number, lo: number | null, hi: number): WindowState {
  if (value > hi) return "high";
  if (lo !== null && value < lo) return "low";
  return "in_range";
}

/** D.3 CGM phenotype clusters (Battarbee 2024) — REVIEW TRIGGERS, not dose
 *  changes. Distinct outcome profiles at similar aggregate metrics. */
export const CGM_PHENOTYPES: ReadonlyArray<{ label: string; meanMgdl: number; flags: string[] }> = [
  { label: "Well controlled", meanMgdl: 123, flags: [] },
  { label: "Suboptimal, high variability", meanMgdl: 154, flags: ["LGA OR 3.34"] },
  { label: "Suboptimal, minimal circadian rhythm", meanMgdl: 148, flags: ["PTB OR 2.59", "CD OR 2.76", "NICU OR 4.08"] },
  { label: "Peak overnight hyperglycemia", meanMgdl: 166, flags: ["LGA OR 3.72", "Neo hypo OR 3.53", "Preeclampsia OR 2.54", "NICU OR 3.15"] },
];

// ── §13 Postpartum ──────────────────────────────────────────────────────────
export interface PostpartumOptions {
  UC23_pct_end_pregnancy?: [number, number];
  VB24_pct_third_trimester?: [number, number];
  UC23_weight_based?: number;
  ADA26_reference_point?: number;
  _warning: string;
}

/**
 * C-13: three published methods with THREE DIFFERENT DENOMINATORS. Return all
 * available options; force clinician selection. Never auto-pick.
 */
export function postpartumTddOptions(args: {
  endPregnancyTdd?: number | null;
  thirdTrimesterTdd?: number | null;
  prepregnancyTdd?: number | null;
  weightKg?: number | null;
}): PostpartumOptions {
  const { endPregnancyTdd = null, thirdTrimesterTdd = null, prepregnancyTdd = null, weightKg = null } = args;
  const out: PostpartumOptions = {
    _warning:
      "Denominators differ: end-pregnancy, third-trimester, and prepregnancy TDD are NOT interchangeable. Clinician must select.",
  };
  if (endPregnancyTdd) out.UC23_pct_end_pregnancy = [pyRound(0.25 * endPregnancyTdd, 1), pyRound(0.33 * endPregnancyTdd, 1)];
  if (thirdTrimesterTdd)
    out.VB24_pct_third_trimester = [pyRound(0.3 * thirdTrimesterTdd, 1), pyRound(0.4 * thirdTrimesterTdd, 1)];
  if (weightKg) out.UC23_weight_based = pyRound(0.4 * weightKg, 1);
  if (prepregnancyTdd) out.ADA26_reference_point = pyRound(0.66 * prepregnancyTdd, 1);
  return out;
}

// ── TDD dispatch (schedule switch, C-02) ────────────────────────────────────
export interface TddResult {
  tdd: number;
  schedule: TDDSchedule;
  rule: string;
  source: string;
}

/**
 * Compute starting TDD under the configured schedule (C-02). This is the value
 * the app's persistent TDD banner shows. Obesity uplift is applied only under
 * the UC23 schedule and only when %DBW > 150 is supplied — VB24 has no uplift.
 */
export function computeTdd(
  weightKg: number,
  gaWeeks: number | null,
  cfg: Config = DEFAULT_CONFIG,
  opts: { insulinSensitive?: boolean; pctDbw?: number | null; ppWeeks?: number | null } = {},
): TddResult {
  const { insulinSensitive = false, pctDbw = null, ppWeeks = null } = opts;
  if (cfg.tddSchedule === "UC23") {
    return {
      tdd: tddUC23(weightKg, gaWeeks, { pctDbw, ppWeeks }),
      schedule: "UC23",
      rule: "UC Cincinnati 2023 · weight × GA-window factor",
      source: "UC23",
    };
  }
  // VB24 requires a gestational age to pick the trimester factor.
  const ga = gaWeeks ?? 0;
  return {
    tdd: tddVB24(weightKg, ga, insulinSensitive),
    schedule: "VB24",
    rule: `Valent & Barbour 2024 · ${insulinSensitive ? "insulin-sensitive" : "standard"} × ${trimester(ga)}`,
    source: "VB24",
  };
}
