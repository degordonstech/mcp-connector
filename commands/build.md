---
description: Build the connector: the MCP route, sign-in metadata, consent page, connected apps and middleware exclusion
---

Build the MCP connector agreed in `/mcp-connector:plan`, using the mcp-connector skill. If there is no plan in this conversation yet, run that first.

1. Check the installed versions of next, @supabase/supabase-js, @supabase/ssr and zod, and propose the exact package versions to add before installing anything.
2. Create the files the skill lists, matching this app's own style, folder layout and Supabase client helpers: the MCP route, both metadata routes, the consent page, the connected apps section, and the middleware exclusion.
3. Every tool queries as the signed-in user. Never use the service role key inside a tool.
4. Make sure the login page sends people back to the consent page safely (same-site paths only).
5. Run the project's type check and build.

Then list, as a short checklist, what the person still has to do in the Supabase dashboard and their hosting provider, and how to test it with `/mcp-connector:check` once deployed.
