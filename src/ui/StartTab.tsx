/**
 * StartTab — insulin initiation. Renders the starting daily schedule from the
 * TDD using the conventional NPH/RAA split (VB24 / UC23 shared architecture).
 * All math comes from dosing.ts.
 */
import { conventionalNphShort } from "../logic/dosing";
import { Kicker, DoseRow, NeedInput, Cite } from "./controls";
import type { TabProps } from "./types";

export function StartTab({ model, onNavigate }: TabProps) {
  if (!model.tdd) {
    return <NeedInput>{model.needs ?? "Enter weight and gestational age to calculate a starting schedule."}</NeedInput>;
  }

  const tdd = model.tdd.tdd;
  const r = conventionalNphShort(tdd);
  const c = r.components;

  return (
    <>
      <section>
        <Kicker>Daily schedule · {model.tdd.source}</Kicker>
        <div className="answer" style={{ marginTop: 8 }}>
          <h4 style={{ margin: "0 0 8px" }}>Conventional NPH / Lispro split</h4>
          <div className="rows">
            <DoseRow when="Before breakfast" agent="NPH" units={`${c.am_nph} u`} />
            <DoseRow when="With breakfast" agent="Lispro" units={`${c.am_short} u`} />
            <DoseRow when="Before dinner" agent="Lispro" units={`${c.pm_short_predinner} u`} />
            <DoseRow when="Bedtime snack" agent="NPH" units={`${c.pm_nph_bedtime} u`} />
          </div>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            AM {c.am_total} · PM {c.pm_total} — NPH {c.am_nph + c.pm_nph_bedtime} · Lispro{" "}
            {c.am_short + c.pm_short_predinner}
          </p>
          <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
            NPH = background (intermediate-acting) · Lispro = mealtime (rapid-acting).
          </p>
        </div>
      </section>

      <details className="ref-details card elev-sm">
        <summary>Show the math — split, as the guide states it</summary>
        <table className="dtab" style={{ marginTop: 8 }}>
          <tbody>
            <tr>
              <td>AM dose — ⅔ of TDD</td>
              <td className="num" style={{ textAlign: "right" }}>{c.am_total} u</td>
            </tr>
            <tr>
              <td>⅔ AM as NPH</td>
              <td className="num" style={{ textAlign: "right" }}>{c.am_nph} u</td>
            </tr>
            <tr>
              <td>⅓ AM as lispro</td>
              <td className="num" style={{ textAlign: "right" }}>{c.am_short} u</td>
            </tr>
            <tr>
              <td>PM dose — ⅓ of TDD</td>
              <td className="num" style={{ textAlign: "right" }}>{c.pm_total} u</td>
            </tr>
            <tr>
              <td>½ PM as lispro, pre-dinner</td>
              <td className="num" style={{ textAlign: "right" }}>{c.pm_short_predinner} u</td>
            </tr>
            <tr>
              <td>½ PM as NPH, bedtime snack</td>
              <td className="num" style={{ textAlign: "right" }}>{c.pm_nph_bedtime} u</td>
            </tr>
          </tbody>
        </table>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Inject into abdominal subcutaneous (under-skin) tissue. Rounded to whole units; remainder
          carried on the AM NPH dose. Inpatient starts — consider perinatology.com.
        </p>
        <div className="card-meta">
          <Cite>Regimen architecture: {r.source}</Cite>
        </div>
      </details>

      <section>
        <Kicker>Next step</Kicker>
        <p className="text-muted" style={{ fontSize: 13, margin: "4px 0 8px" }}>
          Have the patient check fasting and post-meal glucose. In 2–3 days, use <strong>Adjust</strong> to
          titrate each dose from the week&apos;s pattern.
        </p>
        {onNavigate ? (
          <button className="btn btn-secondary" onClick={() => onNavigate("adjust")}>Go to Adjust →</button>
        ) : null}
      </section>
    </>
  );
}
