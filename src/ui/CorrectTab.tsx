/**
 * CorrectTab — pre-meal correction. Shows the calculated correction dose from
 * the active ICF (default VB24 1500 ÷ TDD), the UC23 fixed pre-meal scale with
 * its hard-stop guardrail, and the derived correction factor / carb ratio.
 */
import { useState } from "react";
import {
  correctionDose,
  icf,
  icr,
  UC23_FIXED_CORRECTION,
  uc23FixedCorrection,
} from "../logic/dosing";
import { Kicker, NumberField, NeedInput, Alert, Cite } from "./controls";
import type { TabProps } from "./types";

export function CorrectTab({ model, config }: TabProps) {
  const [premeal, setPremeal] = useState<number | null>(150);

  if (!model.tdd) {
    return <NeedInput>{model.needs ?? "Enter weight and gestational age to derive a correction factor."}</NeedInput>;
  }
  const tdd = model.tdd.tdd;
  const corr = premeal === null ? null : correctionDose(premeal, tdd, config);
  const cf = icf(tdd, config);
  const ic = icr(tdd, config);

  // The active band in the fixed scale, for highlighting.
  let fixedUnits: number | null = null;
  if (premeal !== null) {
    try {
      fixedUnits = uc23FixedCorrection(premeal, true, true);
    } catch {
      fixedUnits = null;
    }
  }

  return (
    <>
      <section>
        <Kicker>Calculated correction · {config.correctionConstant} ÷ TDD</Kicker>
        <NumberField
          label="Pre-meal blood glucose · mg/dL"
          value={premeal}
          onChange={setPremeal}
          min={0}
          hint="Corrects to a target of 100 mg/dL"
        />
        {corr !== null ? (
          <p style={{ marginTop: 8 }}>
            <span className="num" style={{ fontSize: 28 }}>{corr}</span>{" "}
            <span className="text-muted">units lispro added before this meal</span>
          </p>
        ) : null}
        <div className="card-meta">
          <Cite>
            Correction factor {cf} mg/dL per unit · I:C 1 : {ic} g CHO ({config.correctionConstant}/
            {config.icrConstant} ÷ TDD, {model.tdd.source === "UC23" ? "UC23" : "VB24"})
          </Cite>
        </div>
      </section>

      <section className="card elev-sm">
        <div className="card-kicker">Pre-meal dose adjustment algorithm</div>
        <div className="card-title">Fixed correction scale</div>
        <p className="text-muted" style={{ fontSize: 12 }}>Humalog / Novolog · de Veciana &amp; Evans 2007</p>
        <table className="dtab">
          <thead>
            <tr>
              <th>BG mg/dL</th>
              <th style={{ textAlign: "right" }}>Units</th>
            </tr>
          </thead>
          <tbody>
            {UC23_FIXED_CORRECTION.map(([lo, hi, units]) => {
              const isActive = premeal !== null && premeal >= lo && premeal <= hi;
              const label = hi >= 10_000 ? `>${lo - 1}` : lo === 0 ? `<${hi + 1}` : `${lo}–${hi}`;
              return (
                <tr key={`${lo}-${hi}`} data-active={isActive}>
                  <td>{label}</td>
                  <td className="num" style={{ textAlign: "right" }}>{units}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {fixedUnits !== null ? (
          <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
            Fixed-table dose at this BG: <strong>{fixedUnits} u</strong>. Note this scale is
            TDD-independent — the calculated correction above is preferred (spec C-06).
          </p>
        ) : null}
      </section>

      <Alert title="Do not use post-meal sliding scale insulin" stop>
        <p style={{ marginBottom: 0 }}>
          It leads to over-treatment without avoiding fetal exposure to hyperglycemia. Use the
          algorithm before meals only — never to treat between meals. <Cite>UC23 · hard stop HS-01/HS-02</Cite>
        </p>
      </Alert>
    </>
  );
}
