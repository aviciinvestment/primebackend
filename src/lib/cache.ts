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

// Embedding cache. Bounded LRU: at most ~2000 vectors, each TTL'd (24h). Keys
// are SHA-256 hashes of the input text (see embedText in aiController.ts), so
// raw/PII text is never held in server memory. Vectors are ~1500 floats each,
// so peak RSS stays bounded (~24MB) regardless of request volume — no leak.
export const embeddingCache = new LRUCache<string, number[]>(2000, 24 * 60 * 60 * 1000);