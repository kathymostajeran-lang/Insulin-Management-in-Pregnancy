# Insulin Management in Pregnancy

Guideline-based **decision support** for insulin dosing in pregnancy — gestational
and pre-existing (type 1 / type 2) diabetes. It takes patient inputs, derives a
**Total Daily Dose (TDD)**, and presents dosing guidance across eleven tabbed
modules. Every number a clinician sees traces back to a cited pure function in
`src/logic/dosing.ts`, and a regression suite pins every published worked example.

**Live app:** https://kathymostajeran-lang.github.io/Insulin-Management-in-Pregnancy/

> ⚠️ **Not a validated medical device.** Decision support only. Every dose output
> requires explicit clinician confirmation; no module auto-executes or writes to
> an EMR or pump. Do **not** use for clinical care without institutional
> validation. Units, gestational context, and target ranges are made explicit,
> and blocking hard stops guard off-label use — but this is a reference tool, not
> a substitute for clinical judgment. See the safety preamble in
> `docs/PREGNANCY_INSULIN_ALGORITHMS.md` §0.

## Modules

| Tab | What it does |
|-----|--------------|
| **Start** | Initiation TDD (VB24 default / UC23 switch, conflict C-02) and the starting NPH/RAA daily schedule |
| **Correct** | Pre-meal correction — calculated ICF plus the UC23 fixed scale, with the post-meal / between-meal hard stops |
| **Labor** | Intrapartum IV insulin infusion (UC23 table; the 80–99 mg/dL policy gap C-15 is surfaced, not guessed) |
| **Adjust** | SMBG pattern-based titration — move a dose on a pattern, with a 20%-of-TDD change cap |
| **Hypo** | Hypoglycemia threshold (C-01), outpatient Rule of 15, the UC23 inpatient rescue ladder, glucagon, symptoms |
| **Steroids** | Antenatal betamethasone insulin adjustment via the **Mathiesen ER** day-by-day algorithm |
| **DKA** | Reference protocol (fluids/electrolytes/monitoring) plus the **Yale** IV insulin infusion drip calculator |
| **CGM** | Scorecard vs ADA goals (no eA1C, HS-09), data-quality gate (HS-10/11), tagged-value handoff to titration |
| **Pump** | CSII initiation (the C-14 basal-rate ambiguity is resolved to the worked example and pinned by test) |
| **AID** | Automated Insulin Delivery — recommendation grades, the target-vs-pregnancy-range flag, effect sizes |
| **Postpartum** | Immediate-PP dose options shown side by side (C-13, never auto-picked), target tiers, lactation guidance |

## Clinical sources

The engine is compiled from four core sources (vendored under `docs/`), each
numeric parameter carrying a source tag:

- **ADA26** — ADA Standards of Care in Diabetes 2026, §15
- **ES25** — Endocrine Society / ESE Joint Clinical Practice Guideline 2025
- **VB24** — Valent & Barbour, *Obstet Gynecol* 2024
- **UC23** — UC Cincinnati MFM Diabetes & Pregnancy Pocket Guide, 2023

Two additional, individually cited algorithms were added by request: the
**Mathiesen ER** betamethasone algorithm (perinatology.com, pregnancy-specific)
for the Steroids tab, and the **Yale** insulin infusion protocol (ported from
*Insulin IP Calc v2.4*, © John George K., **LGPL v3**) for the DKA drip — a
general critical-care protocol, flagged in-app as not pregnancy-specific.

Source conflicts are never resolved silently: the spec enumerates them (C-01…C-21)
and they surface as configuration switches or explicit policy gaps.

## How it's built

A **React + TypeScript** single-page app (Vite). The load-bearing rule: **all
clinical logic lives in `src/logic/dosing.ts`** as pure, source-cited functions;
the UI, config, and glue never re-implement clinical math. See
[`CLAUDE.md`](./CLAUDE.md) for the full architecture and conventions.

```
src/
├── logic/dosing.ts       # All clinical rules as pure functions, each citing its source
├── logic/dosing.test.ts  # Regression suite — every published worked example
├── config.ts             # Tunable knobs, policy switches, synthetic demo prefill
├── model.ts              # Glue: inputs → kg/DBW → dosing.ts (no thresholds here)
├── App.tsx               # Shell: patient inputs, TDD banner, tab routing
├── ui/                   # One component per tab + shared controls
└── styles/               # modernist.css design tokens + app.css + vendored Archivo
docs/                     # Clinical sources of truth (spec, parameters, reference engine, prototype)
```

## Develop

| Purpose | Command |
|---------|---------|
| Install | `npm install` |
| Dev server | `npm run dev` |
| Build (typecheck + bundle) | `npm run build` |
| Preview the build | `npm run preview` |
| **Test** | `npm test` — Vitest |
| Typecheck | `npm run typecheck` |

The clinical engine is the highest-value thing to cover; `dosing.test.ts` mirrors
the reference engine's regression suite. Keep it green and extend it with every
change to the engine.

## Deploy

Pushing to the default branch runs `.github/workflows/deploy.yml`, which builds,
runs the tests, and publishes to GitHub Pages (source: **GitHub Actions**). See
[`DEPLOYMENT.md`](./DEPLOYMENT.md).

## Safety & data handling

Insulin is a high-alert medication. Treat all patient-related data as PHI —
**never commit real patient data or identifiers.** The only patient-shaped data
in the repo is the synthetic `DEMO_PREFILL` in `config.ts`.

## Licensing

The Yale infusion logic in the DKA module is derived from *Insulin IP Calc v2.4*
(© John George K., **LGPL v3**); that derivation carries LGPL obligations
(attribution is retained in the source and UI). Add a project `LICENSE` that is
compatible with LGPL v3 before distributing the app.
