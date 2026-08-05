/**
 * DkaTab — diabetic ketoacidosis (spec §10 / Module H).
 *
 * Insulin is managed **strictly by the published Yale IV insulin infusion
 * protocol** (target 100–139): initiation gives an IV bolus equal to the
 * starting rate (BG ÷ 100, rounded to 0.5), then the "Changing the Infusion
 * Rate" table (current-BG column × hourly change) drives adjustments, with the
 * hypoglycemia rescue bands. There is no weight-based loading dose. Fluids and
 * potassium/electrolytes are supplemental reference from UC23. HS-14: while DKA
 * is active, suspend the routine dosing modules and manage DKA only. Yale logic
 * lives in dosing.ts.
 */
import { useState } from "react";
import { yaleInsulinInfusion, YALE, DKA } from "../logic/dosing";
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
          Managed <strong>strictly by the Yale protocol</strong> — target {YALE.target[0]}–{YALE.target[1]} mg/dL.
          At initiation, give an <strong>IV bolus equal to the starting rate</strong> (BG ÷ 100, rounded
          to 0.5 U), then run the infusion at that rate. Enter current and previous BG, the interval,
          and the running rate; the recommendation uses the current-BG column and the hourly rate of change.
        </p>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Current BG · mg/dL" value={yale.currentBs} onChange={(v) => setYale((y) => ({ ...y, currentBs: v }))} min={0} />
          <NumberField label="Previous BG · mg/dL" value={yale.previousBs} onChange={(v) => setYale((y) => ({ ...y, previousBs: v }))} min={0} hint="0 / blank = starting" />
          <NumberField label="Hours since previous" value={yale.hours} onChange={(v) => setYale((y) => ({ ...y, hours: v }))} min={0} step={0.5} />
          <NumberField label="Current rate · u/hr" value={yale.rate} onChange={(v) => setYale((y) => ({ ...y, rate: v }))} min={0} step={0.5} hint="0 / blank = not infusing" />
        </div>
        {yaleResult ? (
          <Alert title={YALE_HEADING[yaleResult.kind]} stop={yaleResult.kind === "RESCUE" || (yaleResult.warning?.includes("consult MD") ?? false)}>
            <p style={{ marginBottom: yaleResult.kind === "SET_RATE" || yaleResult.kind === "HOLD_THEN_SET" ? 6 : 0 }}>
              <strong>{yaleResult.instruction}</strong>
            </p>
            {yaleResult.finalDelta !== null ? (
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>
                BG change {yaleResult.bsChangePerHr! > 0 ? "+" : ""}{yaleResult.bsChangePerHr} mg/dL/hr · delta {yaleResult.delta} · rate change {yaleResult.finalDelta > 0 ? "+" : ""}{yaleResult.finalDelta} u/hr
                {yaleResult.warning ? ` · ${yaleResult.warning}` : ""}
              </p>
            ) : yaleResult.restartRate !== null ? (
              <p className="text-muted" style={{ fontSize: 12, margin: 0 }}>Suggested restart rate: {yaleResult.restartRate} u/hr</p>
            ) : null}
          </Alert>
        ) : null}
        <div className="card-meta" style={{ marginTop: 6 }}>
          <Cite>Yale Insulin Infusion Protocol · target {YALE.target[0]}–{YALE.target[1]} mg/dL</Cite>
        </div>
      </section>

      {/* ── Yale protocol notes ───────────────────────────────────── */}
      <section className="card">
        <div className="card-kicker">Yale protocol notes</div>
        <table className="dtab">
          <tbody>
            <tr><td>Infusion</td><td>{YALE.mix}; prime {YALE.primeMl} mL of tubing; titrate in {YALE.incrementUHr} U/hr increments</td></tr>
            <tr><td>Monitoring</td><td>check BG hourly until stable (3 consecutive in range), then q2h</td></tr>
            <tr><td>Consult MD</td><td>if BG ≥ {YALE.consultIfBgGte} mg/dL, or the response is unexpected — the protocol is a general ICU protocol, <strong>not</strong> tailored for DKA/HHS</td></tr>
            <tr><td>Drip endpoint · UC23</td><td>continue insulin until the anion gap and bicarbonate normalize — <strong>not</strong> until glucose normalizes</td></tr>
          </tbody>
        </table>
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
