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

// ── §9 Antenatal corticosteroid hyperglycemia (Module G) ────────────────────
// Sole source: UC23. A steroid course transiently raises glucose (peak 48–72 h,
// may persist 1–2 weeks). The load-bearing safety behavior: while a steroid
// episode is active, SUSPEND the baseline titration engine so a transient spike
// does not permanently escalate the standing regimen, and schedule
// de-escalation reviews at day 7 and day 14.
export const STEROID = {
  peakHours: [48, 72] as [number, number],
  monitorHours: 72,
  persistWeeks: [1, 2] as [number, number],
  typicalMaxBgNondiabetic: 180,
  escalateIfBgGt: 200,
  suspendTitrationDays: [7, 14] as [number, number],
  otherAmplifiers: ["obesity", "sepsis or other infection"],
  source: "UC23",
} as const;

export type SteroidPhase = "pre_peak" | "peak" | "resolution" | "resolved";

export interface SteroidEpisode {
  hoursSinceFirstDose: number;
  phase: SteroidPhase;
  phaseLabel: string;
  /** The 72-h post-dose screening window is active. */
  monitoringActive: boolean;
  monitoringCadence: string;
  /** Baseline titration is suspended (through ~2 weeks). */
  baselineTitrationSuspended: boolean;
  /** Next scheduled de-escalation review (post-dose day), or null when resolved. */
  nextReviewDay: number | null;
}

const HOURS_PER_DAY = 24;

/**
 * Classify a steroid episode from hours since the FIRST dose. `npo` selects the
 * monitoring cadence (q8h while NPO; AC + HS on a regular diet).
 */
export function steroidEpisode(hoursSinceFirstDose: number, npo: boolean): SteroidEpisode {
  const h = hoursSinceFirstDose;
  const twoWeeks = 14 * HOURS_PER_DAY;
  const oneWeek = 7 * HOURS_PER_DAY;

  let phase: SteroidPhase;
  let phaseLabel: string;
  if (h < STEROID.peakHours[0]) {
    phase = "pre_peak";
    phaseLabel = "Before peak — hyperglycemia building (onset can be delayed days)";
  } else if (h <= STEROID.peakHours[1]) {
    phase = "peak";
    phaseLabel = "Peak response (48–72 h)";
  } else if (h <= twoWeeks) {
    phase = "resolution";
    phaseLabel = "Resolving — effect may persist 1–2 weeks";
  } else {
    phase = "resolved";
    phaseLabel = "Resolved — expect return to pretreatment glucose";
  }

  const monitoringActive = h <= STEROID.monitorHours;
  const baselineTitrationSuspended = h <= twoWeeks;
  const nextReviewDay = h < oneWeek ? 7 : h <= twoWeeks ? 14 : null;

  return {
    hoursSinceFirstDose: h,
    phase,
    phaseLabel,
    monitoringActive,
    monitoringCadence: npo ? "q8h (while NPO)" : "AC and HS (on a regular diet)",
    baselineTitrationSuspended,
    nextReviewDay,
  };
}

export interface SteroidBgAction {
  escalate: boolean;
  message: string;
}

/**
 * BG-threshold action during a steroid episode. Above 200 mg/dL, escalate;
 * insulin-treated patients increase doses aggressively and proportionately,
 * others start a carb-counting diet with 7×/day checks and PRN RAA.
 */
export function steroidBgAction(bg: number, onInsulin: boolean): SteroidBgAction {
  if (bg > STEROID.escalateIfBgGt) {
    return {
      escalate: true,
      message: onInsulin
        ? "Increase insulin doses aggressively and proportionately to the hyperglycemia; add PRN rapid-acting analog for BG > 200. This is a transient escalation — do NOT bake it into the baseline regimen."
        : "Start a carbohydrate-counting pregnancy diet, check BG 7×/day, and give PRN rapid-acting analog for BG > 200.",
    };
  }
  return {
    escalate: false,
    message: "At or below 200 mg/dL. After the 72-h screening window, monitoring can be discontinued if BG stays < 200.",
  };
}

