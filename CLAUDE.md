# CLAUDE.md

Guidance for AI assistants (and humans) working in the **Insulin Management in Pregnancy** repository.

> **Status:** The architecture below is the agreed design for the app. Source files are being scaffolded — when you add or change a file, keep the sections here in sync in the same commit so this document never drifts from the code. Where a path is described but not yet committed, treat this file as the spec for how it should be built.

---

## 1. What this project is

A **React + TypeScript single-page app** that helps compute and present **insulin dosing for pregnancy** (gestational and pre-existing diabetes). The app takes patient inputs, derives a **Total Daily Dose (TDD)**, and presents guidance across tabbed views.

Every clinical rule is **guideline-based and traceable to its source** — the codebase is built so that any number a clinician sees can be traced back to a citation in code. This is a **safety-sensitive** project; see §6.

---

## 2. Repository layout

```
src/
├── logic/
│   └── dosing.ts     # All clinical rules as PURE functions, each citing its source page
├── config.ts         # Tunable constants: starting unit, titration step, demo prefill
├── App.tsx           # App shell: patient inputs, TDD banner, tab routing
├── ui/               # One component per tab + shared controls
└── styles/
    ├── modernist.css # Design-system tokens — copied VERBATIM, do not edit token values
    └── app.css       # Application styles built on top of the tokens
public/
└── fonts/            # Archivo font, vendored locally (no external font CDN)
```

**The load-bearing rule:** clinical truth lives in **`src/logic/dosing.ts`** and nowhere else. UI, config, and styles are presentation and tuning around that core.

---

## 3. Key conventions

These are the conventions that make the codebase safe and consistent. Follow them exactly.

### Clinical logic — `src/logic/dosing.ts`
- Every rule is a **pure function**: no I/O, no side effects, deterministic output for a given input. This keeps clinical logic unit-testable and reviewable in isolation.
- **Each rule cites its source page** in a comment (guideline + page/section). No dosing constant, threshold, or formula lands without a citation. If you can't cite it, don't hard-code it.
- Keep UI concerns out of this file — it returns numbers/structured results, not formatted strings or JSX.

### Configuration — `src/config.ts`
- Holds the **tunable knobs**: starting insulin unit, titration step size, and the **demo prefill** values used to populate inputs for demonstration.
- Change behavior by editing config, not by scattering magic numbers through the UI.

### App shell — `src/App.tsx`
- Owns **patient inputs**, the **TDD banner**, and **tab routing**. It wires inputs → `dosing.ts` → the active tab; it does not contain clinical rules itself.

### UI — `src/ui/`
- **One component per tab**, plus **shared controls**. Components render results from `dosing.ts`; they must not re-implement clinical math.

### Styles — `src/styles/`
- `modernist.css` contains **design tokens copied verbatim** — do **not** alter token values; treat them as vendored design output.
- Put app-specific styling in `app.css`, layered on top of the tokens.

### Fonts — `public/fonts/`
- **Archivo is vendored locally.** Do not add external font CDNs or `@import` from the network — reference the local files so the app stays self-contained.

---

## 4. Development environment & commands

Standard React + TypeScript tooling. Once `package.json` is committed, record the exact scripts here and remove this note:

| Purpose | Command |
|---------|---------|
| Install dependencies | `npm install` _(confirm once manifest lands)_ |
| Run dev server | `npm run dev` _(TBD — record actual script)_ |
| Build | `npm run build` _(TBD)_ |
| Test | _TBD — add a runner (e.g. Vitest) and test `dosing.ts` first_ |
| Lint / format | _TBD — record actual commands_ |

**Test `dosing.ts` before anything else.** Because the clinical rules are pure functions, they are the highest-value and easiest thing to unit-test; prioritize coverage there.

---

## 5. Git & contribution workflow

- **Feature branches:** short, descriptive names, e.g. `claude/<topic>-<id>`.
- **Commits:** imperative mood, explain *why*; keep them focused.
- **Push:** `git push -u origin <branch-name>`.
- **Pull requests:** open one only when explicitly requested; mirror any `.github/` template.
- **Never commit secrets or patient data**, and keep a `.gitignore` covering `node_modules/`, build output, and `.env` files.

---

## 6. Clinical safety & data handling (important)

Insulin is a high-alert medication where dosing errors cause serious harm. Hold contributions to a correspondingly high bar:

- **No dosing logic without a cited source.** This is enforced by convention in `dosing.ts` — every rule references its guideline page. Preserve that discipline in every change.
- **Make units and context explicit.** mg/dL vs mmol/L, gestational context, and target ranges must be unambiguous in both code and UI.
- **Treat all patient-related data as PHI.** Never commit real patient data or identifiers. The only patient-shaped data in the repo is the synthetic **demo prefill** in `config.ts`.
- **Fail safe.** Validate inputs; prefer clear error states over silent computation on missing or out-of-range glucose/insulin values.

---

## 7. Domain references available in this environment

For grounding clinical accuracy (via MCP) — use these rather than memory for clinical facts, and cite what informs `dosing.ts`:

- **PubMed** — biomedical literature.
- **ClinicalTrials.gov** — trial protocols and endpoints.
- **ICD-10 (CM/PCS)** — diagnosis/procedure codes (e.g. `O24.*`, diabetes in pregnancy).
- **Consensus / Scholar Gateway** — research-question search across the literature.

---

## 8. Keeping this document useful

The **code is the source of truth.** On every substantive change, update the section here that it affects — layout (§2), conventions (§3), or commands (§4) — and remove any "TBD"/"not yet committed" marker as each item becomes real. If this file contradicts the code, fix this file.
