# Diabetes in Pregnancy — Insulin Management Algorithm Specification

**Purpose:** Machine-consumable clinical logic specification for an insulin management application covering initiation, SMBG/CGM-driven titration, CSII, DKA, intrapartum, and postpartum dosing across GDM, T2DM, and T1DM in pregnancy.

**Audience:** Claude Code (implementation), MFM/endocrine clinical reviewers (validation).

**Status:** Draft v1.0 — every numeric parameter is source-attributed. Conflicts are enumerated in §14 and exposed as configuration switches, not silently resolved.

---

## 0. Safety and regulatory preamble (read before implementing)

1. **This is not a validated device.** An application that outputs patient-specific insulin doses is likely to meet the FDA definition of Clinical Decision Support that is *not* exempt under 21st Century Cures §3060, because the clinician cannot independently review the basis for the recommendation in real time when the output is a dose number. Confirm regulatory posture before any use outside personal reference. Design mitigations: always display the input values, the formula, the source, and the intermediate arithmetic alongside every output.
2. **No auto-execution.** Every dose output must require explicit clinician confirmation. No module may write to an EMR or pump without a human-in-the-loop step.
3. **Hard stops must be implemented as blocking, not advisory** (see §15).
4. **Source currency.** The UC Cincinnati pocket guide (2023) is the oldest source and contains content that is now outdated (detemir availability, AID absence, aspirin dose). It should not be the default for any parameter where a 2024–2026 source exists. See §1.
5. **Unresolved internal inconsistencies exist within individual sources** (§14 conflicts C-14, C-15). These are transcription-level ambiguities in the published documents, not interpretation disputes. They must be resolved by institutional policy before implementation, not by the app.

---

## 1. Source registry and recommended precedence

| ID | Citation | Scope | Currency |
|----|----------|-------|----------|
| `ADA26` | ADA Professional Practice Committee. Standards of Care in Diabetes—2026, §15. *Diabetes Care* 2026;49(Suppl 1):S321–S338. | Targets, CGM, AID, drug safety, postpartum screening, aspirin, BP | Jan 2026 |
| `ES25` | Wyckoff JA, Lapolla A, et al. Preexisting Diabetes and Pregnancy: Endocrine Society/ESE Joint CPG. *JCEM* 2025;110:2405–2452. | GRADE recommendations: CGM targets, HCL, metformin add-on, GLP-1RA, delivery timing, postpartum care | Jul 2025 |
| `VB24` | Valent AM, Barbour LA. Insulin Management for Gestational and Type 2 Diabetes in Pregnancy. *Obstet Gynecol* 2024;144:633–47. | Insulin initiation, regimen selection, titration mechanics, ICF/ICR, concentrated insulin | Nov 2024 |
| `UC23` | University of Cincinnati MFM. Diabetes and Pregnancy Pocket Guide for Healthcare Professionals, 2023. | Weight-based TDD, CSII calculation, hypoglycemia protocol, DKA, IV infusion, intrapartum, immediate PP, steroids | 2023 |

### Recommended precedence by domain

```
targets_and_monitoring        : ADA26 > ES25 > VB24 > UC23
mdi_initiation_and_titration  : VB24 > UC23        (ADA26/ES25 give no dosing formulas)
csii_and_pump_math            : UC23 (sole source) — validate constants against VB24
aid_hcl                       : ES25 + ADA26       (UC23 has no AID content)
inpatient_dka                 : UC23 (sole source)
iv_infusion_and_intrapartum   : UC23 (protocol) + VB24/ADA26 (target range)
postpartum_dosing             : VB24 > UC23        (ADA26 gives physiology, not doses)
non_glycemic_pharmacology     : ADA26 (sole current source)
delivery_timing               : ES25
```

**Rationale for `VB24 > UC23` in MDI:** VB24 is a 2024 Clinical Expert Series authored by Barbour (also an ES25 panelist), explicitly warns against the higher weight-based starting doses UC23 uses in obesity, and reflects current rapid-acting-analog practice. UC23's regimen architecture is structurally identical to VB24's "Conventional NPH/Reg" pathway but with older constants.

---

## 2. Shared data model

```python
@dataclass
class PatientState:
    # Identity / classification
    dm_type: Literal["T1DM", "T2DM", "GDM_A1", "GDM_A2", "EARLY_HYPERGLYCEMIA"]
    # Gestational
    ga_weeks: float                    # 0.0–42.0; use decimal weeks (e.g., 28.4 = 28w3d)
    is_postpartum: bool
    pp_days: Optional[int]
    # Anthropometrics
    weight_kg: float                   # CURRENT weight unless flagged
    prepregnancy_weight_kg: Optional[float]
    height_m: float
    prepregnancy_bmi: Optional[float]
    desirable_body_weight_kg: Optional[float]   # required only for UC23 obesity branch
    # Therapy
    delivery_system: Literal["NONE","MDI","CSII","AID"]
    current_tdd_units: Optional[float]
    basal_agent: Optional[Literal["NPH","GLARGINE_U100","GLARGINE_U300","DEGLUDEC","REGULAR_U500"]]
    bolus_agent: Optional[Literal["LISPRO","ASPART","FASTER_ASPART","REGULAR","INHALED_TECHNOSPHERE"]]
    on_metformin: bool
    on_glp1ra: bool
    # Comorbidity flags that gate logic
    chronic_htn: bool
    nephropathy: bool
    prior_preeclampsia: bool
    fgr_risk: bool
    retinopathy_grade: Optional[str]
    hypoglycemia_unawareness: bool
    # Monitoring
    monitoring_mode: Literal["SMBG","CGM","BOTH"]
    # Context
    on_corticosteroids: bool
    steroid_dose_time: Optional[datetime]
    in_labor: bool
    npo: bool
```

```python
@dataclass
class GlucoseReading:
    value_mgdl: float
    timestamp: datetime
    tag: Literal["FASTING","PREMEAL_B","PREMEAL_L","PREMEAL_D",
                 "PP1H_B","PP1H_L","PP1H_D",
                 "PP2H_B","PP2H_L","PP2H_D",
                 "BEDTIME","OVERNIGHT_3AM","RANDOM"]
    source: Literal["METER","CGM","LAB"]
```

```python
@dataclass
class CGMWindow:
    days: int                          # require >= 10 for titration decisions; >=14 preferred
    tir_63_140_pct: float
    tar_gt140_pct: float
    tbr_lt63_pct: float
    tbr_lt54_pct: float
    mean_glucose_mgdl: float
    overnight_mean_mgdl: Optional[float]     # 00:00–06:00
    cv_pct: Optional[float]
```

---

## 3. Module A — Glycemic targets and monitoring

### A.1 Capillary/plasma glucose targets

`ADA26` Table 15.2. `ES25` Recommendation 7 endorses the identical fasting/postprandial framework.

```json
{
  "T1DM":  {"fasting":[70,95],  "pp_1h":[110,140], "pp_2h":[100,120]},
  "T2DM":  {"fasting":[70,95],  "pp_1h":[110,140], "pp_2h":[100,120]},
  "GDM_A2":{"fasting":[70,95],  "pp_1h":[110,140], "pp_2h":[100,120]},
  "GDM_A1":{"fasting":[null,95],"pp_1h":[null,140],"pp_2h":[null,120]}
}
```

Implementation rules:
- Lower bounds **do not apply** to T2DM managed with nutrition alone (`ADA26`).
- Use **either** the 1-h **or** the 2-h postprandial target, not both, per diabetes type column (`ADA26` Table 15.2 footnote). Expose as a per-patient setting.
- If targets cannot be met without significant hypoglycemia, permit clinician-set relaxed targets with documented rationale (`ADA26`).
- Postprandial timing is measured **from the start of the meal** (`UC23`).

### A.2 A1C

| Parameter | Value | Source |
|---|---|---|
| Preconception goal | <6.5% (<48 mmol/mol) | `ADA26` 15.3 |
| Pregnancy goal | <6% (<42 mmol/mol) if achievable without significant hypoglycemia; relax to <7% | `ADA26` 15.9 |
| Monitoring interval | May need monthly | `ADA26` |
| **Prohibited** | Do not compute or display GMI / estimated A1C from CGM in pregnancy | `ADA26` 15.13 |

Implement `estimated_a1c()` as raising `NotImplementedInPregnancy`. Display CGM **mean glucose** instead (`ADA26`: mean glucose superior to eA1C/GMI in pregnancy).

### A.3 CGM metrics

`ADA26` (goals validated for **T1DM**; same sensor ranges endorsed for T2DM/GDM but time-in-range goal amounts not quantifiable due to insufficient data):

```json
{
  "sensor_range_mgdl": [63, 140],
  "tir_goal_pct_min": 70,
  "tbr_lt63_goal_pct_max": 4,
  "tbr_lt54_goal_pct_max": 1,
  "tar_gt140_goal_pct_max": 25,
  "goals_validated_for": ["T1DM"],
  "t2dm_gdm": "ranges endorsed, time-in-range goal amount undefined"
}
```

`ES25` adds: TIR >90% is *often suggested* for T2DM but is **not** evidence-based.

### A.4 CRITICAL — CGM metrics are a scorecard, not a titration target

