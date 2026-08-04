/**
 * SteroidsTab — antenatal corticosteroid hyperglycemia (spec §9 / Module G).
 *
 * The insulin adjustment uses the pregnancy-specific Mathiesen ER algorithm for
 * betamethasone (perinatology.com): a day-by-day increase over the pre-steroid
 * baseline (Day 1 nighttime +25%, Day 2–3 +40%, Day 4 +20%, Day 5 +10–20%,
 * taper Days 6–7). Monitoring cadence, the >200 mg/dL escalation, and the
 * transient-effect safety framing are UC23. All math lives in dosing.ts.
 */
import { useState } from "react";
import {
  mathiesenSchedule,
  steroidBgAction,
  STEROID,
  MATHIESEN,
  type SteroidRegimen,
  type MathiesenDose,
} from "../logic/dosing";
import { Kicker, NumberField, Seg, Alert, Cite } from "./controls";

const YN: ReadonlyArray<{ value: "yes" | "no"; label: string }> = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const fmt = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);

export function SteroidsTab() {
  const [base, setBase] = useState<SteroidRegimen>({ breakfast: 10, lunch: 8, dinner: 12, hs: 20 });
  const [bg, setBg] = useState<number | null>(210);
  const [onInsulin, setOnInsulin] = useState<"yes" | "no">("yes");

  const schedule = mathiesenSchedule(base);
  const days1to5 = schedule.filter((d) => !d.taper);
  const bgAction = bg === null ? null : steroidBgAction(bg, onInsulin === "yes");

  function patchBase(p: Partial<SteroidRegimen>) {
    setBase((prev) => ({ ...prev, ...p }));
  }

  return (
    <>
      {/* ── Mathiesen insulin adjustment ──────────────────────────── */}
      <section>
        <Kicker>Insulin adjustment · Mathiesen algorithm · betamethasone</Kicker>
        <p className="text-muted" style={{ fontSize: 12, marginTop: 4 }}>
          Enter the pre-steroid regimen. Each day's increase is applied to that baseline. Assumes the
          first steroid dose is given the morning of Day 1.
        </p>
        <div className="rail" style={{ marginTop: 8 }}>
          <NumberField label="Breakfast · units" value={base.breakfast} onChange={(v) => patchBase({ breakfast: v ?? 0 })} min={0} />
          <NumberField label="Lunch · units" value={base.lunch} onChange={(v) => patchBase({ lunch: v ?? 0 })} min={0} />
          <NumberField label="Dinner · units" value={base.dinner} onChange={(v) => patchBase({ dinner: v ?? 0 })} min={0} />
          <NumberField label="HS · units" value={base.hs} onChange={(v) => patchBase({ hs: v ?? 0 })} min={0} />
        </div>

        <div style={{ overflowX: "auto", marginTop: 12 }}>
          <table className="dtab">
            <thead>
              <tr>
                <th>Day</th>
                <th>Adjustment</th>
                <th style={{ textAlign: "right" }}>Breakfast</th>
                <th style={{ textAlign: "right" }}>Lunch</th>
                <th style={{ textAlign: "right" }}>Dinner</th>
                <th style={{ textAlign: "right" }}>HS</th>
              </tr>
            </thead>
            <tbody>
              {days1to5.map((d: MathiesenDose) => (
                <tr key={d.day}>
                  <td className="num">{d.day}</td>
                  <td className="text-muted" style={{ fontSize: 12 }}>{d.instruction}</td>
                  <td className="num" style={{ textAlign: "right" }}>{fmt(d.breakfast)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{fmt(d.lunch)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{fmt(d.dinner)}</td>
                  <td className="num" style={{ textAlign: "right" }}>{fmt(d.hs)}</td>
                </tr>
              ))}
              <tr>
                <td className="num">6–7</td>
                <td className="text-muted" style={{ fontSize: 12 }} colSpan={5}>
                  Gradually reduce the insulin dose back to the pre-steroid dose.
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="card-meta" style={{ marginTop: 6 }}>
          <Cite>{MATHIESEN.source} · hyperglycemia may begin {MATHIESEN.onsetHours[0]}–{MATHIESEN.onsetHours[1]} h post-dose and persist up to {MATHIESEN.elevatedUpToDays} days</Cite>
        </div>
      </section>

      <Alert title="Temporary adjustment — taper back">
        <p style={{ marginBottom: 0 }}>
          This is a <strong>transient</strong> 5–7 day escalation. Do not bake it into the standing
          regimen — taper to the pre-steroid dose by Days 6–7 and reassess.<Cite> spec §9 mitigation</Cite>
        </p>
      </Alert>

      {/* ── Glucose action (breakthrough) ─────────────────────────── */}
      <section>
        <Kicker>Breakthrough glucose</Kicker>
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

      {/* ── Physiology + monitoring reference ─────────────────────── */}
      <section className="card elev-sm">
        <div className="card-kicker">Physiology &amp; monitoring · UC23</div>
        <table className="dtab">
          <tbody>
            <tr><td>Peak response</td><td>{STEROID.peakHours[0]}–{STEROID.peakHours[1]} h (onset can be delayed; may persist {STEROID.persistWeeks[0]}–{STEROID.persistWeeks[1]} weeks)</td></tr>
            <tr><td>Typical max BG</td><td>&lt; {STEROID.typicalMaxBgNondiabetic} mg/dL in non-diabetic pregnancy</td></tr>
            <tr><td>While NPO</td><td>check BG q8h</td></tr>
            <tr><td>On a regular diet</td><td>check BG AC and HS</td></tr>
            <tr><td>After 72 h · BG &lt; 200</td><td>discontinue BG monitoring</td></tr>
            <tr><td>During window · BG &gt; 200</td><td>carbohydrate-counting pregnancy diet; check BG 7×/day; treat as needed</td></tr>
          </tbody>
        </table>
        <div className="card-meta"><Cite>UC23 · other amplifiers: {STEROID.otherAmplifiers.join(", ")}</Cite></div>
      </section>
    </>
  );
}
