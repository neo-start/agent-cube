export class AgentTaskQueue {
  constructor(agentName, cap = 20) {
    this.agentName = agentName;
    this.cap = cap;
    this.items = [];
  }

  // Enqueue a task. Returns true if enqueued, false if queue is full.
  enqueue(taskFn, meta) {
    if (this.items.length >= this.cap) return false;
    this.items.push({ fn: taskFn, meta: meta || null });
    return true;
  }

  // Dequeue and execute the next task (if any).
  dequeue() {
    const item = this.items.shift();
    if (item?.fn) {
      try { item.fn(); } catch (err) {
        console.error(`[AgentTaskQueue:${this.agentName}] task error:`, err.message);
      }
    }
  }

  get length() {
    return this.items.length;
  }

  // Remove a queued task by taskId. Returns true if removed.
  remove(taskId) {
    const idx = this.items.findIndex(i => i.meta?.taskId === taskId);
    if (idx !== -1) {
      this.items.splice(idx, 1);
      return true;
    }
    return false;
  }

  // Returns serializable metadata array for persistence.
  getMeta() {
    return this.items.map(i => i.meta).filter(Boolean);
  }

  // Restore queue from persisted tasks. taskFn is provided by the caller.
  restore(tasks) {
    for (const { taskFn, meta } of tasks) {
      this.items.push({ fn: taskFn, meta });
    }
  }
}
