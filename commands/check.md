---
description: Test a deployed connector the way Claude and ChatGPT will meet it
---

Check the deployed MCP connector using the mcp-connector skill.

1. Ask for the connector address if you do not have it (for example https://your-app.com/api/mcp).
2. Run `node ${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs <address>`. If I give you an access token, add `--token <token>` to also list the tools, and never print the token back.
3. For each failure or warning, use the skill's "When it will not connect" table to name the likely cause and the fix in this codebase.
