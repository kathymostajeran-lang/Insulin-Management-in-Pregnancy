# CLAUDE.md

Guidance for AI assistants (and humans) working in the **Insulin Management in Pregnancy** repository.

> **Current state: greenfield.** As of this file's creation the repository contains no application code — only this document. The sections below describe the project's intent, the conventions to follow, and how to keep this file accurate. **When you add real code, update the relevant sections here in the same change** so this document never drifts from reality. Delete the "not yet present" notes as each piece lands.

---

## 1. What this project is

**Insulin Management in Pregnancy** is a healthcare-domain project concerned with insulin dosing and glucose management for pregnant patients (gestational diabetes and pre-existing type 1 / type 2 diabetes during pregnancy).

The precise deliverable — a clinician/patient web app, a mobile tracker, a clinical-data analysis pipeline, or a research codebase — is **not yet decided**. Until the direction is fixed, keep contributions small, well-documented, and easy to reshape.

Because this project touches clinical decision-making, treat it as **safety-sensitive** (see §6).

---

## 2. Repository layout

```
/
├── CLAUDE.md        # This file — guidance for AI assistants and contributors
└── (application code to be added)
```

There is no source tree, build system, package manifest, or test suite yet. As the project takes shape, document the real layout here — top-level directories, where domain logic lives, where tests live, and any generated/vendored paths that should not be edited by hand.

---

## 3. Development environment & commands

No toolchain is committed yet, so there are no build/test/lint commands to run. **Before writing any code, add the standard trio and record the exact commands here:**

| Purpose | Command | Status |
|---------|---------|--------|
| Install dependencies | _TBD_ | not yet present |
| Run / start | _TBD_ | not yet present |
| Test | _TBD_ | not yet present |
| Lint / format | _TBD_ | not yet present |

When you introduce a stack, prefer the ecosystem's conventional tooling (e.g. `npm`/`pnpm` + a test runner for JS/TS; `pip`/`uv` + `pytest` + `ruff` for Python) and pin versions in a manifest so the environment is reproducible.

---

## 4. Git & contribution workflow

- **Default branch:** the repository's main branch (create it with the first real commit if it does not exist).
- **Feature branches:** use short, descriptive names, e.g. `claude/<topic>-<id>` for assistant-generated work, or `feature/<topic>` for general work.
- **Commits:** write clear, imperative-mood messages that explain *why*, not just *what*. Keep commits focused.
- **Push:** `git push -u origin <branch-name>`.
- **Pull requests:** open one only when explicitly requested. If a PR template exists under `.github/`, mirror its structure.
- **Never commit secrets** — API keys, patient data, credentials, or `.env` files. Add a `.gitignore` before adding code and keep secrets out of history.

---

## 5. Conventions for AI assistants

- **Keep this file current.** Any change to structure, tooling, or workflow must be reflected here in the same commit. This is the first file to read and the first to update.
- **Match the surrounding code.** Once code exists, mirror its style, naming, and idioms rather than importing outside conventions.
- **Don't fabricate.** Do not invent files, commands, or structure that don't exist. If something is undecided, say so and leave a clearly marked TODO.
- **Small, reversible steps.** Because the direction is not locked, favor changes that are easy to revisit.
- **Verify before claiming done.** If tests or a runnable target exist, run them and report real output; if a step was skipped, say so.

---

## 6. Clinical safety & data handling (important)

This project deals with insulin — a high-alert medication where dosing errors can cause serious harm. Hold contributions to a correspondingly high bar:

- **No unqualified medical advice or hard-coded dosing logic without a cited, authoritative clinical source.** Insulin regimens in pregnancy follow guideline-based, individualized protocols; any dosing calculation, threshold, or recommendation must reference its source (e.g. ADA/ACOG/NICE guidance) and be clearly reviewable by a clinician.
- **Treat all patient-related data as protected health information (PHI).** Never commit real patient data, identifiers, or datasets to the repository. Use synthetic or de-identified data for examples and tests.
- **Make clinical assumptions explicit.** Units (mg/dL vs mmol/L), gestational-age context, and target ranges must be unambiguous in code and docs.
- **Fail safe.** Prefer conservative defaults, input validation, and clear error states over silent computation when handling glucose/insulin values.

These rules apply regardless of the eventual stack.

---

## 7. Domain references available in this environment

When working on clinical accuracy, several reference tools are available (via MCP) and may help ground decisions in authoritative data — use them rather than relying on memory for clinical facts:

- **PubMed** — biomedical literature search and article retrieval.
- **ClinicalTrials.gov** — trial protocols, endpoints, and eligibility criteria.
- **ICD-10 (CM/PCS)** — diagnosis and procedure code lookup and validation (e.g. O24.\* codes for diabetes in pregnancy).
- **Consensus / Scholar Gateway** — research-question search across scientific literature.

Cite sources when they inform clinical logic in the codebase.

---

## 8. Keeping this document useful

This file is only valuable if it stays true. On every substantive change:

1. Update §2 (layout) if directories were added or moved.
2. Update §3 (commands) if tooling changed.
3. Update §4/§5 if workflow or conventions changed.
4. Remove "not yet present" / "TBD" markers as each item becomes real.

If you find this document contradicting the code, the **code is the source of truth** — fix this file to match, and note the correction.