`ES25` **Recommendation 7** (2 | ⊕OOO): *suggest against* using a single 24-h CGM target of <140 mg/dL (63–140) **in place of** fasting <95 / 1-h PP <140 / 2-h PP <120 for insulin adjustment. `ADA26` 15.12 concurs: CGM metrics used *in combination with* BGM to achieve pre/postprandial goals, and CGM TIR "does not provide actionable data to address fasting and postprandial hypo- or hyperglycemia."

**Implementation requirement:** the titration engine's decision inputs are **time-tagged glucose values**, not aggregate CGM metrics. CGM metrics may be displayed and may trigger review flags, but must never be the sole input to a dose-change recommendation. Where CGM is the data source, derive tagged values (fasting = mean 04:00–07:00 pre-meal; PP1h = value at meal_start + 60 min) and feed those to the same engine used for SMBG.

Rationale a reviewer will ask about: `ES25` cites evidence that basal/overnight hyperglycemia contributes 66.5–74.9% of the elevated glucose burden in T1DM pregnancy (Ling 2024), and that distinct 24-h glycemic phenotypes with identical TIR carry different LGA/preterm/NICU risk (Battarbee 2024).

### A.5 Monitoring schedule

```
SMBG minimum:      fasting + 1-h or 2-h post each meal (4/day)   [ADA26, UC23]
Add preprandial:   when on CSII or basal–bolus MDI               [ADA26]
Add bedtime/3AM:   T1DM, nocturnal hypoglycemia workup, NPH use  [UC23]
CGM + meter:       UC23 requires >=4 meter checks/day if CGM used, plus meter
                   confirmation for CGM <60 or >200, and before driving.
                   ADA26 permits non-adjunctive use of a validated sensor with
                   fingerstick confirmation for: post-hypoglycemia correction,
                   symptom–sensor mismatch, and day 1 of wear.
                   -> CONFLICT C-09
```

### A.6 CGM indication by type

| Type | `ADA26` | `ES25` |
|---|---|---|
| T1DM | **Recommend** CGM (15.11, grade A) | Consistent |
| T2DM | Insufficient data; individualize | Either CGM **or** SMBG (Rec 6, 2 \| ⊕OOO) |
| GDM | Insufficient data; individualize | Not addressed |

App behavior: enable CGM module for all types; surface an evidence-strength badge (`A` / `individualize`) rather than gating.

---

## 4. Module B — Insulin initiation (MDI)

### B.1 Trigger for pharmacotherapy

`VB24`: initiate when **≥20% of measured glucose values (fasting or postprandial) are above the pregnancy target range**.

```python
def should_initiate_insulin(readings: list[GlucoseReading], window_days=7) -> bool:
    w = [r for r in readings if within(r, window_days)]
    if len(w) < 14: return False          # insufficient data guard
    above = sum(1 for r in w if r.value_mgdl > target_upper(r.tag))
    return above / len(w) >= 0.20
```

`ADA26` 15.15: for GDM, lifestyle first and may suffice; add insulin if needed. `ADA26` 15.17: insulin is first-line for T1DM, preferred for T2DM and GDM.

### B.2 Total daily dose — two competing schedules (CONFLICT C-02)

**Option `VB24` (recommended default):**

```json
{
  "standard": {"T1":0.7, "T2":0.8, "T3":0.9},
  "insulin_sensitive_or_RAA_based": {"T1":0.5, "T2":0.6, "T3":0.7},
  "range": [0.5, 0.9],
  "obesity_modifier": "NONE — VB24 explicitly warns that higher weight-based dosing in obesity increases hypoglycemia risk, defensive eating, weight gain, and worsening insulin resistance"
}
```
Trimester boundaries for `VB24`: T1 <14w, T2 14–27w6d, T3 ≥28w (standard obstetric definitions; VB24 does not restate them).

**Option `UC23`:**

```json
{
  "by_ga_weeks": [
    {"range":[1,18],  "units_per_kg":0.7},
    {"range":[18,26], "units_per_kg":0.8},
    {"range":[26,36], "units_per_kg":0.9},
    {"range":[36,40], "units_per_kg":1.0}
  ],
  "obesity_gt_150pct_DBW": [1.5, 2.0],
  "postpartum_wk_0_6": 0.4,
  "weight_conversion": "lb / 2.2 = kg"
}
```

> **Do not implement both silently.** Expose `TDD_SCHEDULE = "VB24" | "UC23"` as an institutional configuration constant. In a Houston T2DM/GDM population with high obesity prevalence, the UC23 obesity branch (1.5–2.0 u/kg) can produce a starting TDD 2–3× the VB24 output for the same patient. Worked example in §16.

### B.3 Regimen selection

Route on the **pattern** of hyperglycemia, per `VB24` Fig 2:

```
IF fasting hyperglycemia only
    -> bedtime basal
       NPH 0.1–0.2 units/kg immediately before bedtime           [VB24, ADA26]
       (glargine an alternative; detemir NO LONGER AVAILABLE — see C-20)
       titrate q3–7 days until fasting target met

ELIF postprandial hyperglycemia only
    -> premeal bolus
       RAA 0.2–0.4 units/kg/day divided across 3 meals            [VB24]
       adjust each meal dose for that meal's CHO content
       titrate q3–7 days until postprandial target met

ELSE (fasting AND postprandial)
    -> full regimen, TDD 0.5–0.9 units/kg                         [VB24]
       select architecture from B.4
```

### B.4 Regimen architectures

All examples below use `TDD = 63 units` (90 kg × 0.7), matching `VB24` Table 3 so implementations can be unit-tested against the published arithmetic.

**(a) Basal–bolus (glargine + RAA)** — preferred when variable sleep/work/mealtimes, or patient wants self-management autonomy.
```
basal  = 0.40 × TDD                       # 25 units glargine
bolus  = 0.60 × TDD                       # 38 units RAA
per_meal = bolus / 3                      # 13 units, or size-weighted (12/10/16)
```
- Split glargine q12h if dose >20–30 units/d (`VB24`).
- `VB24` alternative framing: basal 40–50%, bolus 50–60%.
- `ADA26`: bolus fraction **increases** as pregnancy advances in preexisting diabetes. `UC23`: after 1st trimester, shift toward 60% bolus / 40% basal.

**(b) NPH + RAA** — marked fasting hyperglycemia with variable postprandial/mealtimes.
```
nph_total   = 0.50 × TDD                  # 32 units
nph_morning = nph_total / 3               # 10 units before breakfast
                                          #   (ideally 4–6 h before anticipated lunch)
nph_bedtime = nph_total × 2/3             # 20 units at bedtime
raa_total   = 0.50 × TDD                  # 31 units across 3 meals
```
Note `VB24`: when RAA is used for meals, **less** daytime NPH is needed — roughly one-third of the NPH total in the morning.

**(c) Conventional NPH/Regular (2/3 : 1/3 rule)** — cost-constrained access, consistent mealtimes, no night shifts.
```
am_dose = 2/3 × TDD                       # 42 units
  am_nph = 2/3 × am_dose                  # 28 units before breakfast
  am_reg = 1/3 × am_dose                  # 14 units, 60 min before breakfast
pm_dose = 1/3 × TDD                       # 20–21 units
  pm_nph = 0.5 × pm_dose                  # 10 units at bedtime
  pm_reg = 0.5 × pm_dose                  # 10 units, 60 min before dinner
```
`UC23` implements the identical architecture with RAA substituted for Regular:
```
TDD 60 -> AM 40 (NPH 27 + RAA 13), PM 20 (RAA 10 pre-dinner + NPH 10 bedtime)
```
**Exception to the 2/3:1/3 rule** (`VB24`): predominant fasting hyperglycemia → NPH split **50:50** morning/bedtime rather than 2/3:1/3.

### B.5 Agent selection constraints

| Agent | Pregnancy status | Implementation rule |
|---|---|---|
| Lispro, Aspart | Widely safe/effective | Default bolus |
| Faster aspart | Similar growth/A1C vs aspart; higher TIR, less severe hypo in T1DM secondary analysis (`ADA26`) | Selectable |
| Regular U-100 | 2nd line for PP hyperglycemia if RAA not covered | **Force 60-min pre-meal timing**; max BID; not within 5 h of prior dose |
| NPH | Intermediate | Bedtime for fasting hyperglycemia; AM dose covers lunch |
| Glargine U-100 | Widely used; no increased adverse fetal outcomes vs NPH | Default basal for basal–bolus |
| Glargine U-300 | Useful if glargine >80 units/d | Apply **10–20% dose reduction** on U-100→U-300 switch |
| Lispro U-200 | Consider when bolus >25 units | Apply **10% dose reduction** on U-100→U-200 switch |
| Regular U-500 | Reserve for TDD >300 units/d; extreme insulin resistance | Require co-management flag; PK resembles NPH |
| Degludec | Noninferior to detemir (EXPECT); DOA ≥42 h | **Minimum 3–4 days between dose changes** (`ADA26`); reduce >2–3 days before delivery (`VB24`); flag PP hypoglycemia risk |
| **Detemir** | **Removed from market** (`ADA26`; `VB24` anticipated end-2024) | **Do not offer.** `UC23` still lists it — C-20 |
| Premixed (NPH/aspart, NPH/lispro, NPH/reg) | **Avoid in pregnancy** — components not independently adjustable, nocturnal hypo risk (`VB24`) | Block |
| Inhaled Technosphere | Does not cross placenta; optimal dosing undetermined in pregnancy | Investigational flag only |
| Concentrated (any) | TDD >200 units → consider | Require diabetologist co-management flag |

