/**
 * SteroidsTab — antenatal corticosteroid insulin adjustment (spec §9 / Module G).
 *
 * Uses the pregnancy-specific Mathiesen ER algorithm for betamethasone
 * (perinatology.com): a day-by-day increase over the pre-steroid baseline
 * (Day 1 nighttime +25%, Day 2–3 +40%, Day 4 +20%, Day 5 +10–20%, taper Days
 * 6–7). All math lives in dosing.ts.
 */
import { useState } from "react";
import { mathiesenSchedule, MATHIESEN, type SteroidRegimen, type MathiesenDose } from "../logic/dosing";
import { Kicker, NumberField, Alert, Cite } from "./controls";

const fmt = (r: [number, number]) => (r[0] === r[1] ? `${r[0]}` : `${r[0]}–${r[1]}`);

export function SteroidsTab() {
  const [base, setBase] = useState<SteroidRegimen>({ breakfast: 10, lunch: 8, dinner: 12, hs: 20 });

  const days1to5 = mathiesenSchedule(base).filter((d) => !d.taper);

  function patchBase(p: Partial<SteroidRegimen>) {
    setBase((prev) => ({ ...prev, ...p }));
  }

  return (
    <>
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
    </>
  );
}
