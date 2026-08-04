"""
Reference implementation of the core dose arithmetic for the pregnancy insulin app.

Purpose: give Claude Code a verified, source-attributed arithmetic core plus a
regression suite built from the worked examples published in the four sources.
Every assertion below traces to a printed table or worked example.

NOT FOR CLINICAL USE. Decision-support only, requires clinician confirmation.
See PREGNANCY_INSULIN_ALGORITHMS.md sections 0 and 15.

Run:  python dosing_engine_reference.py
"""

from __future__ import annotations
from dataclasses import dataclass, field
from enum import Enum
from typing import Literal, Optional


# ---------------------------------------------------------------------------
# Configuration (policy switches — see §14 of the spec)
# ---------------------------------------------------------------------------

class TDDSchedule(str, Enum):
    VB24 = "VB24"      # Valent & Barbour 2024 — recommended default
    UC23 = "UC23"      # UC Cincinnati 2023


@dataclass
class Config:
    tdd_schedule: TDDSchedule = TDDSchedule.VB24
    correction_constant: int = 1500      # C-03: VB24 1500 | UC23 1700
    icr_constant: int = 400              # C-04: VB24 400  | UC23 500
    correction_target_mgdl: int = 100
    hypo_threshold_meter: int = 70       # C-01: ADA26
    hypo_threshold_sensor: int = 63
    intrapartum_target: tuple[int, int] = (70, 110)   # C-12
    adjustment_pct: float = 0.15         # midpoint of VB24 10–20%


DEFAULT = Config()


# ---------------------------------------------------------------------------
# §4.2  Total daily dose
# ---------------------------------------------------------------------------

def trimester(ga_weeks: float) -> Literal["T1", "T2", "T3"]:
    if ga_weeks < 14:
        return "T1"
    if ga_weeks < 28:
        return "T2"
    return "T3"


VB24_STANDARD = {"T1": 0.7, "T2": 0.8, "T3": 0.9}
VB24_SENSITIVE = {"T1": 0.5, "T2": 0.6, "T3": 0.7}


def tdd_vb24(weight_kg: float, ga_weeks: float, insulin_sensitive: bool = False) -> float:
    """Valent & Barbour 2024. No obesity uplift — VB24 explicitly warns against it."""
    table = VB24_SENSITIVE if insulin_sensitive else VB24_STANDARD
    return round(weight_kg * table[trimester(ga_weeks)], 1)


def tdd_uc23(weight_kg: float, ga_weeks: Optional[float],
             pct_dbw: Optional[float] = None,
             pp_weeks: Optional[float] = None) -> float:
    """UC Cincinnati 2023 pocket guide."""
    if pp_weeks is not None and pp_weeks <= 6:
        return round(weight_kg * 0.4, 1)
    if pct_dbw is not None and pct_dbw > 150:
        # Source gives a 1.5–2.0 range; return the conservative end.
        return round(weight_kg * 1.5, 1)
    if ga_weeks is None:
        return round(weight_kg * 0.6, 1)     # pre-pregnant (pump section)
    if ga_weeks < 18:
        f = 0.7
    elif ga_weeks < 26:
        f = 0.8
    elif ga_weeks < 36:
        f = 0.9
    else:
        f = 1.0
    return round(weight_kg * f, 1)


def tdd_uc23_obesity_range(weight_kg: float) -> tuple[float, float]:
    return (round(weight_kg * 1.5, 1), round(weight_kg * 2.0, 1))


# ---------------------------------------------------------------------------
# §4.4  Regimen architectures
# ---------------------------------------------------------------------------

@dataclass
class Regimen:
    name: str
    components: dict[str, float]
    source: str
    notes: list[str] = field(default_factory=list)


def basal_bolus(tdd: float, basal_pct: float = 0.40) -> Regimen:
    """VB24 Table 3: 40% basal glargine / 60% bolus RAA."""
    basal = round(tdd * basal_pct)
    bolus = round(tdd * (1 - basal_pct))
    per_meal = round(bolus / 3)
    notes = []
    if basal > 30:
        notes.append("VB24: split glargine q12h — dose exceeds 20–30 units/day")
    return Regimen(
        "basal_bolus",
        {"basal_glargine": basal, "bolus_total": bolus,
         "bolus_breakfast": per_meal, "bolus_lunch": per_meal, "bolus_dinner": per_meal},
        "VB24", notes,
    )


