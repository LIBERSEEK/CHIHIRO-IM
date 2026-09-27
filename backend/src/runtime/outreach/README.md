# Outreach runtime

`outreach` is the internal domain name for the product feature shown as “营销获客”.

## Boundaries

- `service.mjs`: account and task lifecycle orchestration.
- `accounts/`: account identifiers and platform profile normalization.
- `browser/`: Chrome discovery and task preview.
- `campaign/`: briefs, prompts, model calls, settings, and learned targeting terms.
- `core/`: platform independent targeting and shared execution rules.
- `platforms/`: platform adapters for discovery, login, and engagement actions.

Platform adapters may depend on `campaign/` and `core/`. Platform adapters must not
import another platform adapter. New platforms are registered in `platforms/index.mjs`.

The public surface uses `/api/runtime/outreach/*`, `outreach_*` MCP tools,
`outreach-*` session prefixes, the `outreach` snapshot field, and `data/outreach`.
