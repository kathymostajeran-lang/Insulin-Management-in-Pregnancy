/**
 * model.ts — derives the shared view model from patient inputs.
 *
 * This is glue, not clinical logic: it converts units and delegates every dose
 * computation to dosing.ts. No thresholds or formulas live here (CLAUDE.md §3).
 */
import type { Config, TddResult } from "./logic/dosing";
import { computeTdd, tddUC23 } from "./logic/dosing";
import type { PatientInputs, ObesityDosing } from "./config";

export interface PatientModel {
  weightKg: number | null;
  gaWeeks: number | null;
  /** Desirable body weight (kg) from height, Devine formula; null if no height. */
  dbwKg: number | null;
  pctDbw: number | null;
  tdd: TddResult | null;
  /** Human-readable reason the TDD could not be computed, if any. */
  needs: string | null;
}

const LB_PER_KG = 2.2;

export function toKg(weight: number, unit: "kg" | "lb"): number {
  return unit === "lb" ? weight / LB_PER_KG : weight;
}

/** Devine desirable body weight for females, converted to kg. Height in inches. */
export function desirableBodyWeightKg(heightIn: number): number | null {
  if (heightIn <= 60) return null; // Devine defined at/above 5 ft
  const kg = 45.5 + 2.3 * (heightIn - 60);
  return kg;
}

const OBESITY_MULTIPLIER: Record<Exclude<ObesityDosing, "off">, number> = {
  "1.5": 1.5,
  "1.75": 1.75,
  "2.0": 2.0,
};

export function deriveModel(inputs: PatientInputs, cfg: Config): PatientModel {
  const weightKg = inputs.weight === null ? null : toKg(inputs.weight, inputs.unit);
  const gaWeeks = inputs.gaWeeks;
  const dbwKg = inputs.heightIn ? desirableBodyWeightKg(inputs.heightIn) : null;
  const pctDbw = dbwKg && weightKg ? (weightKg / dbwKg) * 100 : null;

  if (weightKg === null) {
    return { weightKg, gaWeeks, dbwKg, pctDbw, tdd: null, needs: "Enter weight to calculate." };
  }

  // Postpartum weeks 0–6: UC23 weight-based 0.4 u/kg.
  if (inputs.stage === "postpartum_0_6") {
    return {
      weightKg,
      gaWeeks,
      dbwKg,
      pctDbw,
      tdd: {
        tdd: tddUC23(weightKg, null, { ppWeeks: 0 }),
        schedule: "UC23",
        rule: "UC Cincinnati 2023 · postpartum wk 0–6 × 0.4 u/kg",
        source: "UC23",
      },
      needs: null,
    };
  }

  // Manual obesity dosing (UC23 >150% DBW branch): clinician-applied multiplier.
  if (inputs.obesityDosing !== "off") {
    const mult = OBESITY_MULTIPLIER[inputs.obesityDosing];
    return {
      weightKg,
      gaWeeks,
      dbwKg,
      pctDbw,
      tdd: {
        tdd: Math.round(weightKg * mult * 10) / 10,
        schedule: "UC23",
        rule: `UC Cincinnati 2023 · obesity >150% DBW × ${mult.toFixed(2)} u/kg`,
        source: "UC23",
      },
      needs: null,
    };
  }

  // VB24 (default) needs a gestational age to pick the trimester factor.
  if (cfg.tddSchedule === "VB24" && gaWeeks === null) {
    return { weightKg, gaWeeks, dbwKg, pctDbw, tdd: null, needs: "Enter gestational age to calculate." };
  }

  return {
    weightKg,
    gaWeeks,
    dbwKg,
    pctDbw,
    tdd: computeTdd(weightKg, gaWeeks, cfg, { pctDbw }),
    needs: null,
  };
}
