/**
 * AidTab — Automated Insulin Delivery / hybrid closed loop (spec §8 / Module F).
 *
 * Mostly display/education. The one computed rule (F.2): show each system's
 * minimum achievable target and FLAG when it exceeds the pregnancy fasting
 * range (aidTargetCheck in dosing.ts). Assistive "fake-carb" techniques are
 * gated behind an acknowledgment and never automated.
 */
import { useState } from "react";
import {
  AID_RECOMMENDATIONS,
  AID_SYSTEMS,
  aidTargetCheck,
  AID_ASSISTIVE,
  AID_EFFECTS,
  AID_FRAMING,
  PREGNANCY_FASTING_RANGE,
} from "../logic/dosing";
import { Kicker, NumberField, Alert, Cite } from "./controls";

export function AidTab() {
  const [customTarget, setCustomTarget] = useState<number | null>(null);
  const [ackAssistive, setAckAssistive] = useState(false);

  const customCheck = customTarget === null ? null : aidTargetCheck(customTarget);

  const fmtEffect = (md: number, isRatio: boolean) =>
    isRatio ? `RR ${md}` : `${md > 0 ? "+" : ""}${md}%`;

  return (
    <>
      {/* ── Recommendation strengths ──────────────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Recommendation strength</div>
        <table className="dtab">
          <tbody>
            {AID_RECOMMENDATIONS.map((r) => (
              <tr key={r.text}>
                <td>{r.text}</td>
                <td className="text-muted" style={{ whiteSpace: "nowrap" }}>{r.source}</td>
                <td style={{ textAlign: "right" }}>
                  <span className={`tag ${r.grade === "A" || r.grade === "B" ? "tag-accent" : "tag-neutral"}`}>{r.grade}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* ── Target configuration ──────────────────────────────────── */}
      <section>
        <Kicker>System target vs pregnancy fasting range</Kicker>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          Pregnancy fasting target {PREGNANCY_FASTING_RANGE[0]}–{PREGNANCY_FASTING_RANGE[1]} mg/dL. A
          system is flagged when its <strong>minimum achievable target</strong> exceeds that range —
          it cannot reach pregnancy goals.
        </p>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table className="dtab">
            <thead>
              <tr>
                <th>System</th>
                <th style={{ textAlign: "right" }}>Min target</th>
                <th style={{ textAlign: "right" }}>Meets pregnancy target?</th>
              </tr>
            </thead>
            <tbody>
              {AID_SYSTEMS.map((s) => {
                const chk = aidTargetCheck(s.minTargetMgdl);
                return (
                  <tr key={s.label}>
                    <td>
                      {s.label}
                      <div className="text-muted" style={{ fontSize: 11 }}>{s.note}</div>
                    </td>
                    <td className="num" style={{ textAlign: "right" }}>{s.minTargetMgdl}</td>
                    <td style={{ textAlign: "right" }}>
                      <span className={`tag ${chk.exceedsFasting ? "tag-accent" : "tag-neutral"}`}>
                        {chk.exceedsFasting ? "exceeds range" : "meets"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="rail" style={{ marginTop: 12 }}>
          <NumberField label="Check another system's min target · mg/dL" value={customTarget} onChange={setCustomTarget} min={0} />
        </div>
        {customCheck ? (
          customCheck.exceedsFasting ? (
            <Alert title="Minimum target exceeds the pregnancy fasting range">
              <p style={{ marginBottom: 0 }}>
                {customCheck.minTarget} &gt; {customCheck.fastingUpper} mg/dL — this system cannot reach
                the pregnancy fasting target. Consider a pregnancy-specific system, or the assistive
                techniques below with an experienced team.<Cite> ES25</Cite>
              </p>
            </Alert>
          ) : (
            <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
              {customCheck.minTarget} mg/dL is within the pregnancy fasting range.
            </p>
          )
        ) : null}
      </section>

      {/* ── Assistive techniques (gated) ──────────────────────────── */}
      <section>
        <Kicker>Assistive techniques · non-pregnancy-target systems</Kicker>
        {ackAssistive ? (
          <>
            <ul style={{ margin: "8px 0 0 18px", padding: 0, fontSize: 14 }}>
              {AID_ASSISTIVE.map((t) => <li key={t} style={{ marginBottom: 4 }}>{t}</li>)}
            </ul>
            <Alert title="Clinician-directed only" stop>
              <p style={{ marginBottom: 0 }}>
                "Fake-carb" boluses must never be automated — they require expert, individualized
                direction. Do not use this pathway without an experienced interprofessional team.
                <Cite> ADA26 (CRISTAL / Polsky)</Cite>
              </p>
            </Alert>
          </>
        ) : (
          <>
            <p className="text-muted" style={{ fontSize: 13, marginTop: 4 }}>
              These techniques let a non-pregnancy-target system approximate pregnancy goals, but carry
              real risk and are expert-directed. Acknowledge to view.
            </p>
            <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={() => setAckAssistive(true)}>
              I understand — show techniques
            </button>
          </>
        )}
      </section>

      {/* ── Effect sizes (counseling) ─────────────────────────────── */}
      <section className="card">
        <div className="card-kicker">Effect sizes · HCL vs standard · ES25 meta-analysis</div>
        <div style={{ overflowX: "auto" }}>
          <table className="dtab">
            <thead>
              <tr>
                <th>Outcome</th>
                <th style={{ textAlign: "right" }}>Effect</th>
                <th style={{ textAlign: "right" }}>95% CI</th>
                <th style={{ textAlign: "right" }}>Significant</th>
              </tr>
            </thead>
            <tbody>
              {AID_EFFECTS.map((e) => (
                <tr key={e.label}>
                  <td>{e.label}</td>
                  <td className="num" style={{ textAlign: "right" }}>{fmtEffect(e.md, e.isRatio)}</td>
                  <td className="mono" style={{ textAlign: "right" }}>{e.ci[0]} to {e.ci[1]}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className={`tag ${e.significant ? "tag-accent" : "tag-neutral"}`}>{e.significant ? "yes" : "no"}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 8 }}>
          AiDAPT: between-group TIR +10.5% (P&lt;0.001), TAR −10.2%, A1C −0.31%. {AID_FRAMING}
        </p>
        <div className="card-meta"><Cite>ES25 meta-analysis · ADA26 AiDAPT</Cite></div>
      </section>

      {/* ── Peripartum AID ────────────────────────────────────────── */}
      <Alert title="Peripartum AID (C-18)">
        <p style={{ marginBottom: 0 }}>
          ADA26/ES25 data support <strong>continuing AID through labor</strong> with expert supervision
          (improved intrapartum TIR, no severe hypoglycemia) — directionally opposite to the UC23
          "discontinue or halve" instruction. For AID users, prefer the AID pathway; reserve UC23
          suspension for non-AID pumps.<Cite> ADA26 · ES25 · UC23</Cite>
        </p>
      </Alert>
    </>
  );
}
