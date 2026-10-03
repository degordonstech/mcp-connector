---
name: mcp-connector
description: Turn a Next.js app that uses Supabase into a remote MCP connector that Claude, ChatGPT and other AI apps can sign in to, so a user can ask about their own data in plain words. Covers choosing safe tools, the Streamable HTTP endpoint with mcp-handler, OAuth 2.1 sign-in through the Supabase OAuth server with dynamic client registration, the protected resource metadata, the consent screen, listing and revoking connected apps, running every query as the user under row level security, and testing the deployed connector. Use whenever someone wants to build an MCP server or connector for their app, let users connect their account to Claude or ChatGPT, add "Sign in with" OAuth for an AI client, or is debugging a connector that will not connect, keeps asking to sign in, returns 401, or redirects to a login page.
---

# Your app as a connector for Claude and ChatGPT

A connector lets a user add your app inside Claude or ChatGPT, sign in with their own account, and ask questions like "how much did I make this week?". The AI calls tools on your server, and your server answers with that user's data and nothing else.

This skill builds it on Next.js (App Router) with Supabase, the way it was built for a live product: read only first, every query as the signed-in user, no new user table, no tokens stored by you.

## How it fits together

1. The AI app calls `https://your-app.com/api/mcp` with no token and gets a **401**. Its `WWW-Authenticate` header points at your **protected resource metadata**.
2. That metadata names your **Supabase project** as the authorization server. The AI app reads Supabase's discovery document and **registers itself** (dynamic client registration).
3. The user is sent to Supabase, which sends them to **your consent page**. If they are signed out, your login page brings them back to it.
4. They tap Allow. Supabase returns them to the AI app with a code, which it swaps for tokens.
5. Every call to `/api/mcp` now carries the user's access token. Your route asks Supabase whether it is valid, and runs every query **as that user**, so row level security applies exactly as in your dashboard.

## Plan the tools before writing code

Read the app's data model and its row level security first. Then propose the tool list and agree it with the person before building.

- **Start read only.** A connector that can only read cannot be talked into deleting anything. Add write tools later, one at a time, each with its own confirmation in the description.
- **Answer the questions users really ask**, not one tool per table. "Profit for a period" beats "list orders, then add them up".
- **Only the user's own data.** Look hard at every field returned. Names, phone numbers and emails of *other* people often hide in a user's records (a counterparty, a customer, a sender). Leave them out, including nicknames, which people often set to their real name.
- **Round numbers before returning them.** Money to 2 decimals. A model will happily repeat `72.40000000000055`.
- **Use the user's day.** "Today" should mean today in the user's timezone, not the server's.
- **Never add different currencies or units together.** Return them separately.
- **Say when data is incomplete** ("3 sells have no cost price yet") instead of returning a confident wrong total.
- **Write descriptions for the model:** what the tool returns, and when to use it ("Use for 'how much did I make today / this week'"). Mark read-only tools with `annotations: { readOnlyHint: true }`.
- **Give the server instructions:** a few sentences on what the data means and its limits.

## Setup outside the code

In the Supabase dashboard for the project:

- **Authentication, OAuth Server:** turn it on, turn on **dynamic client registration**, and set the **authorization path** to the consent page, for example `/oauth/consent`.
- **Authentication, URL Configuration:** the **Site URL** must be the live address. The consent path is joined to it, so a localhost Site URL sends real users to localhost.

In the hosting provider, the app's public URL variable (for example `NEXT_PUBLIC_APP_URL`) must be the live address, or anything that shows the connector address will show localhost.

## Packages

```
npm install mcp-handler @modelcontextprotocol/sdk zod
```

Pin exact versions that work together and check them before upgrading: `mcp-handler` 1.x works with the SDK's 1.x line and zod 3; `mcp-handler` 2.x needs the SDK's version 2. Avoid old SDK releases with published security advisories (`npm audit` will say). `@supabase/supabase-js` must be new enough to have `supabase.auth.oauth` (2.117 is known to work).

## The files

### 1. The connector: `app/api/mcp/route.ts`

