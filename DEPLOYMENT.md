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

1. Get the code onto the **default branch**. The workflow deploys from `main`
   (or `master`). Merge this branch into `main` — e.g. open a pull request from
   `claude/claude-md-docs-2di2j6` into `main` and merge it, or push these
   commits to `main`.
2. In the repository on GitHub, go to **Settings → Pages**.
3. Under **Build and deployment → Source**, choose **GitHub Actions**.
   (That's the only setting to change — you do *not* pick a branch here.)

That's it. The next push to the default branch runs the workflow; you can also
trigger it manually from the **Actions** tab → *Deploy to GitHub Pages* → *Run
workflow*.

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
