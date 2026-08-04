# CLAUDE.md

Guidance for AI assistants (and humans) working in the **Insulin Management in Pregnancy** repository.

> **The code is the source of truth.** On every substantive change, update the section here it affects — layout (§2), conventions (§3), commands (§4). If this file contradicts the code, fix this file.

---

## 1. What this project is

A **React + TypeScript single-page app** (Vite) that computes and presents **insulin dosing for pregnancy** (gestational and pre-existing diabetes). It takes patient inputs, derives a **Total Daily Dose (TDD)**, and presents guidance across five tabbed modules: **Start** (initiation), **Correct** (pre-meal correction), **Labor** (intrapartum IV infusion), **Adjust** (SMBG titration), and **Pump** (CSII initiation).

Every clinical rule is **guideline-based and traceable to its source**: any number a clinician sees traces back to a cited function in `src/logic/dosing.ts`, and the regression suite pins every published worked example. This is a **safety-sensitive** project — see §6.

The clinical logic is derived from four sources, vendored under `docs/` (see §7). The design system and the five-tab UX come from the `Insulin_Rx` prototype (`docs/Insulin_Rx_prototype.html`).

---

## 2. Repository layout

```
index.html            # Vite entry; mounts #root, sets title/theme, self-icon
vite.config.ts        # Vite + React plugin; Vitest config; base "./" for portability
tsconfig*.json        # Project-references TS config (app / node)
package.json          # Scripts + deps (see §4)

src/
├── main.tsx          # React entry: imports styles, renders <App/>
├── App.tsx           # Shell: patient inputs, TDD banner, tab routing (no clinical math)
├── model.ts          # Glue: inputs → kg/DBW → calls dosing.ts. No thresholds/formulas here
├── config.ts         # Tunable knobs: policy switches, titration step, demo prefill, target tables
├── vite-env.d.ts     # Vite client types (CSS module imports)
├── logic/
│   ├── dosing.ts        # ALL clinical rules as PURE functions, each citing its source
│   └── dosing.test.ts   # Regression suite — every published worked example (Vitest)
├── ui/
│   ├── types.ts         # Shared TabProps
│   ├── controls.tsx     # Shared presentational controls (no clinical math)
│   ├── StartTab.tsx     # Initiation schedule (conventional NPH/RAA split)
│   ├── CorrectTab.tsx   # Calculated ICF correction + UC23 fixed scale (+ hard stop)
│   ├── LaborTab.tsx     # UC23 intrapartum IV algorithm (+ C-15 policy gap)
│   ├── AdjustTab.tsx    # Pattern-based SMBG titration (+ 20% TDD cap)
│   ├── HypoTab.tsx      # Hypoglycemia threshold (C-01), Rule of 15, rescue ladder
│   ├── SteroidsTab.tsx  # Steroid episode + baseline-titration suspension (§9)
│   ├── CgmTab.tsx       # CGM scorecard + tagged-value handoff (HS-09/10/11 guards)
│   ├── PumpTab.tsx      # CSII initiation (C-14 resolved)
│   └── PostpartumTab.tsx # Immediate PP dose options, all methods shown (C-13)
└── styles/
    ├── modernist.css    # Design-system tokens — copied VERBATIM; do not edit token values
    ├── app.css          # Application styles built on top of the tokens
    └── fonts/           # Archivo (variable woff2), vendored & bundled by Vite — no font CDN

docs/                 # Clinical sources of truth (see §7) — spec, parameters, reference engine, prototype
.github/workflows/    # deploy.yml — builds, tests, publishes to GitHub Pages (see DEPLOYMENT.md)
```

**The load-bearing rule:** clinical truth lives in **`src/logic/dosing.ts`** and nowhere else. `model.ts`, `config.ts`, the UI, and styles are glue, tuning, and presentation around that core.

---

## 3. Key conventions

Follow these exactly — they are what make the codebase safe and consistent.

