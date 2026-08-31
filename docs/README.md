# @perch/site

The public site for perch — the marketing **landing page** plus the **docs** — built with
[Astro](https://astro.build) + [Starlight](https://starlight.astro.build) and published to
GitHub Pages at <https://getperch.github.io/perch/>.

## Layout

```
src/pages/index.html          Landing page. A single static .html file flattened from
                               the Claude Design source "Perch Landing.dc.html". Astro
                               serves .html files in src/pages/ as routes, so it is the
                               site root (/) in dev, preview and build alike.
src/content/docs/docs/         Starlight docs. Files here are served under /perch/docs/…
  index.md                     /perch/docs/
  a2ui.md                      /perch/docs/a2ui/
  plans/*.md                   /perch/docs/plans/…
astro.config.mjs               site + base (/perch) + Starlight sidebar
src/content.config.ts          docs content collection
```

Every doc page needs `title` (and ideally `description`) frontmatter — Starlight renders
the `title` as the page's `<h1>`, so don't also start the body with a `#` heading.

## Develop

```sh
pnpm --filter @perch/site dev        # http://localhost:4321/perch/
pnpm --filter @perch/site build      # -> docs/dist/
pnpm --filter @perch/site preview
```

## Deploy

`.github/workflows/deploy-site.yml` builds this package and deploys `docs/dist/` to GitHub
Pages on every push to `main` that touches `docs/`, and on manual dispatch. The repo's
**Settings → Pages → Source** must be set to **GitHub Actions** (one-time).

## Updating the landing page

Re-export the bundle from Claude Design, then re-flatten it to a single static file and
overwrite `src/pages/index.html`. The flatten step resolves the design DSL (`{{ vars }}`,
`sc-camel-view-box`, `style-hover`, `<sc-if>`, `<x-dc>`) and swaps the embedded fonts for
Google Fonts. It does not use React or the dc-runtime at runtime.
