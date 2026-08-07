/** Tests for the input-derivation glue (BMI, obesity classification). */
import { describe, it, expect } from "vitest";
import { deriveModel, bmiCategory } from "./model";
import { EMPTY_INPUTS, APP_CONFIG } from "./config";

describe("BMI derivation", () => {
  it("computes BMI from weight (kg) + height (in)", () => {
    const m = deriveModel({ ...EMPTY_INPUTS, weight: 90, unit: "kg", heightIn: 64, gaWeeks: 10 }, APP_CONFIG);
    expect(m.bmi).toBe(34.1); // 90 / (64 in → 1.6256 m)² = 34.06 → 34.1
  });

  it("converts lb → kg before computing BMI", () => {
    const m = deriveModel({ ...EMPTY_INPUTS, weight: 198, unit: "lb", heightIn: 64 }, APP_CONFIG);
    expect(m.bmi).toBe(34.1); // 198 lb ≈ 90 kg → same BMI
  });

  it("is null when height is missing", () => {
    const m = deriveModel({ ...EMPTY_INPUTS, weight: 90, unit: "kg" }, APP_CONFIG);
    expect(m.bmi).toBeNull();
  });
});

describe("bmiCategory (WHO)", () => {
  it("classifies across the range and flags obesity at ≥ 30", () => {
    expect(bmiCategory(17).label).toBe("Underweight");
    expect(bmiCategory(22).obese).toBe(false);
    expect(bmiCategory(27).label).toBe("Overweight");
    expect(bmiCategory(31)).toEqual({ label: "Obese (class I)", obese: true });
    expect(bmiCategory(37).label).toBe("Obese (class II)");
    expect(bmiCategory(41).label).toBe("Obese (class III)");
  });
});