### B.6 Non-insulin agents

| Agent | Rule | Source |
|---|---|---|
| Metformin | **Not first-line** in pregnancy; crosses placenta (cord levels ≥ maternal) | `ADA26` 15.21 |
| Metformin added to insulin in **preexisting T2DM** | **Suggest against routine addition** (2 \| ⊕OOO) | `ES25` Rec 4 |
| Metformin — absolute avoid | chronic HTN, preeclampsia, FGR risk, nephropathy | `ADA26`; `ES25` (MiTy SGA subgroup) |
| Metformin for PCOS/ovulation induction | **Discontinue by end of first trimester** | `ADA26` 15.22 |
| Metformin already on preconception | Safe in T1 (poor placental crossing before cation transporters upregulate); may stop at end of T1 after organogenesis to avoid hyperglycemia rebound | `ES25`, `ADA26` |
| Glyburide | Not first-line; ↑neonatal hypoglycemia, macrosomia; cord levels 50–70% maternal | `ADA26` 15.21 |
| GLP-1RA / dual GIP-GLP-1RA | **Discontinue before conception**, not after positive test; contraception while on therapy | `ES25` Rec 3; `ADA26` |
| — semaglutide | ≥2 months before planned pregnancy | `ADA26` (manufacturer) |
| — tirzepatide | ≥1 month (Canadian label; no US recommendation) | `ADA26` |
| GLP-1RA discontinuation sequencing | Achieve preconception glycemic goals **after** discontinuation and **before** conception; several months typically required | `ADA26`, `ES25` |

`UC23` lists metformin as 1st-line oral agent for GDM and provides glyburide/acarbose protocols. This is **discordant with `ADA26` 15.21 and `ES25` Rec 4** — see C-11. Retain `UC23` oral-agent protocols only behind an explicit "insulin not feasible" pathway (cost, comprehension, cultural — a use case `ADA26` does acknowledge).

---

## 5. Module C — SMBG-driven titration

### C.1 Decision window and cadence

| Parameter | Value | Source |
|---|---|---|
| Steady state after dose change | 2–3 days | `VB24` |
| Clinician-led review cadence | every 1–2 weeks | `VB24`, `ADA26` |
| Patient-led self-titration cadence | every 2–3 days (well-informed patients) | `VB24` |
| Data window for pattern recognition | 3–14 days | `VB24` |
| Uptitration continues until | ~36 weeks | `VB24`, `ADA26` |
| Expected trajectory | TDD ↑ ~5%/week from ~16w through 36w; ~2× prepregnancy by term | `ADA26` |
| Degludec exception | ≥3–4 days between changes | `ADA26` |

### C.2 Out-of-range criterion (choose one; CONFLICT C-05)

```
CRITERION_A (VB24 majority-of-studies): >=2 values at the SAME time period
             above target within a given week
CRITERION_B (VB24 alternative):         20–50% of values at that time period out of range
CRITERION_C (VB24 initiation rule):     >=20% of all values above target
```
Default recommendation: **Criterion A** for titration (more sensitive, matches the every-1–2-week cadence), Criterion C for initiation.

### C.3 Magnitude

```
standard_adjustment = 10% to 20% of the component dose        [VB24]
```
Individualize by: gestational age, magnitude of elevation above target, glucose variability at that time period, prior response to a dose increase.

Aggressive alternative for fasting hyperglycemia only (`VB24`, McGovern retrospective, N=111): **patient-led bedtime NPH increase of 2–4 units every day while fasting glucose >90 mg/dL.** Associated with higher insulin doses, tighter control, lower birth weight, no increase in hypoglycemia vs weekly clinician-led titration. Expose as `AGGRESSIVE_BASAL_TITRATION` opt-in with mandatory hypoglycemia-education gate.

### C.4 Pattern → dose mapping

```
FASTING elevated
  ├─ overnight/3AM value NORMAL or HIGH ──> ↑ bedtime basal (NPH or long-acting) 10–20%
  ├─ overnight/3AM value LOW ─────────────> ↓ bedtime basal   (Somogyi / overinsulinization)
  └─ pre-bedtime value HIGH ──────────────> ↑ dinner bolus (underdosed dinner RAA/Reg
                                             causing sustained overnight rise)      [VB24]

PP after BREAKFAST elevated  -> ↑ breakfast bolus 10–20%
PP after LUNCH elevated      -> ↑ lunch bolus; OR ↑ morning NPH if NPH-based regimen
                                (morning NPH is the lunch coverage)                 [VB24]
PP after DINNER elevated     -> ↑ dinner bolus 10–20%

PREMEAL LUNCH elevated       -> ↑ breakfast bolus or morning NPH
PREMEAL DINNER elevated      -> ↑ lunch bolus or morning NPH
PREMEAL BREAKFAST elevated   -> treat as FASTING

ALL values elevated proportionally -> ↑ TDD 10–20%, preserve basal:bolus ratio
```

### C.5 Bolus timing escalation (frequently missed; implement as an explicit check)

Before increasing a bolus dose for persistent postprandial hyperglycemia, `VB24` requires interrogating **administration timing**:

> With advancing gestation and increasing insulin resistance, subcutaneous dissociation and absorption slow at higher bolus doses — **particularly above 20 units**. Patients may need to administer RAA **15–45 minutes** before meals to achieve the same peak effect previously seen at 10–20 minutes.

```python
def titrate_bolus(meal, current_dose, prebolus_minutes, ga_weeks):
    if postprandial_above_target(meal):
        if current_dose > 20 and prebolus_minutes < 30:
            return Recommendation(action="EXTEND_PREBOLUS",
                                  new_prebolus_min=min(45, prebolus_minutes + 15),
                                  dose_change=0,
                                  source="VB24")
        return Recommendation(action="INCREASE_DOSE",
                              dose_change=round_units(current_dose * 0.15),
                              source="VB24")
```

Baseline pre-meal timing: RAA 15–20 min; ultrarapid lispro/aspart immediately before; Regular 30–60 min (prefer 60); inhaled immediately before.

### C.6 First-trimester DECREASE branch

`VB24`, `ADA26`: patients requiring insulin in early gestation may need **dose reduction** in the first trimester due to increased insulin sensitivity, nausea, or vomiting, with increased susceptibility to overnight hypoglycemia. The engine must permit negative recommendations before 14 weeks and must not treat a falling TDD in T1 as nonadherence.

### C.7 Falling insulin requirement in the third trimester — ALERT, do not auto-titrate

`ADA26`: a rapid and significant reduction in insulin requirements may indicate **placental insufficiency** (data conflicting). Implement as a non-dismissible clinical alert prompting fetal assessment, not as an automatic dose reduction.

Suggested trigger: ≥15% TDD reduction over 7 days, or ≥2 consecutive weeks of declining requirement, at GA ≥28 weeks.

### C.8 Exercise modifier

`VB24`: insulin requirements may fall by **as much as 20%** with high-intensity physical activity before or after a meal. Options: reduce the RAA dose before a meal in close proximity to exercise, or consume a 15-g CHO snack with high-quality protein and fat pre-exercise. Basal may also need adjustment for extended activity.

`UC23`: if BG <100 mg/dL before exercise, consume 15 g CHO.

### C.9 Insulin-sensitivity factor and carb ratio (self-management tier)

| Parameter | `VB24` | `UC23` (pump section) | Conflict |
|---|---|---|---|
| ICF / correction factor | **1500** ÷ TDD (T2D and GDM use the lower 1500 value; range 1500–1800) | **1700** ÷ TDD | C-03 |
| ICR | **400** ÷ TDD (T2D and GDM can use the lower 400 value; range 400–500) | **500** ÷ TDD | C-04 |
| Correction target | 100 mg/dL | 100 mg/dL (implied by scale) | — |

`VB24` worked example (TDD 63): ICF = 1500/63 ≈ 25 → 1 unit per 25 mg/dL above 100. Preprandial 150 → +2 units RAA on top of the meal dose. ICR = 400/63 ≈ 6 g/unit → a 45-g meal ≈ 7 units RAA given 15–20 min before eating.

`UC23` worked example (TDD 60): CF = 1700/60 ≈ 28; ICR = 500/60 ≈ 8 g/unit.

> **Note a transcription error in `VB24` Table 3:** the *labels* for ICR and ICF descriptions are transposed ("ICR: how many mg/dL of glucose will be lowered with 1 unit"). The formulas and worked examples are internally correct. Implement from the formulas, not the prose labels.

### C.10 Fixed correction scale (`UC23`) — implement with caution

`UC23` pre-meal correction table (Humalog/Novolog, de Veciana & Evans 2007):

| BG (mg/dL) | Units |
|---|---|
| <100 | 0 |
| 100–140 | 2 |
| 141–160 | 3 |
| 161–180 | 4 |
| 181–200 | 5 |
| 201–250 | 6 |
| 251–300 | 8 |
| >300 | 10 |

Hard constraints from the source, both marked with STOP icons:
- Use **during the day only, BEFORE meals**.
- **Do not** use to treat between meals.
- **Never** use post-meal sliding scale insulin — leads to overtreatment without preventing fetal hyperglycemia exposure.

