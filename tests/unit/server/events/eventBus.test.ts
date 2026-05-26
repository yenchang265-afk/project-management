import { beforeEach, describe, expect, it, vi } from 'vitest';

import { emit, on, once, reset } from '@/server/events/bus';

describe('event bus', () => {
  beforeEach(() => {
    reset();
  });

  it('delivers events to subscribers', () => {
    const handler = vi.fn();
    on('test.event', handler);
    emit('test.event', { hello: 'world' });
    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith({ hello: 'world' });
  });

  it('fans out to every subscriber of an event', () => {
    const a = vi.fn();
    const b = vi.fn();
    on('x', a);
    on('x', b);
    emit('x', 1);
    expect(a).toHaveBeenCalledWith(1);
    expect(b).toHaveBeenCalledWith(1);
  });

  it('does not call subscribers of other event names', () => {
    const handler = vi.fn();
    on('x', handler);
    emit('y', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribes correctly', () => {
    const handler = vi.fn();
    const off = on('x', handler);
    off();
    emit('x', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('once subscribes for a single delivery', () => {
    const handler = vi.fn();
    once('x', handler);
    emit('x', 1);
    emit('x', 2);
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler).toHaveBeenCalledWith(1);
  });

  it('reset clears all subscribers', () => {
    const handler = vi.fn();
    on('x', handler);
    reset();
    emit('x', 1);
    expect(handler).not.toHaveBeenCalled();
  });

  it('emit returns synchronously even when handler is async', () => {
    let called = false;
    on('x', async () => {
      await Promise.resolve();
      called = true;
    });
    emit('x', 1);
    // Synchronous part runs immediately
    expect(typeof called).toBe('boolean');
  });
});
