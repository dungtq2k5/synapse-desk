/**
 * Gives what varies the same text on every run, so a masked box is the same
 * width and nothing after it moves: times, ticket numbers and the run's email
 * addresses. Then keeps it so: React can re-render a list between this and the
 * screenshot (a refetch as the tenant's notifications land), putting the real
 * text back, so a `MutationObserver` normalizes again on every change. Its
 * callback runs before the next paint, so no capture sees the real text.
 *
 * Runs in the page (`page.evaluate(keepNormalized)`), so it's self-contained:
 * nothing outside the function body. Calling it again normalizes once more and
 * leaves the one observer in place. It writes only text that differs, so its
 * own writes settle instead of looping.
 */
export function keepNormalized(): void {
  const normalize = () => {
    const set = (node: Node, value: string) => {
      if (node.nodeValue !== value) node.nodeValue = value;
    };
    // A ticket number is "#" and its digits, often as two text nodes.
    for (const element of document.querySelectorAll('body *')) {
      if (
        element.children.length === 0 &&
        /^#\d+$/.test(element.textContent?.trim() ?? '') &&
        element.textContent !== '#0000'
      ) {
        element.textContent = '#0000';
      }
    }
    // A read-only field shows an address too (the profile's email).
    for (const input of document.querySelectorAll('input')) {
      if (
        /@[\w.-]+\.example\.test$/.test(input.value) &&
        input.value !== 'person@northwind.example.test'
      ) {
        input.value = 'person@northwind.example.test';
        // Chrome can keep a glyph of the longer address painted; take the
        // field out of the layout and back so it's drawn afresh.
        input.style.display = 'none';
        void input.offsetHeight;
        input.style.display = '';
      }
    }
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.nodeValue ?? '';
      if (node.parentElement?.closest('time')) set(node, '00:00');
      else if (/#\d+/.test(text)) set(node, text.replace(/#\d+/g, '#0000'));
      else if (/@[\w.-]+\.example\.test/.test(text)) {
        set(
          node,
          text.replace(
            /[\w.-]+@[\w.-]+\.example\.test/,
            'person@northwind.example.test',
          ),
        );
      }
    }
  };

  normalize();
  const page = window as unknown as { normalizer?: MutationObserver };
  if (page.normalizer) return;
  page.normalizer = new MutationObserver(normalize);
  page.normalizer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
  });
}

/**
 * Ends {@link keepNormalized}'s watch once the captures are taken. The text
 * already replaced stays as it is until the page next renders it.
 */
export function stopNormalizing(): void {
  const page = window as unknown as { normalizer?: MutationObserver };
  page.normalizer?.disconnect();
  delete page.normalizer;
}
