import { EventBus, eventBus } from './event-bus.js';

// default group uses the global eventBus for backward compatibility
const buses = new Map([['default', eventBus]]);

export function getGroupBus(groupId) {
  if (!buses.has(groupId)) buses.set(groupId, new EventBus());
  return buses.get(groupId);
}

export function removeGroupBus(groupId) {
  if (groupId === 'default') return; // never remove the default bus
  buses.delete(groupId);
}
