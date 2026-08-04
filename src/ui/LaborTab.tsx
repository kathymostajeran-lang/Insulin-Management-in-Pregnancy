/**
 * LaborTab — intrapartum IV insulin infusion (UC23). BG in → units/hr out,
 * including the C-15 gap at 80–99 mg/dL which requires institutional policy.
 */
import { useState } from "react";
import { UC23_INTRAPARTUM, intrapartumRate, UnresolvedPolicyGap } from "../logic/dosing";
import { UNRESOLVED_POLICY } from "../config";
import { Kicker, NumberField, Alert, Cite } from "./controls";

export function LaborTab() {
  const [bg, setBg] = useState<number | null>(135);

  let doseText = "—";
  let gap = false;
  if (bg !== null) {
    try {
      const r = intrapartumRate(bg, UNRESOLVED_POLICY.INTRAPARTUM_BAND_80_99);
      doseText = typeof r === "number" ? `${r} u/hr` : r;
    } catch (e) {
      if (e instanceof UnresolvedPolicyGap) gap = true;
    }
  }

  return (
    <>
      <section>
        <Kicker>Intrapartum IV insulin algorithm</Kicker>
        <NumberField
          label="Capillary blood glucose · mg/dL, hourly"
          value={bg}
          onChange={setBg}
          min={0}
        />
        {gap ? (
          <p style={{ marginTop: 8 }}>
            <span className="num" style={{ fontSize: 22, color: "var(--color-accent)" }}>Policy needed</span>
          </p>
        ) : (
          <p style={{ marginTop: 8 }}>
            <span className="num" style={{ fontSize: 28 }}>{doseText}</span>
          </p>
        )}
        <p className="text-muted" style={{ fontSize: 12 }}>
          Regular insulin 100 u / 100 mL NS · 1 u = 1 mL · start 0.5 u/hr. Main line D5NS at 125 mL/hr
          throughout.
        </p>
      </section>

      {gap ? (
        <Alert title="BG 80–99 mg/dL — no published rule (C-15)" stop>
          <p style={{ marginBottom: 0 }}>
            The guide's table has no 80–99 row. Restart the infusion once BG is &gt; 80 mg/dL twice.
            This band must be resolved by institutional policy before use (committee sign-off required).
            <Cite> spec §11 · C-15</Cite>
          </p>
        </Alert>
      ) : null}

      <section className="card elev-sm">
        <table className="dtab">
          <thead>
            <tr>
              <th>Blood glucose</th>
              <th style={{ textAlign: "right" }}>Insulin</th>
            </tr>
          </thead>
          <tbody>
            <tr data-active={bg !== null && bg < 80}>
              <td>&lt; 80</td>
              <td style={{ textAlign: "right" }}>Discontinue drip</td>
            </tr>
            <tr data-active={bg !== null && bg >= 80 && bg <= 99}>
              <td>80–99</td>
              <td style={{ textAlign: "right", color: "var(--color-accent)" }}>No rule — see C-15</td>
            </tr>
            {UC23_INTRAPARTUM.filter((b) => b.lo >= 100).map((b) => {
              const isActive = bg !== null && bg >= b.lo && bg <= b.hi;
              const label = b.hi >= 10_000 ? `>${b.lo - 1}` : `${b.lo}–${b.hi}`;
              const val = b.action ?? `${b.rate} u/hr`;
              return (
                <tr key={b.lo} data-active={isActive}>
                  <td>{label}</td>
                  <td className="num" style={{ textAlign: "right" }}>{val}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <div className="card-meta">
          <Cite>UC23 intrapartum table · target {UNRESOLVED_POLICY.INTRAPARTUM_BAND_80_99 ? "" : ""}70–110 (VB24, C-12)</Cite>
        </div>
      </section>

      <section className="card">
        <div className="card-kicker">Active labor rules</div>
        <table className="dtab">
          <tbody>
            <tr><td>Target range</td><td style={{ textAlign: "right" }}>60–100 (UC23) · 70–110 (VB24)</td></tr>
            <tr><td>BG checks</td><td style={{ textAlign: "right" }}>hourly active · 2 h latent</td></tr>
            <tr><td>SC insulin</td><td style={{ textAlign: "right" }}>Discontinue all; hold and keep NPO</td></tr>
            <tr><td>Start the drip when</td><td style={{ textAlign: "right" }}>BG 110–140 × 2, or &gt; 140 × 1</td></tr>
            <tr><td>Hypoglycemia</td><td style={{ textAlign: "right" }}>Stop insulin, call MD, follow protocol</td></tr>
            <tr><td>Back to SC split dose</td><td style={{ textAlign: "right" }}>Increase TDD by 25%</td></tr>
          </tbody>
        </table>
      </section>
    </>
  );
}
