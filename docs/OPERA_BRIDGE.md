# Opera MCP bridge boundary

Visual Makeover does not treat an app login as permission to operate a browser.

The browser path is:

1. user signs into Visual Makeover
2. user sees the AI browser notice
3. user grants an origin-scoped capability for 15 minutes
4. Visual Makeover sends an allow-listed `{ tool, args }` request to an owner-controlled bridge
5. that bridge invokes the Opera MCP runtime that already has the user's browser connection
6. Visual Makeover records a receipt

Supported Opera tools are deliberately limited to the connector capabilities proven by the integration:

- `list_tabs`
- `history`
- `tab_content`
- `screenshot`
- `go_to_page`

`go_to_page` requires `browser:navigate`; the read tools require `browser:read`.

No password typing, cookie extraction, arbitrary form submission, or silent publishing capability is represented by this contract.

## Why the bridge is external

The connected Opera tool inside an AI host is not a public HTTP API that a standalone website can safely assume exists. `OPERA_BRIDGE_URL` must point to a bridge you control in a runtime that genuinely has Opera MCP authority. Until it is configured, the app reports the adapter as present but the bridge as disconnected and browser calls fail closed.
