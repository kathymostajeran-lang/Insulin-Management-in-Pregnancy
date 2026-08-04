/**
 * dosing.test.ts — regression suite for the clinical core.
 *
 * Every assertion traces to a printed table or worked example in one of the
 * four sources, mirroring the reference engine's `_run_tests` and the spec's
 * §16 test vectors. Per CLAUDE.md §4, dosing.ts is tested before anything else.
 */
import { describe, it, expect } from "vitest";
import {
  tddVB24,
  tddUC23,
  tddUC23ObesityRange,
  conventionalNphShort,
  nphRaa,
  basalBolus,
  icfExact,
  icrExact,
  icr,
  correctionDose,
  mealDose,
  uc23FixedCorrection,
  HardStopError,
  csiiInitiation,
  titrateBolus,
  checkFallingTdd,
  intrapartumRate,
  UnresolvedPolicyGap,
  postpartumTddOptions,
  pyRound,
  computeTdd,
  DEFAULT_CONFIG,
  evaluateCgm,
  cgmTitrationGate,
  estimatedA1c,
  NotImplementedInPregnancy,
  basalHyperglycemiaSignal,
  classifyWindow,
  type CgmWindow,
  isHypoglycemia,
  hypoThreshold,
  classifyHypoglycemia,
  inpatientRescue,
  steroidEpisode,
  steroidBgAction,
  mathiesenSteroidAdjustment,
  dkaDiagnosis,
  dkaIcuCriteria,
  yaleInsulinInfusion,
  yaleDelta,
} from "./dosing";

describe("pyRound (half-to-even, matches the reference engine)", () => {
  it("rounds halves to even", () => {
    expect(pyRound(10.5)).toBe(10); // matches VB24's printed bedtime NPH
    expect(pyRound(31.5)).toBe(32);
    expect(pyRound(2.5)).toBe(2);
    expect(pyRound(3.5)).toBe(4);
  });
  it("rounds to decimal places", () => {
    expect(pyRound(23.809, 1)).toBe(23.8);
    expect(pyRound(6.349, 2)).toBe(6.35);
  });
});

describe("VB24 Table 3 — 90 kg patient, TDD 63", () => {
  it("TDD: 90 kg × 0.7 (T1) = 63 units", () => {
    expect(tddVB24(90, 10)).toBe(63.0);
  });

  it("conventional NPH/Reg: AM 42 (28 NPH + 14 Reg), PM split 50:50", () => {
    const r = conventionalNphShort(63);
    expect(r.components.am_total).toBe(42);
    expect(r.components.am_nph).toBe(28);
    expect(r.components.am_short).toBe(14);
    expect(r.components.pm_total).toBe(21); // VB24 prints 20; 63/3 = 21
    expect([10, 11]).toContain(r.components.pm_nph_bedtime);
  });

  it("NPH/RAA: NPH 32 (⅓ AM, ⅔ HS), RAA 31 — components reconciled", () => {
    const r = nphRaa(63);
    expect(r.components.nph_total).toBe(32);
    expect(r.components.nph_morning + r.components.nph_bedtime).toBe(32);
    expect(r.components.raa_total).toBe(31);
  });

  it("basal-bolus: glargine 25 (40%), RAA 38 (60%), 13 per meal", () => {
    const r = basalBolus(63);
    expect(r.components.basal_glargine).toBe(25);
    expect(r.components.bolus_total).toBe(38);
    expect(r.components.bolus_breakfast).toBe(13);
  });

  it("ICF: 1500/63 = 23.8 mg/dL per unit; BG 150 → +2 units", () => {
    expect(pyRound(icfExact(63), 1)).toBe(23.8);
    expect(correctionDose(150, 63)).toBe(2);
  });

  it("ICR: 400/63 = 6.35 g/unit (prints 6); 45 g meal → 7 units", () => {
    expect(pyRound(icrExact(63), 2)).toBe(6.35);
    expect(icr(63)).toBe(6);
    expect(mealDose(45, 63)).toBe(7);
  });
});

describe("UC23 MDI split, TDD 60", () => {
  it("AM 40 (27 NPH + 13 RAA), PM 20 (10 + 10)", () => {
    const r = conventionalNphShort(60);
    expect(r.components.am_total).toBe(40);
    expect(r.components.am_nph).toBe(27);
    expect(r.components.am_short).toBe(13);
    expect(r.components.pm_total).toBe(20);
    expect(r.components.pm_nph_bedtime).toBe(10);
    expect(r.components.pm_short_predinner).toBe(10);
  });
});

