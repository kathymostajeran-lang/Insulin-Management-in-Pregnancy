/**
 * DkaTab — diabetic ketoacidosis (spec §10 / Module H). Sole source UC23.
 *
 * REFERENCE PROTOCOL ONLY. This app deliberately does NOT compute DKA orders —
 * it is an ICU-level condition. The tab supports recognition (dkaDiagnosis,
 * including euglycemic DKA) and the ICU-escalation check (dkaIcuCriteria); the
 * fluid/insulin/electrolyte protocol is shown as reference values only. HS-14:
 * while DKA is active, suspend the routine dosing modules and manage DKA only.
 */
import { useState } from "react";
import { dkaDiagnosis, dkaIcuCriteria, yaleInsulinInfusion, DKA, type DkaLabs } from "../logic/dosing";
import { Kicker, NumberField, Seg, Alert, Cite } from "./controls";

const YALE_HEADING: Record<string, string> = {
  INITIATE: "Initiate infusion",
  SET_RATE: "Set infusion rate",
  HOLD_THEN_SET: "Hold, then set",
  RESCUE: "Hypoglycemia rescue",
};

const YN: ReadonlyArray<{ value: "yes" | "no"; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];
const yes = (v: "yes" | "no") => v === "yes";

export function DkaTab() {
  const [labs, setLabs] = useState<{ ph: number | null; bicarb: number | null; anionGap: number | null; glucose: number | null }>({
    ph: 7.2,
    bicarb: 12,
    anionGap: 18,
    glucose: 180,
  });
  const [ketones, setKetones] = useState<"yes" | "no">("yes");
  const [altered, setAltered] = useState<"yes" | "no">("no");
  const [ekg, setEkg] = useState<"yes" | "no">("no");
  const [kussmaul, setKussmaul] = useState<"yes" | "no">("no");
  const [yale, setYale] = useState<{ currentBs: number | null; previousBs: number | null; hours: number | null; rate: number | null }>({
    currentBs: 220,
    previousBs: 200,
    hours: 1,
    rate: 3,
  });

  const dkaLabs: DkaLabs = { ...labs, ketonesElevated: yes(ketones) };
  const dx = dkaDiagnosis(dkaLabs);
  const icu = dkaIcuCriteria({ alteredSensorium: yes(altered), ph: labs.ph, abnormalEkg: yes(ekg), kussmaul: yes(kussmaul) });
  const yaleResult =
    yale.currentBs === null
      ? null
      : yaleInsulinInfusion({ currentBs: yale.currentBs, previousBs: yale.previousBs, hoursSincePrevious: yale.hours ?? 1, currentRate: yale.rate });

  const critRows: Array<{ label: string; met: boolean }> = [
    { label: `pH < ${DKA.diagnostic.phMax}`, met: dx.criteria.acidemia },
    { label: `Bicarbonate < ${DKA.diagnostic.bicarbMaxMeqL} mEq/L`, met: dx.criteria.lowBicarb },
    { label: `Anion gap > ${DKA.diagnostic.anionGapMin}`, met: dx.criteria.highAnionGap },
    { label: "Serum ketones elevated", met: dx.criteria.ketones },
  ];

  return (
    <>
      <Alert title="Reference protocol — not automated dosing" stop>
        <p style={{ marginBottom: 0 }}>
          DKA is an ICU-level emergency; this app does not calculate DKA orders. While a DKA episode is
          active, <strong>suspend the routine insulin modules</strong> and manage DKA only.
          <Cite> HS-14 · spec §10</Cite>
        </p>
      </Alert>

      {/* ── Recognition ───────────────────────────────────────────── */}
      <section>
        <Kicker>Recognition · diagnostic criteria</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="pH" value={labs.ph} onChange={(v) => setLabs((l) => ({ ...l, ph: v }))} step={0.01} min={6.5} max={8} />
          <NumberField label="Bicarbonate · mEq/L" value={labs.bicarb} onChange={(v) => setLabs((l) => ({ ...l, bicarb: v }))} min={0} />
          <NumberField label="Anion gap" value={labs.anionGap} onChange={(v) => setLabs((l) => ({ ...l, anionGap: v }))} min={0} />
          <NumberField label="Glucose · mg/dL, optional" value={labs.glucose} onChange={(v) => setLabs((l) => ({ ...l, glucose: v }))} min={0} />
          <div className="field">
            <label>Serum ketones elevated?</label>
            <Seg name="ketones" value={ketones} options={YN} onChange={setKetones} />
          </div>
        </div>

        <table className="dtab" style={{ marginTop: 12 }}>
          <tbody>
            {critRows.map((r) => (
              <tr key={r.label}>
                <td>{r.label}</td>
                <td style={{ textAlign: "right" }}>
                  <span className={`tag ${r.met ? "tag-accent" : "tag-neutral"}`}>{r.met ? "met" : "not met"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {dx.isDka ? (
          <Alert title={dx.euglycemic ? "DKA — euglycemic pattern" : "DKA criteria met"} stop>
            <p style={{ marginBottom: 0 }}>
              All four criteria are present. {dx.euglycemic ? "Glucose is not markedly elevated — euglycemic DKA is more common in pregnancy; do not require hyperglycemia to diagnose." : ""}
            </p>
          </Alert>
        ) : (
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
            Not all DKA criteria are met. Note: glucose is deliberately not part of the criteria —
            euglycemic DKA is more common in pregnancy.
          </p>
        )}
        <div className="card-meta"><Cite>UC23 · incidence {DKA.incidencePregestationalT1dmPct[0]}–{DKA.incidencePregestationalT1dmPct[1]}% in pregestational T1DM</Cite></div>
      </section>

      {/* ── ICU escalation ────────────────────────────────────────── */}
      <section>
        <Kicker>ICU consideration</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <div className="field"><label>Altered sensorium?</label><Seg name="altered" value={altered} options={YN} onChange={setAltered} /></div>
          <div className="field"><label>Abnormal EKG?</label><Seg name="ekg" value={ekg} options={YN} onChange={setEkg} /></div>
          <div className="field"><label>Kussmaul respiration?</label><Seg name="kussmaul" value={kussmaul} options={YN} onChange={setKussmaul} /></div>
        </div>
        {icu.indicated ? (
          <Alert title="Consider ICU">
            <p style={{ marginBottom: 0 }}>Triggered by: {icu.reasons.join(" · ")} (also uses pH &lt; 7.1).</p>
          </Alert>
        ) : (
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>No ICU criterion currently met (altered sensorium, pH &lt; 7.1, abnormal EKG, or Kussmaul).</p>
        )}
      </section>

      {/* ── Reference protocol (display only) ─────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Fluids · reference · UC23</div>
        <table className="dtab">
          <tbody>
            <tr><td>Hour 1</td><td>{DKA.fluids.hour1LitersNs} L normal saline</td></tr>
            <tr><td>Hours 2–4</td><td>{DKA.fluids.hours2to4LitersPerHour[0]}–{DKA.fluids.hours2to4LitersPerHour[1]} L / hour</td></tr>
            <tr><td>Thereafter</td><td>{DKA.fluids.thereafterMlPerHour} mL/hr {DKA.fluids.thereafterFluid} until 80% of the deficit is corrected</td></tr>
            <tr><td>BG &lt; {DKA.fluids.switchToD5HalfNsWhenBgLt}</td><td>change to D5 ½NS, then follow the intrapartum IV insulin algorithm (Labor tab)</td></tr>
          </tbody>
        </table>
      </section>

      {/* ── Insulin infusion · Yale protocol ──────────────────────── */}
      <section>
        <Kicker>Insulin infusion · Yale protocol</Kicker>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          General critical-care IV insulin protocol, target 140–180 mg/dL — <strong>not</strong>{" "}
          pregnancy-specific. Enter the current and previous BG, the interval, and the running rate;
          the recommendation uses the glucose and its hourly rate of change.
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

      <section className="card">
        <div className="card-kicker">DKA insulin — key rules · UC23</div>
        <table className="dtab">
          <tbody>
            <tr><td>Loading</td><td>{DKA.insulin.loadingUnitsPerKg[0]}–{DKA.insulin.loadingUnitsPerKg[1]} units/kg</td></tr>
            <tr><td>Escalate</td><td>double the infusion rate if BG does not fall {DKA.insulin.doubleIfNotDecreasedPct}% in the first {DKA.insulin.doubleWindowHours} h (if hyperglycemic)</td></tr>
            <tr><td>Continue until</td><td>bicarbonate and anion gap normalize — <strong>not</strong> until glucose normalizes</td></tr>
            <tr><td>Euglycemic DKA</td><td>may need D5 to permit continued insulin administration</td></tr>
          </tbody>
        </table>
        <div className="card-meta"><Cite>UC23</Cite></div>
      </section>

      <section className="card">
        <div className="card-kicker">Electrolytes &amp; monitoring · UC23</div>
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