Design objection to surface in the UI: this table is TDD-independent, so it delivers the same correction to a 30-unit/day GDM patient at 20 weeks and a 200-unit/day T2DM patient at 36 weeks. `VB24` prefers the calculated ICF. Recommend `CORRECTION_METHOD = "ICF"` as default with the fixed table available as a fallback for patients who cannot perform the calculation. See C-06.

### C.11 Concentrated insulin thresholds

```
TDD > 200 units/day        -> consider concentrated preparation          [VB24]
Glargine > 80 units/day    -> consider U-300 (reduce dose 10–20%)        [VB24]
Bolus  > 25 units/meal     -> consider lispro U-200 (reduce dose 10%)    [VB24]
TDD > 300 units/day        -> consider Regular U-500 (PK ~ NPH)          [VB24]
Any concentrated insulin   -> require endocrine/MFM co-management flag   [VB24]
```

---

## 6. Module D — CGM-driven titration

Per §A.4, CGM data is **converted to tagged values** and routed through Module C. This module defines the conversion and the supplementary CGM-only flags.

### D.1 Derivation of tagged values from CGM

```python
FASTING_WINDOW   = (time(4,0), time(7,0))     # pre-first-meal
PP1H_OFFSET_MIN  = 60
PP2H_OFFSET_MIN  = 120
OVERNIGHT_WINDOW = (time(0,0), time(6,0))

def derive_tagged(cgm_series, meal_log, days=14):
    fasting = median_of_daily(cgm_series, FASTING_WINDOW, days)
    pp1h    = {m: cgm_at(m.start + PP1H_OFFSET_MIN) for m in meal_log}
    overnight_mean = mean_over(cgm_series, OVERNIGHT_WINDOW, days)
    return TaggedSet(fasting=fasting, pp1h=pp1h, overnight_mean=overnight_mean)
```
Require ≥10 days of ≥70% sensor wear before permitting a CGM-derived titration recommendation.

### D.2 Basal hyperglycemia quantification (drives basal vs bolus allocation)

`ES25` cites Ling 2024 (N=112, T1DM): basal hyperglycemia (BHG) — AUC where glucose ≥95 mg/dL but below the subject's own mean fasting glucose — contributed:
- 74.9% of hyperglycemic burden when TIR <60%
- 69.2% when TIR 60–78%
- 66.5% when TIR ≥78%

and BHG contributed **more** than postprandial hyperglycemia to LGA, preterm birth, and preeclampsia, but **less** to neonatal hypoglycemia.

Implementation: compute `overnight_mean` and `basal_hyperglycemia_auc`. When overnight mean is above target, weight the recommendation toward **basal** escalation even if TIR appears acceptable.

### D.3 CGM phenotype flags (review triggers, not dose changes)

`ES25` reports 4 clusters from Battarbee 2024 (N=177, preexisting DM), with distinct outcome profiles at similar aggregate metrics:

```json
[
 {"label":"well_controlled",              "mean_mgdl":123, "flags":[]},
 {"label":"suboptimal_high_variability",  "mean_mgdl":154, "flags":["LGA_OR_3.34"]},
 {"label":"suboptimal_minimal_circadian", "mean_mgdl":148, "flags":["PTB_OR_2.59","CD_OR_2.76","NICU_OR_4.08"]},
 {"label":"peak_overnight_hyperglycemia", "mean_mgdl":166, "flags":["LGA_OR_3.72","NEO_HYPO_OR_3.53","PREE_OR_2.54","NICU_OR_3.15"]}
]
```
Use to escalate review priority. Do not map to dose changes.

### D.4 CGM quality guards

- Day 1 of sensor wear: `ADA26` reports %20/20 agreement of 78.6% on day 1 rising to 96.3–97.3% by days 4–10 (Dexcom G7 pregnancy validation). Suppress titration recommendations from day-1 data.
- Confirm with fingerstick: after hypoglycemia correction (interstitial lag), symptom–sensor mismatch, day 1 of wear (`ADA26`).
- `UC23` states CGM tends to **underestimate** BG vs SMBG and requires meter confirmation for values <60 and >200. See C-09.

---

## 7. Module E — CSII (pump) initiation and titration

Sole source: `UC23` (adapted from Walsh 2000). No competing algorithm exists in `ADA26`, `ES25`, or `VB24`.

### E.1 Initiation calculation

```python
def csii_initiation(mdi_tdd, weight_kg, ga_weeks, is_postpartum, pp_weeks=None):
    # Step 1–2: MDI conversion, 25% reduction
    tdd_from_mdi = mdi_tdd * 0.75

    # Step 3: weight-based TDD
    if is_postpartum and pp_weeks is not None and pp_weeks <= 6:
        factor = 0.4
    elif ga_weeks is None:                      # pre-pregnant
        factor = 0.6
    elif ga_weeks < 18:  factor = 0.7
    elif ga_weeks < 26:  factor = 0.8
    elif ga_weeks < 36:  factor = 0.9
    else:                factor = 1.0
    tdd_from_weight = weight_kg * factor

    # Step 4: choose the LOWER of the two
    final_tdd = min(tdd_from_mdi, tdd_from_weight)

    # Step 5: basal fraction
    total_daily_basal = final_tdd * 0.50

    # Step 6: three basal rates  ***SEE CONFLICT C-14 BEFORE IMPLEMENTING***
    basal_3 = total_daily_basal / 24            # 08:00–24:00  (key value)
    basal_1 = basal_3 * 0.8                     # 00:00–03:00
    basal_2 = basal_3 * 1.2                     # 03:00–08:00

    # Step 7–8
    correction_factor = 1700 / final_tdd
    icr               = 500  / final_tdd

    return PumpSettings(final_tdd, total_daily_basal,
                        [(0,3,basal_1),(3,8,basal_2),(8,24,basal_3)],
                        correction_factor, icr)
```

**Published worked example (`UC23`), use as the unit test:**
```
TDD = 60 units
  total daily basal = 60 × 0.5 = 30 units
  basal_3 = 30 / 24        = 1.25 units/hr   (08:00–24:00)
  basal_1 = 1.25 × 0.8     = 1.00 units/hr   (00:00–03:00)
  basal_2 = 1.25 × 1.2     = 1.50 units/hr   (03:00–08:00)
  CF      = 1700 / 60      = 28 mg/dL per unit
  ICR     = 500 / 60       = 8 g CHO per unit  (1:8)
```

> **CONFLICT C-14 — internal inconsistency in the source.** The `UC23` prose states the third basal rate is "TDD divided by 24 hrs," but the worked example divides the **Total Daily Basal Insulin** (30 units) by 24. Implementing the prose literally produces basal rates **2× too high**. The worked example is arithmetically consistent with a 50% basal fraction and must be treated as authoritative. Implement `total_daily_basal / 24` and hard-code the worked example as a regression test.

The 03:00–08:00 rate being 1.2× reflects the dawn phenomenon; 00:00–03:00 at 0.8× reflects the nadir of overnight insulin requirement. Both scale with the key value.

### E.2 Basal:bolus evolution

`UC23`: initial pump split 50% basal / 50% bolus; **after the first trimester the ratio often changes to 60% bolus / 40% basal** due to rising CHO-associated insulin resistance (Journsay 1998). `ADA26` and `VB24` concur directionally (bolus fraction rises with gestation; VB24 basal–bolus MDI default is 40/60 from the outset).

Implementation: recompute the basal fraction at each trimester transition and prompt review, do not auto-apply.

### E.3 Pump titration

`UC23` provides no distinct pump titration algorithm beyond re-running the initiation calculation at each GA window transition. Recommendation: apply Module C pattern logic to pump components —

```
fasting elevated                -> ↑ overnight basal rate(s) 10–20% (Ling: basal is dominant driver)
pre-lunch / pre-dinner elevated -> ↑ preceding daytime basal
postprandial elevated           -> tighten ICR (decrease the g/unit divisor)
premeal corrections repeatedly
  under-correcting              -> tighten CF (decrease the mg/dL/unit divisor)
```
Recompute weight-based TDD at each GA window boundary (18, 26, 36 weeks) and compare with observed TDD as a plausibility check.

### E.4 Pump agent

`UC23`: the insulin used in the CSII pump for pregnancy is **aspart or lispro**. `VB24` concurs (RAAs most commonly used).

### E.5 Candidacy and co-management

`VB24`: CSII requires a significant learning curve; because of device features, psychosocial burden, and adherence demands (carb counting, prebolusing, troubleshooting), CSII **preferentially should be started before pregnancy** and managed by clinicians who can support extensive education and frequent follow-up. `ADA26` 15.18: either MDI or pump acceptable in T1DM, neither superior.

---

## 8. Module F — AID / hybrid closed loop

`UC23` has **no AID content** — do not use it as a source here.

### F.1 Recommendation strength

| Statement | Source | Grade |
|---|---|---|
| AID with **pregnancy-specific** glucose targets recommended for pregnant T1DM | `ADA26` 15.19 | A |
| AID **without** pregnancy-specific targets may be considered for **select** T1DM patients, with assistive techniques and an experienced team | `ADA26` 15.20 | B |
| HCL pump suggested over pump+CGM (no algorithm) or MDI+CGM in T1DM | `ES25` Rec 8 | 2 \| ⊕OOO |
| Not all HCL algorithms are appropriate for pregnancy | `ES25` Rec 8 technical remark | — |
| Insufficient evidence for AID in T2DM pregnancy | `ES25` (research consideration) | — |

