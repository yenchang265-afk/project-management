// Minimal in-process domain event bus. Phase 4 swaps the listener for a real
// notifications/email job consumer; for now this is a logging stub so callers
// can already emit typed events without coupling to the consumer.

export type DomainEvent =
  | {
      type: 'auth.password_reset_requested';
      payload: { userId: string; email: string; token: string };
    }
  | { type: 'auth.registered'; payload: { userId: string; email: string } };

export type DomainEventHandler = (event: DomainEvent) => void | Promise<void>;

const handlers = new Set<DomainEventHandler>();

export function subscribe(handler: DomainEventHandler): () => void {
  handlers.add(handler);
  return () => handlers.delete(handler);
}

export async function publish(event: DomainEvent): Promise<void> {
  // Default sink: log so the event is observable in dev/test without a real consumer.
  // eslint-disable-next-line no-console
  console.info('[event]', event.type, event.payload);
  for (const h of handlers) {
    await h(event);
  }
}
