/**
 * The layout APIs jsdom lacks, stubbed for components that only measure:
 * Radix's checkbox watches its size, its select captures the pointer and
 * scrolls the chosen option into view, and input-otp looks for a password
 * manager's badge. Import it for its effect.
 *
 * @example
 * import '@/test/dom';
 */
globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
document.elementFromPoint ??= () => null;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.scrollIntoView ??= () => undefined;
