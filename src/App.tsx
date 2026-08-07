/**
 * App.tsx — application shell.
 *
 * Owns patient inputs, the persistent TDD banner, and tab routing. It wires
 * inputs → dosing.ts (via model.ts) → the active tab. It contains no clinical
 * rules itself (CLAUDE.md §3).
 *
 * Usability posture (from clinician faculty feedback that the app was "complex
 * to the point that if you know how to use it, you don't need it"):
 *  - Boots on a guided plain-language menu, not a pre-computed demo patient.
 *  - The patient-inputs form and the TDD banner appear only on the modules that
 *    actually consume them, so the other modules aren't cluttered by inert fields.
 *  - Expert/institutional knobs live behind an "Advanced" disclosure.
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
import type { AdjustPattern } from "./ui/types";
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
 * Home-menu groups. Urgent (low sugar, DKA) is its own bucket so time-critical
 * modules aren't buried among elective ones.
 */
const GROUPS = [
  { id: "everyday", label: "Everyday dosing" },
  { id: "urgent", label: "Urgent" },
  { id: "delivery", label: "Around delivery" },
  { id: "monitoring", label: "Setup & monitoring" },
] as const;

/**
 * Every module carries a plain-language `title` and a "use this when…" line so a
 * clinician who doesn't already know the workflow can be routed to the right
 * place from the guided home menu. `needsInputs` = the module reads the shared
 * patient form (weight/GA); `showsTdd` = it reads the initiation TDD. Modules
 * without those flags render their own inputs and get no shared form/banner.
 */
