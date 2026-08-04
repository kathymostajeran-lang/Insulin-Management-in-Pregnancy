/**
 * PostpartumTab — immediate postpartum dosing (spec §13 / Module K).
 *
 * The load-bearing rule is C-13: the published methods use THREE DIFFERENT
 * DENOMINATORS (end-pregnancy, third-trimester, prepregnancy TDD, plus a
 * weight-based option). They are NOT interchangeable, so the app shows all of
 * them side by side and forces clinician selection — it never auto-picks. All
 * math is in dosing.ts (postpartumTddOptions).
 */
import { useState } from "react";
import { postpartumTddOptions } from "../logic/dosing";
import { DEMO_POSTPARTUM, POSTPARTUM_TARGETS, type PostpartumInputs } from "../config";
import { Kicker, NumberField, Alert, Cite } from "./controls";
import type { TabProps } from "./types";

export function PostpartumTab({ model }: TabProps) {
  const [pp, setPp] = useState<PostpartumInputs>(DEMO_POSTPARTUM);
  function patch(p: Partial<PostpartumInputs>) {
    setPp((prev) => ({ ...prev, ...p }));
  }

  const opts = postpartumTddOptions({
    endPregnancyTdd: pp.endPregnancyTdd,
    thirdTrimesterTdd: pp.thirdTrimesterTdd,
    prepregnancyTdd: pp.prepregnancyTdd,
    weightKg: model.weightKg,
  });

  const rows: Array<{ method: string; source: string; value: string }> = [];
  if (opts.UC23_pct_end_pregnancy)
    rows.push({ method: "25–33% of end-pregnancy TDD", source: "UC23", value: `${opts.UC23_pct_end_pregnancy[0]}–${opts.UC23_pct_end_pregnancy[1]} u` });
  if (opts.VB24_pct_third_trimester)
    rows.push({ method: "30–40% of third-trimester TDD", source: "VB24", value: `${opts.VB24_pct_third_trimester[0]}–${opts.VB24_pct_third_trimester[1]} u` });
  if (opts.UC23_weight_based !== undefined)
    rows.push({ method: "0.4 u/kg (weight-based)", source: "UC23", value: `${opts.UC23_weight_based} u` });
  if (opts.ADA26_reference_point !== undefined)
    rows.push({ method: "~66% of prepregnancy TDD (≈34% lower)", source: "ADA26", value: `${opts.ADA26_reference_point} u` });

  return (
    <>
      <section>
        <Kicker>Immediate postpartum · physiology</Kicker>
        <p className="text-muted" style={{ fontSize: 13 }}>
          Insulin sensitivity rises sharply once the placenta delivers. UC23: requirements fall
          50–75% immediately; ADA26: ~34% below <em>prepregnancy</em> needs, returning to prepregnancy
          sensitivity over 1–2 weeks. Discontinue IV insulin after delivery of the placenta.
        </p>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="End-pregnancy TDD · units" value={pp.endPregnancyTdd} onChange={(v) => patch({ endPregnancyTdd: v })} min={0} />
          <NumberField label="Third-trimester TDD · units" value={pp.thirdTrimesterTdd} onChange={(v) => patch({ thirdTrimesterTdd: v })} min={0} />
          <NumberField label="Pre-pregnancy TDD · units, optional" value={pp.prepregnancyTdd} onChange={(v) => patch({ prepregnancyTdd: v })} min={0} />
        </div>
      </section>

      <section>
        <Kicker>Starting dose options · clinician selects</Kicker>
        {rows.length ? (
          <table className="dtab" style={{ marginTop: 8 }}>
            <thead>
              <tr>
                <th>Method</th>
                <th>Source</th>
                <th style={{ textAlign: "right" }}>Starting TDD</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.method}>
                  <td>{r.method}</td>
                  <td className="text-muted">{r.source}</td>
                  <td className="num" style={{ textAlign: "right" }}>{r.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="text-muted" style={{ fontSize: 14 }}>Enter at least one prior TDD (or weight) to compute options.</p>
        )}
      </section>

      <Alert title="Different denominators — not interchangeable (C-13)">
        <p style={{ marginBottom: 0 }}>
          End-pregnancy, third-trimester, and prepregnancy TDD are different baselines, so these
          methods can diverge sharply. The app does <strong>not</strong> auto-select — the clinician
          must choose the method and confirm the dose.<Cite> spec §13 · C-13</Cite>
        </p>
      </Alert>

      <section className="card elev-sm">
        <div className="card-kicker">Postpartum glycemic targets · mg/dL</div>
        <table className="dtab">
          <thead>
            <tr>
              <th>Phase</th>
              <th>Target</th>
              <th style={{ textAlign: "right" }}>Source</th>
            </tr>
          </thead>
          <tbody>
            {POSTPARTUM_TARGETS.map((t) => (
              <tr key={t.phase}>
                <td>{t.phase}</td>
                <td>{t.target}</td>
                <td className="text-muted" style={{ textAlign: "right" }}>{t.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="card">
        <div className="card-kicker">By diabetes type</div>
        <table className="dtab">
          <tbody>
            <tr><td>GDM A1 / A2</td><td>Stop insulin after placenta; check FBG + 1-h PP until discharge. Consider metformin if BG &gt; 180 despite diet.</td></tr>
            <tr><td>T1DM / T2DM</td><td>Resume CHO-counting (pregnancy calories if lactating); restart at the selected fraction above. VB24: stop insulin immediately in GDM/T2DM if prepregnancy A1C &lt; 7.5%.</td></tr>
          </tbody>
        </table>
        <div className="card-meta"><Cite>UC23 · VB24</Cite></div>
      </section>

      <Alert title="Lactation — overnight hypoglycemia risk">
        <p style={{ marginBottom: 0 }}>
          Breastfeeding increases overnight hypoglycemia risk; check BG before nighttime feeds and
          take 15 g CHO if &lt; 100 mg/dL. Degludec must be reduced &gt; 2–3 days before delivery to
          avoid postpartum lows.<Cite> ADA26 · UC23 · VB24</Cite>
        </p>
      </Alert>
    </>
  );
}
