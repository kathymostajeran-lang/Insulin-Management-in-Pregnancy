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
import { CorrectTab } from "./ui/CorrectTab";
import { LaborTab } from "./ui/LaborTab";
import { AdjustTab } from "./ui/AdjustTab";
import { HypoTab } from "./ui/HypoTab";
import { CgmTab } from "./ui/CgmTab";
import { PumpTab } from "./ui/PumpTab";
import { PostpartumTab } from "./ui/PostpartumTab";

const TABS = [
  { id: "start", label: "Start", Comp: StartTab },
  { id: "correct", label: "Correct", Comp: CorrectTab },
  { id: "labor", label: "Labor", Comp: LaborTab },
  { id: "adjust", label: "Adjust", Comp: AdjustTab },
  { id: "hypo", label: "Hypo", Comp: HypoTab },
  { id: "cgm", label: "CGM", Comp: CgmTab },
  { id: "pump", label: "Pump", Comp: PumpTab },
  { id: "postpartum", label: "Postpartum", Comp: PostpartumTab },
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

  const model = useMemo(() => deriveModel(inputs, config), [inputs, config]);

  function patch(p: Partial<PatientInputs>) {
    setInputs((prev) => ({ ...prev, ...p }));
  }

  const ActiveComp = TABS.find((t) => t.id === active)!.Comp;

  return (
    <div className="app">
      <header className="app-header">
        <h1 className="app-title">Insulin in pregnancy</h1>
        <div className="app-sub">
          Guideline-based dosing decision support · every output requires clinician confirmation
        </div>
      </header>

      {/* ── Patient inputs ─────────────────────────────────────────── */}
      <section className="view" style={{ paddingBottom: 0 }}>
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
          <Labeled label="Obesity dosing · >150% DBW" hint="UC23 branch — clinician-applied multiplier">
            <Seg
              name="obesity"
              value={inputs.obesityDosing}
              options={OBESITY_OPTIONS}
              onChange={(obesityDosing) => patch({ obesityDosing })}
            />
          </Labeled>
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

      {/* ── TDD banner (persistent across tabs) ────────────────────── */}
      <section className="view" style={{ paddingTop: "var(--space-3)", paddingBottom: 0 }}>
        <TddBanner model={model} />
      </section>

      {/* ── Tabs ───────────────────────────────────────────────────── */}
      <nav className="tabs" role="tablist" aria-label="Modules">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={active === t.id}
            className="tab"
            onClick={() => setActive(t.id)}
          >
            {t.label}
          </button>
        ))}
      </nav>

      <main className="view" role="tabpanel">
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
