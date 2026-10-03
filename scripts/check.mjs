#!/usr/bin/env node
// Checks a deployed MCP connector the way Claude and ChatGPT will meet it.
//
//   node check.mjs https://your-app.com/api/mcp
//   node check.mjs https://your-app.com/api/mcp --token <access token>
//
// Without a token it walks the sign-in discovery: the 401, the protected
// resource metadata, and the authorization server's metadata. With a token
// (copy one from a signed-in session) it also opens a session and lists the
// tools. It only reads. No dependencies: Node 18+.

const args = process.argv.slice(2);
const target = args.find((a) => /^https?:\/\//.test(a));
const ti = args.indexOf('--token');
const token = ti >= 0 ? args[ti + 1] : process.env.MCP_TOKEN;

if (!target) {
  console.error('Usage: node check.mjs https://your-app.com/api/mcp [--token <access token>]');
  process.exit(1);
}

let failures = 0;
let warnings = 0;
const ok = (msg) => console.log(`  ok    ${msg}`);
const warn = (msg) => { warnings++; console.log(`  warn  ${msg}`); };
const fail = (msg) => { failures++; console.log(`  FAIL  ${msg}`); };

async function getJson(url, init) {
  const res = await fetch(url, init);
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { res, json, text };
}

const initialize = {
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'mcp-connector-check', version: '1.0.0' } },
};
const mcpHeaders = { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' };

// Streamable HTTP may answer as JSON or as a short event stream.
function rpcResult(text) {
  try { return JSON.parse(text); } catch { /* event stream */ }
  const data = text.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).filter(Boolean);
  for (const d of data.reverse()) { try { return JSON.parse(d); } catch { /* keep looking */ } }
  return null;
}

// ── 1. the connector asks for sign-in ──────────────────────────────────────

console.log(`\n1. Calling ${target} without a token`);
let metadataUrl = null;
try {
  const res = await fetch(target, { method: 'POST', headers: mcpHeaders, body: JSON.stringify(initialize) });
  const www = res.headers.get('www-authenticate') || '';
  if (res.status === 401) ok('answers 401, so clients know to sign in');
  else if (res.status === 200) fail('answers 200 without a token: anyone can use this connector. Require auth (withMcpAuth with required: true).');
  else if (res.status >= 300 && res.status < 400) fail(`redirects (${res.status}) to ${res.headers.get('location')}. Your middleware is sending the connector to a login page; exclude this path from it.`);
  else if (res.status === 404) fail('answers 404: there is no connector at this address. Check the path and that the route is deployed.');
  else fail(`answers ${res.status}. Expected 401.`);

  const m = www.match(/resource_metadata="([^"]+)"/i);
  if (m) { metadataUrl = m[1]; ok(`WWW-Authenticate points at ${metadataUrl}`); }
  else if (res.status === 401) fail('the 401 has no WWW-Authenticate resource_metadata, so a client cannot find where to sign in.');
} catch (e) {
  fail(`could not reach it: ${e.message}`);
}

// ── 2. protected resource metadata ─────────────────────────────────────────

const u = new URL(target);
const candidates = [
  metadataUrl,
  `${u.origin}/.well-known/oauth-protected-resource${u.pathname}`,
  `${u.origin}/.well-known/oauth-protected-resource`,
].filter(Boolean);

console.log('\n2. Protected resource metadata');
let resourceMeta = null;
for (const url of [...new Set(candidates)]) {
  try {
    const { res, json } = await getJson(url);
    if (res.ok && json) {
      resourceMeta = json;
      ok(`found at ${url}`);
      if (!res.headers.get('access-control-allow-origin')) warn('no CORS header on the metadata. Browser-based clients cannot read it; serve OPTIONS and Access-Control-Allow-Origin.');
      break;
    }
    if (res.status === 307 || res.status === 308 || res.redirected) fail(`${url} redirects. Exclude /.well-known from your middleware.`);
  } catch { /* try the next one */ }
}

