/**
 * AdjustTab — SMBG-driven titration of a standing MDI regimen. Move a dose on a
 * pattern (a window with >30% out-of-target values), not a single reading. All
 * dose math is in dosing.ts (titratePattern); the tab only collects the pattern.
 */
import { useState } from "react";
import { conventionalNphShort, titratePattern, glycemicTargets, type StandingRegimen, type WindowState } from "../logic/dosing";
import { HYPO_THRESHOLD_MGDL, TITRATION_STEPS, DM_TYPE_OPTIONS } from "../config";
import { Kicker, NumberField, Seg, Alert, Cite } from "./controls";
import type { TabProps } from "./types";

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

export function AdjustTab({ model, inputs }: TabProps) {
  const [reg, setReg] = useState<StandingRegimen>({ amNph: 0, amLispro: 0, dinnerLispro: 0, bedtimeNph: 0 });
  const [step, setStep] = useState<number>(TITRATION_STEPS[0]);
  const [pattern, setPattern] = useState({
    fasting: "in_range" as WindowState,
    postBreakfast: "in_range" as WindowState,
    postLunch: "in_range" as WindowState,
    postDinner: "in_range" as WindowState,
  });

  const tdd = model.tdd?.tdd ?? 0;

  function prefill() {
    if (!model.tdd) return;
    const c = conventionalNphShort(model.tdd.tdd).components;
    setReg({
      amNph: c.am_nph,
      amLispro: c.am_short,
      dinnerLispro: c.pm_short_predinner,
      bedtimeNph: c.pm_nph_bedtime,
    });
  }

  const result = titratePattern(reg, pattern, step, tdd);
  const a = result.adjusted;

  const targets = glycemicTargets(inputs.dmType);
  const dmLabel = DM_TYPE_OPTIONS.find((o) => o.value === inputs.dmType)?.label ?? inputs.dmType;
  const fmtT = (r: [number | null, number]) => (r[0] === null ? `≤ ${r[1]}` : `${r[0]}–${r[1]}`);

  return (
    <>
      <section className="card elev-sm">
        <div className="card-kicker">Glycemic targets · {dmLabel} · ADA26</div>
        <table className="dtab">
          <tbody>
            <tr><td>Fasting / pre-prandial</td><td className="num" style={{ textAlign: "right" }}>{fmtT(targets.fasting)}</td></tr>
            <tr><td>1-h postprandial</td><td className="num" style={{ textAlign: "right" }}>{fmtT(targets.pp1h)}</td></tr>
            <tr><td>2-h postprandial</td><td className="num" style={{ textAlign: "right" }}>{fmtT(targets.pp2h)}</td></tr>
            <tr><td>Hypoglycemia threshold</td><td className="num" style={{ textAlign: "right" }}>&lt; {HYPO_THRESHOLD_MGDL}</td></tr>
          </tbody>
        </table>
        <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
          {inputs.dmType === "GDM_A1"
            ? "GDM A1 is diet-controlled — no lower target bound. Use either the 1-h or the 2-h postprandial target."
            : "Use either the 1-h or the 2-h postprandial target, not both."}
        </p>
      </section>

      <section>
        <Kicker>Current regimen · units</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="AM NPH" value={reg.amNph} onChange={(v) => setReg((r) => ({ ...r, amNph: v ?? 0 }))} min={0} />
          <NumberField label="AM lispro" value={reg.amLispro} onChange={(v) => setReg((r) => ({ ...r, amLispro: v ?? 0 }))} min={0} />
          <NumberField label="Dinner lispro" value={reg.dinnerLispro} onChange={(v) => setReg((r) => ({ ...r, dinnerLispro: v ?? 0 }))} min={0} />
          <NumberField label="Bedtime NPH" value={reg.bedtimeNph} onChange={(v) => setReg((r) => ({ ...r, bedtimeNph: v ?? 0 }))} min={0} />
        </div>
        <button className="btn btn-ghost" style={{ marginTop: 8 }} onClick={prefill} disabled={!model.tdd}>
          Prefill from calculated start dose
        </button>
      </section>

      <section>
        <Kicker>Review the last week&apos;s pattern</Kicker>
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
        <Kicker>Adjusted regimen</Kicker>
        <div className="rows" style={{ marginTop: 8 }}>
          <AdjRow label="AM NPH" from={reg.amNph} to={a.amNph} />
          <AdjRow label="AM lispro" from={reg.amLispro} to={a.amLispro} />
          <AdjRow label="Dinner lispro" from={reg.dinnerLispro} to={a.dinnerLispro} />
          <AdjRow label="Bedtime NPH" from={reg.bedtimeNph} to={a.bedtimeNph} />
        </div>
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
