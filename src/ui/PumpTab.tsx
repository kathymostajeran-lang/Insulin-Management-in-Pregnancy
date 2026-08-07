/**
 * PumpTab — CSII initiation (UC23). Computes final TDD (lower of MDI-derived and
 * weight-derived), the three basal rates, correction factor and carb ratio. The
 * basal-rate math resolves conflict C-14 (Total Daily Basal ÷ 24). See dosing.ts.
 */
import { useState } from "react";
import { csiiInitiation } from "../logic/dosing";
import { Kicker, NumberField, NeedInput, Cite } from "./controls";
import type { TabProps } from "./types";

export function PumpTab({ model }: TabProps) {
  const [mdiTdd, setMdiTdd] = useState<number | null>(80);

  if (model.weightKg === null) {
    return <NeedInput>Enter weight to calculate pump settings.</NeedInput>;
  }

  const p = csiiInitiation(model.weightKg, model.gaWeeks, { mdiTdd });

  return (
    <>
      <section>
        <Kicker>CSII initiation · UC23</Kicker>
        <NumberField
          label="Current injection total daily dose · units, optional"
          value={mdiTdd}
          onChange={setMdiTdd}
          min={0}
          hint="Pump dose is the lower of (injection dose × 0.75) and the weight-based estimate"
        />
        <div className="rail" style={{ marginTop: 12 }}>
          <Stat label="Final pump TDD" value={`${p.finalTdd} u`} />
          <Stat label="Total daily basal · 50%" value={`${p.totalDailyBasal} u`} />
          <Stat label="Correction factor" value={`${p.correctionFactor} mg/dL/u`} />
          <Stat label="I : C ratio" value={`1 : ${p.icrGPerUnit} g`} />
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          From injections: {p.tddFromMdi ?? "—"} u · from weight: {p.tddFromWeight} u — the lower is used.
        </p>
      </section>

      <section className="card elev-sm">
        <div className="card-kicker">Basal rate schedule</div>
        <table className="dtab">
          <thead>
            <tr>
              <th>Time</th>
              <th style={{ textAlign: "right" }}>Rate</th>
            </tr>
          </thead>
          <tbody>
            <tr><td>00:00–03:00 · ×0.8 (overnight nadir)</td><td className="num" style={{ textAlign: "right" }}>{p.basalRate1} u/hr</td></tr>
            <tr><td>03:00–08:00 · ×1.2 (dawn)</td><td className="num" style={{ textAlign: "right" }}>{p.basalRate2} u/hr</td></tr>
            <tr><td>08:00–24:00 · key value</td><td className="num" style={{ textAlign: "right" }}>{p.basalRate3} u/hr</td></tr>
          </tbody>
        </table>
        <div className="card-meta">
          <Cite>Agent: aspart or lispro. Recompute at 18 / 26 / 36 wk boundaries.</Cite>
        </div>
      </section>
    </>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className="num" style={{ fontSize: 22 }}>{value}</div>
    </div>
  );
}
