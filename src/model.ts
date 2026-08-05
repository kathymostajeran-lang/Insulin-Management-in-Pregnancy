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
  /** Body mass index (kg/m²) from weight + height; null if either is missing. */
  bmi: number | null;
  tdd: TddResult | null;
  /** Human-readable reason the TDD could not be computed, if any. */
  needs: string | null;
}

/** WHO BMI category. Obesity is BMI ≥ 30 (class I 30–34.9, II 35–39.9, III ≥40). */
export function bmiCategory(bmi: number): { label: string; obese: boolean } {
  if (bmi < 18.5) return { label: "Underweight", obese: false };
  if (bmi < 25) return { label: "Normal", obese: false };
  if (bmi < 30) return { label: "Overweight", obese: false };
  if (bmi < 35) return { label: "Obese (class I)", obese: true };
  if (bmi < 40) return { label: "Obese (class II)", obese: true };
  return { label: "Obese (class III)", obese: true };
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

const IN_TO_M = 0.0254;

export function deriveModel(inputs: PatientInputs, cfg: Config): PatientModel {
  const weightKg = inputs.weight === null ? null : toKg(inputs.weight, inputs.unit);
  const gaWeeks = inputs.gaWeeks;
  const dbwKg = inputs.heightIn ? desirableBodyWeightKg(inputs.heightIn) : null;
  const pctDbw = dbwKg && weightKg ? (weightKg / dbwKg) * 100 : null;
  const heightM = inputs.heightIn ? inputs.heightIn * IN_TO_M : null;
  const bmi = weightKg && heightM ? Math.round((weightKg / (heightM * heightM)) * 10) / 10 : null;

  // Fields common to every result, regardless of which TDD branch is taken.
  const base = { weightKg, gaWeeks, dbwKg, pctDbw, bmi };

  if (weightKg === null) {
    return { ...base, tdd: null, needs: "Enter weight to calculate." };
  }

  // Postpartum weeks 0–6: UC23 weight-based 0.4 u/kg.
  if (inputs.stage === "postpartum_0_6") {
    return {
      ...base,
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
      ...base,
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
    return { ...base, tdd: null, needs: "Enter gestational age to calculate." };
  }

  return {
    ...base,
    tdd: computeTdd(weightKg, gaWeeks, cfg, { pctDbw }),
    needs: null,
  };
}
