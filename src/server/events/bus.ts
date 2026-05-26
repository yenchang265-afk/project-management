// In-process pub/sub event bus.
//
// Phase 1 shipped a no-op stub with `publish`/`subscribe`. Phase 3 extends it
// to a proper bus so Phase 4c (Notifications) and Phase 5a (Audit) can subscribe
// to typed event names. The bus is intentionally tiny and synchronous (handlers
// are invoked in registration order). Async handlers may return Promises; we
// fire-and-forget them so emit stays non-blocking. Errors in handlers are
// caught and logged so one bad subscriber can't break a service mutation.

// ---------- legacy phase-1 API (kept for backward compat) -------------------

export type DomainEvent =
  | {
      type: 'auth.password_reset_requested';
      payload: { userId: string; email: string; token: string };
    }
  | { type: 'auth.registered'; payload: { userId: string; email: string } };

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

const legacyHandlers = new Set<DomainEventHandler>();

export function subscribe(handler: DomainEventHandler): () => void {
  legacyHandlers.add(handler);
  return () => legacyHandlers.delete(handler);
}

export async function publish(event: DomainEvent): Promise<void> {
  // Redact sensitive fields before logging so tokens never appear in logs.
  const logPayload =
    event.type === 'auth.password_reset_requested'
      ? { ...event.payload, token: '[REDACTED]' }
      : event.payload;
  // eslint-disable-next-line no-console
  console.info('[event]', event.type, logPayload);
  for (const h of legacyHandlers) {
    await h(event);
  }
}

// ---------- phase-3 typed pub/sub ------------------------------------------

type Handler<T> = (payload: T) => void | Promise<void>;

const handlers = new Map<string, Set<Handler<unknown>>>();

export function on<T = unknown>(event: string, handler: Handler<T>): () => void {
  let set = handlers.get(event);
  if (!set) {
    set = new Set();
    handlers.set(event, set);
  }
  set.add(handler as Handler<unknown>);
  return () => {
    set?.delete(handler as Handler<unknown>);
  };
}

export function once<T = unknown>(event: string, handler: Handler<T>): () => void {
  const off = on<T>(event, (payload) => {
    off();
    return handler(payload);
  });
  return off;
}

export function emit<T = unknown>(event: string, payload: T): void {
  const set = handlers.get(event);
  if (!set) return;
  for (const h of Array.from(set)) {
    try {
      const result = (h as Handler<T>)(payload);
      if (result && typeof (result as Promise<unknown>).then === 'function') {
        (result as Promise<unknown>).catch((err: unknown) => {
          // eslint-disable-next-line no-console
          console.error('[event-handler-error]', event, err);
        });
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[event-handler-error]', event, err);
    }
  }
}

export function reset(): void {
  handlers.clear();
  legacyHandlers.clear();
}
