# mcp-connector

A Claude Code plugin that turns your Next.js and Supabase app into a connector for Claude, ChatGPT and other AI apps.

Your users add your app as a connector, sign in with their own account, and ask about their own data in plain words: "how much did I make this week?", "which orders are still unpaid?". The AI calls tools on your server, and your server answers with that user's data and nothing else.

I built this for P2Proof, a profit tracker for crypto traders, and it took a lot of small discoveries to get right: middleware that sent the AI app to a login page, a metadata route that broke the build, a sign-in that landed on localhost, and a tool that quietly returned other traders' real names. This plugin is everything I learned, so your connector works the first time.

## What it does

- **Plans the tools** from your data model: read only first, answering the questions users really ask, and never exposing anyone but the user.
- **Builds the connector:** a Streamable HTTP endpoint with `mcp-handler`, sign-in through the Supabase OAuth server with dynamic client registration, the protected resource metadata, a consent screen, and a settings section to see and revoke connected apps.
- **Runs every query as the user**, so your existing row level security protects the connector exactly like your dashboard. No service role key in any tool, no tokens stored by you.
- **Tests the deployed connector** the way Claude and ChatGPT meet it: the 401, both metadata documents and dynamic registration. It never handles a token; the MCP Inspector covers sign-in and the tools.

## Install

```
/plugin marketplace add degordonstech/mcp-connector
/plugin install mcp-connector@mcp-connector
```

## Using it

- `/mcp-connector:plan` reads your app and proposes the tools, what they return, and what they must never expose.
- `/mcp-connector:build` creates the route, metadata, consent page, connected apps and middleware exclusion, in your app's own style.
- `/mcp-connector:check` tests the live connector and explains any failure.

The skill also switches on by itself when you say something like "I want users to connect my app to Claude".

The checker is one file with no dependencies. You can run it yourself:

```
node scripts/check.mjs https://<your-app>/api/mcp
```

## Requirements

Next.js with the App Router, Supabase Auth, and Node.js 18 or newer for the checker. The principles (read only first, run as the user, protect other people's data) apply to any stack.

## License

MIT
