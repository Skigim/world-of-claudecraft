// Read-only scoped-token guarantees. The behavioral 403 promise is enforced at a
// single choke point — bearerActiveAccount rejects scope!=='full' — so this suite
// proves (a) the scope policy itself, (b) every mutating route funnels through
// that choke point (a source scan that "loops the list"), and (c) the migration
// is additive with old tokens reading 'full'. main.ts cannot be imported (it
// boots a server + connects to Postgres on import), so the route coverage is
// verified structurally rather than over a live socket.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';

// db.ts builds a pg Pool at import; give it a dummy URL (no connection is made
// until a query runs, and these tests never query).
process.env.DATABASE_URL ||= 'postgres://test:test@localhost:5432/test';

const { scopeAllowsMutation, scopeAllowsRead, SCHEMA } = await import('../server/db');

const MAIN = readFileSync(join(__dirname, '..', 'server', 'main.ts'), 'utf8');

describe('token scope policy', () => {
  it('only a full token may mutate', () => {
    expect(scopeAllowsMutation('full')).toBe(true);
    expect(scopeAllowsMutation('read')).toBe(false);
  });
  it('both read and full may read', () => {
    expect(scopeAllowsRead('full')).toBe(true);
    expect(scopeAllowsRead('read')).toBe(true);
  });
});

describe('migration is additive; old tokens read full', () => {
  it('adds the scope and label columns to auth_tokens', () => {
    expect(SCHEMA).toMatch(/ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS scope TEXT NOT NULL DEFAULT 'full'/);
    expect(SCHEMA).toMatch(/ALTER TABLE auth_tokens ADD COLUMN IF NOT EXISTS label TEXT/);
  });
  it("defaults scope to 'full' so pre-existing sessions keep full power", () => {
    // The DEFAULT 'full' on the additive column is what makes every token that
    // predates the scope column read back as a full session.
    expect(SCHEMA).toContain("scope TEXT NOT NULL DEFAULT 'full'");
  });
});

describe('every mutating / owner-action route funnels through bearerActiveAccount', () => {
  // The reference "loop the list": each of these route handlers must gate on
  // bearerActiveAccount (which rejects read tokens), never on the read/optional
  // helpers. Anchored on the route guard literal in main.ts.
  const MUTATING_ROUTE_ANCHORS = [
    "if (url === '/api/characters') {",          // POST create (and GET list)
    'if (req.method === \'POST\' && renameMatch) {',
    'if (req.method === \'POST\' && takeoverMatch) {',
    'if (req.method === \'DELETE\' && delMatch) {',
    'if (req.method === \'GET\' && standingMatch) {', // owner-scoped read
    "if (req.method === 'POST' && url === '/api/reports') {",
    "if (req.method === 'POST' && url === '/api/bug-reports') {",
    "if (url === '/api/account/companion-token') {",
    "if (req.method === 'POST' && url === '/api/account/password') {",
    "if (req.method === 'POST' && url === '/api/account/email') {",
    "if (req.method === 'POST' && url === '/api/account/deactivate') {",
    "if (req.method === 'POST' && url === '/api/wallet/link/challenge') {",
    "if (req.method === 'POST' && url === '/api/wallet/link') {",
    "if (req.method === 'DELETE' && url === '/api/wallet/link') {",
    "if (req.method === 'GET' && url === '/api/wallet') {",
    "if (req.method === 'POST' && url === '/api/card') {",
    "if (req.method === 'GET' && url === '/api/referrals') {",
  ];

  for (const anchor of MUTATING_ROUTE_ANCHORS) {
    it(`gates: ${anchor}`, () => {
      const idx = MAIN.indexOf(anchor);
      expect(idx, `anchor not found: ${anchor}`).toBeGreaterThanOrEqual(0);
      // The bearerActiveAccount call is always within the first few lines of the
      // handler block. Scan a generous window after the anchor.
      const window = MAIN.slice(idx, idx + 600);
      expect(window).toContain('bearerActiveAccount(req, res)');
    });
  }
});

describe('sheet routes use the right gate', () => {
  it('owner /sheet accepts read tokens via bearerReadAccount', () => {
    const idx = MAIN.indexOf("const ownerSheetMatch = /^\\/api\\/characters\\/(\\d+)\\/sheet$/");
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(MAIN.slice(idx, idx + 600)).toContain('bearerReadAccount(req, res)');
  });

  it('public /sheet requires no auth and is rate-limited', () => {
    const idx = MAIN.indexOf('const publicSheetMatch =');
    expect(idx).toBeGreaterThanOrEqual(0);
    const block = MAIN.slice(idx, idx + 700);
    expect(block).toContain('publicReadRateLimited(req)');
    expect(block).not.toContain('bearerActiveAccount');
    expect(block).not.toContain('bearerReadAccount');
  });

  it('bearerReadAccount is used by exactly one route (owner /sheet)', () => {
    const count = (MAIN.match(/bearerReadAccount\(req, res\)/g) ?? []).length;
    expect(count).toBe(1);
  });
});

describe('CORS opens only the public read surfaces', () => {
  it('routes public read paths through wide-open CORS, others through the narrow allowlist', () => {
    expect(MAIN).toContain('isPublicCorsPath(path)');
    expect(MAIN).toContain('publicCors(res)');
    // The * is set only in publicCors, not maybeCors.
    const publicCorsIdx = MAIN.indexOf('function publicCors');
    expect(MAIN.slice(publicCorsIdx, publicCorsIdx + 300)).toContain("'Access-Control-Allow-Origin', '*'");
  });
});
