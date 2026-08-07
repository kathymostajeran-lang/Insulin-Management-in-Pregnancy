/**
 * App.tsx — application shell.
 *
 * Owns patient inputs, the persistent TDD banner, and tab routing. It wires
 * inputs → dosing.ts (via model.ts) → the active tab. It contains no clinical
 * rules itself (CLAUDE.md §3).
 */
import { useMemo, useState } from "react";
import {
  APP_CONFIG,
  DEMO_PREFILL,
  EMPTY_INPUTS,
  TDD_SCHEDULE_OPTIONS,
  type PatientInputs,
  type Stage,
  type Unit,
  type ObesityDosing,
} from "./config";
import type { Config, TDDSchedule } from "./logic/dosing";
import { deriveModel, bmiCategory } from "./model";
import { NumberField, Seg, Labeled } from "./ui/controls";
import { StartTab } from "./ui/StartTab";
import { LaborTab } from "./ui/LaborTab";
import { AdjustTab } from "./ui/AdjustTab";
import { HypoTab } from "./ui/HypoTab";
import { SteroidsTab } from "./ui/SteroidsTab";
import { DkaTab } from "./ui/DkaTab";
import { CgmTab } from "./ui/CgmTab";
import { PumpTab } from "./ui/PumpTab";
import { PostpartumTab } from "./ui/PostpartumTab";

/**
 * Every module carries a plain-language `title` and a "use this when…" line so a
 * clinician who doesn't already know the workflow can be routed to the right
 * place from the guided home menu. `label` is the short name used in the quick
 * dropdown; `group` buckets the module on the home screen.
 */
const GROUPS = [
  { id: "everyday", label: "Everyday dosing" },
  { id: "delivery", label: "Around delivery" },
  { id: "special", label: "Special situations" },
] as const;

const TABS = [
  { id: "start", label: "Start", group: "everyday", Comp: StartTab,
    title: "Start insulin", when: "Begin insulin in someone not yet on it — builds a starting schedule from weight and gestational age." },
  { id: "adjust", label: "Adjust", group: "everyday", Comp: AdjustTab,
    title: "Adjust the doses", when: "Already on insulin? Fine-tune each dose from the week's home glucose readings." },
  { id: "labor", label: "Labor", group: "delivery", Comp: LaborTab,
    title: "During labor", when: "IV insulin infusion and glucose targets for the intrapartum period." },
  { id: "postpartum", label: "Postpartum", group: "delivery", Comp: PostpartumTab,
    title: "After delivery", when: "Re-set insulin for the first days postpartum, including breastfeeding targets." },
  { id: "steroids", label: "Steroids", group: "special", Comp: SteroidsTab,
    title: "Steroids were given", when: "Betamethasone for fetal lungs raises insulin needs — a day-by-day plan." },
  { id: "dka", label: "DKA", group: "special", Comp: DkaTab,
    title: "DKA", when: "Diabetic ketoacidosis: IV insulin drip, fluids, and potassium." },
  { id: "hypo", label: "Low sugar", group: "special", Comp: HypoTab,
    title: "Low blood sugar", when: "Treat a low now (Rule of 15) and the inpatient rescue steps." },
  { id: "pump", label: "Pump", group: "special", Comp: PumpTab,
    title: "Insulin pump (CSII)", when: "Turn a total daily dose into pump basal-rate and bolus settings." },
  { id: "cgm", label: "CGM", group: "special", Comp: CgmTab,
    title: "CGM report", when: "Read a continuous-glucose summary and turn it into dose changes." },
] as const;

type TabId = (typeof TABS)[number]["id"];
type View = TabId | "home";

const UNIT_OPTIONS: ReadonlyArray<{ value: Unit; label: string }> = [
  { value: "lb", label: "lb" },
  { value: "kg", label: "kg" },
];
const STAGE_OPTIONS: ReadonlyArray<{ value: Stage; label: string }> = [
  { value: "pregnant", label: "Pregnant" },
  { value: "postpartum_0_6", label: "Postpartum 0–6 wk" },
];
const OBESITY_OPTIONS: ReadonlyArray<{ value: ObesityDosing; label: string }> = [
  { value: "off", label: "Off" },
  { value: "1.5", label: "1.5" },
  { value: "1.75", label: "1.75" },
  { value: "2.0", label: "2.0" },
];

