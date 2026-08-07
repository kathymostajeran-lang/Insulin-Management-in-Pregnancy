/**
 * HypoTab — hypoglycemia recognition and treatment (spec §12 / Module J).
 *
 * Threshold uses the ADA26 default (<70 meter / <63 sensor, conflict C-01). The
 * outpatient Rule of 15 and the UC23 inpatient rescue ladder are surfaced; the
 * rescue routing (by consciousness / PO ability / BG) lives in dosing.ts.
 */
import { useState } from "react";
import {
  classifyHypoglycemia,
  inpatientRescue,
  OUTPATIENT_HYPO,
  INPATIENT_LADDER,
  GLUCAGON,
  HYPO_SYMPTOMS,
  type GlucoseSource,
} from "../logic/dosing";
import { Kicker, NumberField, Seg, Alert, Cite } from "./controls";
import type { TabProps } from "./types";

const SOURCE_OPTS: ReadonlyArray<{ value: GlucoseSource; label: string }> = [
  { value: "meter", label: "Meter" },
  { value: "sensor", label: "Sensor" },
];
const YN: ReadonlyArray<{ value: "yes" | "no"; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function HypoTab({ config }: TabProps) {
  const [source, setSource] = useState<GlucoseSource>("meter");
  const [value, setValue] = useState<number | null>(58);
  const [conscious, setConscious] = useState<"yes" | "no">("yes");
  const [canPO, setCanPO] = useState<"yes" | "no">("yes");

  const view = value === null ? null : classifyHypoglycemia(value, source, config);
  const rescue = value === null ? null : inpatientRescue(value, conscious === "yes", canPO === "yes");

  return (
    <>
      {/* ── Threshold check ───────────────────────────────────────── */}
      <section>
        <Kicker>Is this hypoglycemia?</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Reading source</label>
            <Seg name="source" value={source} options={SOURCE_OPTS} onChange={setSource} />
          </div>
          <NumberField label="Blood glucose · mg/dL" value={value} onChange={setValue} min={0} />
        </div>
        {view ? (
          view.isLow ? (
            <Alert title={view.severe ? "Hypoglycemia — level 2 (severe)" : "Hypoglycemia"} stop={view.severe}>
              <p style={{ marginBottom: 0 }}>
                {view.value} mg/dL is below the {view.source} threshold of {view.threshold}. Treat now.
                {view.severe ? " Below 54 mg/dL is clinically significant (ADA level 2)." : ""}
              </p>
            </Alert>
          ) : (
            <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
              {view.value} mg/dL is at or above the {view.source} threshold of {view.threshold} — not
              hypoglycemic by the ADA26 default.
            </p>
          )
        ) : null}
        <div className="card-meta" style={{ marginTop: 6 }}>
          <Cite>ADA26 &lt;70 meter / &lt;63 sensor (default) · UC23 &lt;60 · VB24 65–70</Cite>
        </div>
      </section>

      {/* ── Outpatient Rule of 15 ─────────────────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Outpatient · Rule of 15</div>
        <table className="dtab">
          <tbody>
            <tr><td>Treat with</td><td>{OUTPATIENT_HYPO.ruleOf15.choG} g fast-acting carbohydrate (e.g. 4 oz apple juice)</td></tr>
            <tr><td>No more than</td><td>{OUTPATIENT_HYPO.choGramsMax} g simple sugar — avoids rebound hyperglycemia (VB24)</td></tr>
            <tr><td>Recheck</td><td>in {OUTPATIENT_HYPO.recheckMinutes[0]}–{OUTPATIENT_HYPO.recheckMinutes[1]} min; expect ≥ {OUTPATIENT_HYPO.ruleOf15.expectedRiseMgdl} mg/dL rise</td></tr>
            <tr><td>Pre-exercise</td><td>if BG &lt; {OUTPATIENT_HYPO.preExerciseChoIfBgBelow} mg/dL, take 15 g carbohydrate first</td></tr>
            <tr><td>Overnight lows</td><td>wear CGM or check a 3 AM glucose — the bedtime long/intermediate dose may need a <strong>downward</strong> adjustment</td></tr>
          </tbody>
        </table>
        <div className="card-meta"><Cite>{OUTPATIENT_HYPO.source}</Cite></div>
      </section>

      {/* ── Inpatient rescue ladder ───────────────────────────────── */}
      <section>
        <Kicker>Inpatient rescue · UC23</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <div className="field">
            <label>Alert &amp; responsive?</label>
            <Seg name="conscious" value={conscious} options={YN} onChange={setConscious} />
          </div>
          <div className="field">
            <label>Can eat or drink?</label>
            <Seg name="po" value={canPO} options={YN} onChange={setCanPO} />
          </div>
        </div>
        {rescue ? (
          <Alert title={rescue.rung} stop={rescue.rung.startsWith("Unconscious")}>
            <p style={{ marginBottom: rescue.cautions.length ? 8 : 0 }}>{rescue.action}</p>
            {rescue.recheck !== "—" ? (
              <p className="text-muted" style={{ fontSize: 12, margin: rescue.cautions.length ? "0 0 8px" : 0 }}>
                Recheck {rescue.recheck}.
              </p>
            ) : null}
            {rescue.cautions.length ? (
              <ul style={{ margin: "0 0 0 18px", padding: 0 }}>
                {rescue.cautions.map((c) => <li key={c}>{c}</li>)}
              </ul>
            ) : null}
          </Alert>
        ) : null}
        <table className="dtab" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Condition</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {INPATIENT_LADDER.map((r) => (
              <tr key={r.condition}>
                <td>{r.condition}</td>
                <td>{r.action}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Glucagon ──────────────────────────────────────────────── */}
      <section className="card">
        <div className="card-kicker">Glucagon rescue</div>
        <table className="dtab">
          <tbody>
            <tr><td>GVOKE</td><td>{GLUCAGON.gvokeMgSc} mg under-skin (SC) prefilled kit</td></tr>
            <tr><td>BAQSIMI</td><td>{GLUCAGON.baqsimiMgIntranasal} mg intranasal prefilled kit</td></tr>
            <tr><td>Dose</td><td>use the entire dose · onset ~{GLUCAGON.onsetMinutes} min · may repeat in {GLUCAGON.mayRepeatMinutes} min</td></tr>
            <tr><td>Positioning</td><td>vomiting is common — position the patient on their side</td></tr>
            <tr><td>At home</td><td>every pregnant patient on insulin should have a kit; instruct family in its use</td></tr>
          </tbody>
        </table>
        <div className="card-meta"><Cite>UC23</Cite></div>
      </section>

      {/* ── Patient education ─────────────────────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Symptoms · patient education</div>
        <p style={{ fontSize: 13, margin: 0 }}>{HYPO_SYMPTOMS.join(" · ")}</p>
      </section>

      <Alert title="Hypoglycemia unawareness">
        <p style={{ marginBottom: 0 }}>
          Pregnancy blunts the counter-regulatory response and can reduce hypoglycemia awareness in
          anyone — and it can develop in T2DM/GDM on insulin, not only T1DM. When flagged, relax the
          lower target bounds and review CGM alarm settings.<Cite> ADA26 · VB24</Cite>
        </p>
      </Alert>
    </>
  );
}
