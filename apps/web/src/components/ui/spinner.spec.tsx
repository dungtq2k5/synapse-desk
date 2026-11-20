import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render } from '@testing-library/react';
import { Spinner } from './spinner';

const SRC = join(__dirname, '../..');

/** Every source file under src, as its path from src. */
const sources = (dir: string = SRC): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)
      ? [relative(SRC, path)]
      : [];
  });

describe('Spinner', () => {
  it('turns unless the viewer asks for reduced motion, and is hidden from readers', () => {
    const { container } = render(<Spinner className="size-4" />);
    const svg = container.querySelector('svg');

    expect(svg).toHaveClass('motion-safe:animate-spin', 'size-4');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('is the only spinner: no loader icon or spin class anywhere else', () => {
    const offenders = sources().filter((path) => {
      if (path === join('components', 'ui', 'spinner.tsx')) return false;
      const text = readFileSync(join(SRC, path), 'utf8');
      return /\b(LoaderCircleIcon|Loader2Icon|LoaderIcon)\b|animate-spin/.test(
        text,
      );
    });

    expect(sources().length).toBeGreaterThan(100);
    expect(offenders).toEqual([]);
  });
});