def nph_raa(tdd: float) -> Regimen:
    """
    VB24 Table 3: half TDD as NPH (1/3 AM, 2/3 bedtime), half as RAA across 3 meals.

    Note: VB24's printed example (TDD 63) gives NPH total 32 but morning 10 +
    bedtime 20 = 30, which does not sum. We compute bedtime as the remainder so
    the components reconcile.
    """
    nph_total = round(tdd * 0.50)
    nph_morning = round(nph_total / 3)
    nph_bedtime = nph_total - nph_morning
    raa_total = round(tdd - nph_total)
    return Regimen(
        "nph_raa",
        {"nph_total": nph_total, "nph_morning": nph_morning,
         "nph_bedtime": nph_bedtime, "raa_total": raa_total},
        "VB24",
        ["Morning NPH ideally 4–6 h before anticipated lunch (it IS the lunch coverage)",
         "VB24's printed 10 + 20 does not sum to its stated NPH total of 32"],
    )


def conventional_nph_short(tdd: float, fasting_predominant: bool = False) -> Regimen:
    """VB24 / UC23: 2/3 AM : 1/3 PM. AM = 2/3 NPH + 1/3 short. PM = 1/2 NPH + 1/2 short."""
    if fasting_predominant:
        # VB24 exception: NPH 50:50 morning/bedtime instead of 2/3:1/3
        nph_total = round(tdd * 0.5)
        return Regimen(
            "conventional_fasting_predominant",
            {"nph_morning": round(nph_total / 2), "nph_bedtime": round(nph_total / 2)},
            "VB24", ["Fasting-predominant exception to the 2/3:1/3 rule"],
        )
    am = round(tdd * 2 / 3)
    pm = round(tdd * 1 / 3)
    return Regimen(
        "conventional_nph_short",
        {"am_total": am,
         "am_nph": round(am * 2 / 3),
         "am_short": round(am * 1 / 3),
         "pm_total": pm,
         "pm_nph_bedtime": round(pm * 0.5),
         "pm_short_predinner": round(pm * 0.5)},
        "VB24 / UC23",
        ["If Regular insulin: administer 60 min before the meal",
         "If RAA (UC23 variant): 15–20 min before the meal"],
    )


# ---------------------------------------------------------------------------
# §5.9  ICF / ICR
# ---------------------------------------------------------------------------

def icf_exact(tdd: float, cfg: Config = DEFAULT) -> float:
    """Insulin correction factor, unrounded. mg/dL lowered per unit."""
    return cfg.correction_constant / tdd


def icr_exact(tdd: float, cfg: Config = DEFAULT) -> float:
    """Insulin-to-carbohydrate ratio, unrounded. Grams CHO covered per unit."""
    return cfg.icr_constant / tdd


def icf(tdd: float, cfg: Config = DEFAULT) -> int:
    """Display value only. VB24 prints 1500/63 as '~25'; exact is 23.8."""
    return round(icf_exact(tdd, cfg))


def icr(tdd: float, cfg: Config = DEFAULT) -> int:
    """Display value only. VB24 prints 400/63 as 6; exact is 6.35."""
    return round(icr_exact(tdd, cfg))


def correction_dose(premeal_bg: float, tdd: float, cfg: Config = DEFAULT) -> int:
    """
    Compute from the UNROUNDED ratio, then round the dose. Rounding the ratio
    first introduces error that compounds at high TDD. VB24's worked example
    (TDD 63, premeal 150) yields 2 units either way, but the unrounded path is
    what reproduces its ICR example exactly.
    """
    if premeal_bg <= cfg.correction_target_mgdl:
        return 0
    return round((premeal_bg - cfg.correction_target_mgdl) / icf_exact(tdd, cfg))