// ── §9b Mathiesen betamethasone insulin adjustment (perinatal) ──────────────
// Pregnancy-specific day-by-day insulin adjustment for antenatal betamethasone
// (Mathiesen ER algorithm, as implemented at perinatology.com). Each day's
// percentage increase is applied to the PRE-STEROID baseline dose (not
// compounded). Assumes the first steroid dose is given the morning of Day 1.
export const MATHIESEN = {
  onsetHours: [3, 8] as [number, number], // hyperglycemia may begin 3–8 h post-dose
  elevatedUpToDays: 5,
  firstDoseMorningDay1: true,
  source: "Mathiesen ER algorithm · perinatology.com",
} as const;

export interface SteroidRegimen {
  breakfast: number;
  lunch: number;
  dinner: number;
  hs: number;
}

export type SteroidDay = 1 | 2 | 3 | 4 | 5 | 6 | 7;

type MathiesenFactor = [number, number]; // [low, high]

const MATHIESEN_FACTORS: Record<SteroidDay, { meal: MathiesenFactor; hs: MathiesenFactor; label: string; taper: boolean }> = {
  1: { meal: [1, 1], hs: [1.25, 1.25], label: "Increase nighttime (HS) insulin by 25%", taper: false },
  2: { meal: [1.4, 1.4], hs: [1.4, 1.4], label: "Increase all insulin doses by 40%", taper: false },
  3: { meal: [1.4, 1.4], hs: [1.4, 1.4], label: "Increase all insulin doses by 40%", taper: false },
  4: { meal: [1.2, 1.2], hs: [1.2, 1.2], label: "Increase all insulin doses by 20%", taper: false },
  5: { meal: [1.1, 1.2], hs: [1.1, 1.2], label: "Increase all insulin doses by 10–20%", taper: false },
  6: { meal: [1, 1], hs: [1, 1], label: "Gradually reduce toward the pre-steroid dose", taper: true },
  7: { meal: [1, 1], hs: [1, 1], label: "Gradually reduce toward the pre-steroid dose", taper: true },
};

export interface MathiesenDose {
  day: SteroidDay;
  instruction: string;
  taper: boolean;
  breakfast: [number, number];
  lunch: [number, number];
  dinner: [number, number];
  hs: [number, number];
}

function applyRange(v: number, f: MathiesenFactor): [number, number] {
  return [pyRound(v * f[0]), pyRound(v * f[1])];
}

/** Adjusted doses for a given steroid day, from the pre-steroid baseline. */
export function mathiesenSteroidAdjustment(base: SteroidRegimen, day: SteroidDay): MathiesenDose {
  const f = MATHIESEN_FACTORS[day];
  return {
    day,
    instruction: f.label,
    taper: f.taper,
    breakfast: applyRange(base.breakfast, f.meal),
    lunch: applyRange(base.lunch, f.meal),
    dinner: applyRange(base.dinner, f.meal),
    hs: applyRange(base.hs, f.hs),
  };
}

/** The full Days 1–7 schedule for a baseline regimen. */
export function mathiesenSchedule(base: SteroidRegimen): MathiesenDose[] {
  return ([1, 2, 3, 4, 5, 6, 7] as SteroidDay[]).map((d) => mathiesenSteroidAdjustment(base, d));
}

// ── §10 Diabetic ketoacidosis (Module H) ────────────────────────────────────
// Sole source: UC23. REFERENCE PROTOCOL ONLY — this app does not automate DKA
// dosing (an ICU-level condition). The engine here supports recognition
// (including euglycemic DKA, which does not require hyperglycemia) and the ICU
// escalation check; the fluid/insulin/electrolyte protocol is displayed as
// reference values, never computed into orders. HS-14: while DKA is active,
// suspend all routine dosing modules and manage DKA only.
export const DKA = {
  diagnostic: { phMax: 7.3, bicarbMaxMeqL: 15, anionGapMin: 10 },
  incidencePregestationalT1dmPct: [5, 10] as [number, number],
  euglycemicMoreCommon: true,
  // Displayed as reference ranges only — NOT used to compute an order.
  insulin: {
    loadingUnitsPerKg: [0.1, 0.4] as [number, number],
    maintenanceUnitsPerHour: [2, 10] as [number, number],
    doubleIfNotDecreasedPct: 20,
    doubleWindowHours: 2,
  },
  fluids: {
    hour1LitersNs: 1,
    hours2to4LitersPerHour: [0.5, 1.0] as [number, number],
    thereafterMlPerHour: 250,
    thereafterFluid: "0.45% NS",
    switchToD5HalfNsWhenBgLt: 300,
  },
  potassium: { normalOrLowMeqPerHourMax: [15, 20] as [number, number] },
  phosphateReplaceIfLtMgDl: 1.0,
  doNotDeliverDuringDka: true,
  source: "UC23",
} as const;

