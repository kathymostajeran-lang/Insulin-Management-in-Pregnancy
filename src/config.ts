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
  drives: string;
}

/** ADA26 goals shown on the Adjust tab. Source: insulin_parameters.json. */
export const GLYCEMIC_TARGETS: GlycemicWindow[] = [
  { label: "Fasting and pre-prandial", target: "70–95", drives: "Bedtime NPH" },
  { label: "1 hour after start of meal", target: "110–140", drives: "Meal bolus" },
];

export const HYPO_THRESHOLD_MGDL = APP_CONFIG.hypoThresholdMeter; // ADA26 <70 meter