### F.2 Target configuration

AiDAPT protocol targets (`ADA26`, `ES25`):
```json
{
  "early_pregnancy_target_mgdl": 100,
  "from_16_20_weeks_target_mgdl": [81, 90],
  "note": "the AiDAPT system is FDA-approved but not currently available in the US (ADA26)"
}
```
Other studied systems: CRISTAL used a fixed 100 mg/dL target; Polsky used 120 mg/dL (higher than the pregnancy fasting target — this trial showed *worse* third-trimester mean sensor glucose in the AID arm, 132 vs 119 mg/dL).

**Implementation rule:** the app must display each system's **minimum achievable target** and flag when that minimum exceeds the pregnancy fasting target range (70–95). `ES25`: "not all HCL algorithms can meet these targets."

### F.3 Assistive techniques (for non-pregnancy-target systems)

`ADA26` names, from CRISTAL/Polsky protocols:
- Administration of "fake carbohydrate" insulin boluses for carbohydrates not consumed
- Alternating between SAP/manual mode and automated mode at different times of day or stages of pregnancy
- Pump management determined by expert guidance from an experienced interprofessional team

Gate this pathway behind an explicit acknowledgment screen. Do not automate fake-carb dosing.

### F.4 Effect sizes (for patient counseling display)

`ES25` meta-analysis, HCL vs standard:
```
24-h TIR      MD +3.81%   (95% CI −4.24 to 11.86)   [not significant]
24-h TBR      MD −0.88%   (95% CI −2.04 to 0.27)    [not significant]
Overnight TIR MD +10.18%  (95% CI 7.42 to 12.94)    [significant]
Overnight TBR MD −0.67%   (95% CI −0.91 to −0.43)   [significant]
LGA           RR 0.82     (0.48–1.41)
SGA           RR 3.03     (0.49–18.62)
Neonatal hypo RR 1.19     (0.23–6.20)
```
`ADA26` AiDAPT: TIR +10.5% between-group (P<0.001), TAR −10.2%, A1C −0.31%.

Honest framing for the app: the overnight benefit is the robust finding; 24-hour and neonatal outcome benefits are not established.

### F.5 Peripartum AID

`ADA26`: prespecified observational analysis (CRISTAL) — continuing AID intrapartum improved intrapartum TIR and gave similar early-PP TIR vs standard therapy, without severe hypoglycemia. AiDAPT extension: 6-month PP AID gave higher TIR and lower mean glucose without a significant hypoglycemia difference. `ES25` (Stewart): 82% TIR during labor and delivery, mean 124 ± 36 mg/dL, maintained across vaginal, elective cesarean, and emergency cesarean delivery.

This conflicts with `UC23`'s instruction to discontinue or halve pump basal in labor — see C-18.

---

## 9. Module G — Antenatal corticosteroid hyperglycemia

Sole source: `UC23`.

```
PHYSIOLOGY
  transient hyperglycemia after first dose, peak response at 48–72 h
  onset may be delayed several days; may persist 1–2 weeks
  typical maximum BG in non-diabetic pregnancy < 180 mg/dL

MONITORING
  check BG for 72 h after steroid administration
  q8h while NPO;  AC + HS while on regular diet
  after 72 h: if BG < 200 mg/dL -> discontinue BG monitoring
  if BG > 200 mg/dL during the 72-h screening window ->
      initiate carbohydrate-counting pregnancy diet
      check BG 7×/day
      treat as necessary

TREATMENT
  RAA on an as-needed basis for BG > 200 mg/dL
  patients already on insulin: increase doses aggressively and proportionately
      to the level of hyperglycemia
  if hyperglycemia persists > 3 days post-administration ->
      consider initiating treatment (oral or insulin)
      CAUTION: transient response typically resolves 1–2 weeks post-steroid;
      BG values are anticipated to return to pretreatment levels
```

**Implementation:** create a time-bounded `steroid_episode` state that (a) suspends the normal titration engine's "persistent hyperglycemia" logic for 7–14 days so the app does not permanently escalate a patient's baseline regimen for a transient effect, and (b) auto-schedules a de-escalation review at day 7 and day 14 post-dose.

`UC23` also lists other insulin-requirement amplifiers: obesity, sepsis/other infections.

---

## 10. Module H — Diabetic ketoacidosis

Sole source: `UC23`. (`ADA26` notes DKA occurs at lower glucose in pregnancy, carries high stillbirth risk, and often requires dextrose-containing IVF with an insulin drip; it gives no numeric protocol.)

### H.1 Recognition

```json
{
  "incidence_pregestational_T1DM": "5–10%",
  "euglycemic_dka": "MORE COMMON IN PREGNANCY — do not require hyperglycemia to diagnose",
  "diagnostic_labs": {"pH": "<7.3", "bicarb_mEq_L": "<15",
                      "anion_gap": ">10", "serum_ketones": "elevated"},
  "risk_factors": ["T1DM","new-onset DM","infection (respiratory, UTI)",
                   "nonadherence","insulin pump failure","corticosteroids"],
  "symptoms": ["abdominal pain","nausea","vomiting","altered sensorium"]
}
```

### H.2 Initial evaluation

```
Vital signs, EKG
VBG  (ABG if altered sensorium, unstable vitals, or nonreassuring fetal tracing —
      obtain VBG while awaiting ABG)
CMP with anion gap
Serum ketones
Etiology workup (infectious, etc.)
Fetal assessment — classical teaching: DO NOT INTERVENE (deliver) while in DKA
ICU consideration if: altered sensorium OR pH < 7.1 OR abnormal EKG OR Kussmaul
```

### H.3 Fluids

```
Hour 1        : 1 L normal saline
Hours 2–4     : 0.5–1 L/hour
Thereafter    : 250 mL/hr 0.45% NS until 80% of deficit corrected
Once BG < 300 : change to D5 ½NS, then follow the intrapartum IV insulin algorithm
```

### H.4 Insulin

```
Loading dose  : 0.1–0.4 units/kg
Maintenance   : 2–10 units/hour (start with the labor insulin drip protocol, adjust)
Escalation    : DOUBLE the insulin infusion rate if BG does not decrease by 20%
                in the first 2 hours (if hyperglycemic)
Duration      : continue insulin until bicarbonate and anion gap normalize
                (NOT until glucose normalizes)
Euglycemic DKA: may need D5 to permit continued insulin administration
```

### H.5 Electrolytes

```
POTASSIUM
  K normal or reduced -> consider infusion of K up to 15–20 mEq/hr
  K elevated          -> no supplemental K until levels normal, then 20–30 mEq/L
PHOSPHATE
  replace if serum phosphate < 1.0 mg/dL, OR cardiac dysfunction present,
  OR patient obtunded
```

### H.6 Ongoing monitoring

```
BG                      q1h
Vital signs             q1–2h
Electrolytes + AG, VBG,
  ketones               until pH / anion gap normalize
Maternal ECG, pulse ox  continuous
Fetal                   CEFM if > 24 weeks; otherwise FHT q4–8h
Foley catheter, I&O     hourly
Consults                NICU, Anesthesia
```

---

## 11. Module I — Antepartum IV infusion, intrapartum management, delivery planning

### I.1 Antepartum IV insulin infusion (`UC23`)

```
Check BG on admission and q1h
Discontinue ALL subcutaneous insulin
Target capillary BG 60–100 mg/dL
Order "Diabetes Consistent CHO Meal Plan for Pregnancy"
  compute ICR for meals: 500 / TDD = ICR (units/g); inject to cover meals
IV fluids @ 125 mL/hr (LR or D5NS)
Insulin drip: Regular insulin 100 units / 100 mL NS (1 unit/mL), start 0.5 units/hr,
  titrate per the IV insulin algorithm
CONVERSION BACK TO SC: when converting to SC split-dose weight-based insulin,
  INCREASE the TDD by 25% to reduce risk of hyperglycemia
```
Note the symmetry with pump initiation: MDI→CSII reduces TDD 25%; IV→SC increases TDD 25%.

### I.2 Delivery planning (`UC23`)

```
Insulin      : give usual dose the day prior to delivery;
               DISCONTINUE insulin at midnight; NPO until delivery
Oral agents  : usual dose the day before; discontinue the day of delivery
BG frequency : q1h in active labor; q2h in latent labor
Escalation   : if BG > 110 and < 140 mg/dL ×2, OR > 140 mg/dL ×1
                 -> start IV insulin infusion
Active labor : hold all insulin, NPO until delivery
Induction    : manage as active labor. If IOL is prolonged, discontinue pitocin in
               time to give usual dinner calories, then give pre-dinner RAA and
               HS NPH.
```

### I.3 Intrapartum insulin infusion (`UC23`)

Applies to T1DM and T2DM. **GDM A2 usually does not require insulin during labor unless BG >110 mg/dL.** `VB24` concurs: GDM often does not require insulin in labor unless requirements are high; insulin requirements typically decrease during active stage 1 and stage 2.

```
Check BG on admission and q1h; discontinue all SC insulin
Target capillary BG 60–100 mg/dL
NPO or non-CHO-containing clear liquids
IV fluids: D5NS in T1DM, or LR, @ 125 mL/hr
Insulin drip: Regular 100 units/100 mL NS (1 unit/mL), start 0.5 units/hr
If hypoglycemic: call MD, follow hypoglycemia protocol, STOP insulin
Restart infusion if BG becomes > 80 mg/dL ×2
```