export interface DkaLabs {
  ph: number | null;
  bicarb: number | null;
  anionGap: number | null;
  ketonesElevated: boolean;
  glucose?: number | null;
}

export interface DkaDiagnosis {
  isDka: boolean;
  criteria: { acidemia: boolean; lowBicarb: boolean; highAnionGap: boolean; ketones: boolean };
  /** DKA present with glucose not markedly elevated (implementation heuristic to
   *  surface euglycemic DKA, which is more common in pregnancy). */
  euglycemic: boolean;
}

/** Classic DKA requires acidemia + low bicarbonate + high anion gap + ketones.
 *  Glucose is intentionally NOT part of the criteria (euglycemic DKA). */
export function dkaDiagnosis(labs: DkaLabs): DkaDiagnosis {
  const acidemia = labs.ph !== null && labs.ph < DKA.diagnostic.phMax;
  const lowBicarb = labs.bicarb !== null && labs.bicarb < DKA.diagnostic.bicarbMaxMeqL;
  const highAnionGap = labs.anionGap !== null && labs.anionGap > DKA.diagnostic.anionGapMin;
  const ketones = labs.ketonesElevated;
  const isDka = acidemia && lowBicarb && highAnionGap && ketones;
  const euglycemic = isDka && labs.glucose !== null && labs.glucose !== undefined && labs.glucose < 250;
  return { isDka, criteria: { acidemia, lowBicarb, highAnionGap, ketones }, euglycemic };
}

export interface DkaIcu {
  indicated: boolean;
  reasons: string[];
}

/** ICU consideration: altered sensorium, pH < 7.1, abnormal EKG, or Kussmaul. */
export function dkaIcuCriteria(opts: {
  alteredSensorium: boolean;
  ph: number | null;
  abnormalEkg: boolean;
  kussmaul: boolean;
}): DkaIcu {
  const reasons: string[] = [];
  if (opts.alteredSensorium) reasons.push("Altered sensorium");
  if (opts.ph !== null && opts.ph < 7.1) reasons.push("pH < 7.1");
  if (opts.abnormalEkg) reasons.push("Abnormal EKG");
  if (opts.kussmaul) reasons.push("Kussmaul respiration");
  return { indicated: reasons.length > 0, reasons };
}

// ── Yale insulin infusion protocol (IV drip) ────────────────────────────────
// Ported faithfully from "Insulin IP Calc v2.4" © 2015–2023 John George K.
// (LGPL v3), the user's Yale_infusion_calculator repo. Target band 140–180
// mg/dL. Dynamic: the rate change is driven by the current BG AND its hourly
// rate of change, scaled by a rate-dependent delta. NOT pregnancy-specific — a
// general critical-care protocol; used here as the DKA drip engine at the
// user's request. Decision support only; every rate requires confirmation.
export type YaleActionKind = "INITIATE" | "SET_RATE" | "HOLD_THEN_SET" | "RESCUE";

export interface YaleInput {
  currentBs: number; // mg/dL
  previousBs: number | null; // mg/dL; 0/null = not yet on protocol
  hoursSincePrevious: number; // default 1
  currentRate: number | null; // units/hr; 0/null = not yet infusing
}