describe("UC23 CSII worked example — the C-14 regression", () => {
  it("TDD 60 → basal 30, rates 1.00/1.50/1.25, CF 28, ICR 1:8", () => {
    const p = csiiInitiation(75, 20, { mdiTdd: 80 });
    expect(p.finalTdd).toBe(60.0);
    expect(p.totalDailyBasal).toBe(30.0);
    expect(p.basalRate3).toBe(1.25);
    expect(p.basalRate1).toBe(1.0);
    expect(p.basalRate2).toBe(1.5);
    expect(p.correctionFactor).toBe(28);
    expect(p.icrGPerUnit).toBe(8);
  });

  it("selects min(MDI-derived 60, weight-derived 63) = 60", () => {
    const p = csiiInitiation(70, 30, { mdiTdd: 80 });
    expect(p.tddFromMdi).toBe(60.0);
    expect(p.tddFromWeight).toBe(63.0);
    expect(p.finalTdd).toBe(60.0);
  });
});

describe("C-02 divergence — the switch that matters most", () => {
  it("VB24 99 u vs UC23-obesity 165–220 u (~2.2×)", () => {
    const vb = tddVB24(110, 30);
    const ucStd = tddUC23(110, 30);
    const ucObese = tddUC23ObesityRange(110);
    expect(vb).toBe(99.0);
    expect(ucStd).toBe(99.0);
    expect(ucObese).toEqual([165.0, 220.0]);
    const ratio = ucObese[1] / vb;
    expect(ratio).toBeGreaterThan(2.2);
    expect(ratio).toBeLessThan(2.3);
  });
});

describe("VB24 bolus timing escalation", () => {
  it(">20 u with <30 min prebolus → extend timing first", () => {
    const rec = titrateBolus("dinner", 26, 15, true);
    expect(rec.action).toBe("EXTEND_PREBOLUS");
    expect(rec.newPrebolusMin).toBe(30);
  });
  it(">20 u with ≥30 min prebolus → dose increase (15%)", () => {
    const rec = titrateBolus("dinner", 26, 30, true);
    expect(rec.action).toBe("INCREASE_DOSE");
    expect(rec.deltaUnits).toBe(4);
  });
  it("≤20 u → dose increase", () => {
    const rec = titrateBolus("breakfast", 8, 15, true);
    expect(rec.action).toBe("INCREASE_DOSE");
  });
});

describe("ADA26 falling-TDD alert (HS-15)", () => {
  it("fires at ≥15% over 7 d, GA ≥28 w only", () => {
    const a = checkFallingTdd(95, 120, 33);
    expect(a).not.toBeNull();
    expect(a?.action).toBe("ALERT_PLACENTAL_INSUFFICIENCY");
    expect(checkFallingTdd(95, 120, 20)).toBeNull(); // too early
    expect(checkFallingTdd(115, 120, 33)).toBeNull(); // drop too small
  });
});

describe("UC23 intrapartum table", () => {
  it("maps bands correctly", () => {
    expect(intrapartumRate(75)).toBe("discontinue drip");
    expect(intrapartumRate(110)).toBe(0.5);
    expect(intrapartumRate(135)).toBe(1.0);
    expect(intrapartumRate(250)).toBe(3.0);
    expect(intrapartumRate(350)).toBe("call MD");
  });
  it("BG 80–99 raises UnresolvedPolicyGap (C-15) until policy set", () => {
    expect(() => intrapartumRate(90)).toThrow(UnresolvedPolicyGap);
    expect(intrapartumRate(90, "HOLD_RECHECK_1H")).toBe("HOLD_RECHECK_1H");
  });
});

describe("UC23 fixed correction table (HS-01/HS-02 guardrail)", () => {
  it("returns the banded dose premeal + daytime", () => {
    expect(uc23FixedCorrection(175, true, true)).toBe(4);
  });
  it("blocks non-premeal use (source STOP warning)", () => {
    expect(() => uc23FixedCorrection(175, false, true)).toThrow(HardStopError);
  });
});

describe("IV → SC conversion", () => {
  it("increases TDD by 25% (48 → 60)", () => {
    expect(pyRound(48 * 1.25)).toBe(60);
  });
});

