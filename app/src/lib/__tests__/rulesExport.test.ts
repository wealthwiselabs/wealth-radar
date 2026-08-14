import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { promises as fs } from 'fs';
import fsSync from 'fs';
import os from 'os';
import path from 'path';
import { makeTmpDb } from '@/test/tmpDb';
import * as dbClient from '@/db/client';
import { createRule, exportRules } from '@/lib/storage';

describe('exportRules', () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  // exportRules() only writes when its `db` param is recognized as the real
  // production db by isProductionDb() (see storage.ts and db/client.ts) —
  // that's what stops tests and scripts from clobbering the real
  // data/preferences.json. isProductionDb checks identity against the
  // memoized getDb() singleton without ever calling getDb() itself, so to
  // genuinely exercise the write path here (not just prove the guard skips
  // it) we stub isProductionDb directly, making this test's temp handle
  // count as "the real db" without touching the production db machinery at
  // all.
  function makeIdentifiedTmpDb() {
    const tmp = makeTmpDb();
    vi.spyOn(dbClient, 'isProductionDb').mockReturnValue(true);
    return tmp;
  }

  it('writes the enabled and disabled rules as a JSON array', async () => {
    const { db } = makeIdentifiedTmpDb();
    const written: string[] = [];
    vi.spyOn(fs, 'writeFile').mockImplementation(async (_p, data) => {
      written.push(String(data));
    });

    await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);
    await createRule({ pattern: 'aplpay', categoryId: 'shopping', subcategoryId: 'clothing', enabled: false }, db);
    await exportRules(db);

    const parsed = JSON.parse(written[written.length - 1]) as Array<Record<string, unknown>>;
    expect(parsed).toEqual(
      expect.arrayContaining([
        { pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books', enabled: true },
        { pattern: 'aplpay', categoryId: 'shopping', subcategoryId: 'clothing', enabled: false },
      ]),
    );
  });

  it('does not throw when the file cannot be written', async () => {
    const { db } = makeIdentifiedTmpDb();
    vi.spyOn(fs, 'writeFile').mockRejectedValue(new Error('EACCES'));
    await expect(exportRules(db)).resolves.toBeUndefined();
  });

  describe('destination path', () => {
    const originalDatabaseUrl = process.env.DATABASE_URL;
    let scratchDir: string;

    beforeEach(() => {
      scratchDir = fsSync.mkdtempSync(path.join(os.tmpdir(), 'rules-export-'));
    });

    afterEach(() => {
      if (originalDatabaseUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = originalDatabaseUrl;
      fsSync.rmSync(scratchDir, { recursive: true, force: true });
    });

    // The whole point of this fix: exportRules must write next to whatever
    // database DATABASE_URL points at, not next to the repo's own data/ dir
    // (module-level DATA_DIR) — otherwise a server pointed elsewhere still
    // clobbers the real data/preferences.json. Point DATABASE_URL at a
    // scratch directory and assert the write lands there instead of in the
    // repo's data/ directory.
    it('follows DATABASE_URL rather than the repo data directory', async () => {
      const { db } = makeIdentifiedTmpDb();
      process.env.DATABASE_URL = `file:${path.join(scratchDir, 'somewhere.db')}`;

      const written: string[] = [];
      vi.spyOn(fs, 'writeFile').mockImplementation(async (p, data) => {
        written.push(String(p));
        return undefined;
      });

      await createRule({ pattern: 'kindle svcs', categoryId: 'education', subcategoryId: 'books' }, db);

      expect(written).toHaveLength(1);
      const writtenPath = written[0];
      expect(path.dirname(writtenPath)).toBe(scratchDir);
      expect(writtenPath).not.toContain(path.join(process.cwd(), 'data'));
    });
  });
});
