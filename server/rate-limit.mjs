// Never trust a forwarded IP or an unverified cookie as an independent quota.
export class RateLimit {
  constructor(max, { windowMs = 60_000, capacity = 20_000, clock = Date.now } = {}) {
    this.max = max; this.windowMs = windowMs; this.capacity = capacity; this.clock = clock;
    this.entries = new Map();
  }
  take(key) {
    const now = this.clock();
    let entry = this.entries.get(key);
    if (!entry || entry.until <= now) {
      if (this.entries.size >= this.capacity) {
        for (const [id, value] of this.entries) if (value.until <= now) this.entries.delete(id);
        if (!this.entries.has(key) && this.entries.size >= this.capacity) return 60;
      }
      entry = { count: 0, until: now + this.windowMs }; this.entries.set(key, entry);
    }
    entry.count++;
    return entry.count > this.max ? Math.max(1, Math.ceil((entry.until - now) / 1000)) : 0;
  }
}
