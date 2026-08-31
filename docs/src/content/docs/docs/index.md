---
title: "Overview"
description: "Design notes, plans, and architecture references for perch."
---

Design notes, plans, and architecture references for perch. This site is built with
[Astro](https://astro.build) + [Starlight](https://starlight.astro.build) and deployed to
GitHub Pages by `.github/workflows/deploy-site.yml` on every push to `main` that touches
`docs/`.

- **[Agent-rendered UI (A2UI)](/perch/docs/a2ui/)** — `render_ui` / A2UI cards in the
  chat: how it works, the component catalog, the per-agent toggle, and how to add a
  component.
- **Plans** — implementation plans for in-flight or upcoming work. A plan is a living
  document: update it as decisions land, and leave it in place once shipped so the
  rationale stays discoverable.
  - [AG-UI / A2UI as a standard capability](/perch/docs/plans/agui-a2ui/)
  - [Feature flags](/perch/docs/plans/feature-flags/)

The marketing landing page lives at [`docs/src/pages/index.html`](https://github.com/getperch/perch/blob/main/docs/src/pages/index.html)
— a single static file flattened from the Claude Design source `Perch Landing.dc.html`.
Re-export and re-flatten it when the design changes; Astro serves `.html` files in
`src/pages/` as routes, so it stays the site root.

See also [`infra/README.md`](https://github.com/getperch/perch/blob/main/infra/README.md)
for the deploy / streaming / reconnect contracts.