describe("Postpartum options (C-13) — none auto-selected", () => {
  it("computes all three methods side by side", () => {
    const opts = postpartumTddOptions({
      endPregnancyTdd: 120,
      thirdTrimesterTdd: 120,
      prepregnancyTdd: 60,
      weightKg: 95,
    });
    expect(opts.UC23_pct_end_pregnancy).toEqual([30.0, 39.6]);
    expect(opts.VB24_pct_third_trimester).toEqual([36.0, 48.0]);
    expect(opts.UC23_weight_based).toBe(38.0);
    expect(opts.ADA26_reference_point).toBe(39.6);
  });
});

describe("CGM module (§6 / §A)", () => {
  const good: CgmWindow = {
    days: 14,
    wearPct: 92,
    tir63_140Pct: 74,
    tarGt140Pct: 22,
    tbrLt63Pct: 3,
    tbrLt54Pct: 0.5,
    meanGlucoseMgdl: 118,
    overnightMeanMgdl: 90,
    dayOfWear: 10,
  };

  it("scorecard evaluates each metric against ADA26 goals", () => {
    const m = evaluateCgm(good);
    expect(m.find((x) => x.key === "tir")?.meets).toBe(true);
    expect(m.find((x) => x.key === "tar")?.meets).toBe(true);
    expect(m.find((x) => x.key === "tbr63")?.meets).toBe(true);
    expect(m.find((x) => x.key === "mean")?.meets).toBeNull(); // informational
  });

  it("flags a failing scorecard", () => {
    const m = evaluateCgm({ ...good, tir63_140Pct: 55, tbrLt63Pct: 6 });
    expect(m.find((x) => x.key === "tir")?.meets).toBe(false);
    expect(m.find((x) => x.key === "tbr63")?.meets).toBe(false);
  });

  it("titration gate allows only ≥10 days, ≥70% wear, not day 1 (HS-10/HS-11)", () => {
    expect(cgmTitrationGate(good).allowed).toBe(true);
    expect(cgmTitrationGate({ ...good, days: 6 }).allowed).toBe(false);
    expect(cgmTitrationGate({ ...good, wearPct: 55 }).allowed).toBe(false);
    expect(cgmTitrationGate({ ...good, dayOfWear: 1 }).allowed).toBe(false);
    expect(cgmTitrationGate({ ...good, days: 6, wearPct: 55 }).reasons.length).toBe(2);
  });

  it("blocks eA1C / GMI display in pregnancy (HS-09)", () => {
    expect(() => estimatedA1c()).toThrow(NotImplementedInPregnancy);
  });

  it("basal-hyperglycemia signal fires when overnight mean exceeds fasting target (D.2)", () => {
    expect(basalHyperglycemiaSignal(110).flag).toBe(true);
    expect(basalHyperglycemiaSignal(90).flag).toBe(false);
    expect(basalHyperglycemiaSignal(null).flag).toBe(false);
  });

  it("classifyWindow tags values against a target window", () => {
    expect(classifyWindow(120, 70, 95)).toBe("high");
    expect(classifyWindow(60, 70, 95)).toBe("low");
    expect(classifyWindow(85, 70, 95)).toBe("in_range");
    expect(classifyWindow(60, null, 95)).toBe("in_range"); // no lower bound (GDM A1)
  });
});

describe("Hypoglycemia module (§12)", () => {
  it("threshold is ADA26 <70 meter / <63 sensor by default (C-01)", () => {
    expect(hypoThreshold("meter")).toBe(70);
    expect(hypoThreshold("sensor")).toBe(63);
    expect(isHypoglycemia(65, "meter")).toBe(true);
    expect(isHypoglycemia(72, "meter")).toBe(false);
    expect(isHypoglycemia(62, "sensor")).toBe(true);
    expect(isHypoglycemia(64, "sensor")).toBe(false);
  });

  it("flags level-2 (severe) hypoglycemia below 54", () => {
    expect(classifyHypoglycemia(50, "meter").severe).toBe(true);
    expect(classifyHypoglycemia(58, "meter").severe).toBe(false);
  });

  it("inpatient rescue routes by consciousness, PO ability, and BG (UC23 <60)", () => {
    expect(inpatientRescue(45, false, true).rung).toContain("Unconscious"); // unconscious overrides
    expect(inpatientRescue(80, true, true).rung).toContain("do not treat"); // ≥60
    expect(inpatientRescue(55, true, false).action).toContain("GLUCAGON 1 mg IM"); // cannot take PO
    const severe = inpatientRescue(35, true, true);
    expect(severe.rung).toContain("< 40");
    expect(severe.action).toContain("8 oz");
    const mild = inpatientRescue(50, true, true);
    expect(mild.action).toContain("4 oz");
    expect(mild.cautions[0]).toContain("complex CHO");
  });
});

