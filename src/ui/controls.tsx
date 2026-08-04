/**
 * controls.tsx — shared presentational controls used across tabs.
 * These render results and inputs; they contain NO clinical math (CLAUDE.md §3).
 */
import type { ReactNode } from "react";

// ── Numeric field ───────────────────────────────────────────────────────────
export function NumberField(props: {
  label: string;
  value: number | null;
  onChange: (v: number | null) => void;
  hint?: string;
  step?: number;
  min?: number;
  max?: number;
  placeholder?: string;
}) {
  const { label, value, onChange, hint, step, min, max, placeholder } = props;
  return (
    <div className="field">
      <label>{label}</label>
      <input
        className="input"
        type="number"
        inputMode="decimal"
        value={value ?? ""}
        step={step}
        min={min}
        max={max}
        placeholder={placeholder}
        onChange={(e) => {
          const raw = e.target.value;
          onChange(raw === "" ? null : Number(raw));
        }}
      />
      {hint ? <div className="cite" style={{ marginTop: 4 }}>{hint}</div> : null}
    </div>
  );
}

// ── Segmented control ───────────────────────────────────────────────────────
export function Seg<T extends string>(props: {
  name: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  const { name, value, options, onChange } = props;
  return (
    <div className="seg" role="radiogroup" aria-label={name}>
      {options.map((o) => (
        <label className="seg-opt" key={o.value}>
          <input
            type="radio"
            name={name}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
          />
          {o.label}
        </label>
      ))}
    </div>
  );
}

// ── Field wrapper for non-input controls ────────────────────────────────────
export function Labeled(props: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="field">
      <label>{props.label}</label>
      {props.children}
      {props.hint ? <div className="cite" style={{ marginTop: 4 }}>{props.hint}</div> : null}
    </div>
  );
}

// ── Source citation chip ────────────────────────────────────────────────────
export function Cite({ children }: { children: ReactNode }) {
  return <span className="cite">{children}</span>;
}

// ── Alert / hard-stop banner ────────────────────────────────────────────────
export function Alert(props: { title: string; children?: ReactNode; stop?: boolean }) {
  return (
    <div className={`alert${props.stop ? " stop" : ""}`} role="alert">
      <div className="alert-title">{props.title}</div>
      {props.children}
    </div>
  );
}

// ── Section heading ─────────────────────────────────────────────────────────
export function Kicker({ children }: { children: ReactNode }) {
  return <p className="kick">{children}</p>;
}

// ── A "When / Insulin / Units" schedule row ─────────────────────────────────
export function DoseRow(props: { when: string; agent: string; units: ReactNode }) {
  return (
    <div className="row">
      <span className="row-when">{props.when}</span>
      <span className="row-agent">{props.agent}</span>
      <span className="row-units num">{props.units}</span>
    </div>
  );
}

// ── "Enter more input" placeholder ──────────────────────────────────────────
export function NeedInput({ children }: { children: ReactNode }) {
  return <p className="text-muted" style={{ fontSize: 14 }}>{children}</p>;
}
