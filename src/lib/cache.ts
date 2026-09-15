// Minimal in-memory LRU cache with a max number of entries.
export class LRUCache<K, V> {
  private readonly max: number;
  private readonly map = new Map<K, { value: V; created: number }>();

  constructor(max = 500, private readonly ttlMs = 60_000) {
    this.max = max;
  }

  get(key: K): V | undefined {
    const entry = this.map.get(key);
    if (!entry) return undefined;
    if (entry.created + this.ttlMs < Date.now()) {
      this.map.delete(key);
      return undefined;
    }
    // Refresh recency.
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key: K, value: V): void {
    if (this.get(key) !== undefined) return;
    this.map.set(key, { value, created: Date.now() });
    if (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value as K);
    }
  }

  get size(): number {
    return this.map.size;
  }
}

// Shared cache for AI chat replies (RAG pipeline + LLM round-trip is expensive).
export const aiReplyCache = new LRUCache<string, { reply: string }>(300, 30 * 60 * 1000);