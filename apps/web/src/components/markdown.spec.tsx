import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { render, screen } from '@testing-library/react';
import { Markdown } from './markdown';

const SRC = join(__dirname, '..');

/** Every source file under src, as its path from src. */
const sources = (dir: string = SRC): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sources(path);
    return /\.tsx?$/.test(entry.name) && !/\.spec\.tsx?$/.test(entry.name)
      ? [relative(SRC, path)]
      : [];
  });

describe('Markdown', () => {
  it('renders what agents write: emphasis, lists, code and links', () => {
    const { container } = render(
      <Markdown>
        {
          '# Steps\n\nClaim **€450**, then:\n\n1. Send the `receipt`\n2. Read [the policy](https://example.com/policy)'
        }
      </Markdown>,
    );

    expect(screen.getByText('Steps').tagName).toBe('P');
    expect(screen.getByText('€450').tagName).toBe('STRONG');
    expect(container.querySelectorAll('ol > li')).toHaveLength(2);
    expect(screen.getByText('receipt').tagName).toBe('CODE');
    const link = screen.getByRole('link', { name: 'the policy' });
    expect(link).toHaveAttribute('href', 'https://example.com/policy');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  /**
   * The guard: no raw HTML. A message's HTML shows as the text it is, and
   * adds no element and no attribute, whatever it tries.
   */
  it.each([
    ['<script>alert(1)</script>', 'script'],
    ['<img src="x" onerror="alert(1)">', 'img'],
    ['<iframe src="https://example.com"></iframe>', 'iframe'],
    ['Hi <b onmouseover="alert(1)">there</b>', 'b'],
    ['<div>\n\n**inside**\n\n</div>', 'div div'],
  ])('shows %s as text, never as HTML', (source, selector) => {
    const { container } = render(<Markdown>{source}</Markdown>);
    const rendered = container.firstElementChild!;

    expect(rendered.querySelector(selector)).toBeNull();
    expect(rendered.querySelector('[onerror], [onmouseover]')).toBeNull();
    expect(rendered.textContent).toContain(source.split('\n')[0]);
  });

  it.each([
    ['[click](javascript:alert(1))', 'click'],
    ['[data](data:text/html;base64,PHNjcmlwdD4=)', 'data'],
    ['[file](file:///etc/passwd)', 'file'],
  ])('makes %s no link, only its text', (source, text) => {
    render(<Markdown>{source}</Markdown>);

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText(text)).toBeInTheDocument();
  });

  it('makes a mailto address a link', () => {
    render(<Markdown>{'[Write to us](mailto:help@example.com)'}</Markdown>);

    expect(screen.getByRole('link', { name: 'Write to us' })).toHaveAttribute(
      'href',
      'mailto:help@example.com',
    );
  });

  it('shows an image as its alt text, never loading it', () => {
    const { container } = render(
      <Markdown>{'![tracking pixel](https://example.com/p.gif)'}</Markdown>,
    );

    expect(container.querySelector('img')).toBeNull();
    expect(screen.getByText('tracking pixel')).toBeInTheDocument();
  });

  it('is the only way Markdown or HTML strings reach the page', () => {
    const offenders = sources().filter((path) => {
      const text = readFileSync(join(SRC, path), 'utf8');
      return (
        text.includes('dangerouslySetInnerHTML') ||
        text.includes('rehypePlugins') ||
        (text.includes("from 'react-markdown'") &&
          path !== join('components', 'markdown.tsx'))
      );
    });

    expect(offenders).toEqual([]);
  });
});