| BG (mg/dL) | Insulin (units/hr) | IV solution |
|---|---|---|
| <80 | Discontinue drip | D5NS @ 125 mL/hr |
| **80–99** | **NOT SPECIFIED — see C-15** | D5NS @ 125 mL/hr |
| 100–120 | 0.5 | D5NS @ 125 mL/hr |
| 121–140 | 1.0 | D5NS @ 125 mL/hr |
| 141–160 | 1.5 | D5NS @ 125 mL/hr |
| 161–180 | 2.0 | D5NS @ 125 mL/hr |
| 181–200 | 2.5 | D5NS @ 125 mL/hr |
| >200 | 3.0 | D5NS @ 125 mL/hr |
| >300 | Call MD | D5NS @ 125 mL/hr |

> **CONFLICT C-15 — gap in the published table.** The 80–99 mg/dL band is absent. The source elsewhere states the target is 60–100 (implying no insulin in this band) but also says to restart the infusion at BG >80 ×2 (implying dosing begins at 80). This must be resolved by institutional policy before implementation. Recommended default given a target of 60–100: **hold insulin, recheck in 1 hour** — but flag prominently for MFM committee sign-off.

### I.4 Intrapartum target — CONFLICT C-12

```
UC23  : 60–100 mg/dL
VB24  : 70–110 mg/dL  ("current recommendations", based on T1DM labor studies)
ADA26 : does not specify a numeric intrapartum target
Wilkie RCT (cited by VB24 and ADA26): 70–140 mg/dL, SC vs IV both acceptable
```
Recommendation: default to **70–110** (`VB24`, more current, avoids the maternal hypoglycemia risk of a 60 mg/dL floor). Expose as `INTRAPARTUM_TARGET`. Note that changing the target requires regenerating the infusion table — the `UC23` table is calibrated to a 60–100 target.

Rationale for tight intrapartum control: about **half** of neonates of mothers with preexisting diabetes and nearly **1 in 5** of GDM mothers are diagnosed and treated for neonatal hypoglycemia; maternal intrapartum hyperglycemia contributes (`VB24`).

### I.5 CSII in labor and delivery (`UC23`)

```
ACTIVE LABOR
  NPO. Use lowest basal setting until active labor.
  Pumps can usually be DISCONTINUED during labor, OR basal rate decreased by 50%.
  BG q1h.
  If needed, the pump can be used for intrapartum hyperglycemia
    (alternatively consider insulin gtt).
  SUSPEND the pump if:
      glucose < 80 mg/dL, OR
      active labor and glucose < 100 mg/dL
CESAREAN
  Maintain basal rates until 06:00; discontinue the pump prior to going to the OR.
POSTPARTUM
  Restart the pump when the patient demonstrates hyperglycemia (>180 mg/dL),
  particularly in T1DM, to reduce the risk of hypoglycemia.
POSTPARTUM PUMP SETTINGS
  basal rates -> 1/3 to 1/2 of pre-delivery doses
                 (reference pre-pregnancy pump settings)
  ICR and ISF -> INCREASE by 50%   (i.e., less insulin per gram / larger correction)
  BG targets  -> 80–120 mg/dL
```

> See C-18: `ADA26`/`ES25` peripartum AID data support **continuing** automated delivery through labor with expert supervision, which is directionally opposite to "discontinue or halve." For AID users, prefer the AID pathway; reserve the `UC23` suspension logic for non-AID CSII.

### I.6 Delivery timing (`ES25` Rec 9, 2 | ⊕OOO)

```
Recommendation: early delivery based on risk assessment rather than expectant management.
No validated obstetric risk assessment tool exists for preexisting DM.
Risk assessment inputs: history of diabetes-related complications, measures of glycemia,
  ultrasound fetal growth, amniotic fluid volume, other comorbidities.
Risks may outweigh benefits of expectant management BEYOND 38 WEEKS,
  even with ideal glycemic management.
Panel conclusion: delivery no later than 38 6/7 weeks even with ideal glycemic control.

ACOG framework (cited in ES25):
  ideal glycemia, no maternal HTN, no fetal growth abnormality -> 39 0/7 to 39 6/7
  vascular complications, hyperglycemia, or prior stillbirth   -> 36 0/7 to 38 6/7
```
Implement as a documentation/decision-support prompt, not a calculator. Supporting figures for counseling: preexisting DM stillbirth pooled OR 3.74 (3.17–4.41); with class 3 obesity, adjusted HR for stillbirth at 37–39 weeks 25.34 (15.58–41.22).

---

## 12. Module J — Hypoglycemia

### J.1 Threshold — CONFLICT C-01

```
UC23  : < 60 mg/dL   (explicit: "the definition of hypoglycemia in pregnancy is
                       BG values below 60 mg/dL")
ADA26 : BG < 70 mg/dL;  sensor glucose < 63 mg/dL
        (notes the most appropriate threshold in pregnancy is NOT validated and
         has historically ranged from <60 to <70)
VB24  : treat BG < 65–70 mg/dL
```
Recommended default: **treat at <70 mg/dL (meter) / <63 mg/dL (sensor)** per `ADA26`. Use `UC23`'s <60 only for the inpatient rescue protocol thresholds, which are internally calibrated to that number.

### J.2 Outpatient treatment

```
VB24  : treat with NO MORE THAN 15 g simple sugar (e.g., 4 oz apple juice)
        to avoid rebound hyperglycemia; recheck in 10–15 min
UC23  : Rule of 15 — 15 g fast-acting CHO, recheck in 15 min,
        expect >= 15 mg/dL rise
Pre-exercise: if BG < 100 mg/dL, take 15 g CHO  [UC23]
Overnight hypoglycemia -> wear CGM or check a middle-of-the-night capillary glucose
        to determine whether the bedtime long/intermediate-acting dose needs a
        DOWNWARD adjustment  [VB24]
```

### J.3 Inpatient rescue ladder (`UC23`)

```
BG > 60 mg/dL — DO NOT TREAT
  ensure 3 meals + 3 snacks ON TIME, 2–3 hours apart

ALERT, RESPONSIVE, CAN TAKE PO — BG < 60
  4 oz (½ cup) apple juice OR 4 glucose tablets (4 g each) with 8 oz water
  DO NOT give complex CHO (milk, cookies, candy, peanut butter crackers, sandwiches)
    — complex CHO delays glucose absorption
  recheck fingerstick q15 min until BG > 60 mg/dL ×2

ALERT, RESPONSIVE, CAN TAKE PO — BG < 40 + signs/symptoms
  8 oz (1 cup) apple juice
  DO NOT leave the patient alone
  recheck q15 min until BG > 60 ×2

ALERT, RESPONSIVE, CANNOT TAKE PO — BG < 60
  GLUCAGON 1 mg IM stat
  recheck q15 min until BG > 60 ×2

UNCONSCIOUS / UNRESPONSIVE
  GLUCAGON 1 mg SC or IM stat
  ensure venous access
  recheck fingerstick q5 min until alert and responsive
  if BG not > 60 after 15 min -> D5NS or D10NS @ 200 mL/hr until BG > 60 ×2
  be prepared to start D5NS @ 125 mL/hr if BG remains < 20 mg/dL
  a member of the healthcare team must REMAIN WITH THE PATIENT until fully
    conscious, stable, and normoglycemic
  notify the attending physician

GLUCAGON PRODUCTS
  GVOKE   1 mg SC prefilled emergency kit
  BAQSIMI 3 mg intranasal prefilled kit
  use ALL of the glucagon
  onset of reversal: rapid, within 15 minutes
  may repeat in 20 minutes for persistent severe hypoglycemia
  vomiting is common -> position patient on their side
  ALL pregnant patients on insulin should have a glucagon emergency kit at home,
    and family members should be instructed in proper use
```

### J.4 Symptom list for patient-facing education (`UC23`)

Hunger · headache · diaphoresis · weakness/lethargy · tremulousness · blurred or tunnel vision · disorientation · confusion · stupor · loss of consciousness · drowsiness · nausea · circumoral numbness · coma · seizure

### J.5 Hypoglycemia unawareness

`VB24`: although rare compared with T1DM, hypoglycemia unawareness **can develop** in T2DM or GDM on insulin therapy. `ADA26`: pregnancy alters counterregulatory response and may decrease hypoglycemia awareness in all pregnant people. Set `hypoglycemia_unawareness` as a flag that relaxes lower target bounds and mandates CGM alarm review.

---

## 13. Module K — Postpartum

### K.1 Physiology

```
Insulin sensitivity increases dramatically with delivery of the placenta.
UC23  : insulin requirements decrease by 50–75% immediately after delivery
ADA26 : immediate-PP insulin requirements ~34% LOWER than PREPREGNANCY requirements;
        sensitivity returns to prepregnancy levels over the following 1–2 weeks
```
Note the two statements use different denominators (end-pregnancy vs prepregnancy) — see C-13.

### K.2 Immediate postpartum dosing

