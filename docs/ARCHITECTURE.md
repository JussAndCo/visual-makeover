# Visual Makeover architecture

## Trust model

Visual Makeover separates four concepts that must never collapse into one:

1. **Identity** — the user is signed in to Visual Makeover.
2. **Notice** — the user sees what the AI/browser capability can do.
3. **Grant** — a target-origin-scoped, capability-scoped, expiring authorization token.
4. **Receipt** — append-only evidence of what was actually attempted/completed.

A logged-in app session is **not** browser authorization. A browser grant is **not** permission to publish website changes.

## Browser providers

`src/browser/opera-provider.mjs` models the currently supported Opera connector capability surface:

- read: `list_tabs`, `history`, `tab_content`, `screenshot`
- navigate: `go_to_page`
- mutate/type/submit: intentionally unsupported in this starter

The repo does not collect browser cookies or passwords. `OPERA_BRIDGE_URL` is an owner-controlled adapter that translates `{tool,args}` to the Opera MCP host used in the deployment environment. This avoids hard-coding a ChatGPT/plugin-only transport into the product.

## Scraping

Public HTML scraping is isolated from authenticated browser capture. The starter:

- allows only HTTP(S)
- blocks localhost/private IP targets to reduce SSRF risk
- caps response size
- applies a request timeout
- extracts a small visual/content signal set

Production should add robots/terms policy, crawl budgets, per-domain rate limits, content provenance, and a persistent queue.

## AI makeover

The runnable starter uses a local heuristic planner so the product works without secrets. Replace `/api/analyze` with PromptOS/Chief/Sol/model routing later. The model gets scraped/captured evidence and returns a proposal; it does not gain browser authority by being selected as the analyzer.

## Production auth

`/api/auth/dev-sign-in` is development-only and returns 404 under `NODE_ENV=production`. Production must plug in a real identity provider. Browser grants remain a second authorization step even after that change.
