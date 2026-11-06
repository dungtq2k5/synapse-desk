/**
 * The page a visitor sees when the demo's machine isn't answering. One
 * self-contained file: the mark is inline SVG, the colors are the brand's for
 * light and dark, and nothing loads from anywhere else, since nothing else is
 * up.
 */
export const OFFLINE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>Demo offline · SynapseDesk</title>
<style>
  :root {
    --background: #ffffff;
    --foreground: #21282b;
    --muted: #5a6265;
    --primary: #006e75;
    --mark-ink: #ffffff;
    color-scheme: light dark;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --background: #21282b;
      --foreground: #f6fbfd;
      --muted: #cad3d6;
      --primary: #32cbd6;
      --mark-ink: #002d30;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    min-height: 100vh;
    display: grid;
    place-items: center;
    padding: 24px 16px;
    background: var(--background);
    color: var(--foreground);
    font: 16px/1.5 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  }
  main { max-width: 32rem; text-align: center; }
  svg { width: 48px; height: 48px; }
  h1 { font-size: 1.5rem; line-height: 1.3; margin: 20px 0 8px; }
  p { margin: 0 0 12px; color: var(--muted); }
  a { color: var(--primary); font-weight: 600; }
</style>
</head>
<body>
<main>
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect width="24" height="24" rx="6" fill="var(--primary)" />
    <path d="M12.314 4.814A3.6 3.6 0 1 0 12 12A3.6 3.6 0 1 1 11.686 19.186" fill="none" stroke="var(--mark-ink)" stroke-width="2.4" stroke-linecap="round" />
    <circle cx="15.275" cy="6.906" r="1.7" fill="var(--mark-ink)" />
    <circle cx="8.725" cy="17.094" r="1.7" fill="var(--mark-ink)" />
  </svg>
  <h1>The SynapseDesk demo is offline right now</h1>
  <p>It runs on a single machine, which isn't answering. Please try again in a few minutes.</p>
  <p><a href="mailto:support@synapsedeskapp.com">support@synapsedeskapp.com</a></p>
</main>
</body>
</html>
`;