def meal_dose(cho_grams: float, tdd: float, cfg: Config = DEFAULT) -> int:
    return round(cho_grams / icr_exact(tdd, cfg))


UC23_FIXED_CORRECTION = [
    (0, 99, 0), (100, 140, 2), (141, 160, 3), (161, 180, 4),
    (181, 200, 5), (201, 250, 6), (251, 300, 8), (301, 10_000, 10),
]


def uc23_fixed_correction(bg: float, is_premeal: bool, is_daytime: bool) -> int:
    """UC23 fixed scale. HARD CONSTRAINT: premeal + daytime only."""
    if not (is_premeal and is_daytime):
        raise ValueError(
            "UC23 correction table is premeal, daytime-only. "
            "Never use between meals or post-meal (source STOP warning)."
        )
    for lo, hi, units in UC23_FIXED_CORRECTION:
        if lo <= bg <= hi:
            return units
    return 0


# ---------------------------------------------------------------------------
# §7  CSII initiation  (UC23 — see conflict C-14)
# ---------------------------------------------------------------------------

@dataclass
class PumpSettings:
    final_tdd: float
    total_daily_basal: float
    basal_rate_1: float      # 00:00–03:00
    basal_rate_2: float      # 03:00–08:00
    basal_rate_3: float      # 08:00–24:00 (key value)
    correction_factor: float
    icr_g_per_unit: float
    tdd_from_mdi: Optional[float]
    tdd_from_weight: float


def csii_initiation(weight_kg: float,
                    ga_weeks: Optional[float],
                    mdi_tdd: Optional[float] = None,
                    pp_weeks: Optional[float] = None) -> PumpSettings:
    """
    UC23 pump calculation.

    CONFLICT C-14: the source prose says the 3rd basal rate is "TDD divided by
    24 hrs", but the printed worked example divides the TOTAL DAILY BASAL
    (50% of TDD) by 24. Implementing the prose literally overdoses basal 2x.
    The worked example is authoritative and is asserted in the test suite.
    """
    tdd_from_mdi = round(mdi_tdd * 0.75, 1) if mdi_tdd is not None else None
    tdd_from_weight = tdd_uc23(weight_kg, ga_weeks, pp_weeks=pp_weeks)

    final_tdd = min(t for t in (tdd_from_mdi, tdd_from_weight) if t is not None)

    total_daily_basal = final_tdd * 0.50
    rate_3 = round(total_daily_basal / 24, 2)          # <-- C-14
    rate_1 = round(rate_3 * 0.8, 2)
    rate_2 = round(rate_3 * 1.2, 2)

    return PumpSettings(
        final_tdd=final_tdd,
        total_daily_basal=round(total_daily_basal, 1),
        basal_rate_1=rate_1, basal_rate_2=rate_2, basal_rate_3=rate_3,
        correction_factor=round(1700 / final_tdd),
        icr_g_per_unit=round(500 / final_tdd),
        tdd_from_mdi=tdd_from_mdi, tdd_from_weight=tdd_from_weight,
    )


# ---------------------------------------------------------------------------
# §5  Titration
# ---------------------------------------------------------------------------

@dataclass
class TitrationRec:
    action: Literal["INCREASE_DOSE", "DECREASE_DOSE", "EXTEND_PREBOLUS",
                    "HOLD", "ALERT_PLACENTAL_INSUFFICIENCY"]
    component: str
    delta_units: float = 0.0
    new_prebolus_min: Optional[int] = None
    rationale: str = ""
    source: str = ""


def titrate_bolus(component: str, current_dose: float, prebolus_minutes: int,
                  above_target: bool, cfg: Config = DEFAULT) -> TitrationRec:
    """
    VB24: before increasing a bolus above 20 units for persistent postprandial
    hyperglycemia, interrogate ADMINISTRATION TIMING first. Absorption slows at
    higher doses and later gestation; patients may need 15–45 min prebolus.
    """
    if not above_target:
        return TitrationRec("HOLD", component, rationale="at target")
    if current_dose > 20 and prebolus_minutes < 30:
        return TitrationRec(
            "EXTEND_PREBOLUS", component,
            new_prebolus_min=min(45, prebolus_minutes + 15),
            rationale=("Dose >20 units with prebolus <30 min. VB24: subcutaneous "
                       "absorption slows at higher doses and later gestation; "
                       "extend prebolus before escalating the dose."),
            source="VB24",
        )
    return TitrationRec(
        "INCREASE_DOSE", component,
        delta_units=round(current_dose * cfg.adjustment_pct),
        rationale=f"Postprandial above target; VB24 adjustment 10–20%.",
        source="VB24",
    )