export interface YaleResult {
  kind: YaleActionKind;
  newRate: number | null; // resulting infusion rate (units/hr)
  bolusUnits: number | null; // initiation bolus, if any
  bsChangePerHr: number | null; // computed rate of change
  delta: number | null; // delta magnitude from the rate table
  finalDelta: number | null; // signed rate change applied
  holdMinutes: number | null; // hold before resuming (Reduce2 / rescue)
  restartRate: number | null; // suggested restart rate after rescue
  instruction: string;
  warning: string | null;
}

const round05 = (x: number) => Math.round(x * 2) / 2; // nearest 0.5

/** Yale delta: the adjustment unit, scaled to the current infusion rate. */
export function yaleDelta(rate: number): number {
  if (rate < 3) return 0.5;
  if (rate < 6.5) return 1;
  if (rate < 10) return 1.5;
  if (rate < 15) return 2;
  if (rate < 20) return 3;
  if (rate < 25) return 4;
  return 5;
}

function yaleInitiate(cur: number): YaleResult {
  const base = { kind: "INITIATE" as const, bsChangePerHr: null, delta: null, finalDelta: null, holdMinutes: null, restartRate: null, warning: null };
  if (cur >= 100 && cur < 180) {
    return { ...base, newRate: 0.5, bolusUnits: 0, instruction: "Start infusion at 0.5 units/hr. Do not bolus." };
  }
  if (cur >= 180 && cur < 300) {
    const rate = round05((cur / 100) * 2) / 2; // BG/100 rounded to nearest 0.5
    return { ...base, newRate: rate, bolusUnits: 0, instruction: `Start infusion at ${rate} units/hr (BG ÷ 100). Do not bolus.` };
  }
  // cur >= 300
  const b = Math.round(cur / 100); // nearest 1 unit
  return { ...base, newRate: b, bolusUnits: b, instruction: `Give ${b} units IV bolus and start infusion at ${b} units/hr (BG ÷ 100).` };
}

function yaleRescue(level: 1 | 2 | 3, rate: number): YaleResult {
  const base = { kind: "RESCUE" as const, newRate: null, bolusUnits: null, delta: null, finalDelta: null, warning: "Hypoglycemia" };
  if (level === 1) {
    return {
      ...base,
      bsChangePerHr: null,
      holdMinutes: 15,
      restartRate: round05(rate * 0.5),
      instruction:
        "STOP the insulin infusion. Give 1 amp (25 g) D50 IV; recheck BG q15 min until ≥ 100 mg/dL (give another 25 g D50 if BG < 70). Recheck at 1 h; if ≥ 100, restart at 50% of the most recent rate.",
    };
  }
  if (level === 2) {
    return {
      ...base,
      bsChangePerHr: null,
      holdMinutes: 15,
      restartRate: round05(rate * 0.75),
      instruction:
        "STOP the insulin infusion. Give ½ amp (12.5 g) D50 IV; recheck BG q15 min until ≥ 100 mg/dL (give another 12.5 g D50 if BG < 70). Recheck at 1 h; if ≥ 100, restart at 75% of the most recent rate.",
    };
  }
  return {
    ...base,
    bsChangePerHr: null,
    holdMinutes: 30,
    restartRate: round05(rate * 0.75),
    instruction:
      "STOP the insulin infusion. Recheck BG q30 min until ≥ 100 mg/dL (give 12.5 g D50 if BG < 70). Restart at 75% of the most recent rate; resume BG checks q1h.",
  };
}

/**
 * Yale IV insulin infusion recommendation. Returns the next action: initiation,
 * a new rate (with the signed delta), a hold-then-set for large drops, or a
 * hypoglycemia rescue. Target band 140–180 mg/dL.
 */