```ts
import { createMcpHandler, withMcpAuth } from 'mcp-handler';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// A Supabase client that acts as the signed-in user, so row level security
// applies to every query. Never use the service role key in a tool.
function userClient(token: string) {
  return createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
    global: {
      headers: { Authorization: `Bearer ${token}` },
      fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }),
    },
  });
}

function session(extra: { authInfo?: AuthInfo }) {
  const token = extra.authInfo?.token;
  const userId = extra.authInfo?.extra?.userId as string | undefined;
  if (!token || !userId) throw new Error('Not signed in.');
  return { db: userClient(token), userId };
}

const handler = createMcpHandler(
  (server) => {
    server.registerTool(
      'get_orders',
      {
        title: 'Orders',
        description: 'The user\'s orders for a period, newest first, with totals. Use for "what did I sell this week".',
        inputSchema: { days: z.number().int().min(1).max(90).optional().describe('How many days back. Default 7.') },
        annotations: { readOnlyHint: true },
      },
      async ({ days }, extra) => {
        const { db, userId } = session(extra as { authInfo?: AuthInfo });
        const since = new Date(Date.now() - (days ?? 7) * 86400000).toISOString();
        const { data, error } = await db.from('orders').select('id, total, created_at').eq('user_id', userId).gte('created_at', since);
        if (error) return { content: [{ type: 'text', text: 'Could not load orders.' }], isError: true };
        return { content: [{ type: 'text', text: JSON.stringify(data) }] };
      }
    );
  },
  {
    serverInfo: { name: 'Your App', version: '1.0.0' },
    instructions: 'What the data is, what the amounts mean, and what never to assume.',
  },
  { streamableHttpEndpoint: '/api/mcp', disableSse: true, maxDuration: 60 }
);

// Supabase checks every token, so an expired or forged one never reaches a tool.
async function verifyToken(_req: Request, bearerToken?: string): Promise<AuthInfo | undefined> {
  if (!bearerToken) return undefined;
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await supabase.auth.getUser(bearerToken);
  if (error || !data.user) return undefined;
  let clientId = 'unknown';
  try {
    const payload = JSON.parse(Buffer.from(bearerToken.split('.')[1] ?? '', 'base64url').toString('utf8'));
    if (typeof payload.client_id === 'string') clientId = payload.client_id;
  } catch { /* Supabase already accepted it */ }
  return { token: bearerToken, clientId, scopes: [], extra: { userId: data.user.id } };
}

const authHandler = withMcpAuth(handler, verifyToken, {
  required: true,
  resourceMetadataPath: '/.well-known/oauth-protected-resource/api/mcp',
});

export { authHandler as GET, authHandler as POST, authHandler as DELETE };
```

### 2. Where to sign in: two metadata routes

`app/.well-known/oauth-protected-resource/route.ts`, and the same file again at `app/.well-known/oauth-protected-resource/[...path]/route.ts` (the path-specific address strict clients use):

```ts
import { metadataCorsOptionsRequestHandler, protectedResourceHandler } from 'mcp-handler';

export const dynamic = 'force-dynamic';

const handler = protectedResourceHandler({
  authServerUrls: [`${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1`],
});
const options = metadataCorsOptionsRequestHandler();

export { handler as GET, options as OPTIONS };
```

Write both files in full. Re-exporting `dynamic` or the handlers from one route file into another fails the Next.js build.

### 3. The consent page: `app/oauth/consent/page.tsx`

A client component that:

1. Reads `authorization_id` from the query string.
2. If nobody is signed in, sends them to `/login?next=` with the full consent URL (including `authorization_id`), so they land back here.
3. Calls `supabase.auth.oauth.getAuthorizationDetails(authorizationId)`. If the result has `redirect_url`, the user approved this app before: go straight there. Otherwise show the app's name (`data.client.name`), the signed-in email, **what it will be able to see**, and **what it will never be able to do**.
4. On Allow or Deny, calls `supabase.auth.oauth.approveAuthorization(id, { skipBrowserRedirect: true })` or `denyAuthorization(...)` and sends the browser to the returned `redirect_url`.

The login page's `next` parameter must only accept a path on the same site (starts with `/`, not `//`, no backslashes or spaces). Otherwise this flow becomes an open redirect.

### 4. Connected apps in settings

Show the connector address so users can copy it, list what they connected with `supabase.auth.oauth.listGrants()` (each has `client.id`, `client.name`, `granted_at`), and disconnect with `supabase.auth.oauth.revokeGrant({ clientId })`.

### 5. Keep middleware away

Auth middleware that redirects signed-out visitors to `/login` will also redirect the AI app, which then receives an HTML page instead of a 401. Exclude both paths from the matcher:

```ts
export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|api/mcp|\\.well-known).*)'],
};
```

## Testing

1. **Discovery:** `node ${CLAUDE_PLUGIN_ROOT}/scripts/check.mjs https://your-app.com/api/mcp` walks the 401, both metadata documents and dynamic registration the way a client does. With `--token <access token>` it also opens a session and lists the tools.
2. **The full sign-in:** `npx @modelcontextprotocol/inspector`, pointed at the connector address.
3. **The real thing:** add the address as a custom connector in Claude or ChatGPT, sign in, and ask the questions users will ask.

## When it will not connect

| Symptom | Usual cause |
|---|---|
| The AI app gets a login page, or a redirect | Middleware is catching `/api/mcp` or `/.well-known` |
| "feature_disabled" from Supabase | The OAuth server is off in Authentication settings |
| Sign-in lands on localhost | Site URL in Supabase, or the app URL variable, still points at localhost |
| Asks to sign in again and again | `verifyToken` returns nothing: wrong project URL or key, or the token is checked against a different project |
| Connected, but tools return nothing | Queries run as the user and row level security hides the rows, or the tool filters on the wrong user id |
| Build fails on a metadata route | One route file re-exports from another; write each in full |
| TypeScript errors in cookie code after upgrading supabase-js | An older `@supabase/ssr` needs the cookie callback typed: `setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[])` |

## Before launch

- Every tool runs as the user, never with the service role key.
- No tool returns other people's personal details.
- Read-only tools are marked read only; any write tool says exactly what it changes.
- The consent page lists what the app can and cannot do.
- Users can see and revoke connected apps.
- `check.mjs` passes against the live address.