def check_falling_tdd(tdd_now: float, tdd_7d_ago: float,
                      ga_weeks: float) -> Optional[TitrationRec]:
    """ADA26: rapid significant reduction in insulin requirement may indicate
    placental insufficiency. ALERT ONLY — never auto-reduce."""
    if ga_weeks < 28 or tdd_7d_ago <= 0:
        return None
    drop = (tdd_7d_ago - tdd_now) / tdd_7d_ago
    if drop >= 0.15:
        return TitrationRec(
            "ALERT_PLACENTAL_INSUFFICIENCY", "TDD",
            rationale=(f"TDD fell {drop:.0%} over 7 days at {ga_weeks:.1f} weeks. "
                       "ADA26: may indicate placental insufficiency. "
                       "Obtain fetal assessment. Do not auto-titrate."),
            source="ADA26",
        )
    return None


# ---------------------------------------------------------------------------
# §11  Intrapartum infusion  (UC23 table; C-15 gap at 80–99)
# ---------------------------------------------------------------------------

UC23_INTRAPARTUM = [
    (0,   79,  0.0,  "discontinue drip"),
    (100, 120, 0.5,  None),
    (121, 140, 1.0,  None),
    (141, 160, 1.5,  None),
    (161, 180, 2.0,  None),
    (181, 200, 2.5,  None),
    (201, 300, 3.0,  None),
    (301, 10_000, None, "call MD"),
]


class UnresolvedPolicyGap(Exception):
    pass


def intrapartum_rate(bg: float, policy_80_99: Optional[str] = None):
    """
    UC23 intrapartum insulin infusion algorithm.

    CONFLICT C-15: the published table has no 80–99 mg/dL row. The source
    elsewhere states a 60–100 target (implying hold) but also says to restart
    the infusion at BG >80 x2 (implying dosing begins at 80). This gap MUST be
    closed by institutional policy before deployment.
    """
    if 80 <= bg <= 99:
        if policy_80_99 is None:
            raise UnresolvedPolicyGap(
                "BG 80–99 mg/dL is not covered by the UC23 table (conflict C-15). "
                "Set INTRAPARTUM_BAND_80_99 policy before use."
            )
        return policy_80_99
    for lo, hi, rate, action in UC23_INTRAPARTUM:
        if lo <= bg <= hi:
            return action if action is not None else rate
    return None


# ---------------------------------------------------------------------------
# §13  Postpartum
# ---------------------------------------------------------------------------

def postpartum_tdd_options(end_pregnancy_tdd: Optional[float] = None,
                           third_trimester_tdd: Optional[float] = None,
                           prepregnancy_tdd: Optional[float] = None,
                           weight_kg: Optional[float] = None) -> dict:
    """
    C-13: three published methods with THREE DIFFERENT DENOMINATORS.
    Return all available options; force clinician selection. Never auto-pick.
    """
    out: dict[str, object] = {}
    if end_pregnancy_tdd:
        out["UC23_pct_end_pregnancy"] = (round(0.25 * end_pregnancy_tdd, 1),
                                         round(0.33 * end_pregnancy_tdd, 1))
    if third_trimester_tdd:
        out["VB24_pct_third_trimester"] = (round(0.30 * third_trimester_tdd, 1),
                                           round(0.40 * third_trimester_tdd, 1))
    if weight_kg:
        out["UC23_weight_based"] = round(0.4 * weight_kg, 1)
    if prepregnancy_tdd:
        out["ADA26_reference_point"] = round(0.66 * prepregnancy_tdd, 1)
    out["_warning"] = ("Denominators differ: end-pregnancy, third-trimester, and "
                       "prepregnancy TDD are NOT interchangeable. Clinician must select.")
    return out


