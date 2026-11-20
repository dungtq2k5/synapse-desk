'use client';

/** Throws outside React, as an uncaught error does. */
export function ThrowButton() {
  return (
    <button
      type="button"
      className="rounded-md border px-3 py-1.5"
      onClick={() =>
        setTimeout(() => {
          throw new Error('Thrown by the test page');
        })
      }
    >
      Throw
    </button>
  );
}