export function yaleInsulinInfusion(input: YaleInput): YaleResult {
  const cur = input.currentBs;
  const prev = input.previousBs ?? 0;
  const time = input.hoursSincePrevious > 0 ? input.hoursSincePrevious : 1;
  const rate = input.currentRate ?? 0;

  // Initiation: no prior value or not yet infusing, and BG ≥ 100.
  if ((prev === 0 || rate === 0) && cur >= 100) return yaleInitiate(cur);

  const bsChange = (cur - prev) / time;

  // Hypoglycemia rescue.
  if (cur < 50) return yaleRescue(1, rate);
  if (cur <= 69) return yaleRescue(2, rate);
  if (cur <= 99) return yaleRescue(3, rate);

  // Maintenance (target 140–180): pick the signed multiple of delta.
  const delta = yaleDelta(rate);
  let mult: number; // multiples of delta: +2,+1,0,-1,-2
  let hold = false;

  if (cur <= 139) {
    // Range 1: 100–139
    if (bsChange >= 0) mult = 0;
    else if (bsChange >= -20) mult = -1;
    else { mult = -2; hold = true; }
  } else if (cur <= 179) {
    // Range 2: 140–179
    if (bsChange > 20) mult = 1;
    else if (bsChange >= -20) mult = 0;
    else if (bsChange >= -40) mult = -1;
    else { mult = -2; hold = true; }
  } else if (cur <= 249) {
    // Range 3: 180–249
    if (bsChange >= 40) mult = 2;
    else if (bsChange >= 0) mult = 1;
    else if (bsChange >= -40) mult = 0;
    else if (bsChange >= -80) mult = -1;
    else { mult = -2; hold = true; }
  } else {
    // Range 4: ≥ 250
    if (bsChange > 0) mult = 2;
    else if (bsChange >= -40) mult = 1;
    else if (bsChange >= -80) mult = 0;
    else if (bsChange >= -120) mult = -1;
    else { mult = -2; hold = true; }
  }

  const finalDelta = mult * delta;
  const newRate = Math.max(0, rate + finalDelta);
  const warning = finalDelta === 10 ? "Consult MD" : null;

  if (hold) {
    return {
      kind: "HOLD_THEN_SET",
      newRate,
      bolusUnits: null,
      bsChangePerHr: bsChange,
      delta,
      finalDelta,
      holdMinutes: 30,
      restartRate: null,
      instruction: `Large BG drop — HOLD the infusion for 30 min, then set at ${newRate} units/hr (reduce by 2 × delta).`,
      warning,
    };
  }

  const verb = finalDelta === 0 ? "No rate change — continue at" : finalDelta > 0 ? "Increase to" : "Decrease to";
  return {
    kind: "SET_RATE",
    newRate,
    bolusUnits: null,
    bsChangePerHr: bsChange,
    delta,
    finalDelta,
    holdMinutes: null,
    restartRate: null,
    instruction: `${verb} ${newRate} units/hr.`,
    warning,
  };
}

// ── §12 Hypoglycemia (Module J) ─────────────────────────────────────────────
// Threshold is C-01: ADA26 <70 meter / <63 sensor (default), UC23 <60, VB24
// 65–70. The inpatient rescue ladder is UC23 and is internally calibrated to
// <60, so it uses that number regardless of the display threshold.
export type GlucoseSource = "meter" | "sensor";

export function hypoThreshold(source: GlucoseSource, cfg: Config = DEFAULT_CONFIG): number {
  return source === "sensor" ? cfg.hypoThresholdSensor : cfg.hypoThresholdMeter;
}

export function isHypoglycemia(value: number, source: GlucoseSource, cfg: Config = DEFAULT_CONFIG): boolean {
  return value < hypoThreshold(source, cfg);
}

export interface HypoView {
  value: number;
  source: GlucoseSource;
  threshold: number;
  isLow: boolean;
  /** ADA level 2 (clinically significant) hypoglycemia. */
  severe: boolean;
}

export function classifyHypoglycemia(value: number, source: GlucoseSource, cfg: Config = DEFAULT_CONFIG): HypoView {
  const threshold = hypoThreshold(source, cfg);
  return { value, source, threshold, isLow: value < threshold, severe: value < 54 };
}

/** Outpatient treatment knobs — VB24 "no more than 15 g" + UC23 Rule of 15. */
export const OUTPATIENT_HYPO = {
  choGramsMax: 15, // VB24: no more than 15 g to avoid rebound hyperglycemia
  recheckMinutes: [10, 15] as [number, number],
  ruleOf15: { choG: 15, recheckMin: 15, expectedRiseMgdl: 15 }, // UC23
  preExerciseChoIfBgBelow: 100, // UC23
  source: "VB24 · UC23",
} as const;