const authServers = resourceMeta?.authorization_servers || [];
if (!resourceMeta) {
  fail('no protected resource metadata found. Serve it at /.well-known/oauth-protected-resource and at the path-specific address.');
} else {
  const clean = (s) => String(s || '').replace(/\/+$/, '');
  if (clean(resourceMeta.resource) === clean(target)) ok(`resource is exactly ${target}`);
  else warn(`resource is "${resourceMeta.resource}", not ${target}. Strict clients check these match.`);
  if (authServers.length) ok(`authorization server: ${authServers.join(', ')}`);
  else fail('authorization_servers is empty, so nobody can sign in.');
  if (authServers.some((s) => /localhost|127\.0\.0\.1/.test(s))) fail('the authorization server is on localhost. An environment variable is not set in production.');
}

// ── 3. authorization server metadata ───────────────────────────────────────

console.log('\n3. Authorization server');
for (const issuer of authServers) {
  const iu = new URL(issuer);
  const path = iu.pathname.replace(/\/+$/, '');
  const urls = [
    `${iu.origin}/.well-known/oauth-authorization-server${path}`,
    `${iu.origin}${path}/.well-known/oauth-authorization-server`,
    `${iu.origin}/.well-known/openid-configuration${path}`,
    `${iu.origin}${path}/.well-known/openid-configuration`,
  ];
  let meta = null;
  for (const url of urls) {
    try {
      const { res, json } = await getJson(url);
      if (res.ok && json?.authorization_endpoint) { meta = json; ok(`metadata at ${url}`); break; }
      if (json?.error_code === 'feature_disabled' || /feature_disabled/.test(JSON.stringify(json || ''))) {
        fail('the authorization server says this feature is disabled. In Supabase, turn on Authentication, OAuth Server.');
        break;
      }
    } catch { /* try the next one */ }
  }
  if (!meta) { fail(`no OAuth metadata found for ${issuer}`); continue; }
  if (meta.registration_endpoint) ok('dynamic client registration is on');
  else warn('no registration_endpoint. Claude and ChatGPT register themselves; turn on dynamic client registration, or every user must enter a client id by hand.');
  if ((meta.code_challenge_methods_supported || []).includes('S256')) ok('PKCE with S256 is supported');
  else warn('S256 is not listed in code_challenge_methods_supported.');
  for (const k of ['authorization_endpoint', 'token_endpoint']) {
    if (meta[k]) ok(`${k}: ${meta[k]}`); else fail(`missing ${k}`);
  }
}

// ── 4. with a token: open a session and list the tools ─────────────────────

if (token) {
  console.log('\n4. Signed in');
  const auth = { ...mcpHeaders, Authorization: `Bearer ${token}` };
  try {
    const init = await fetch(target, { method: 'POST', headers: auth, body: JSON.stringify(initialize) });
    const initBody = rpcResult(await init.text());
    if (init.status !== 200 || !initBody?.result) {
      fail(`initialize answered ${init.status}${initBody?.error ? `: ${initBody.error.message}` : ''}. An expired token also does this.`);
    } else {
      const info = initBody.result.serverInfo || {};
      ok(`session opened with ${info.name || 'the server'} ${info.version || ''}`.trim());
      if (!initBody.result.instructions) warn('no server instructions. A few sentences on what the data means and its limits help the model answer correctly.');
      const session = init.headers.get('mcp-session-id');
      const listHeaders = { ...auth, ...(session ? { 'mcp-session-id': session } : {}), 'mcp-protocol-version': initBody.result.protocolVersion || '2025-06-18' };
      await fetch(target, { method: 'POST', headers: listHeaders, body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) });
      const list = await fetch(target, { method: 'POST', headers: listHeaders, body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) });
      const tools = rpcResult(await list.text())?.result?.tools || [];
      if (!tools.length) fail('tools/list returned no tools.');
      for (const t of tools) {
        const notes = [];
        if (!t.description || t.description.length < 40) notes.push('description too short to tell the model when to use it');
        if (!t.annotations || t.annotations.readOnlyHint === undefined) notes.push('no readOnlyHint annotation');
        if (notes.length) warn(`${t.name}: ${notes.join('; ')}`);
        else ok(`${t.name}${t.annotations.readOnlyHint ? ' (read only)' : ' (changes data)'}`);
      }
    }
  } catch (e) {
    fail(`could not open a session: ${e.message}`);
  }
} else {
  console.log('\n4. Skipped the tool check: pass --token with an access token from a signed-in session to list the tools.');
}

console.log(`\n${failures ? `${failures} problem(s)` : 'No problems'}${warnings ? `, ${warnings} warning(s)` : ''}.`);
process.exit(failures ? 1 : 0);
