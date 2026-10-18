import { keepNormalized, stopNormalizing } from './normalize';

/** Lets the observer's callback run, as it would before the next paint. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('keepNormalized', () => {
  afterEach(() => {
    stopNormalizing();
    document.body.innerHTML = '';
  });

  it('gives ticket numbers, times and addresses the same text', () => {
    document.body.innerHTML =
      '<p>Maya Chen replied on <span>#1042</span></p>' +
      '<p>#1019 was resolved</p><time>2 min ago</time>' +
      '<p>sam@run-81.example.test</p>';

    keepNormalized();

    expect(document.body.textContent).toBe(
      'Maya Chen replied on #0000#0000 was resolved00:00person@northwind.example.test',
    );
  });

  it('**puts it back when the page re-renders the real text**', async () => {
    document.body.innerHTML = '<p>Maya Chen replied on <span>#1042</span></p>';
    keepNormalized();

    // As React does on a refetch: the same text node, its real value again.
    document.querySelector('span')!.firstChild!.nodeValue = '#1042';
    document.body.insertAdjacentHTML('beforeend', '<p>#1019 was resolved</p>');
    await settle();

    expect(document.body.textContent).toBe(
      'Maya Chen replied on #0000#0000 was resolved',
    );
  });

  it('stops once the captures are taken', async () => {
    document.body.innerHTML = '<p><span>#1042</span></p>';
    keepNormalized();
    stopNormalizing();

    document.querySelector('span')!.textContent = '#1042';
    await settle();

    expect(document.body.textContent).toBe('#1042');
  });
});