export interface RescueStep {
  rung: string;
  action: string;
  recheck: string;
  cautions: string[];
}

/** UC23 inpatient rescue ladder for display (calibrated to <60 mg/dL). */
export const INPATIENT_LADDER: ReadonlyArray<{ condition: string; action: string }> = [
  { condition: "BG > 60", action: "Do not treat; ensure 3 meals + 3 snacks on time, 2–3 h apart" },
  { condition: "Alert, can take PO · BG < 60", action: "4 oz apple juice OR 4 glucose tablets (4 g) + 8 oz water" },
  { condition: "Alert, can take PO · BG < 40 + symptoms", action: "8 oz apple juice; do not leave the patient alone" },
  { condition: "Alert, cannot take PO · BG < 60", action: "Glucagon 1 mg IM stat" },
  { condition: "Unconscious / unresponsive", action: "Glucagon 1 mg SC or IM stat; venous access; escalate to IV dextrose" },
];

/**
 * Route to the correct UC23 inpatient rescue rung from bedside state. The ladder
 * is calibrated to the UC23 <60 threshold, so 60 and above is "do not treat".
 */
export function inpatientRescue(bg: number, conscious: boolean, canTakePO: boolean): RescueStep {
  if (!conscious) {
    return {
      rung: "Unconscious / unresponsive",
      action:
        "GLUCAGON 1 mg SC or IM stat; ensure venous access. If BG not > 60 after 15 min, start D5NS or D10NS @ 200 mL/hr until BG > 60 ×2 (D5NS @ 125 mL/hr if BG stays < 20). Notify the attending.",
      recheck: "q5 min until alert and responsive",
      cautions: ["A team member must remain with the patient until fully conscious and normoglycemic"],
    };
  }
  if (bg >= 60) {
    return {
      rung: "BG ≥ 60 — do not treat",
      action: "Do not treat. Ensure 3 meals + 3 snacks on time, 2–3 h apart.",
      recheck: "—",
      cautions: [],
    };
  }
  if (!canTakePO) {
    return {
      rung: "Alert, cannot take PO · BG < 60",
      action: "GLUCAGON 1 mg IM stat.",
      recheck: "q15 min until BG > 60 ×2",
      cautions: [],
    };
  }
  if (bg < 40) {
    return {
      rung: "Alert, can take PO · BG < 40 + symptoms",
      action: "8 oz (1 cup) apple juice. Do not leave the patient alone.",
      recheck: "q15 min until BG > 60 ×2",
      cautions: [],
    };
  }
  return {
    rung: "Alert, can take PO · BG < 60",
    action: "4 oz (½ cup) apple juice OR 4 glucose tablets (4 g each) with 8 oz water.",
    recheck: "q15 min until BG > 60 ×2",
    cautions: ["No complex CHO (milk, cookies, candy, peanut-butter crackers, sandwiches) — it delays glucose absorption"],
  };
}

/** Glucagon rescue products and rules (UC23). */
export const GLUCAGON = {
  gvokeMgSc: 1,
  baqsimiMgIntranasal: 3,
  useEntireDose: true,
  onsetMinutes: 15,
  mayRepeatMinutes: 20,
  positionOnSide: true, // vomiting is common
  homeKitAllInsulinUsers: true,
} as const;

