// Yahoo OAuth2 (3-legged). Access tokens live 1 hour; refresh tokens are
// long-lived, so after one interactive login this runs unattended.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN_FILE = path.join(ROOT, 'state', 'tokens.json');

const AUTH_URL = 'https://api.login.yahoo.com/oauth2/request_auth';
const TOKEN_URL = 'https://api.login.yahoo.com/oauth2/get_token';

export function loadEnv() {
  const envPath = path.join(ROOT, '.env');
  if (fs.existsSync(envPath)) {
    for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
  const id = process.env.YAHOO_CLIENT_ID;
  const secret = process.env.YAHOO_CLIENT_SECRET;
  const redirect = process.env.YAHOO_REDIRECT_URI || 'https://localhost:8080/callback';
  if (!id || !secret) {
    throw new Error(
      'Missing YAHOO_CLIENT_ID / YAHOO_CLIENT_SECRET.\n' +
      'Copy .env.example to .env and fill in your Yahoo app credentials.'
    );
  }
  return { id, secret, redirect };
}

export function authorizeUrl() {
  const { id, redirect } = loadEnv();
  const q = new URLSearchParams({
    client_id: id,
    redirect_uri: redirect,
    response_type: 'code',
    language: 'en-us',
  });
  return `${AUTH_URL}?${q}`;
}

function readTokens() {
  if (!fs.existsSync(TOKEN_FILE)) return null;
  try { return JSON.parse(fs.readFileSync(TOKEN_FILE, 'utf8')); } catch { return null; }
}

function writeTokens(t) {
  fs.mkdirSync(path.dirname(TOKEN_FILE), { recursive: true });
  fs.writeFileSync(TOKEN_FILE, JSON.stringify(t, null, 2));
  // Tokens are credentials - keep them off other accounts on this machine.
  try { fs.chmodSync(TOKEN_FILE, 0o600); } catch { /* best effort on Windows */ }
}

async function tokenRequest(body) {
  const { id, secret } = loadEnv();
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${id}:${secret}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Yahoo token request failed (${res.status}): ${text}`);
  const json = JSON.parse(text);
  const tokens = {
    access_token: json.access_token,
    refresh_token: json.refresh_token,
    // Refresh a minute early so a request never races the expiry.
    expires_at: Date.now() + (json.expires_in - 60) * 1000,
    obtained_at: new Date().toISOString(),
  };
  writeTokens(tokens);
  return tokens;
}

/** Exchange the ?code= from the redirect for a token pair. */
export async function exchangeCode(codeOrUrl) {
  const { redirect } = loadEnv();
  let code = codeOrUrl.trim();
  // Accept either the bare code or the whole URL Yahoo redirected to.
  if (code.includes('?') || code.startsWith('http')) {
    try { code = new URL(code).searchParams.get('code') || code; } catch { /* leave as-is */ }
  }
  if (!code) throw new Error('No authorization code found in that input.');
  return tokenRequest({
    grant_type: 'authorization_code',
    redirect_uri: redirect,
    code,
  });
}

/** Valid access token, refreshing transparently when stale. */
export async function accessToken() {
  const t = readTokens();
  if (!t) throw new Error('Not authenticated. Run:  npm run login');
  if (Date.now() < t.expires_at) return t.access_token;
  const fresh = await tokenRequest({
    grant_type: 'refresh_token',
    redirect_uri: loadEnv().redirect,
    refresh_token: t.refresh_token,
  });
  return fresh.access_token;
}

export function isAuthenticated() { return readTokens() !== null; }
export { ROOT };
