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
import { deriveModel } from "./model";
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

const TABS = [
  { id: "start", label: "Start", Comp: StartTab },
  { id: "adjust", label: "Adjust", Comp: AdjustTab },
  { id: "pump", label: "Pump", Comp: PumpTab },
  { id: "steroids", label: "Steroids", Comp: SteroidsTab },
  { id: "labor", label: "Labor", Comp: LaborTab },
  { id: "dka", label: "DKA", Comp: DkaTab },
  { id: "postpartum", label: "Postpartum", Comp: PostpartumTab },
  { id: "cgm", label: "CGM", Comp: CgmTab },
  { id: "hypo", label: "Hypo", Comp: HypoTab },
] as const;

type TabId = (typeof TABS)[number]["id"];

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
  const [active, setActive] = useState<TabId>("start");
  const [inputsOpen, setInputsOpen] = useState(true);

  const model = useMemo(() => deriveModel(inputs, config), [inputs, config]);

  function patch(p: Partial<PatientInputs>) {
    setInputs((prev) => ({ ...prev, ...p }));
  }

  const ActiveComp = TABS.find((t) => t.id === active)!.Comp;
  const activeLabel = TABS.find((t) => t.id === active)!.label;
  const inputSummary =
    inputs.weight != null
      ? `${inputs.weight} ${inputs.unit} · ${inputs.gaWeeks ?? "–"} wk · ${config.tddSchedule}`
      : "Tap to enter patient details";

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
          aria-label="Module"
          value={active}
          onChange={(e) => setActive(e.target.value as TabId)}
        >
          {TABS.map((t) => (
            <option key={t.id} value={t.id}>{t.label}</option>
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
            hint={model.pctDbw ? `${Math.round(model.pctDbw)}% DBW` : "for obesity dosing"}
            min={0}
          />
          <Labeled label="Stage">
            <Seg name="stage" value={inputs.stage} options={STAGE_OPTIONS} onChange={(stage) => patch({ stage })} />
          </Labeled>
          <div style={{ gridColumn: "1 / -1" }}>
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

      <main className="view" role="tabpanel" aria-label={activeLabel}>
        <ActiveComp model={model} config={config} inputs={inputs} />
      </main>

      <footer className="safety">
        <strong>Not a validated medical device.</strong> Decision support only. Every dose requires
        explicit clinician confirmation; no output is executed automatically. Sources: ADA 2026 §15,
        Endocrine Society/ESE 2025, Valent &amp; Barbour 2024, UC Cincinnati 2023. See
        PREGNANCY_INSULIN_ALGORITHMS.md §0 and §15.
      </footer>
    </div>
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
