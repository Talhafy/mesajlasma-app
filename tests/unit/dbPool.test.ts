import { describe, expect, it } from 'vitest';
import { dbPoolConnectionTimeoutMs, dbPoolIdleTimeoutMs, dbPoolMax, dbStatementTimeoutMs } from '../../src/config/env';
import { closeDatabasePool, pool } from '../../src/db';

describe('PostgreSQL Connection Pool & Timeout unit tests', () => {
  it('should export valid pool configuration defaults from env', () => {
    expect(dbPoolMax).toBeGreaterThanOrEqual(2);
    expect(dbPoolMax).toBeLessThanOrEqual(100);

    expect(dbPoolIdleTimeoutMs).toBeGreaterThanOrEqual(1_000);
    expect(dbPoolConnectionTimeoutMs).toBeGreaterThanOrEqual(500);
    expect(dbStatementTimeoutMs).toBeGreaterThanOrEqual(1_000);
  });

  it('should configure pg Pool instance with options', () => {
    expect(pool).toBeDefined();
    expect(pool.options.max).toBe(dbPoolMax);
    expect(pool.options.idleTimeoutMillis).toBe(dbPoolIdleTimeoutMs);
    expect(pool.options.connectionTimeoutMillis).toBe(dbPoolConnectionTimeoutMs);
    expect(pool.options.statement_timeout).toBe(dbStatementTimeoutMs);
  });

  it('should support closeDatabasePool helper', async () => {
    expect(typeof closeDatabasePool).toBe('function');
  });
});