const TABS = [
  { id: "start", label: "Start", group: "everyday", needsInputs: true, showsTdd: true, Comp: StartTab,
    title: "Start insulin", when: "Begin insulin in someone not yet on it — builds a starting schedule from weight and gestational age." },
  { id: "adjust", label: "Adjust", group: "everyday", needsInputs: true, showsTdd: true, Comp: AdjustTab,
    title: "Adjust the doses", when: "Already on insulin? Fine-tune each dose from the week's home glucose readings." },
  { id: "hypo", label: "Low sugar", group: "urgent", needsInputs: false, showsTdd: false, Comp: HypoTab,
    title: "Low blood sugar", when: "Treat a low now (Rule of 15) and the inpatient rescue steps." },
  { id: "dka", label: "DKA", group: "urgent", needsInputs: false, showsTdd: false, Comp: DkaTab,
    title: "DKA", when: "Diabetic ketoacidosis: IV insulin drip, fluids, and potassium." },
  { id: "labor", label: "Labor", group: "delivery", needsInputs: false, showsTdd: false, Comp: LaborTab,
    title: "During labor", when: "IV insulin infusion and glucose targets for the intrapartum period." },
  { id: "postpartum", label: "Postpartum", group: "delivery", needsInputs: true, showsTdd: false, Comp: PostpartumTab,
    title: "After delivery", when: "Re-set insulin for the first days postpartum, including breastfeeding targets." },
  { id: "steroids", label: "Steroids", group: "delivery", needsInputs: false, showsTdd: false, Comp: SteroidsTab,
    title: "Steroids were given", when: "Betamethasone for fetal lungs raises insulin needs — a day-by-day plan." },
  { id: "pump", label: "Pump", group: "monitoring", needsInputs: true, showsTdd: false, Comp: PumpTab,
    title: "Insulin pump (CSII)", when: "Turn a total daily dose into pump basal-rate and bolus settings." },
  { id: "cgm", label: "CGM", group: "monitoring", needsInputs: false, showsTdd: false, Comp: CgmTab,
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
  const [inputs, setInputs] = useState<PatientInputs>(EMPTY_INPUTS);
  const [isDemo, setIsDemo] = useState(false);
  const [config, setConfig] = useState<Config>(APP_CONFIG);
  const [active, setActive] = useState<View>("home");
  const [inputsOpen, setInputsOpen] = useState(false);
  // Pattern handed from CGM into Adjust; consumed when Adjust mounts.
  const [adjustSeed, setAdjustSeed] = useState<AdjustPattern | null>(null);

  const model = useMemo(() => deriveModel(inputs, config), [inputs, config]);

  // Any real edit clears the "demonstration data" flag.
  function patch(p: Partial<PatientInputs>) {
    setInputs((prev) => ({ ...prev, ...p }));
    setIsDemo(false);
  }
  function loadDemo() {
    setInputs(DEMO_PREFILL);
    setIsDemo(true);
  }
  function clearInputs() {
    setInputs(EMPTY_INPUTS);
    setIsDemo(false);
  }

  // Navigate: open the patient-inputs panel inside a module that uses it, keep
  // it closed on the home menu so the landing leads with the guided choices.
  function go(view: View) {
    setActive(view);
    const t = view === "home" ? null : TABS.find((x) => x.id === view)!;
    setInputsOpen(!!t?.needsInputs);
    // A CGM→Adjust seed is one-shot: drop it unless we're heading to Adjust.
    if (view !== "adjust") setAdjustSeed(null);
    if (typeof window !== "undefined") window.scrollTo({ top: 0 });
  }

  // Print a clean one-pager of the current module for the chart: expand every
  // collapsed <details> so the math/sources print, then restore afterward.
  function printSummary() {
    if (typeof document === "undefined") return;
    const collapsed = Array.from(document.querySelectorAll("details")).filter((d) => !d.open) as HTMLDetailsElement[];
    collapsed.forEach((d) => (d.open = true));
    const restore = () => {
      collapsed.forEach((d) => (d.open = false));
      window.removeEventListener("afterprint", restore);
    };
    window.addEventListener("afterprint", restore);
    window.print();
  }

  const activeTab = active === "home" ? null : TABS.find((t) => t.id === active)!;
  const ActiveComp = activeTab?.Comp;
  const activeLabel = activeTab?.label ?? "Menu";
  const needsInputs = !!activeTab?.needsInputs;
  const showsTdd = !!activeTab?.showsTdd;

  const inputSummary =
    inputs.weight != null
      ? `${inputs.weight} ${inputs.unit}${inputs.gaWeeks != null ? ` · ${inputs.gaWeeks} wk` : ""}`
      : "tap to enter weight & dates";
  const bmiCat = model.bmi != null ? bmiCategory(model.bmi) : null;
  // Advisory unit-mix-up catch: flag a body weight well outside plausible range.
  const weightWarn =
    model.weightKg != null && (model.weightKg < 30 || model.weightKg > 250)
      ? model.weightKg < 30
        ? "unusually low"
        : "unusually high"
      : null;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Insulin in pregnancy</h1>
        <div className="app-sub">
          Guideline-based dosing decision support · every output requires clinician confirmation
        </div>
      </header>

      {/* ── Sticky module switcher + compact TDD (inside a module only) ─── */}
      {active !== "home" ? (
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
                  <option key={t.id} value={t.id}>{t.title}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {showsTdd ? (
            <div className="topbar-tdd" aria-live="polite">
              {isDemo ? <span className="demo-badge demo-badge--sm" title="Demonstration data — not your patient">DEMO</span> : null}
              {model.tdd ? (
                <><span className="num">{model.tdd.tdd}</span> <span className="topbar-tdd-unit">u/24h</span></>
              ) : (
                <span className="num" style={{ opacity: 0.35 }}>—</span>
              )}
            </div>
          ) : null}
        </div>
      ) : null}

      {/* ── Collapsible patient inputs (only where a module consumes them) ── */}
      {needsInputs ? (
        <details className="inputs-panel" open={inputsOpen} onToggle={(e) => setInputsOpen(e.currentTarget.open)}>
          <summary className="inputs-summary">
            <span className="inputs-summary-label">Patient inputs</span>
            {isDemo ? <span className="demo-badge">Demonstration data — not your patient</span> : null}
            <span className="text-muted inputs-summary-detail">{inputSummary}</span>
          </summary>
          {showsTdd ? (
            <div className="view" style={{ paddingTop: "var(--space-3)", paddingBottom: 0 }}>
              <TddBanner model={model} />
            </div>
          ) : null}
          <section className="view" style={{ paddingBottom: "var(--space-4)" }}>
            <div className="rail">
              <NumberField
                label={`Current weight · ${inputs.unit} · required`}
                value={inputs.weight}
                onChange={(v) => patch({ weight: v })}
                hint={inputs.weight == null ? "Required" : model.weightKg ? `${model.weightKg.toFixed(1)} kg` : undefined}
                min={0}
              />
              <Labeled label="Units">
                <Seg name="unit" value={inputs.unit} options={UNIT_OPTIONS} onChange={(unit) => patch({ unit })} />
              </Labeled>
              <NumberField
                label="Gestational age · wk · required"
                value={inputs.gaWeeks}
                onChange={(v) => patch({ gaWeeks: v })}
                hint={inputs.gaWeeks == null ? "Required" : model.gaWeeks !== null ? trimesterHint(model.gaWeeks) : undefined}
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
                    ? `BMI ${model.bmi}${model.pctDbw ? ` · ${Math.round(model.pctDbw)}% of ideal wt` : ""}`
                    : "for BMI & obesity dosing"
                }
                min={0}
              />
              <Labeled label="Stage">
                <Seg name="stage" value={inputs.stage} options={STAGE_OPTIONS} onChange={(stage) => patch({ stage })} />
              </Labeled>
              <div style={{ gridColumn: "1 / -1" }}>
                {weightWarn ? (
                  <div className="input-warn" role="alert" style={{ marginBottom: "var(--space-2)" }}>
                    Check the units — {model.weightKg!.toFixed(0)} kg is {weightWarn}. Did you mean {inputs.unit === "kg" ? "pounds" : "kilograms"}?
                  </div>
                ) : null}
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
              </div>
            </div>

            {/* Advanced / institutional knobs — defaults preserved; hidden so a
                non-expert isn't invited to flip a policy switch by accident. */}
            <details className="advanced">
              <summary>Advanced · institutional settings</summary>
              <div className="rail" style={{ marginTop: "var(--space-3)" }}>
                <Labeled label="Guideline set" hint="Default: Valent & Barbour 2024">
                  <Seg
                    name="schedule"
                    value={config.tddSchedule}
                    options={TDD_SCHEDULE_OPTIONS.map((o) => ({ value: o.value, label: o.value }))}
                    onChange={(tddSchedule: TDDSchedule) => setConfig((c) => ({ ...c, tddSchedule }))}
                  />
                </Labeled>
                <Labeled label="Weight-based dose multiplier" hint="Only if body weight > 150% of ideal (UC Cincinnati 2023)">
                  <Seg
                    name="obesity"
                    value={inputs.obesityDosing}
                    options={OBESITY_OPTIONS}
                    onChange={(obesityDosing) => patch({ obesityDosing })}
                  />
                </Labeled>
              </div>
            </details>

            <div className="field" style={{ display: "flex", alignItems: "center", gap: 8, marginTop: "var(--space-3)" }}>
              <button className="btn btn-secondary" onClick={loadDemo}>Demo prefill</button>
              <button className="btn btn-ghost" onClick={clearInputs}>Clear</button>
            </div>
          </section>
        </details>
      ) : null}

      {active === "home" || !ActiveComp ? (
        <main className="view" aria-label="Menu">
          <HomeMenu onPick={go} />
        </main>
      ) : (
        <main className="view" role="tabpanel" aria-label={activeLabel}>
          <div className="module-actions">
            <button className="back-link" onClick={() => go("home")}>‹ All tasks</button>
            <button className="print-btn" onClick={printSummary}>Print / Save PDF</button>
          </div>
          <ActiveComp
            model={model}
            config={config}
            inputs={inputs}
            onNavigate={(id) => go(id as View)}
            adjustSeed={adjustSeed}
            onSeedAdjust={setAdjustSeed}
          />
        </main>
      )}

      <footer className="safety">
        <p style={{ margin: "0 0 var(--space-2)" }}>
          <strong>Not a validated medical device.</strong> Decision support only. Every dose requires
          explicit clinician confirmation; no output is executed automatically.
        </p>
        <p style={{ margin: 0 }}>
          Source keys: <strong>ADA26</strong> = ADA 2026 §15 · <strong>ES25</strong> = Endocrine
          Society / ESE 2025 · <strong>VB24</strong> = Valent &amp; Barbour 2024 · <strong>UC23</strong> =
          UC Cincinnati 2023. See PREGNANCY_INSULIN_ALGORITHMS.md §0 and §15.
        </p>
      </footer>
    </div>
  );
}

