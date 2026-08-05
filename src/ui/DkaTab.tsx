/**
 * DkaTab — diabetic ketoacidosis (spec §10 / Module H).
 *
 * Insulin is managed **strictly by the Yale IV insulin infusion protocol**
 * (initiation, rate adjustments, hypoglycemia rescue). There is NO routine
 * weight-based loading bolus: Yale starts an infusion without a bolus, and an
 * IV bolus is given only when *initiating* at BG ≥ 300 (glucose-based,
 * round(BG ÷ 100) units). Fluids and potassium/electrolytes are supplemental
 * reference from UC23. HS-14: while DKA is active, suspend the routine dosing
 * modules and manage DKA only. Yale logic lives in dosing.ts.
 */
import { useState } from "react";
import { yaleInsulinInfusion, DKA } from "../logic/dosing";
import { Kicker, NumberField, Alert, Cite } from "./controls";

const YALE_HEADING: Record<string, string> = {
  INITIATE: "Initiate infusion",
  SET_RATE: "Set infusion rate",
  HOLD_THEN_SET: "Hold, then set",
  RESCUE: "Hypoglycemia rescue",
};

export function DkaTab() {
  const [yale, setYale] = useState<{ currentBs: number | null; previousBs: number | null; hours: number | null; rate: number | null }>({
    currentBs: 220,
    previousBs: 200,
    hours: 1,
    rate: 3,
  });

  const yaleResult =
    yale.currentBs === null
      ? null
      : yaleInsulinInfusion({ currentBs: yale.currentBs, previousBs: yale.previousBs, hoursSincePrevious: yale.hours ?? 1, currentRate: yale.rate });

  return (
    <>
      <Alert title="Reference protocol — not automated dosing" stop>
        <p style={{ marginBottom: 0 }}>
          DKA is an ICU-level emergency. While a DKA episode is active,{" "}
          <strong>suspend the routine insulin modules</strong> and manage DKA only.
          <Cite> HS-14 · spec §10</Cite>
        </p>
      </Alert>

      {/* ── Fluids (reference) ────────────────────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Fluids · reference · UC23</div>
        <table className="dtab">
          <tbody>
            <tr><td>Hour 1</td><td>{DKA.fluids.hour1LitersNs} L normal saline</td></tr>
            <tr><td>Hours 2–4</td><td>{DKA.fluids.hours2to4LitersPerHour[0]}–{DKA.fluids.hours2to4LitersPerHour[1]} L / hour</td></tr>
            <tr><td>Thereafter</td><td>{DKA.fluids.thereafterMlPerHour} mL/hr {DKA.fluids.thereafterFluid} until 80% of the deficit is corrected</td></tr>
            <tr><td>BG &lt; {DKA.fluids.switchToD5HalfNsWhenBgLt}</td><td>change to D5 ½NS to allow the insulin infusion to continue</td></tr>
          </tbody>
        </table>
      </section>

      {/* ── Insulin infusion · Yale protocol (strict) ─────────────── */}
      <section>
        <Kicker>Insulin infusion · Yale protocol</Kicker>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          Insulin is managed <strong>strictly by Yale</strong> (target 140–180 mg/dL; general
          critical-care, not pregnancy-specific). <strong>No routine loading bolus</strong> — the
          infusion starts without a bolus, and an IV bolus is given only when initiating at BG ≥ 300
          (round(BG ÷ 100) units). Continue the drip until the anion gap and bicarbonate normalize —
          <em> not</em> until glucose normalizes.
        </p>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Current BG · mg/dL" value={yale.currentBs} onChange={(v) => setYale((y) => ({ ...y, currentBs: v }))} min={0} />
          <NumberField label="Previous BG · mg/dL" value={yale.previousBs} onChange={(v) => setYale((y) => ({ ...y, previousBs: v }))} min={0} hint="0 / blank = starting" />
          <NumberField label="Hours since previous" value={yale.hours} onChange={(v) => setYale((y) => ({ ...y, hours: v }))} min={0} step={0.5} />
          <NumberField label="Current rate · u/hr" value={yale.rate} onChange={(v) => setYale((y) => ({ ...y, rate: v }))} min={0} step={0.5} hint="0 / blank = not infusing" />
        </div>
        {yaleResult ? (
          <Alert title={YALE_HEADING[yaleResult.kind]} stop={yaleResult.kind === "RESCUE" || yaleResult.warning === "Consult MD"}>
            <p style={{ marginBottom: yaleResult.kind === "SET_RATE" || yaleResult.kind === "HOLD_THEN_SET" ? 6 : 0 }}>
              <strong>{yaleResult.instruction}</strong>
            </p>
            {yaleResult.bsChangePerHr !== null ? (
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                BG change {yaleResult.bsChangePerHr > 0 ? "+" : ""}{yaleResult.bsChangePerHr} mg/dL/hr · delta {yaleResult.delta} · rate change {yaleResult.finalDelta! > 0 ? "+" : ""}{yaleResult.finalDelta} u/hr
                {yaleResult.warning ? ` · ${yaleResult.warning}` : ""}
              </p>
            ) : yaleResult.restartRate !== null ? (
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>Suggested restart rate: {yaleResult.restartRate} u/hr</p>
            ) : null}
          </Alert>
        ) : null}
        <div className="card-meta" style={{ marginTop: 6 }}>
          <Cite>Ported from Insulin IP Calc v2.4 · © John George K. · LGPL v3</Cite>
        </div>
      </section>

      {/* ── Potassium & electrolytes (reference) ──────────────────── */}
      <section className="card">
        <div className="card-kicker">Potassium &amp; electrolytes · reference · UC23</div>
        <table className="dtab">
          <tbody>
            <tr><td>Potassium — normal / low</td><td>consider K up to {DKA.potassium.normalOrLowMeqPerHourMax[0]}–{DKA.potassium.normalOrLowMeqPerHourMax[1]} mEq/hr</td></tr>
            <tr><td>Potassium — elevated</td><td>no supplemental K until normal, then 20–30 mEq/L</td></tr>
            <tr><td>Phosphate</td><td>replace if &lt; {DKA.phosphateReplaceIfLtMgDl} mg/dL, or cardiac dysfunction, or obtunded</td></tr>
            <tr><td>Monitoring</td><td>BG q1h · vitals q1–2h · electrolytes/AG/VBG/ketones until pH &amp; AG normalize · continuous ECG + pulse ox</td></tr>
            <tr><td>Fetal</td><td>CEFM if &gt; 24 weeks, else FHT q4–8h · Foley + I&amp;O hourly · consult NICU, Anesthesia</td></tr>
          </tbody>
        </table>
      </section>

      <Alert title="Do not deliver during DKA">
        <p style={{ marginBottom: 0 }}>
          Classical teaching: do not intervene (deliver) while the patient is in DKA — stabilize the
          mother first.<Cite> UC23</Cite>
        </p>
      </Alert>
    </>
  );
}
