/**
 * AdjustTab — SMBG-driven titration of a standing MDI regimen. Move a dose on a
 * pattern (a window with >30% out-of-target values), not a single reading. All
 * dose math is in dosing.ts (titratePattern); the tab only collects the pattern.
 */
import { useState } from "react";
import { conventionalNphShort, titratePattern, type StandingRegimen, type WindowState } from "../logic/dosing";
import { HYPO_THRESHOLD_MGDL, TITRATION_STEPS, GLYCEMIC_TARGETS } from "../config";
import { Kicker, NumberField, Seg, Alert, Cite, NeedInput } from "./controls";
import type { TabProps, AdjustPattern } from "./types";

const ZERO_REG: StandingRegimen = { amNph: 0, amLispro: 0, dinnerLispro: 0, bedtimeNph: 0 };
const IN_RANGE: AdjustPattern = { fasting: "in_range", postBreakfast: "in_range", postLunch: "in_range", postDinner: "in_range" };

function startRegimen(tddVal: number): StandingRegimen {
  const c = conventionalNphShort(tddVal).components;
  return { amNph: c.am_nph, amLispro: c.am_short, dinnerLispro: c.pm_short_predinner, bedtimeNph: c.pm_nph_bedtime };
}

const WINDOW_OPTS: ReadonlyArray<{ value: WindowState; label: string }> = [
  { value: "in_range", label: "In range" },
  { value: "high", label: "High" },
  { value: "low", label: "Low" },
];

const WINDOWS = [
  { key: "fasting", label: "Fasting", target: "70–95", drives: "Bedtime NPH" },
  { key: "postBreakfast", label: "Post-breakfast", target: "110–140", drives: "AM lispro" },
  { key: "postLunch", label: "Post-lunch", target: "110–140", drives: "Morning NPH" },
  { key: "postDinner", label: "Post-dinner", target: "110–140", drives: "Dinner lispro" },
] as const;