/** Guided landing menu — routes a clinician to the right module in plain
 *  language, so knowing the tool isn't a prerequisite for using it. */
function HomeMenu({ onPick }: { onPick: (id: TabId) => void }) {
  const [triageOpen, setTriageOpen] = useState(false);
  const [onInsulin, setOnInsulin] = useState<"" | "yes" | "no">("");
  const [phase, setPhase] = useState<"" | "pregnant" | "labor" | "delivered">("");

  let suggestion: { id: TabId; label: string } | null = null;
  if (phase === "labor") suggestion = { id: "labor", label: "During labor" };
  else if (phase === "delivered") suggestion = { id: "postpartum", label: "After delivery" };
  else if (phase === "pregnant" && onInsulin === "yes") suggestion = { id: "adjust", label: "Adjust the doses" };
  else if (phase === "pregnant" && onInsulin === "no") suggestion = { id: "start", label: "Start insulin" };

  return (
    <>
      <div className="home-hero">
        <h2>What do you need to do?</h2>
        <p>Pick a task and this tool walks you through it. Every number shows its source and math; nothing is prescribed for you.</p>
      </div>

      <div className="home-triage">
        <button className="home-triage-toggle" onClick={() => setTriageOpen((v) => !v)} aria-expanded={triageOpen}>
          Not sure where to start? Answer 2 questions {triageOpen ? "▾" : "›"}
        </button>
        {triageOpen ? (
          <div className="home-triage-body">
            <Labeled label="Is the patient already on insulin?">
              <Seg name="tri-insulin" value={onInsulin} options={[{ value: "yes", label: "Yes" }, { value: "no", label: "No" }]} onChange={setOnInsulin} />
            </Labeled>
            <Labeled label="Pregnant, in labor, or delivered?">
              <Seg
                name="tri-phase"
                value={phase}
                options={[{ value: "pregnant", label: "Pregnant" }, { value: "labor", label: "In labor" }, { value: "delivered", label: "Delivered" }]}
                onChange={setPhase}
              />
            </Labeled>
            {suggestion ? (
              <div className="home-triage-result">
                <span>Go to <strong>{suggestion.label}</strong></span>
                <button className="btn btn-primary" onClick={() => onPick(suggestion!.id)}>Open →</button>
              </div>
            ) : (
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>Answer both to get a suggestion.</p>
            )}
          </div>
        ) : null}
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
