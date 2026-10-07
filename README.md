# Visual Makeover

A consent-first AI workspace for visually redesigning websites from **real browser/page evidence**.

It can:

- scrape public website HTML into compact design/content signals
- model an origin-scoped Opera MCP lane for tab/accessibility content, screenshots, and navigation
- require a separate, visible browser grant after app sign-in
- scope grants to one origin + selected capabilities + a short expiry
- generate a structured makeover plan
- export a `makeover.json` proposal without silently publishing anything
- write local action receipts for auditability

## Why the auth split exists

**App sign-in ≠ browser authorization.**

Visual Makeover uses two gates:

1. application identity
2. explicit browser/data grant with notice

Authenticated browser access never requires this app to collect a password or raw cookie. Keep credentials inside the browser/provider boundary.

## Opera integration

The repo includes an Opera MCP adapter contract based on the connector capability surface used here:

- `tab_content`
- `screenshot`
- `go_to_page`

The underlying Opera connector may also expose `list_tabs` and `history`, but Visual Makeover blocks those browser-global reads until a separate global-read grant model exists.

Visual Makeover reuses the portfolio browser-recovery contract `juss/browser-bridge-recovery@v1`: direct capability first, then live Opera, then another authenticated bridge, then bounded generic automation, otherwise fail closed. A plugin can be installed/enabled and fully permissioned while its live browser session is temporarily not exposed; that state is classified as `BLOCKED_CONNECTOR_BRIDGE`, not as bad user setup. `OPERA_BRIDGE_URL` remains the standalone-runtime adapter for deployments that need to invoke a browser host outside ChatGPT. See `docs/OPERA_BRIDGE.md` for the trust boundary.

## Production identity

Production uses **Cloudflare Access** as the identity gate. Configure `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`, place the app behind the matching Access application, and Visual Makeover verifies the `CF-Access-Jwt-Assertion` signature, issuer, audience, and expiry before issuing its short-lived app session. The app never receives the user's password.

Development mode keeps a local session path for testing only.

## Run

```bash
npm run dev
```

Open `http://127.0.0.1:4173`.

## Verify

```bash
npm test
npm run test:playwright
```

## Next production gates

- configure the Cloudflare Access application/audience for the deployed hostname
- persist sessions/grants/receipts in a real store
- add per-domain scraping policy + rate limits + robots/terms evaluation
- connect a live Opera/host bridge when browser-only evidence is required; preserve verified plugin/permission state if the runtime attach is temporarily blocked
- add screenshot/DOM evidence as inputs to PromptOS
- add patch/export adapters for GitHub, Figma, or site builders
- keep publishing as a separate explicit write authorization

## Verification evidence

- Node tests cover SSRF guards, origin scoping, Opera capability scopes, and the dual-gate API.
- Playwright renders the shipped UI and verifies the browser notice defaults to public scrape only; Opera read/navigation are opt-in.
- Screenshot: `docs/proof/playwright-consent.png`.
