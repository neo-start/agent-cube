/**
 * EventBus — unified event system for agent-cube
 *
 * All inter-agent communication (delegate, msg, thread turns, status)
 * flows through here. Provides:
 *   - Unified history / audit log
 *   - Type-based subscriptions (on / off)
 *   - Wildcard '*' subscription for SSE broadcast
 */

class EventBus {
  constructor() {
    this.history = [];
    this.handlers = new Map();
    this._counter = 0;
  }

  /**
   * Subscribe to events of a specific type, or '*' for all events.
   * Returns an unsubscribe function.
   */
  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type).add(handler);
    return () => this.handlers.get(type)?.delete(handler);
  }

  /**
   * Emit an event. Automatically assigns id + timestamp.
   * Returns the completed event object.
   */
  emit(event) {
    const full = {
      id: `ev-${++this._counter}-${Date.now()}`,
      timestamp: new Date().toISOString(),
      ...event,
    };

    // Keep rolling history (max 1000 events)
    this.history.push(full);
    if (this.history.length > 1000) this.history.shift();

    // Dispatch to type-specific handlers
    this.handlers.get(full.type)?.forEach(fn => {
      try { fn(full); } catch (e) { console.error('[EventBus] handler error:', e); }
    });

    // Dispatch to wildcard handlers
    this.handlers.get('*')?.forEach(fn => {
      try { fn(full); } catch (e) { console.error('[EventBus] handler error:', e); }
    });

    return full;
  }

  /**
   * Return history, optionally filtered by event index offset.
   */
  getHistory(sinceIndex = 0) {
    return sinceIndex > 0 ? this.history.slice(sinceIndex) : [...this.history];
  }
}

export const eventBus = new EventBus();
