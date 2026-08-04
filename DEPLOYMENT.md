# Deploying to GitHub Pages

This app is a **static site** (Vite builds it to a `dist/` folder of plain
HTML/CSS/JS — no server or database). It's deployed with the GitHub Actions
workflow at `.github/workflows/deploy.yml`, which builds the app, runs the
clinical-engine tests, and publishes it to GitHub Pages on every push to the
default branch.

> ⚠️ **Not a validated medical device.** This tool outputs insulin doses for
> decision support only and requires clinician confirmation. Think carefully
> before making it publicly reachable — consider restricting access or adding
> an acknowledgment gate for anything beyond private testing.

## One-time setup (you do this once, in the GitHub UI)

There is exactly **one** setting to change:

1. In the repository on GitHub, go to **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

> ❗ **This is the step that matters.** If the source is set to **"Deploy from
> a branch"** (the default), GitHub publishes the *raw source files* — the
> unbuilt `index.html` points at `/src/main.tsx`, which the browser can't run,
> so you get a **blank page**. Only the **GitHub Actions** source runs the build
> that compiles the app.

The deploy workflow (`.github/workflows/deploy.yml`) is set to run on the
`claude/claude-md-docs-2di2j6` branch as well as `main`/`master`, so it deploys
from wherever the code currently lives. After switching the source, either push
a commit or trigger it manually: **Actions** tab → *Deploy to GitHub Pages* →
*Run workflow*.

## Your URL

Once the workflow's `deploy` job finishes, your site is live at:

```
https://kathymostajeran-lang.github.io/Insulin-Management-in-Pregnancy/
```

The exact URL also appears in the Actions run summary and under
**Settings → Pages**.

## Why it works under a sub-path

GitHub Pages serves project sites from `/<repo-name>/`, not the domain root.
`vite.config.ts` sets `base: "./"`, and the fonts are bundled through Vite, so
every asset URL is **relative** — the app works at the sub-path with no 404s.
No base-path configuration is required.

## Local preview of the production build

```bash
npm run build     # outputs dist/
npm run preview   # serves the built app locally
```

## Custom domain (optional)

Add a `CNAME` file to the deployed site (via **Settings → Pages → Custom
domain**) and point your DNS at GitHub Pages. With a custom domain the app is
served from the root, which also works given the relative base.