export function AdjustTab({ model, adjustSeed }: TabProps) {
  // Auto-prefill the current regimen from the calculated start dose (if a TDD is
  // available); the Clear button is the escape. Seed the weekly pattern from a
  // CGM hand-off when present.
  const [reg, setReg] = useState<StandingRegimen>(() => (model.tdd ? startRegimen(model.tdd.tdd) : ZERO_REG));
  const [step, setStep] = useState<number>(TITRATION_STEPS[0]);
  const [pattern, setPattern] = useState<AdjustPattern>(() => (adjustSeed ? { ...adjustSeed } : { ...IN_RANGE }));

  const tdd = model.tdd?.tdd ?? 0;

  function prefill() {
    if (!model.tdd) return;
    setReg(startRegimen(model.tdd.tdd));
  }

  const result = titratePattern(reg, pattern, step, tdd);
  const a = result.adjusted;

  const regEmpty = reg.amNph === 0 && reg.amLispro === 0 && reg.dinnerLispro === 0 && reg.bedtimeNph === 0;
  const changed =
    a.amNph !== reg.amNph || a.amLispro !== reg.amLispro || a.dinnerLispro !== reg.dinnerLispro || a.bedtimeNph !== reg.bedtimeNph;

  return (
    <>
      <details className="ref-details card elev-sm">
        <summary>Glycemic targets · ADA26</summary>
        <table className="dtab" style={{ marginTop: 8 }}>
          <tbody>
            {GLYCEMIC_TARGETS.map((t) => (
              <tr key={t.label}>
                <td>{t.label}</td>
                <td className="num" style={{ textAlign: "right" }}>{t.target}</td>
              </tr>
            ))}
            <tr><td>Hypoglycemia threshold</td><td className="num" style={{ textAlign: "right" }}>&lt; {HYPO_THRESHOLD_MGDL}</td></tr>
          </tbody>
        </table>
        <p className="text-muted" style={{ fontSize: 12, margin: "8px 0 0" }}>
          Use either the 1-h or the 2-h postprandial target, not both.
        </p>
      </details>

      {adjustSeed ? (
        <p className="text-muted" style={{ fontSize: 13, margin: 0 }}>
          Pattern carried over from the CGM report — confirm the current doses below.
        </p>
      ) : null}

      <section>
        <Kicker>1 · Current regimen · units</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="AM NPH" value={reg.amNph} onChange={(v) => setReg((r) => ({ ...r, amNph: v ?? 0 }))} min={0} />
          <NumberField label="AM lispro" value={reg.amLispro} onChange={(v) => setReg((r) => ({ ...r, amLispro: v ?? 0 }))} min={0} />
          <NumberField label="Dinner lispro" value={reg.dinnerLispro} onChange={(v) => setReg((r) => ({ ...r, dinnerLispro: v ?? 0 }))} min={0} />
          <NumberField label="Bedtime NPH" value={reg.bedtimeNph} onChange={(v) => setReg((r) => ({ ...r, bedtimeNph: v ?? 0 }))} min={0} />
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button className="btn btn-secondary" onClick={prefill} disabled={!model.tdd}>
            Prefill from calculated start dose
          </button>
          <button className="btn btn-ghost" onClick={() => setReg({ ...ZERO_REG })}>Clear</button>
        </div>
      </section>

      <section>
        <Kicker>2 · Review the last week&apos;s pattern</Kicker>
        <p className="text-muted" style={{ fontSize: 12 }}>
          Move a dose on a pattern, not one reading — flag a window when &gt; 30% of its values sit
          outside target.
        </p>
        <div className="rows" style={{ marginTop: 8 }}>
          {WINDOWS.map((w) => (
            <div className="row" key={w.key} style={{ gridTemplateColumns: "1fr auto" }}>
              <span className="row-when">
                {w.label} <span className="text-muted">target {w.target} → {w.drives}</span>
              </span>
              <Seg
                name={w.key}
                value={pattern[w.key]}
                options={WINDOW_OPTS}
                onChange={(v) => setPattern((p) => ({ ...p, [w.key]: v }))}
              />
            </div>
          ))}
        </div>
        <div className="field" style={{ marginTop: 12 }}>
          <label>Step per adjustment</label>
          <Seg
            name="step"
            value={String(step)}
            options={TITRATION_STEPS.map((s) => ({ value: String(s), label: `${s * 100}%` }))}
            onChange={(v) => setStep(Number(v))}
          />
        </div>
      </section>

      <section>
        <Kicker>3 · Adjusted result</Kicker>
        {regEmpty ? (
          <NeedInput>Enter the current doses above, or tap “Prefill from calculated start dose”.</NeedInput>
        ) : (
          <div className="answer" style={{ marginTop: 8 }}>
            {!changed ? (
              <p className="answer-lead">No change — all windows in target. Continue the current doses.</p>
            ) : null}
            <div className="rows">
              <AdjRow label="AM NPH" from={reg.amNph} to={a.amNph} />
              <AdjRow label="AM lispro" from={reg.amLispro} to={a.amLispro} />
              <AdjRow label="Dinner lispro" from={reg.dinnerLispro} to={a.dinnerLispro} />
              <AdjRow label="Bedtime NPH" from={reg.bedtimeNph} to={a.bedtimeNph} />
            </div>
          </div>
        )}
        <div className="card-meta" style={{ marginTop: 8 }}>
          <Cite>Trigger &gt;30% of a window out of target · cadence 2–3 days · step 10–20% (VB24, ADA26)</Cite>
        </div>
      </section>

      {result.overCap ? (
        <Alert title="Over the 20% cap">
          <p style={{ marginBottom: 0 }}>
            Total increase is {result.totalIncrease} u, more than 20% of a {Math.round(tdd)} u TDD
            ({result.capUnits} u). Stage the change — raise the largest driver first and review in
            2–3 days.
          </p>
        </Alert>
      ) : null}
    </>
  );
}

function AdjRow({ label, from, to }: { label: string; from: number; to: number }) {
  const changed = to !== from;
  return (
    <div className="row" style={{ gridTemplateColumns: "1fr auto" }}>
      <span className="row-when">{label}</span>
      <span className="row-units num" style={{ color: changed ? "var(--color-accent)" : undefined }}>
        {to} u{changed ? <span className="text-muted" style={{ fontSize: 12 }}> (was {from})</span> : null}
      </span>
    </div>
  );
}