describe("Steroid module (§9)", () => {
  it("classifies the episode by hours since first dose", () => {
    expect(steroidEpisode(24, true).phase).toBe("pre_peak");
    expect(steroidEpisode(60, false).phase).toBe("peak");
    expect(steroidEpisode(100, false).phase).toBe("resolution");
    expect(steroidEpisode(400, false).phase).toBe("resolved");
  });

  it("suspends baseline titration through ~2 weeks and schedules reviews", () => {
    expect(steroidEpisode(24, true).baselineTitrationSuspended).toBe(true);
    expect(steroidEpisode(24, true).nextReviewDay).toBe(7);
    expect(steroidEpisode(200, false).nextReviewDay).toBe(14); // ~8.3 days
    const resolved = steroidEpisode(400, false);
    expect(resolved.baselineTitrationSuspended).toBe(false);
    expect(resolved.nextReviewDay).toBeNull();
  });

  it("sets the monitoring cadence by NPO status inside the 72-h window", () => {
    expect(steroidEpisode(24, true).monitoringActive).toBe(true);
    expect(steroidEpisode(24, true).monitoringCadence).toContain("q8h");
    expect(steroidEpisode(24, false).monitoringCadence).toContain("AC and HS");
    expect(steroidEpisode(100, false).monitoringActive).toBe(false);
  });

  it("escalates above 200 mg/dL, routing by insulin status", () => {
    expect(steroidBgAction(220, true).escalate).toBe(true);
    expect(steroidBgAction(220, true).message).toContain("aggressively");
    expect(steroidBgAction(220, false).message).toContain("carbohydrate-counting");
    expect(steroidBgAction(180, false).escalate).toBe(false);
  });

  it("Mathiesen betamethasone adjustment applies the per-day factors to baseline", () => {
    const base = { breakfast: 10, lunch: 8, dinner: 12, hs: 20 };
    // Day 1: only nighttime (HS) +25%, meals unchanged
    const d1 = mathiesenSteroidAdjustment(base, 1);
    expect(d1.breakfast).toEqual([10, 10]);
    expect(d1.hs).toEqual([25, 25]);
    // Day 2: all +40%
    const d2 = mathiesenSteroidAdjustment(base, 2);
    expect(d2.breakfast).toEqual([14, 14]);
    expect(d2.lunch).toEqual([11, 11]); // 8 × 1.4 = 11.2 → 11
    expect(d2.dinner).toEqual([17, 17]); // 12 × 1.4 = 16.8 → 17
    expect(d2.hs).toEqual([28, 28]);
    // Day 4: all +20%
    expect(mathiesenSteroidAdjustment(base, 4).hs).toEqual([24, 24]);
    // Day 5: 10–20% range
    expect(mathiesenSteroidAdjustment(base, 5).hs).toEqual([22, 24]);
    // Day 6: taper back to baseline
    const d6 = mathiesenSteroidAdjustment(base, 6);
    expect(d6.taper).toBe(true);
    expect(d6.hs).toEqual([20, 20]);
  });
});

describe("DKA module (§10)", () => {
  it("requires acidemia + low bicarb + high anion gap + ketones", () => {
    const full = dkaDiagnosis({ ph: 7.2, bicarb: 12, anionGap: 18, ketonesElevated: true });
    expect(full.isDka).toBe(true);
    // Missing ketones → not DKA
    expect(dkaDiagnosis({ ph: 7.2, bicarb: 12, anionGap: 18, ketonesElevated: false }).isDka).toBe(false);
    // Normal pH → not DKA
    expect(dkaDiagnosis({ ph: 7.38, bicarb: 12, anionGap: 18, ketonesElevated: true }).isDka).toBe(false);
  });

  it("flags euglycemic DKA (glucose not part of the criteria)", () => {
    expect(dkaDiagnosis({ ph: 7.2, bicarb: 12, anionGap: 18, ketonesElevated: true, glucose: 180 }).euglycemic).toBe(true);
    expect(dkaDiagnosis({ ph: 7.2, bicarb: 12, anionGap: 18, ketonesElevated: true, glucose: 380 }).euglycemic).toBe(false);
  });

  it("escalates to ICU on any of altered sensorium / pH<7.1 / abnormal EKG / Kussmaul", () => {
    expect(dkaIcuCriteria({ alteredSensorium: false, ph: 7.05, abnormalEkg: false, kussmaul: false }).indicated).toBe(true);
    expect(dkaIcuCriteria({ alteredSensorium: true, ph: 7.2, abnormalEkg: false, kussmaul: false }).reasons).toContain("Altered sensorium");
    expect(dkaIcuCriteria({ alteredSensorium: false, ph: 7.2, abnormalEkg: false, kussmaul: false }).indicated).toBe(false);
  });
});

