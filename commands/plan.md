---
description: Read this app and propose the connector's tools, what they return and what they must never expose
---

Plan an MCP connector for this app using the mcp-connector skill. Do not write any code yet.

1. Read the data model, the row level security policies, and the screens users rely on most.
2. Propose a short list of read-only tools that answer the questions users actually ask. For each: its name, what it returns, its inputs, and the sentence that tells the model when to use it.
3. List every field that could expose someone other than the user (customers, counterparties, senders, staff), and say how each tool leaves it out.
4. Note anything that needs care: timezones, currencies, rounding, data that can be incomplete.
5. List the setup the person must do outside the code (Supabase OAuth Server, Site URL, the app URL variable).

End by asking which tools to build.