### Clinical logic — `src/logic/dosing.ts`
- Every rule is a **pure function**: no I/O, no side effects, deterministic. It returns numbers/structured results, never formatted strings or JSX.
- **Each rule cites its source** in a comment (guideline + section). No dosing constant, threshold, or formula lands without a citation. If you can't cite it, don't hard-code it.
- Rounding uses **`pyRound` (round-half-to-even)** to reproduce the verified reference engine and the published worked examples exactly (e.g. VB24's printed bedtime NPH of 10 = `round(10.5)` under half-even). Use it for every dose rounding; do not use `Math.round` for clinical values.
- **Source conflicts are configuration, not silent choices.** The spec (§14) enumerates conflicts C-01…C-21. They surface as `Config` switches or explicit policy gaps — e.g. C-02 (`tddSchedule`), C-14 (CSII basal uses *total daily basal ÷ 24*, pinned by test), C-15 (intrapartum 80–99 band throws `UnresolvedPolicyGap`), C-13 (postpartum returns all methods, never auto-picks).
- **Hard stops are blocking, not advisory** (spec §15): e.g. `uc23FixedCorrection` throws `HardStopError` off-label.

### Glue — `src/model.ts`
- Converts inputs (unit → kg, height → DBW) and **delegates all dose math to `dosing.ts`**. Never add a threshold or formula here.

### Configuration — `src/config.ts`
- Holds tunable knobs: TDD schedule options, titration step, dose rounding, unresolved-policy defaults, and the **synthetic demo prefill**. Change behavior here, not with magic numbers in the UI. `DEMO_PREFILL` is the only patient-shaped data in the repo and is entirely synthetic.

### App shell — `src/App.tsx`
- Owns patient inputs, the TDD banner, and tab routing. Wires inputs → `model.ts`/`dosing.ts` → the active tab. Contains no clinical rules itself.

### UI — `src/ui/`
- **One component per tab**, plus shared controls in `controls.tsx`. Components render results from `dosing.ts`; they must not re-implement clinical math. Every dose displayed shows its input, source, and (where relevant) the intermediate arithmetic — a spec §0 mitigation.

### Styles — `src/styles/`
- `modernist.css` are **design tokens copied verbatim** from the prototype — do **not** alter token values (colors, spacing, radius=0, Archivo). App-specific styling goes in `app.css`.

### Fonts — `src/styles/fonts/`
- **Archivo is vendored locally** (variable woff2, one file per unicode subset) and imported through the bundler, so asset URLs stay correct under any base path (e.g. the GitHub Pages sub-path). Do not add external font CDNs or network `@import`.

---

## 4. Development environment & commands

Standard React + TypeScript + Vite tooling.

| Purpose | Command |
|---------|---------|
| Install dependencies | `npm install` |
| Run dev server | `npm run dev` |
| Build (typecheck + bundle) | `npm run build` |
| Preview the production build | `npm run preview` |
| **Test (run once)** | `npm test` — Vitest |
| Test (watch) | `npm run test:watch` |
| Typecheck only | `npm run typecheck` |
| Lint | `npm run lint` _(ESLint not yet configured — placeholder script)_ |

**Test `dosing.ts` before anything else.** The clinical rules are pure functions and the highest-value thing to cover; `dosing.test.ts` mirrors the reference engine's regression suite and the spec's §16 test vectors. Keep it green and extend it whenever you touch the engine.

---

## 5. Git & contribution workflow

- **Feature branches:** short, descriptive, e.g. `claude/<topic>-<id>`.
- **Commits:** imperative mood, explain *why*; keep them focused.
- **Push:** `git push -u origin <branch-name>`.
- **Pull requests:** open one only when explicitly requested; mirror any `.github/` template.
- **Never commit secrets or patient data.** `.gitignore` covers `node_modules/`, `dist/`, and `.env*`.

---

## 6. Clinical safety & data handling (important)

Insulin is a high-alert medication where dosing errors cause serious harm. Hold contributions to a correspondingly high bar:

- **Not a validated device.** Decision support only. Every dose output requires explicit clinician confirmation; no module auto-executes or writes to an EMR/pump. Always display the input, formula, source, and intermediate arithmetic alongside every output (spec §0).
- **No dosing logic without a cited source** — enforced by convention in `dosing.ts`. Preserve it in every change.
- **Make units and context explicit.** mg/dL vs mmol/L, gestational context, and target ranges must be unambiguous in code and UI.
- **Treat all patient-related data as PHI.** Never commit real patient data or identifiers. The only patient-shaped data is the synthetic `DEMO_PREFILL` in `config.ts`.
- **Fail safe.** Validate inputs; prefer clear error/empty states and blocking hard stops over silent computation on missing or out-of-range values.

---

## 7. Clinical sources (vendored under `docs/`)

The engine is compiled from four sources only; each numeric parameter carries a source tag.

| File | What it is |
|------|-----------|
| `docs/PREGNANCY_INSULIN_ALGORITHMS.md` | The full machine-consumable spec (§0 safety, §14 conflict registry, §15 hard stops, §16 test vectors, §17 build order). The authority for how `dosing.ts` should behave. |
| `docs/insulin_parameters.json` | Every parameter, policy switch, target table, and hard stop as data. |
| `docs/dosing_engine_reference.py` | The verified reference arithmetic + regression suite that `dosing.ts` and `dosing.test.ts` are ported from. |
| `docs/Insulin_Rx_prototype.html` | The self-contained design/UX prototype — origin of the modernist design system, the vendored Archivo fonts, and the five-tab layout. |

Source precedence (spec §1): targets/monitoring **ADA26 > ES25 > VB24 > UC23**; MDI initiation/titration **VB24 > UC23**; CSII **UC23** (sole); AID **ES25 + ADA26**. Full citations live in `docs/insulin_parameters.json → sources`.

For grounding new clinical facts (via MCP), prefer **PubMed**, **ClinicalTrials.gov**, **ICD-10 (CM/PCS)**, and **Consensus / Scholar Gateway** over memory, and cite what informs `dosing.ts`.

---

## 8. Build order & what's next

Per the spec's suggested order (§17), implemented so far: data/target service, the TDD/initiation calculator with the C-02 switch, pattern titration, the fixed/calculated correction, CSII (C-14), the intrapartum table (C-15 gap surfaced), the CGM adapter (§6: scorecard, HS-09/10/11 guards, tagged-value derivation feeding the titration engine, basal-hyperglycemia signal, phenotype triggers), Postpartum (§13: all dose methods shown side by side per C-13, target tiers, lactation guidance), Hypoglycemia (§12: C-01 threshold check, outpatient Rule of 15, the UC23 inpatient rescue ladder routed by consciousness/PO/BG, glucagon, symptoms, unawareness), and Steroids (§9: time-bounded episode that suspends baseline titration, monitoring cadence, BG-threshold escalation). **Not yet built:** DKA reference (§10) and AID (§8). See spec §18 for clinical gaps the four sources do not cover.
