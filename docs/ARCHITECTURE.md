# Visual Makeover architecture

## Trust model

Visual Makeover separates four concepts that must never collapse into one:

1. **Identity** — the user is signed in to Visual Makeover.
2. **Notice** — the user sees what the AI/browser capability can do.
3. **Grant** — a target-origin-scoped, capability-scoped, expiring authorization token.
4. **Receipt** — append-only evidence of what was actually attempted/completed.

A logged-in app session is **not** browser authorization. A browser grant is **not** permission to publish website changes.

## Browser providers

`src/browser/opera-provider.mjs` exposes only origin-scoped Opera operations in this product:

- read: `tab_content`, `screenshot`
- navigate: `go_to_page`
- browser-global reads such as `list_tabs` and `history`: blocked until a separate global-read authority exists
- mutate/type/submit: intentionally unsupported in this starter

`src/browser/recovery.mjs` ports the proven FCR contract `juss/browser-bridge-recovery@v1`. It keeps provider setup evidence separate from runtime attachment evidence. An installed/enabled/permissioned Opera plugin with a missing live session is `BLOCKED_CONNECTOR_BRIDGE`; it does not trigger repeated setup instructions. The policy re-probes Opera at most once, then may route to another authenticated bridge or a bounded generic browser capability. Every route still returns `executionAuthorized: false` until the normal human authority gate is satisfied.

The repo does not collect browser cookies or passwords. `OPERA_BRIDGE_URL` is an owner-controlled standalone-runtime adapter that translates `{tool,args}` to the browser host used in the deployment environment. This avoids pretending a ChatGPT plugin transport is itself a public embeddable API.

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

`POST /api/auth/session` uses a local development identity outside production. Under `NODE_ENV=production`, it requires Cloudflare Access and verifies the `CF-Access-Jwt-Assertion` against the configured issuer JWKS, application audience, signature, and expiry. The app converts that verified identity into a short-lived local app session. Browser grants remain a second authorization step after identity is established.