describe("Yale insulin infusion protocol", () => {
  it("rate-dependent delta table", () => {
    expect(yaleDelta(2)).toBe(0.5);
    expect(yaleDelta(4)).toBe(1);
    expect(yaleDelta(8)).toBe(1.5);
    expect(yaleDelta(12)).toBe(2);
    expect(yaleDelta(17)).toBe(3);
    expect(yaleDelta(22)).toBe(4);
    expect(yaleDelta(25)).toBe(5);
  });

  it("initiation: BG<180 → 0.5 u/hr; 180–299 → BG/100; ≥300 → bolus + infusion", () => {
    const a = yaleInsulinInfusion({ currentBs: 150, previousBs: 0, hoursSincePrevious: 1, currentRate: 0 });
    expect(a.kind).toBe("INITIATE");
    expect(a.newRate).toBe(0.5);
    expect(a.bolusUnits).toBe(0);
    expect(yaleInsulinInfusion({ currentBs: 200, previousBs: 0, hoursSincePrevious: 1, currentRate: 0 }).newRate).toBe(2.0);
    const c = yaleInsulinInfusion({ currentBs: 350, previousBs: 0, hoursSincePrevious: 1, currentRate: 0 });
    expect(c.newRate).toBe(4);
    expect(c.bolusUnits).toBe(4);
  });

  it("maintenance: rising in 180–249 increases by 1×delta", () => {
    const r = yaleInsulinInfusion({ currentBs: 200, previousBs: 170, hoursSincePrevious: 1, currentRate: 4 });
    expect(r.kind).toBe("SET_RATE");
    expect(r.bsChangePerHr).toBe(30);
    expect(r.finalDelta).toBe(1);
    expect(r.newRate).toBe(5);
  });

  it("maintenance: in-band stable → no change", () => {
    const r = yaleInsulinInfusion({ currentBs: 160, previousBs: 155, hoursSincePrevious: 1, currentRate: 2 });
    expect(r.finalDelta).toBe(0);
    expect(r.newRate).toBe(2);
  });

  it("large drop → hold 30 min then reduce by 2×delta", () => {
    const r = yaleInsulinInfusion({ currentBs: 120, previousBs: 150, hoursSincePrevious: 1, currentRate: 6 });
    expect(r.kind).toBe("HOLD_THEN_SET");
    expect(r.holdMinutes).toBe(30);
    expect(r.newRate).toBe(4); // 6 + (-2 × 1)
  });

  it("high rate + big increase flags Consult MD (finalDelta 10)", () => {
    const r = yaleInsulinInfusion({ currentBs: 260, previousBs: 250, hoursSincePrevious: 1, currentRate: 25 });
    expect(r.finalDelta).toBe(10);
    expect(r.newRate).toBe(35);
    expect(r.warning).toBe("Consult MD");
  });

  it("hypoglycemia rescue rungs (<50 / 50–69 / 70–99)", () => {
    expect(yaleInsulinInfusion({ currentBs: 45, previousBs: 120, hoursSincePrevious: 1, currentRate: 4 }).kind).toBe("RESCUE");
    expect(yaleInsulinInfusion({ currentBs: 60, previousBs: 120, hoursSincePrevious: 1, currentRate: 4 }).restartRate).toBe(3); // 75% of 4
    expect(yaleInsulinInfusion({ currentBs: 45, previousBs: 120, hoursSincePrevious: 1, currentRate: 4 }).restartRate).toBe(2); // 50% of 4
    expect(yaleInsulinInfusion({ currentBs: 85, previousBs: 120, hoursSincePrevious: 1, currentRate: 4 }).warning).toBe("Hypoglycemia");
  });
});

describe("computeTdd dispatch (C-02 schedule switch)", () => {
  it("defaults to VB24", () => {
    const r = computeTdd(90, 10, DEFAULT_CONFIG);
    expect(r.schedule).toBe("VB24");
    expect(r.tdd).toBe(63.0);
  });
  it("uses UC23 when configured", () => {
    const r = computeTdd(110, 30, { ...DEFAULT_CONFIG, tddSchedule: "UC23" });
    expect(r.schedule).toBe("UC23");
    expect(r.tdd).toBe(99.0);
  });
});