/** Patient-education symptom list (UC23). */
export const HYPO_SYMPTOMS: ReadonlyArray<string> = [
  "Hunger",
  "Headache",
  "Diaphoresis",
  "Weakness / lethargy",
  "Tremulousness",
  "Blurred or tunnel vision",
  "Disorientation",
  "Confusion",
  "Drowsiness",
  "Nausea",
  "Circumoral numbness",
  "Stupor",
  "Loss of consciousness",
  "Seizure",
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

// ── §8 AID / hybrid closed loop (Module F) ──────────────────────────────────
// Automated Insulin Delivery — mostly display/education. The one implementation
// rule (F.2): show each system's MINIMUM achievable target and FLAG when that
// minimum exceeds the pregnancy fasting target range (70–95). UC23 has no AID
// content. Do not automate "fake-carb" dosing (gate behind acknowledgment).
export const PREGNANCY_FASTING_RANGE: [number, number] = [70, 95];

export interface AidRecommendation {
  text: string;
  source: string;
  grade: string;
}

export const AID_RECOMMENDATIONS: ReadonlyArray<AidRecommendation> = [
  { text: "AID with pregnancy-specific glucose targets is recommended for pregnant T1DM", source: "ADA26 15.19", grade: "A" },
  { text: "AID without pregnancy-specific targets may be considered for select T1DM (assistive techniques + experienced team)", source: "ADA26 15.20", grade: "B" },
  { text: "HCL pump suggested over pump+CGM (no algorithm) or MDI+CGM in T1DM", source: "ES25 Rec 8", grade: "2 | ⊕OOO" },
  { text: "Not all HCL algorithms are appropriate for pregnancy", source: "ES25 Rec 8", grade: "remark" },
  { text: "Insufficient evidence for AID in T2DM pregnancy", source: "ES25", grade: "—" },
];

export interface AidSystem {
  label: string;
  minTargetMgdl: number;
  note: string;
}

export const AID_SYSTEMS: ReadonlyArray<AidSystem> = [
  { label: "AiDAPT (pregnancy-specific)", minTargetMgdl: 81, note: "81–90 from 16–20 wk (100 early); FDA-approved, not currently available in the US" },
  { label: "CRISTAL", minTargetMgdl: 100, note: "fixed 100 mg/dL target" },
  { label: "Polsky", minTargetMgdl: 120, note: "120 mg/dL; worse 3rd-trimester mean sensor glucose in the AID arm (132 vs 119)" },
];

export interface AidTargetCheck {
  minTarget: number;
  fastingUpper: number;
  exceedsFasting: boolean;
}

/** Flag a system whose minimum achievable target sits above the pregnancy
 *  fasting target range (i.e. it cannot reach pregnancy goals). */
export function aidTargetCheck(minTargetMgdl: number, fastingUpper = PREGNANCY_FASTING_RANGE[1]): AidTargetCheck {
  return { minTarget: minTargetMgdl, fastingUpper, exceedsFasting: minTargetMgdl > fastingUpper };
}

/** ADA26-named assistive techniques for non-pregnancy-target systems.
 *  "Fake-carb" boluses must never be automated — clinician-directed only. */
export const AID_ASSISTIVE: ReadonlyArray<string> = [
  '"Fake carbohydrate" insulin boluses for carbohydrates not consumed',
  "Alternating between SAP/manual mode and automated mode by time of day or stage of pregnancy",
  "Pump management guided by an experienced interprofessional team",
];

export interface AidEffect {
  label: string;
  md: number; // mean difference (%) or risk ratio
  ci: [number, number];
  significant: boolean;
  isRatio: boolean; // true for RR (LGA/SGA/neonatal hypo)
}

/** ES25 meta-analysis effect sizes (HCL vs standard) for counseling display. */
export const AID_EFFECTS: ReadonlyArray<AidEffect> = [
  { label: "24-h TIR", md: 3.81, ci: [-4.24, 11.86], significant: false, isRatio: false },
  { label: "24-h TBR", md: -0.88, ci: [-2.04, 0.27], significant: false, isRatio: false },
  { label: "Overnight TIR", md: 10.18, ci: [7.42, 12.94], significant: true, isRatio: false },
  { label: "Overnight TBR", md: -0.67, ci: [-0.91, -0.43], significant: true, isRatio: false },
  { label: "LGA", md: 0.82, ci: [0.48, 1.41], significant: false, isRatio: true },
  { label: "SGA", md: 3.03, ci: [0.49, 18.62], significant: false, isRatio: true },
  { label: "Neonatal hypoglycemia", md: 1.19, ci: [0.23, 6.2], significant: false, isRatio: true },
];

export const AID_FRAMING =
  "The overnight benefit is the robust finding; 24-hour and neonatal outcome benefits are not established.";

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
