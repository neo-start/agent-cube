import { EventBus, eventBus } from './event-bus.js';

// default group uses the global eventBus for backward compatibility
const buses = new Map<string, EventBus>([['default', eventBus]]);
const busLastAccess = new Map<string, number>([['default', Date.now()]]);

const MAX_IDLE_BUSES = 50;
const BUS_IDLE_MS = 30 * 60 * 1000; // 30 minutes

export function getGroupBus(groupId: string): EventBus {
  busLastAccess.set(groupId, Date.now());
  if (!buses.has(groupId)) buses.set(groupId, new EventBus());
  return buses.get(groupId)!;
}

export function removeGroupBus(groupId: string): void {
  if (groupId === 'default') return; // never remove the default bus
  buses.delete(groupId);
  busLastAccess.delete(groupId);
}

// Periodically evict idle buses to prevent unbounded memory growth
setInterval(() => {
  if (buses.size <= MAX_IDLE_BUSES) return;
  const now = Date.now();
  for (const [id, lastAccess] of busLastAccess) {
    if (id === 'default') continue;
    if (now - lastAccess > BUS_IDLE_MS) {
      buses.delete(id);
      busLastAccess.delete(id);
    }
  }
}, 5 * 60 * 1000); // check every 5 min