**GDM A1 / GDM A2 (`UC23`):**
```
Discontinue IV insulin immediately after delivery of the placenta
Resume regular diet
Check FBG and 1-h postprandial until discharge
If FBG > 100 mg/dL or PP > 180 mg/dL:
    continue SMBG, report out-of-target values to the diabetes team
    typically start metformin if BG > 180 despite a diabetic diet
```
`VB24` concurs directionally: discontinue insulin immediately PP in GDM or T2DM on oral therapies with a **prepregnancy A1C below 7.5%**.

**T1DM / T2DM (`UC23`), NSVD and cesarean:**
```
Discontinue IV insulin immediately after delivery of the placenta
Resume CHO-counting meal plan (if lactating, resume PREGNANCY calorie level)
Check fasting, preprandial, and 1-h postprandial BG
Give 25–33% of the SQ END-PREGNANCY insulin dose when on PO intake and/or
    when BG exceeds the parameters above
Alternatively, if controlled prepregnancy with metformin, restart metformin; titrate
```

**T2DM (`VB24`):**
```
Patients with T2DM on multiple antidiabetic medications or insulin before pregnancy
can transition postpartum safely by reducing their insulin regimen to
    30–40% of their THIRD-TRIMESTER pregnancy insulin requirements
Metformin alone is also an option if prepregnancy A1C was below 7.5% without
    insulin or other antidiabetic medications
```

**Weight-based alternative (`UC23`):** PP weeks 0–6 → **0.4 units/kg**.

Recommended implementation — compute all three and display side by side with sources, requiring clinician selection:
```python
def postpartum_tdd_options(end_pregnancy_tdd, third_trimester_tdd,
                           prepregnancy_tdd, weight_kg):
    return {
      "UC23_pct_end_pregnancy": (0.25*end_pregnancy_tdd, 0.33*end_pregnancy_tdd),
      "VB24_pct_third_trimester": (0.30*third_trimester_tdd, 0.40*third_trimester_tdd),
      "UC23_weight_based":        0.4 * weight_kg,
      "ADA26_reference_point":    0.66 * prepregnancy_tdd if prepregnancy_tdd else None,
    }
```

### K.3 Postpartum targets — CONFLICT C-14b

```
UC23 inpatient   : FBG < 126 mg/dL;  1-h post-meal < 180 mg/dL
                   (stated goal: avoid hypoglycemia and extreme hyperglycemia)
UC23 outpatient  : FBG < 100 mg/dL;  1-h postprandial < 140 mg/dL
UC23 pump PP     : BG target 80–120 mg/dL
VB24 T2DM PP     : fasting 100–125 mg/dL, OR random/postprandial 160–180 mg/dL
                   as acceptable options during the postpartum period
UC23 breastfeeding: 1-h postprandial target < 150 mg/dL
```
These are reconcilable as inpatient (looser) vs outpatient-transition vs stable-outpatient tiers. Implement as three named target sets with an explicit phase selector.

### K.4 AID postpartum (`ADA26`)

Continuing AID postpartum reduced hypoglycemia episodes (Donovan RCT, n=18) and improved TIR with lower mean glucose over 6 months (AiDAPT extension) without a significant hypoglycemia difference. Reference: Szmuilowicz 2025 for suggested PP AID setting adjustments.

### K.5 Lactation

```
Lactation INCREASES the risk of overnight hypoglycemia; insulin dosing may need
    adjustment                                                            [ADA26]
UC23:
  Diabetes-consistent CHO meal plan, +500 calories over prepregnant level
  Check BG prior to breastfeeding, especially at night
  If BG < 100 mg/dL -> 15 g CHO snack
  1-h postprandial target < 150 mg/dL
  Hyperglycemia is transmitted through breast milk
  Teach hypoglycemia precautions to all patients on insulin
  Glyburide, metformin, and acarbose are NOT contraindicated while breastfeeding
  Teach mastitis monitoring
ADA26 / VB24:
  GLP-1RA, SGLT2i, and DPP-4 inhibitors are NOT encouraged for lactating individuals
  (breastfeeding data lacking; GLP-1RA likely low in milk and digested by the
   infant gut, rendered inactive)
Degludec: given the marked PP insulin reduction, doses must be reduced MORE THAN
  2–3 DAYS BEFORE DELIVERY to avoid postpartum hypoglycemia                [VB24]
```

### K.6 Postpartum screening and follow-up

| Population | Test | Timing | Source |
|---|---|---|---|
| GDM | 75-g OGTT, nonpregnancy criteria | 4–12 weeks PP | `ADA26` 15.30 |
| GDM (`UC23` variant) | 2-h 75-g OGTT | 6–12 weeks PP | `UC23` |
| GDM, ongoing | Any recommended glycemic test | every 1–3 years, lifelong | `ADA26` 15.31 |
| GDM + prediabetes + overweight/obesity | Intensive lifestyle and/or metformin | — | `ADA26` 15.32 |
| GDM unable/declining OGTT | A1C (small subset) | 6–12 months PP | `ADA26` |
| Preexisting DM | Postpartum endocrine care **in addition to** usual obstetric care | — | `ES25` Rec 10 |
| All | Contraceptive plan | before discharge | `ADA26` 15.27 |
| All with preexisting DM | Dilated eye exam | through 1 year PP as indicated | `ADA26` 15.7 |
| `UC23` visit schedule | DAPP team follow-up | 2 and 6 weeks PP | `UC23` |

`ADA26` prefers OGTT over A1C at 4–12 weeks because A1C may be persistently lowered by pregnancy-related RBC turnover, delivery blood loss, or the preceding 3-month glucose profile.

Lifetime T2DM risk after GDM (`ADA26`, for counseling): ~20% at 10 y, 30% at 20 y, 40% at 30 y, 50% at 40 y, 60% at 50 y; 10-fold increased risk vs no GDM.

---

## 14. Conflict registry — configuration switches

Each conflict is exposed as a named constant. **No default should be silently applied without institutional sign-off.**

| ID | Domain | Options | Recommended default | Clinical consequence of choosing wrong |
|----|--------|---------|---------------------|-----------------------------------------|
| **C-01** | Hypoglycemia threshold | `UC23` <60 · `ADA26` <70 meter / <63 sensor · `VB24` <65–70 | **`ADA26`** | A <60 threshold delays treatment; matters most in T1DM with unawareness |
| **C-02** | Starting TDD | `VB24` 0.5–0.9 u/kg, no obesity uplift · `UC23` 0.7–1.0 by GA, **1.5–2.0 u/kg if >150% DBW** | **`VB24`** | Largest single divergence. UC23 can yield 2–3× the starting dose in class 2–3 obesity. VB24 explicitly warns this causes hypoglycemia, defensive eating, excess GWG, worsening IR |
| **C-03** | Correction factor constant | `VB24` 1500 · `UC23` 1700 | **1500** for T2DM/GDM | 1700 under-corrects at high insulin resistance; VB24 states T2D/GDM should use the lower value |
| **C-04** | ICR constant | `VB24` 400 · `UC23` 500 | **400** for T2DM/GDM | 500 under-doses meals in insulin-resistant patients |
| **C-05** | Titration trigger | ≥2 same-time values/wk · 20–50% out of range · ≥20% of all values | ≥2 same-time values/wk | Looser triggers delay escalation across a period of ~5%/wk rising requirement |
| **C-06** | Correction method | Calculated ICF (`VB24`) · Fixed table (`UC23`) | **ICF** | Fixed table is TDD-independent; dangerous at both ends of the insulin-requirement range |
| **C-07** | CGM titration basis | Fasting/PP tagged values (`ES25` Rec 7, `ADA26` 15.12) · Single 63–140 TIR target | **Tagged values** | `ES25` recommends *against* the single-target approach; basal hyperglycemia drives 66–75% of burden and is invisible in aggregate TIR |
| **C-08** | CGM in T2DM/GDM | `ADA26` insufficient data, individualize · `ES25` either CGM or SMBG | Individualize; no gating | Neither source supports mandating CGM outside T1DM |
| **C-09** | CGM as SMBG replacement | `UC23` adjunct only, ≥4 meter checks/day, confirm <60 and >200 · `ADA26` non-adjunctive use of validated sensor permitted with 3 exceptions | **`ADA26`** for validated sensors | UC23 predates G7 pregnancy validation |
| **C-10** | Basal:bolus split | 40/60 from start (`VB24`) · 50/50 then 40/60 after T1 (`UC23` pump) | 40/60 MDI, 50/50 pump initiation then reassess | Modest; both converge by T2 |
| **C-11** | Oral agents in GDM | `UC23` metformin 1st-line oral · `ADA26`/`ES25` not first-line, insulin preferred | **`ADA26`/`ES25`** | Keep UC23 protocols only behind an "insulin not feasible" pathway |
| **C-12** | Intrapartum target | `UC23` 60–100 · `VB24` 70–110 · Wilkie RCT 70–140 | **70–110** | A 60 floor risks maternal hypoglycemia; changing the target invalidates the UC23 infusion table calibration |
| **C-13** | Postpartum dose | `UC23` 25–33% of end-pregnancy · `VB24` 30–40% of third-trimester · `UC23` 0.4 u/kg · `ADA26` ~34% below **prepregnancy** | Display all; require selection | **Different denominators.** End-pregnancy, third-trimester, and prepregnancy TDD are not interchangeable |
| **C-14** | CSII basal rate formula | Prose "TDD/24" · Worked example "TotalDailyBasal/24" | **TotalDailyBasal/24** | Literal prose implementation is **2× overdose**. Hard-code the worked example as a regression test |
| **C-15** | Intrapartum table 80–99 band | Absent from published table | Hold insulin, recheck q1h — **requires committee sign-off** | Source is internally inconsistent (target 60–100 vs restart at >80) |
| **C-16** | Aspirin dose | `ADA26` 100–150 mg/d starting 12–16 wk (162 acceptable; explicitly states <100 mg **not effective**) · `UC23` 81 mg starting 12 wk | **`ADA26`** | UC23's 81 mg is below the dose ADA26 says is required |
| **C-17** | Carbohydrate floor | `ADA26` minimum **175 g/d** · `ES25` either <175 or >175, insufficient evidence, extremes harmful · `UC23` prescription = 30+45+45+3×15 = **165 g/d** | 175 g/d floor; flag UC23 pattern | `ES25` notes severe restriction (<95–100 g/d) is associated with 20–100% increased NTD risk |
| **C-18** | CSII/AID in labor | `UC23` discontinue or halve basal, suspend at <80 (or <100 in active labor) · `ADA26`/`ES25` continuing AID intrapartum is safe with improved TIR | AID users → continue with supervision; non-AID CSII → `UC23` | `UC23` predates AID intrapartum data |
| **C-19** | Metformin added to insulin, T2DM | `ES25` suggest against routine addition · `ADA26` not first-line, notes no composite benefit and SGA signal · `UC23` silent for pregestational | **`ES25` — against** | `ES25` weighted MiTy SGA (13% vs 7%, RR 1.96) and primate fetal growth restriction data above the LGA benefit (RR 0.74) |
| **C-20** | Detemir | `UC23` lists as available · `VB24`/`ADA26` discontinued/removed from market | **Remove from formulary list** | Prescribing an unavailable product |
| **C-21** | A1C in pregnancy | `ADA26` <6% (relax to <7%) · `UC23` references <6.0% assoc. with less macrosomia, <6.5% preconception | **`ADA26`** | Minor; frameworks agree |

