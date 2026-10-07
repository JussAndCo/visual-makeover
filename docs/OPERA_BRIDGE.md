# Opera MCP bridge boundary

Visual Makeover does not treat an app login as permission to operate a browser.

The browser path is:

1. user signs into Visual Makeover
2. user sees the AI browser notice
3. user grants an origin-scoped capability for 15 minutes
4. Visual Makeover sends an allow-listed `{ tool, args }` request to an owner-controlled bridge
5. that bridge invokes the Opera MCP runtime that already has the user's browser connection
6. Visual Makeover records a receipt

Supported Opera tools exposed by Visual Makeover are deliberately origin-scoped:

- `tab_content`
- `screenshot`
- `go_to_page`

`go_to_page` requires `browser:navigate`; the tab/screenshot tools require `browser:read`. The underlying connector may expose browser-wide `list_tabs` and `history`, but this app blocks them until a separate global-read authority exists.

No password typing, cookie extraction, arbitrary form submission, or silent publishing capability is represented by this contract.

## Why the bridge is external

The connected Opera tool inside an AI host is not a public HTTP API that a standalone website can safely assume exists. `OPERA_BRIDGE_URL` must point to a bridge you control in a runtime that genuinely has Opera MCP authority. Until it is configured, the app reports the adapter as present but the bridge as disconnected and browser calls fail closed.


## Origin proof requirement

Visual Makeover never trusts a caller-supplied tab ID as proof of origin. Every bridge request includes `expectedOrigin`. The owner-controlled bridge must resolve the actual tab/navigation origin inside the browser runtime and return:

```json
{ "origin": "https://example.com", "data": { "...": "tool result" } }
```

Visual Makeover rejects a missing or mismatched origin proof. Browser-wide `list_tabs` and `history` are intentionally blocked by the current origin-scoped grant model. Add a distinct global-read authority class before exposing them.


## Provider authority

Recovery may select a different browser provider, but a route decision cannot expand the user's grant. Browser grants carry an explicit provider allowlist. The default Visual Makeover UI authorizes `opera` only.

If recovery selects `authenticated_browser_bridge` or `generic_browser_automation`, execution is denied with 403 unless the active grant explicitly names that provider. A fallback therefore requires a fresh or separately issued provider grant. All providers remain origin-scoped and limited to `tab_content`, `screenshot`, and same-origin `go_to_page`.
