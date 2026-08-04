/**
 * CgmTab — CGM as a scorecard, and CGM-derived tagged values as the titration
 * input. Spec §6 / §A. The load-bearing rule (§A.4): aggregate CGM metrics are
 * a scorecard, NEVER the sole input to a dose change — titration runs on
 * time-tagged values. Data-quality hard stops (HS-10/HS-11) gate the handoff;
 * eA1C/GMI is never shown (HS-09). All logic is in dosing.ts.
 */
import { useState } from "react";
import {
  evaluateCgm,
  cgmTitrationGate,
  basalHyperglycemiaSignal,
  classifyWindow,
  CGM_TARGETS,
  CGM_PHENOTYPES,
  type CgmWindow,
  type WindowState,
} from "../logic/dosing";
import { DEMO_CGM, FASTING_TARGET, PP1H_TARGET, type CgmInputs } from "../config";
import { Kicker, NumberField, Alert, Cite } from "./controls";

export function CgmTab() {
  const [cgm, setCgm] = useState<CgmInputs>(DEMO_CGM);
  function patch(p: Partial<CgmInputs>) {
    setCgm((prev) => ({ ...prev, ...p }));
  }

  const window: CgmWindow = {
    days: cgm.days ?? 0,
    wearPct: cgm.wearPct ?? 0,
    tir63_140Pct: cgm.tir ?? 0,
    tarGt140Pct: cgm.tar ?? 0,
    tbrLt63Pct: cgm.tbr63 ?? 0,
    tbrLt54Pct: cgm.tbr54 ?? 0,
    meanGlucoseMgdl: cgm.meanGlucose ?? 0,
    overnightMeanMgdl: cgm.overnightMean,
    dayOfWear: cgm.dayOfWear,
  };

  const metrics = evaluateCgm(window);
  const gate = cgmTitrationGate(window);
  const basal = basalHyperglycemiaSignal(cgm.overnightMean);

  const tagged: Array<{ label: string; value: number | null; window: [number, number]; drives: string; state: WindowState | null }> = [
    { label: "Fasting", value: cgm.fasting, window: FASTING_TARGET, drives: "Bedtime NPH", state: cgm.fasting === null ? null : classifyWindow(cgm.fasting, FASTING_TARGET[0], FASTING_TARGET[1]) },
    { label: "Post-breakfast", value: cgm.postBreakfast, window: PP1H_TARGET, drives: "AM lispro", state: cgm.postBreakfast === null ? null : classifyWindow(cgm.postBreakfast, PP1H_TARGET[0], PP1H_TARGET[1]) },
    { label: "Post-lunch", value: cgm.postLunch, window: PP1H_TARGET, drives: "Morning NPH", state: cgm.postLunch === null ? null : classifyWindow(cgm.postLunch, PP1H_TARGET[0], PP1H_TARGET[1]) },
    { label: "Post-dinner", value: cgm.postDinner, window: PP1H_TARGET, drives: "Dinner lispro", state: cgm.postDinner === null ? null : classifyWindow(cgm.postDinner, PP1H_TARGET[0], PP1H_TARGET[1]) },
  ];

  return (
    <>
      <Alert title="CGM metrics are a scorecard, not a titration target">
        <p style={{ marginBottom: 0 }}>
          Dose changes run on time-tagged values (fasting, post-meal), never on aggregate TIR. CGM
          metrics may flag a review but must never be the sole input to a dose change.
          <Cite> ES25 Rec 7 · ADA26 15.12</Cite>
        </p>
      </Alert>

      {/* ── Scorecard ─────────────────────────────────────────────── */}
      <section>
        <Kicker>CGM scorecard · ADA goals (validated for T1DM)</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Time in range 63–140 · %" value={cgm.tir} onChange={(v) => patch({ tir: v })} min={0} max={100} />
          <NumberField label="Time above 140 · %" value={cgm.tar} onChange={(v) => patch({ tar: v })} min={0} max={100} />
          <NumberField label="Time below 63 · %" value={cgm.tbr63} onChange={(v) => patch({ tbr63: v })} min={0} max={100} step={0.1} />
          <NumberField label="Time below 54 · %" value={cgm.tbr54} onChange={(v) => patch({ tbr54: v })} min={0} max={100} step={0.1} />
          <NumberField label="Mean glucose · mg/dL" value={cgm.meanGlucose} onChange={(v) => patch({ meanGlucose: v })} min={0} />
        </div>
        <table className="dtab" style={{ marginTop: 12 }}>
          <thead>
            <tr>
              <th>Metric</th>
              <th style={{ textAlign: "right" }}>Value</th>
              <th style={{ textAlign: "right" }}>Goal</th>
              <th style={{ textAlign: "right" }}>Status</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m.key}>
                <td>{m.label}</td>
                <td className="num" style={{ textAlign: "right" }}>{m.value}{m.key === "mean" ? "" : "%"}</td>
                <td style={{ textAlign: "right" }} className="text-muted">{m.goal}</td>
                <td style={{ textAlign: "right" }}>
                  {m.meets === null ? (
                    <span className="tag tag-neutral">info</span>
                  ) : m.meets ? (
                    <span className="tag tag-neutral">meets</span>
                  ) : (
                    <span className="tag tag-accent">off goal</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          Mean glucose is shown instead of GMI / estimated A1C, which is prohibited in pregnancy
          (ADA26 15.13). Sensor ranges are endorsed for T2DM/GDM but the TIR goal amount is undefined.
        </p>
      </section>

      {/* ── Data-quality gate ─────────────────────────────────────── */}
      <section>
        <Kicker>Data quality · required before any CGM-derived dose change</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Days of data" value={cgm.days} onChange={(v) => patch({ days: v })} min={0} hint={`≥ ${CGM_TARGETS.minDaysForTitration} required`} />
          <NumberField label="Sensor wear · %" value={cgm.wearPct} onChange={(v) => patch({ wearPct: v })} min={0} max={100} hint={`≥ ${CGM_TARGETS.minWearPctForTitration}% required`} />
          <NumberField label="Day of current wear" value={cgm.dayOfWear} onChange={(v) => patch({ dayOfWear: v })} min={1} hint="day 1 is suppressed" />
        </div>
      </section>

      {/* ── Tagged values → titration handoff ─────────────────────── */}
      <section>
        <Kicker>CGM-derived tagged values → titration</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Fasting · median 04–07h" value={cgm.fasting} onChange={(v) => patch({ fasting: v })} min={0} />
          <NumberField label="Post-breakfast · +60 min" value={cgm.postBreakfast} onChange={(v) => patch({ postBreakfast: v })} min={0} />
          <NumberField label="Post-lunch · +60 min" value={cgm.postLunch} onChange={(v) => patch({ postLunch: v })} min={0} />
          <NumberField label="Post-dinner · +60 min" value={cgm.postDinner} onChange={(v) => patch({ postDinner: v })} min={0} />
        </div>

        {gate.allowed ? (
          <>
            <div className="rows" style={{ marginTop: 12 }}>
              {tagged.map((t) => (
                <div className="row" key={t.label} style={{ gridTemplateColumns: "1fr auto auto" }}>
                  <span className="row-when">
                    {t.label} <span className="text-muted">target {t.window[0]}–{t.window[1]} → {t.drives}</span>
                  </span>
                  <span className="row-agent num">{t.value ?? "—"}</span>
                  <span>
                    {t.state === null ? null : (
                      <span className={`tag ${t.state === "in_range" ? "tag-neutral" : "tag-accent"}`}>
                        {t.state === "in_range" ? "in range" : t.state}
                      </span>
                    )}
                  </span>
                </div>
              ))}
            </div>
            <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
              Carry these window states to the <strong>Adjust</strong> tab — the dose change runs on
              these tagged values, using the same engine as SMBG.
            </p>
          </>
        ) : (
          <Alert title="Dose recommendations blocked — insufficient CGM data" stop>
            <ul style={{ margin: "4px 0 0 18px", padding: 0 }}>
              {gate.reasons.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          </Alert>
        )}
      </section>

      {/* ── Basal-hyperglycemia signal (D.2) ──────────────────────── */}
      <section>
        <Kicker>Basal / overnight signal</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Overnight mean · 00–06h, mg/dL" value={cgm.overnightMean} onChange={(v) => patch({ overnightMean: v })} min={0} />
        </div>
        {basal.flag ? (
          <Alert title="Basal-dominant hyperglycemia">
            <p style={{ marginBottom: 0 }}>{basal.message}<Cite> ES25 · Ling 2024 · D.2</Cite></p>
          </Alert>
        ) : (
          <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>{basal.message}</p>
        )}
      </section>

      {/* ── Phenotype review triggers (D.3) ───────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Phenotype review triggers · not dose changes</div>
        <table className="dtab">
          <thead>
            <tr>
              <th>Cluster</th>
              <th style={{ textAlign: "right" }}>Mean</th>
              <th style={{ textAlign: "right" }}>Outcome flags</th>
            </tr>
          </thead>
          <tbody>
            {CGM_PHENOTYPES.map((p) => (
              <tr key={p.label}>
                <td>{p.label}</td>
                <td className="num" style={{ textAlign: "right" }}>{p.meanMgdl}</td>
                <td style={{ textAlign: "right" }} className="text-muted">{p.flags.length ? p.flags.join(" · ") : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="card-meta">
          <Cite>Battarbee 2024 · distinct outcomes at similar aggregate metrics. Escalate review, not dose.</Cite>
        </div>
      </section>
    </>
  );
}
