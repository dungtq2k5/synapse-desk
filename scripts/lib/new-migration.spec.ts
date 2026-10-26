import { join } from 'node:path';
import { hasChanges, migrationFolder } from './new-migration.cjs';

const NOW = new Date('2026-10-26T10:30:00Z');
const CWD = '/repo/services/notification-service';

/** Long enough that a backtracking pattern takes seconds; a linear one, none. */
const LONG = 100_000;

function elapsedMs(run: () => unknown): number {
  const start = performance.now();
  run();
  return performance.now() - start;
}

describe('new-migration', () => {
  describe('migrationFolder', () => {
    it('puts a snake_case name in a stamped folder under prisma/migrations', () => {
      expect(migrationFolder('add_widget_color', NOW, CWD)).toBe(
        join(CWD, 'prisma/migrations/20261026103000_add_widget_color'),
      );
    });

    it.each([['../x'], ['a/b'], ['a\\b'], [''], [undefined], ['Add_widget']])(
      '**refuses %p** before anything is written',
      (name) => {
        expect(() => migrationFolder(name, NOW, CWD)).toThrow('snake_case');
      },
    );
  });

  describe('hasChanges', () => {
    it('is true for a diff with a statement, indented or not', () => {
      expect(
        hasChanges('-- AlterTable\nALTER TABLE "a" ADD COLUMN "b" TEXT;'),
      ).toBe(true);
      expect(hasChanges('\n\t  CREATE INDEX "i" ON "a"("b");')).toBe(true);
    });

    it('is false for an empty diff', () => {
      expect(hasChanges('-- This is an empty migration.\n')).toBe(false);
    });

    it('**finishes at once on a long run of blank lines**', () => {
      const blank = '\n'.repeat(LONG);
      expect(elapsedMs(() => hasChanges(blank))).toBeLessThan(500);
    });
  });
});