---

## 15. Hard stops — implement as blocking, not advisory

```
1. BLOCK any post-meal sliding-scale insulin recommendation.               [UC23]
2. BLOCK the fixed correction table for between-meal use.                  [UC23]
3. BLOCK premixed insulin recommendations in pregnancy.                    [VB24]
4. BLOCK detemir from the formulary.                                       [ADA26]
5. BLOCK metformin recommendation when chronic_htn OR preeclampsia OR
   fgr_risk OR nephropathy is true.                                        [ADA26, ES25]
6. BLOCK GLP-1RA / SGLT2i / DPP-4i recommendations in pregnancy and
   lactation.                                                              [ADA26, VB24]
7. BLOCK ACE inhibitors, ARBs, mineralocorticoid receptor antagonists.     [ADA26 15.25a]
8. BLOCK lipid-lowering agents by default; allow override only for
   familial hypercholesterolemia, severe hypertriglyceridemia, or prior
   ASCVD event, with documented shared decision-making.                    [ADA26 15.25b]
9. BLOCK GMI / estimated-A1C display in pregnancy.                         [ADA26 15.13]
10. BLOCK dose recommendations from < 10 days of CGM data or < 70% wear.
11. BLOCK dose recommendations from day 1 of sensor wear.                  [ADA26]
12. BLOCK degludec dose changes at intervals < 3–4 days.                   [ADA26]
13. BLOCK weight loss recommendations in pregnancy (SGA risk).             [ADA26]
14. BLOCK any recommendation while a DKA episode is active — route to
    Module H only.
15. HALT + ALERT on ≥15% TDD reduction over 7 days at GA ≥28 weeks
    (possible placental insufficiency) — no auto-titration.                [ADA26]
16. ALERT on any insulin recommendation for a patient with retinopathy
    undergoing rapid glycemic normalization (retinopathy progression).     [ADA26]
```

---

## 16. Test vectors

Hard-code these published worked examples as unit tests. Every one is directly traceable to a source table.

```yaml
- id: VB24_TDD_90kg_T1
  input:  {weight_kg: 90, trimester: 1, schedule: VB24_standard}
  expect: {tdd_units: 63}

- id: VB24_conventional_NPH_Reg
  input:  {tdd: 63}
  expect: {am_total: 42, am_nph: 28, am_reg: 14,
           pm_total: 20, pm_nph_bedtime: 10, pm_reg_predinner: 10}

- id: VB24_NPH_RAA
  input:  {tdd: 63}
  expect: {nph_total: 32, nph_morning_plus_bedtime: 32, raa_total: 31}
  note:   "VB24 prints morning 10 + bedtime 20 = 30, which does NOT sum to its
           own stated NPH total of 32. Compute bedtime as the remainder so
           components reconcile: morning 11, bedtime 21."

- id: VB24_basal_bolus
  input:  {tdd: 63}
  expect: {basal_glargine: 25, bolus_total: 38, per_meal: 13}

- id: VB24_ICF
  input:  {tdd: 63, constant: 1500, premeal_bg: 150, target: 100}
  expect: {mgdl_per_unit_exact: 23.8, correction_units: 2}
  note:   "VB24 prints '~25 mg/dL'; the exact quotient is 23.8. Compute the
           dose from the UNROUNDED ratio, then round the dose. Rounding the
           ratio first introduces error that compounds at high TDD."

- id: VB24_ICR
  input:  {tdd: 63, constant: 400, meal_cho_g: 45}
  expect: {g_per_unit_exact: 6.35, g_per_unit_display: 6, meal_units: 7}
  note:   "45 / 6.35 = 7.09 -> 7 units, matching the paper. Rounding the ratio
           to 6 first gives 45/6 = 7.5 -> 8 units, which does NOT match."

- id: UC23_TDD_split
  input:  {tdd: 60}
  expect: {am: 40, am_nph: 27, am_raa: 13, pm: 20, pm_raa: 10, pm_nph: 10}

- id: UC23_CSII_full            # THE critical regression test for C-14
  input:  {tdd: 60}
  expect: {total_daily_basal: 30,
           basal_rate_3_0800_2400: 1.25,
           basal_rate_1_0000_0300: 1.00,
           basal_rate_2_0300_0800: 1.50,
           correction_factor: 28,
           icr_g_per_unit: 8}

- id: UC23_CSII_from_MDI
  input:  {mdi_tdd: 80, weight_kg: 70, ga_weeks: 30}
  expect: {tdd_from_mdi: 60.0, tdd_from_weight: 63.0, final_tdd: 60.0}
  note:   "min() selects the MDI-derived value"

- id: C02_divergence_demo
  input:  {weight_kg: 110, ga_weeks: 30, dbw_kg: 60}   # 183% DBW
  expect:
    vb24_tdd: 99.0        # 110 × 0.9
    uc23_standard_tdd: 99.0
    uc23_obesity_tdd: [165.0, 220.0]   # 110 × 1.5–2.0
  note: "1.7–2.2× divergence. This is the switch that matters most in a
         high-obesity-prevalence population."

- id: IV_to_SC_conversion
  input:  {iv_derived_tdd: 48}
  expect: {sc_tdd: 60}     # ×1.25

- id: PP_options_T2DM
  input:  {end_pregnancy_tdd: 120, third_trimester_tdd: 120,
           prepregnancy_tdd: 60, weight_kg: 95}
  expect:
    uc23_pct_end_pregnancy: [30.0, 39.6]
    vb24_pct_third_trimester: [36.0, 48.0]
    uc23_weight_based: 38.0
    ada26_reference: 39.6
  note: "Ranges overlap in this case; they diverge sharply when
         prepregnancy TDD is unknown or when third-trimester != end-pregnancy TDD."
```

---

## 17. Suggested module build order

```
1.  Data model + target service (§2, §3)          — no dosing risk, unblocks everything
2.  Titration engine (§5)                         — highest daily clinical value
3.  Initiation calculator (§4) with C-02 switch
4.  CGM adapter (§6) feeding the same engine
5.  Hypoglycemia module (§12)                     — safety-critical, implement early
6.  Postpartum (§13)
7.  Intrapartum + IV infusion (§11)
8.  CSII (§7)                                     — after C-14 is resolved in writing
9.  Steroids (§9)
10. DKA (§10)                                     — reference protocol only; do not
                                                    automate dosing for an ICU-level
                                                    condition
11. AID (§8)                                      — mostly display/education, not dosing
```

---

## 18. What these four sources do NOT cover

Gaps you will need additional references for before the app is clinically complete:

- Insulin dosing in **twins/higher-order multiples** (`UC23` mentions meal plan adjustment only)
- **Bariatric surgery** patients (`UC23` addresses screening only — no OGTT due to dumping)
- **CKD/dialysis** dose adjustment in pregnancy
- **Fetal surveillance** schedules integrated with glycemic control (`UC23` has a surveillance grid; ADA/ES do not)
- **MODY** identification and management
- Pediatric/adolescent T1DM in pregnancy
- Specific **AID system-by-system** minimum target values (needed to implement §F.2 properly — requires device labeling, not these papers)
- Numeric **DKA protocol** validation from a source other than `UC23`
- Cost/formulary logic for insulin selection

---

*Compiled from the four uploaded sources only. No content has been introduced from outside these documents except the regulatory framing in §0 and the build-order recommendation in §17. Every numeric parameter carries a source tag; any parameter without one is an implementation decision, not a published recommendation.*