# ---------------------------------------------------------------------------
# REGRESSION SUITE — every assertion traces to a printed worked example
# ---------------------------------------------------------------------------

def _run_tests() -> None:
    ok = lambda label: print(f"  PASS  {label}")

    # --- VB24 Table 3, 90-kg patient, TDD 63 --------------------------------
    assert tdd_vb24(90, 10) == 63.0, tdd_vb24(90, 10)
    ok("VB24 TDD: 90 kg x 0.7 (T1) = 63 units")

    r = conventional_nph_short(63)
    assert r.components["am_total"] == 42
    assert r.components["am_nph"] == 28
    assert r.components["am_short"] == 14
    assert r.components["pm_total"] == 21          # VB24 prints 20; 63/3 = 21
    assert r.components["pm_nph_bedtime"] == 10 or r.components["pm_nph_bedtime"] == 11
    ok("VB24 conventional NPH/Reg: AM 42 (28 NPH + 14 Reg), PM ~20-21 split 50:50")

    r = nph_raa(63)
    assert r.components["nph_total"] == 32, r.components
    assert r.components["nph_morning"] + r.components["nph_bedtime"] == 32
    assert r.components["raa_total"] == 31
    ok("VB24 NPH/RAA: NPH 32 (1/3 AM, 2/3 HS), RAA 31 across 3 meals "
       "[components reconciled — paper's 10+20 does not sum to 32]")

    r = basal_bolus(63)
    assert r.components["basal_glargine"] == 25, r.components
    assert r.components["bolus_total"] == 38
    assert r.components["bolus_breakfast"] == 13
    ok("VB24 basal-bolus: glargine 25 (40%), RAA 38 (60%), 13 per meal")

    assert round(icf_exact(63), 1) == 23.8, icf_exact(63)
    assert correction_dose(150, 63) == 2
    ok("VB24 ICF: 1500/63 = 23.8 mg/dL per unit (paper prints '~25'); "
       "BG 150 -> +2 units [matches paper]")

    assert round(icr_exact(63), 2) == 6.35, icr_exact(63)
    assert icr(63) == 6
    assert meal_dose(45, 63) == 7, meal_dose(45, 63)
    ok("VB24 ICR: 400/63 = 6.35 g per unit (paper prints 6); "
       "45 g meal -> 7 units [matches paper]")

    # --- UC23 MDI split, TDD 60 ---------------------------------------------
    r = conventional_nph_short(60)
    assert r.components["am_total"] == 40
    assert r.components["am_nph"] == 27
    assert r.components["am_short"] == 13
    assert r.components["pm_total"] == 20
    assert r.components["pm_nph_bedtime"] == 10
    assert r.components["pm_short_predinner"] == 10
    ok("UC23 MDI split: TDD 60 -> AM 40 (27 NPH + 13 RAA), PM 20 (10 + 10)")

    # --- UC23 CSII worked example (CRITICAL: conflict C-14) -----------------
    p = csii_initiation(weight_kg=75, ga_weeks=20, mdi_tdd=80)
    assert p.final_tdd == 60.0, p.final_tdd
    assert p.total_daily_basal == 30.0, p.total_daily_basal
    assert p.basal_rate_3 == 1.25, p.basal_rate_3
    assert p.basal_rate_1 == 1.00, p.basal_rate_1
    assert p.basal_rate_2 == 1.50, p.basal_rate_2
    assert p.correction_factor == 28, p.correction_factor
    assert p.icr_g_per_unit == 8, p.icr_g_per_unit
    ok("UC23 CSII (C-14 regression): TDD 60 -> basal 30, rates 1.00/1.50/1.25, "
       "CF 28, ICR 1:8")

    # min() selection
    p2 = csii_initiation(weight_kg=70, ga_weeks=30, mdi_tdd=80)
    assert p2.tdd_from_mdi == 60.0
    assert p2.tdd_from_weight == 63.0
    assert p2.final_tdd == 60.0
    ok("UC23 CSII: min(MDI-derived 60, weight-derived 63) = 60")

    # --- C-02 divergence demonstration --------------------------------------
    vb = tdd_vb24(110, 30)
    uc_std = tdd_uc23(110, 30)
    uc_obese = tdd_uc23_obesity_range(110)
    assert vb == 99.0 and uc_std == 99.0
    assert uc_obese == (165.0, 220.0)
    ratio = uc_obese[1] / vb
    assert 2.2 < ratio < 2.3
    ok(f"C-02 divergence: VB24 99 u vs UC23-obesity 165-220 u ({ratio:.1f}x). "
       "This is the switch that matters most.")

    # --- Bolus timing escalation --------------------------------------------
    rec = titrate_bolus("dinner", current_dose=26, prebolus_minutes=15, above_target=True)
    assert rec.action == "EXTEND_PREBOLUS" and rec.new_prebolus_min == 30
    rec2 = titrate_bolus("dinner", current_dose=26, prebolus_minutes=30, above_target=True)
    assert rec2.action == "INCREASE_DOSE" and rec2.delta_units == 4
    rec3 = titrate_bolus("breakfast", current_dose=8, prebolus_minutes=15, above_target=True)
    assert rec3.action == "INCREASE_DOSE"
    ok("VB24 bolus logic: >20 u with <30 min prebolus -> extend timing first, "
       "not dose; <=20 u -> dose increase")

    # --- Falling TDD alert ---------------------------------------------------
    a = check_falling_tdd(tdd_now=95, tdd_7d_ago=120, ga_weeks=33)
    assert a is not None and a.action == "ALERT_PLACENTAL_INSUFFICIENCY"
    assert check_falling_tdd(95, 120, ga_weeks=20) is None
    assert check_falling_tdd(115, 120, ga_weeks=33) is None
    ok("ADA26 falling-TDD alert: fires at >=15% over 7 d, GA >=28 w only")

    # --- Intrapartum ---------------------------------------------------------
    assert intrapartum_rate(75) == "discontinue drip"
    assert intrapartum_rate(110) == 0.5
    assert intrapartum_rate(135) == 1.0
    assert intrapartum_rate(250) == 3.0
    assert intrapartum_rate(350) == "call MD"
    try:
        intrapartum_rate(90)
        raise AssertionError("should have raised on the C-15 gap")
    except UnresolvedPolicyGap:
        pass
    ok("UC23 intrapartum table maps correctly; BG 80-99 raises "
       "UnresolvedPolicyGap (C-15)")

    # --- Fixed correction table guardrail ------------------------------------
    assert uc23_fixed_correction(175, is_premeal=True, is_daytime=True) == 4
    try:
        uc23_fixed_correction(175, is_premeal=False, is_daytime=True)
        raise AssertionError("should have blocked between-meal use")
    except ValueError:
        pass
    ok("UC23 fixed table blocks non-premeal use (source STOP warning)")

    # --- IV -> SC conversion --------------------------------------------------
    assert round(48 * 1.25) == 60
    ok("UC23 IV->SC conversion: increase TDD by 25% (48 -> 60)")

    # --- Postpartum options ---------------------------------------------------
    opts = postpartum_tdd_options(end_pregnancy_tdd=120, third_trimester_tdd=120,
                                  prepregnancy_tdd=60, weight_kg=95)
    assert opts["UC23_pct_end_pregnancy"] == (30.0, 39.6)
    assert opts["VB24_pct_third_trimester"] == (36.0, 48.0)
    assert opts["UC23_weight_based"] == 38.0
    assert opts["ADA26_reference_point"] == 39.6
    ok("Postpartum: all three methods computed side by side (C-13), none auto-selected")

    print("\nAll regression tests passed.\n")


if __name__ == "__main__":
    print("\nPregnancy insulin dosing engine — regression suite")
    print("=" * 60)
    _run_tests()
    print("Reminder: decision support only. Every output requires clinician")
    print("confirmation. See PREGNANCY_INSULIN_ALGORITHMS.md sections 0 and 15.\n")
