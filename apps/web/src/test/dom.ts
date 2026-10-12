/**
 * The layout APIs jsdom lacks, stubbed for components that only measure:
 * Radix's checkbox watches its size, and input-otp looks for a password
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
