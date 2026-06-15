import { beforeEach, describe, expect, it, vi } from 'vitest';

// db.ts builds a pg Pool and requires DATABASE_URL at import time; stub both so
// the module loads and every query goes through a spy we can assert against.
const { query } = vi.hoisted(() => ({ query: vi.fn() }));
vi.hoisted(() => {
  process.env.DATABASE_URL = 'postgres://test/test';
});
vi.mock('pg', () => ({
  Pool: function Pool() {
    return { query };
  },
}));

import { createAccount, deleteCharacter, openPlaySession, touchLogin } from '../server/db';
import { REALM } from '../server/realm';

beforeEach(() => {
  query.mockReset();
});

describe('deleteCharacter', () => {
  it('scopes the delete to the current realm so cross-realm characters are safe', async () => {
    query.mockResolvedValueOnce({ rowCount: 1 } as any);

    await deleteCharacter(7, 42);

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/realm/i);
    expect(params).toContain(REALM);
    // id + account + realm — the same three predicates getCharacter/renameCharacter use
    expect(params).toEqual(expect.arrayContaining([42, 7, REALM]));
  });

  it('reports whether a row was actually deleted', async () => {
    query.mockResolvedValueOnce({ rowCount: 0 } as any);
    expect(await deleteCharacter(7, 42)).toBe(false);

    query.mockResolvedValueOnce({ rowCount: 1 } as any);
    expect(await deleteCharacter(7, 42)).toBe(true);
  });
});

describe('account and session request metadata', () => {
  it('stores account creation IP and user agent when registering', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 7, username: 'alice', password_hash: 'hash' }] } as any);

    await createAccount('alice', 'hash', { ip: '203.0.113.4', userAgent: 'Mozilla/5.0' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/created_ip/);
    expect(sql).toMatch(/created_user_agent/);
    expect(params).toEqual(['alice', 'hash', '203.0.113.4', 'Mozilla/5.0']);
  });

  it('updates last login IP and user agent when logging in', async () => {
    query.mockResolvedValueOnce({ rows: [] } as any);

    await touchLogin(7, { ip: '203.0.113.5', userAgent: 'Mozilla/5.0' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/last_login_ip/);
    expect(sql).toMatch(/last_login_user_agent/);
    expect(params).toEqual([7, '203.0.113.5', 'Mozilla/5.0']);
  });

  it('stores play session IP and user agent when entering the world', async () => {
    query.mockResolvedValueOnce({ rows: [{ id: 99 }] } as any);

    await openPlaySession(7, 42, 'Alice', { ip: '203.0.113.6', userAgent: 'Mozilla/5.0' });

    const [sql, params] = query.mock.calls[0];
    expect(sql).toMatch(/ip_address/);
    expect(sql).toMatch(/user_agent/);
    expect(params).toEqual([7, 42, 'Alice', '203.0.113.6', 'Mozilla/5.0']);
  });
});