export function App() {
  const [inputs, setInputs] = useState<PatientInputs>(DEMO_PREFILL);
  const [config, setConfig] = useState<Config>(APP_CONFIG);
  const [active, setActive] = useState<View>("home");
  const [inputsOpen, setInputsOpen] = useState(false);

  const model = useMemo(() => deriveModel(inputs, config), [inputs, config]);

  function patch(p: Partial<PatientInputs>) {
    setInputs((prev) => ({ ...prev, ...p }));
  }

  // Navigate: open the patient-inputs panel inside a module, collapse it on the
  // home menu so the landing screen leads with the guided choices, not a form.
  function go(view: View) {
    setActive(view);
    setInputsOpen(view !== "home");
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  const activeTab = active === "home" ? null : TABS.find((t) => t.id === active)!;
  const ActiveComp = activeTab?.Comp;
  const activeLabel = activeTab?.label ?? "Menu";
  const inputSummary =
    inputs.weight != null
      ? `${inputs.weight} ${inputs.unit} · ${inputs.gaWeeks ?? "–"} wk`
      : "tap to enter details";
  const bmiCat = model.bmi != null ? bmiCategory(model.bmi) : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Insulin in pregnancy</h1>
        <div className="app-sub">
          Guideline-based dosing decision support · every output requires clinician confirmation
        </div>
      </header>

      {/* ── Sticky module switcher + compact TDD ───────────────────── */}
      <div className="topbar">
        <select
          className="switcher"
          aria-label="Go to"
          value={active}
          onChange={(e) => go(e.target.value as View)}
        >
          <option value="home">☰　Menu</option>
          {GROUPS.map((grp) => (
            <optgroup key={grp.id} label={grp.label}>
              {TABS.filter((t) => t.group === grp.id).map((t) => (
                <option key={t.id} value={t.id}>{t.label}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <div className="topbar-tdd" aria-live="polite">
          {model.tdd ? (
            <><span className="num">{model.tdd.tdd}</span> <span className="topbar-tdd-unit">u/24h</span></>
          ) : (
            <span className="num" style={{ opacity: 0.35 }}>—</span>
          )}
        </div>
      </div>

      {/* ── Collapsible patient inputs ─────────────────────────────── */}
      <details className="inputs-panel" open={inputsOpen} onToggle={(e) => setInputsOpen(e.currentTarget.open)}>
        <summary className="inputs-summary">
          <span className="inputs-summary-label">Patient inputs</span>
          <span className="text-muted inputs-summary-detail">{inputSummary}</span>
        </summary>
        <div className="view" style={{ paddingTop: "var(--space-3)", paddingBottom: 0 }}>
          <TddBanner model={model} />
        </div>
        <section className="view" style={{ paddingBottom: "var(--space-4)" }}>
          <div className="rail">
          <NumberField
            label={`Current weight · ${inputs.unit}`}
            value={inputs.weight}
            onChange={(v) => patch({ weight: v })}
            hint={model.weightKg ? `${model.weightKg.toFixed(1)} kg` : undefined}
            min={0}
          />
          <Labeled label="Units">
            <Seg name="unit" value={inputs.unit} options={UNIT_OPTIONS} onChange={(unit) => patch({ unit })} />
          </Labeled>
          <NumberField
            label="Gestational age · wk"
            value={inputs.gaWeeks}
            onChange={(v) => patch({ gaWeeks: v })}
            hint={model.gaWeeks !== null ? trimesterHint(model.gaWeeks) : undefined}
            min={0}
            max={42}
            step={0.1}
          />
          <NumberField
            label="Height · in, optional"
            value={inputs.heightIn}
            onChange={(v) => patch({ heightIn: v })}
            hint={
              model.bmi != null
                ? `BMI ${model.bmi}${model.pctDbw ? ` · ${Math.round(model.pctDbw)}% DBW` : ""}`
                : "for BMI & obesity dosing"
            }
            min={0}
          />
          <Labeled label="Stage">
            <Seg name="stage" value={inputs.stage} options={STAGE_OPTIONS} onChange={(stage) => patch({ stage })} />
          </Labeled>
          <div style={{ gridColumn: "1 / -1" }}>
            {bmiCat ? (
              <div style={{ marginBottom: "var(--space-2)", fontSize: 14 }}>
                BMI <span className="num" style={{ fontSize: 18 }}>{model.bmi}</span>{" "}
                <span className={bmiCat.obese ? undefined : "text-muted"}>— {bmiCat.label}</span>{" "}
                {bmiCat.obese ? <span className="tag tag-accent">obese</span> : null}
              </div>
            ) : (
              <div className="text-muted" style={{ marginBottom: "var(--space-2)", fontSize: 13 }}>
                Enter weight and height for BMI.
              </div>
            )}
            <Labeled label="Obesity dosing · >150% DBW" hint="UC23 branch — clinician-applied multiplier">
              <Seg
                name="obesity"
                value={inputs.obesityDosing}
                options={OBESITY_OPTIONS}
                onChange={(obesityDosing) => patch({ obesityDosing })}
              />
            </Labeled>
          </div>
        </div>

        {/* Config: TDD schedule switch (C-02) + demo/clear */}
        <div className="rail" style={{ marginTop: "var(--space-3)" }}>
          <Labeled label="TDD schedule · C-02" hint="Recommended default: VB24">
            <Seg
              name="schedule"
              value={config.tddSchedule}
              options={TDD_SCHEDULE_OPTIONS.map((o) => ({ value: o.value, label: o.value }))}
              onChange={(tddSchedule: TDDSchedule) => setConfig((c) => ({ ...c, tddSchedule }))}
            />
          </Labeled>
          <div className="field" style={{ display: "flex", alignItems: "flex-end", gap: 8 }}>
            <button className="btn btn-secondary" onClick={() => setInputs(DEMO_PREFILL)}>
              Demo prefill
            </button>
            <button className="btn btn-ghost" onClick={() => setInputs(EMPTY_INPUTS)}>
              Clear
            </button>
          </div>
        </div>
        </section>
      </details>

      {active === "home" || !ActiveComp ? (
        <main className="view" aria-label="Menu">
          <HomeMenu onPick={go} />
        </main>
      ) : (
        <main className="view" role="tabpanel" aria-label={activeLabel}>
          <button className="back-link" onClick={() => go("home")}>‹ All tasks</button>
          <ActiveComp model={model} config={config} inputs={inputs} />
        </main>
      )}

      <footer className="safety">
        <strong>Not a validated medical device.</strong> Decision support only. Every dose requires
        explicit clinician confirmation; no output is executed automatically. Sources: ADA 2026 §15,
        Endocrine Society/ESE 2025, Valent &amp; Barbour 2024, UC Cincinnati 2023. See
        PREGNANCY_INSULIN_ALGORITHMS.md §0 and §15.
      </footer>
    </div>
  );
}

/** Guided landing menu — routes a clinician to the right module in plain
 *  language, so knowing the tool isn't a prerequisite for using it. */
function HomeMenu({ onPick }: { onPick: (id: TabId) => void }) {
  return (
    <>
      <div className="home-hero">
        <h2>What do you need to do?</h2>
        <p>Pick a task and this tool walks you through it. Every number shows its source and math; nothing is prescribed for you.</p>
      </div>
      {GROUPS.map((grp) => {
        const items = TABS.filter((t) => t.group === grp.id);
        return (
          <div className="home-group" key={grp.id}>
            <div className="home-group-label kick">{grp.label}</div>
            <div className="home-cards">
              {items.map((t) => (
                <button className="home-card" key={t.id} onClick={() => onPick(t.id)}>
                  <span>
                    <span className="home-card-title">{t.title}</span>
                    <span className="home-card-when">{t.when}</span>
                  </span>
                  <span className="home-card-go" aria-hidden="true">›</span>
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </>
  );
}

function trimesterHint(ga: number): string {
  if (ga < 14) return "First trimester";
  if (ga < 28) return "Second trimester";
  return "Third trimester";
}

function TddBanner({ model }: { model: ReturnType<typeof deriveModel> }) {
  if (!model.tdd) {
    return (
      <div className="banner banner--empty">
        <span className="banner-value num">—</span>
        <span className="banner-unit">units / 24 h</span>
        <span className="banner-derivation">{model.needs ?? "Enter weight and gestational age."}</span>
      </div>
    );
  }
  return (
    <div className="banner">
      <span className="banner-label">Total daily dose</span>
      <span className="banner-value num">{model.tdd.tdd}</span>
      <span className="banner-unit">units / 24 h</span>
      <span className="banner-derivation">{model.tdd.rule}</span>
    </div>
  );
}
