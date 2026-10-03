---
description: Test a deployed connector the way Claude and ChatGPT will meet it
---

Check the deployed MCP connector using the mcp-connector skill.

1. Ask for the connector address if you do not have it (the app's address followed by /api/mcp).
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs <address>`.
3. To sign in and try the tools, tell me to run `npx @modelcontextprotocol/inspector` myself and point it at the address.
4. For each failure or warning, use the skill's "When it will not connect" table to name the likely cause and the fix in this codebase.
