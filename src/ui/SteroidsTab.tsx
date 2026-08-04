/**
 * SteroidsTab — antenatal corticosteroid hyperglycemia (spec §9 / Module G).
 * Sole source: UC23. The headline behavior is the time-bounded episode that
 * SUSPENDS baseline titration so a transient steroid spike is not baked into
 * the standing regimen. Episode classification and the BG action live in
 * dosing.ts (steroidEpisode / steroidBgAction).
 */
import { useState } from "react";
import { steroidEpisode, steroidBgAction, STEROID } from "../logic/dosing";
import { Kicker, NumberField, Seg, Alert, Cite } from "./controls";

const YN: ReadonlyArray<{ value: "yes" | "no"; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

export function SteroidsTab() {
  const [hours, setHours] = useState<number | null>(60);
  const [npo, setNpo] = useState<"yes" | "no">("no");
  const [bg, setBg] = useState<number | null>(210);
  const [onInsulin, setOnInsulin] = useState<"yes" | "no">("no");

  const ep = hours === null ? null : steroidEpisode(hours, npo === "yes");
  const bgAction = bg === null ? null : steroidBgAction(bg, onInsulin === "yes");

  return (
    <>
      {/* ── Episode state ─────────────────────────────────────────── */}
      <section>
        <Kicker>Steroid episode · hours since first dose</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField
            label="Hours since first dose"
            value={hours}
            onChange={setHours}
            min={0}
            hint={hours !== null ? `≈ day ${(hours / 24).toFixed(1)} post-dose` : undefined}
          />
          <div className="field">
            <label>NPO?</label>
            <Seg name="npo" value={npo} options={YN} onChange={setNpo} />
          </div>
        </div>
        {ep ? (
          <>
            <div className="rail" style={{ marginTop: 12 }}>
              <div className="field">
                <label>Phase</label>
                <div className="num" style={{ fontSize: 16 }}>{ep.phaseLabel}</div>
              </div>
              <div className="field">
                <label>Monitoring</label>
                <div className="num" style={{ fontSize: 16 }}>
                  {ep.monitoringActive ? ep.monitoringCadence : "72-h window passed"}
                </div>
              </div>
              <div className="field">
                <label>Next de-escalation review</label>
                <div className="num" style={{ fontSize: 16 }}>
                  {ep.nextReviewDay ? `Day ${ep.nextReviewDay} post-dose` : "—"}
                </div>
              </div>
            </div>
            {ep.baselineTitrationSuspended ? (
              <Alert title="Baseline titration suspended">
                <p style={{ marginBottom: 0 }}>
                  Treat this hyperglycemia as <strong>transient</strong>. Do not permanently escalate the
                  standing regimen — the effect typically resolves in 1–2 weeks. Re-evaluate the baseline at
                  day {ep.nextReviewDay}.<Cite> spec §9 mitigation · UC23</Cite>
                </p>
              </Alert>
            ) : (
              <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>
                Past the 2-week window — glucose is expected back at pretreatment levels. Resume normal
                titration on the Adjust tab.
              </p>
            )}
          </>
        ) : null}
      </section>

      {/* ── BG action ─────────────────────────────────────────────── */}
      <section>
        <Kicker>Glucose action</Kicker>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Blood glucose · mg/dL" value={bg} onChange={setBg} min={0} />
          <div className="field">
            <label>Already on insulin?</label>
            <Seg name="oninsulin" value={onInsulin} options={YN} onChange={setOnInsulin} />
          </div>
        </div>
        {bgAction ? (
          bgAction.escalate ? (
            <Alert title={`BG > ${STEROID.escalateIfBgGt} — treat`}>
              <p style={{ marginBottom: 0 }}>{bgAction.message}</p>
            </Alert>
          ) : (
            <p className="text-muted" style={{ fontSize: 13, marginTop: 8 }}>{bgAction.message}</p>
          )
        ) : null}
      </section>

      {/* ── Physiology reference ──────────────────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Physiology · UC23</div>
        <table className="dtab">
          <tbody>
            <tr><td>Peak response</td><td>{STEROID.peakHours[0]}–{STEROID.peakHours[1]} h after the first dose</td></tr>
            <tr><td>Onset</td><td>may be delayed several days</td></tr>
            <tr><td>Duration</td><td>may persist {STEROID.persistWeeks[0]}–{STEROID.persistWeeks[1]} weeks</td></tr>
            <tr><td>Typical max BG</td><td>&lt; {STEROID.typicalMaxBgNondiabetic} mg/dL in non-diabetic pregnancy</td></tr>
          </tbody>
        </table>
      </section>

      {/* ── Monitoring protocol ───────────────────────────────────── */}
      <section className="card">
        <div className="card-kicker">Monitoring · {STEROID.monitorHours} h screening window</div>
        <table className="dtab">
          <tbody>
            <tr><td>While NPO</td><td>check BG q8h</td></tr>
            <tr><td>On a regular diet</td><td>check BG AC and HS</td></tr>
            <tr><td>After 72 h · BG &lt; 200</td><td>discontinue BG monitoring</td></tr>
            <tr><td>During window · BG &gt; 200</td><td>carbohydrate-counting pregnancy diet; check BG 7×/day; treat as needed</td></tr>
          </tbody>
        </table>
        <div className="card-meta"><Cite>UC23</Cite></div>
      </section>

      {/* ── Treatment ─────────────────────────────────────────────── */}
      <section className="card">
        <div className="card-kicker">Treatment</div>
        <table className="dtab">
          <tbody>
            <tr><td>BG &gt; 200</td><td>PRN rapid-acting analog</td></tr>
            <tr><td>Already on insulin</td><td>increase doses aggressively and proportionately to the hyperglycemia</td></tr>
            <tr><td>Persists &gt; 3 days</td><td>consider initiating treatment (oral or insulin) — but the transient response usually resolves in 1–2 weeks and returns to pretreatment levels</td></tr>
          </tbody>
        </table>
        <div className="card-meta"><Cite>UC23</Cite></div>
      </section>

      <p className="text-muted" style={{ fontSize: 12, margin: "0 var(--space-1)" }}>
        Other insulin-requirement amplifiers to consider: {STEROID.otherAmplifiers.join(", ")}.
      </p>
    </>
  );
}
