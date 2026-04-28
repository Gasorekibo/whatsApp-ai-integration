class ClientCache {
  #store = new Map();
  #ttl;

  constructor(ttlMs = 5 * 60 * 1000) {
    this.#ttl = ttlMs;
  }

  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.#store.delete(key);
      return null;
    }
    return entry.value;
  }

  set(key, value) {
    this.#store.set(key, { value, expiresAt: Date.now() + this.#ttl });
  }

  invalidate(key) {
    this.#store.delete(key);
  }

  clear() {
    this.#store.clear();
  }

  get size() {
    return this.#store.size;
  }
}

export default new ClientCache();
