import type { PrismaService } from '../../src/modules/prisma/prisma.service';

/**
 * Makes the next `<model>.create` through the SCOPED client reject once.
 *
 * Every write goes through `prisma.scoped(context)`, which builds a new client
 * per call, so a spy on the bare client's delegate never sees it. This wraps
 * `scoped()` instead and fails the first matching create it hands out.
 *
 * @example const restore = failNextCreate(fx.prisma, 'notification'); try { … } finally { restore(); }
 */
export function failNextCreate(
  prisma: PrismaService,
  model: 'notification',
): () => void {
  const scoped = prisma.scoped.bind(prisma);
  let remaining = 1;

  const spy = jest.spyOn(prisma, 'scoped').mockImplementation((context) => {
    const client = scoped(context);

    return new Proxy(client, {
      get(target, property, receiver) {
        const value: unknown = Reflect.get(target, property, receiver);
        if (property !== model) return value;

        return new Proxy(value as object, {
          get(delegate, method, inner) {
            if (method === 'create' && remaining > 0) {
              remaining -= 1;
              return () => Promise.reject(new Error('injected failure'));
            }

            return Reflect.get(delegate, method, inner);
          },
        });
      },
    });
  });

  return () => spy.mockRestore();
}
