/**
 * config.ts — tunable knobs and demonstration data.
 *
 * Behavior changes go here, not scattered through the UI (CLAUDE.md §3). This
 * file holds: the starting-unit / titration-step knobs, the policy switches
 * that resolve the source conflicts (spec §14), the synthetic demo prefill, and
 * the display-only reference tables the UI renders (glycemic targets).
 *
 * The demo prefill is the ONLY patient-shaped data in the repo and is entirely
 * synthetic — never commit real patient data or identifiers (CLAUDE.md §6).
 */
import type { Config, TDDSchedule } from "./logic/dosing";
import { DEFAULT_CONFIG } from "./logic/dosing";

// ── Tunable knobs ───────────────────────────────────────────────────────────
export const TITRATION_STEPS = [0.1, 0.2] as const; // 10% / 20% (VB24)
export const DEFAULT_TITRATION_STEP = 0.1;

/** Doses are displayed rounded to whole units; remainder carried on AM NPH. */
export const DOSE_ROUNDING_UNITS = 1;

/**
 * Policy switches that MUST NOT be silently defaulted (spec §14). These carry a
 * `null` default in the parameters file and require institutional sign-off
 * before the corresponding module can produce a number.
 */
export const UNRESOLVED_POLICY = {
  /** C-15: intrapartum 80–99 mg/dL band. */
  INTRAPARTUM_BAND_80_99: null as null | "HOLD_RECHECK_1H" | "INFUSE_0.5_U_HR",
  /** C-13: postpartum dose method — clinician selects; never auto-picked. */
  POSTPARTUM_DOSE_METHOD: null as
    | null
    | "UC23_PCT_END_PREGNANCY"
    | "VB24_PCT_THIRD_TRIMESTER"
    | "UC23_WEIGHT_BASED",
} as const;

/** The app's default clinical configuration (VB24-forward, ADA26 targets). */
export const APP_CONFIG: Config = { ...DEFAULT_CONFIG };

export const TDD_SCHEDULE_OPTIONS: ReadonlyArray<{ value: TDDSchedule; label: string }> = [
  { value: "VB24", label: "Valent & Barbour 2024 (recommended)" },
  { value: "UC23", label: "UC Cincinnati 2023" },
];

// ── Demo prefill (synthetic — for demonstration only) ───────────────────────
export type Unit = "kg" | "lb";
export type Stage = "pregnant" | "postpartum_0_6";
export type ObesityDosing = "off" | "1.5" | "1.75" | "2.0";

export interface PatientInputs {
  weight: number | null;
  unit: Unit;
  gaWeeks: number | null;
  heightIn: number | null;
  stage: Stage;
  obesityDosing: ObesityDosing;
}

/** Synthetic demonstration inputs — NOT a real patient. 90 kg at 10w reproduces
 *  the VB24 Table 3 worked example (TDD 63). */
export const DEMO_PREFILL: PatientInputs = {
  weight: 90,
  unit: "kg",
  gaWeeks: 10,
  heightIn: 64,
  stage: "pregnant",
  obesityDosing: "off",
};

export const EMPTY_INPUTS: PatientInputs = {
  weight: null,
  unit: "kg",
  gaWeeks: null,
  heightIn: null,
  stage: "pregnant",
  obesityDosing: "off",
};

// ── Display-only reference: ADA26 glycemic targets (Table 15.2) ─────────────
export interface GlycemicWindow {
  label: string;
  target: string;
}

/** ADA26 pregnancy goals shown on the Adjust tab. Source: insulin_parameters.json. */
export const GLYCEMIC_TARGETS: GlycemicWindow[] = [
  { label: "Fasting / pre-prandial", target: "70–95" },
  { label: "1-h postprandial", target: "110–140" },
  { label: "2-h postprandial", target: "100–120" },
];

export const HYPO_THRESHOLD_MGDL = APP_CONFIG.hypoThresholdMeter; // ADA26 <70 meter

// ── CGM tab (§6) ────────────────────────────────────────────────────────────
/** Tagged-value target windows for classifying CGM-derived readings (ADA26). */
export const FASTING_TARGET: [number, number] = [70, 95];
export const PP1H_TARGET: [number, number] = [110, 140];

export interface CgmInputs {
  days: number | null;
  wearPct: number | null;
  dayOfWear: number | null;
  tir: number | null;
  tar: number | null;
  tbr63: number | null;
  tbr54: number | null;
  meanGlucose: number | null;
  overnightMean: number | null;
  // CGM-derived tagged values (feed the titration engine, not the scorecard).
  fasting: number | null;
  postBreakfast: number | null;
  postLunch: number | null;
  postDinner: number | null;
}

// ── Postpartum tab (§13) ────────────────────────────────────────────────────
export interface PostpartumInputs {
  endPregnancyTdd: number | null;
  thirdTrimesterTdd: number | null;
  prepregnancyTdd: number | null;
}

/** Synthetic demo — NOT a real patient. Mirrors the spec §16 PP_options_T2DM
 *  vector (end-pregnancy 120, third-trimester 120, prepregnancy 60). */
export const DEMO_POSTPARTUM: PostpartumInputs = {
  endPregnancyTdd: 120,
  thirdTrimesterTdd: 120,
  prepregnancyTdd: 60,
};

/** Postpartum glycemic target tiers (UC23 / VB24). Display-only reference. */
export interface PostpartumTargetTier {
  phase: string;
  target: string;
  source: string;
}
export const POSTPARTUM_TARGETS: PostpartumTargetTier[] = [
  { phase: "Inpatient", target: "fasting < 126 · 1-h after-meal < 180", source: "UC23" },
  { phase: "Outpatient transition", target: "fasting < 100 · 1-h after-meal < 140", source: "UC23" },
  { phase: "Breastfeeding", target: "1-h after-meal < 150", source: "UC23" },
  { phase: "Pump", target: "80–120", source: "UC23" },
  { phase: "T2DM (acceptable)", target: "fasting 100–125 · random/after-meal 160–180", source: "VB24" },
];

/** Synthetic demonstration CGM window — NOT a real patient. Slightly
 *  out-of-target so the scorecard, basal flag, and tagged values are illustrative. */
export const DEMO_CGM: CgmInputs = {
  days: 14,
  wearPct: 92,
  dayOfWear: 10,
  tir: 64,
  tar: 33,
  tbr63: 3,
  tbr54: 0.5,
  meanGlucose: 128,
  overnightMean: 104,
  fasting: 104,
  postBreakfast: 150,
  postLunch: 128,
  postDinner: 146,
};
