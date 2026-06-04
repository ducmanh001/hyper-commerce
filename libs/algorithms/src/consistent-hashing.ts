// ============================================================
// HYPERCOMMERCE — Consistent Hashing
//
// Used for:
//   1. Shard routing in Redis Cluster (which node owns this key?)
//   2. Inventory shard selection (which DB shard holds product X?)
//   3. Cache shard routing (which memcached/Redis node?)
//   4. Live service room assignment (which WebSocket server?)
//
// Why Consistent Hashing vs modulo:
//   - modulo(n): adding/removing 1 node remaps ~all keys
//   - consistent hashing: adding/removing 1 node remaps ~k/n keys
//
// Virtual nodes (vnodes): each physical node maps to v_factor
// positions on the ring. Default v_factor=150 for good distribution.
// ============================================================

/**
 * Djb2 hash — fast, good distribution for consistent hashing ring.
 */
function djb2Hash(str: string): number {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) >>> 0;
  }
  return hash;
}

export interface NodeInfo {
  id: string;
  host: string;
  port: number;
  weight?: number; // Relative weight (default 1 = equal weight)
}

export class ConsistentHashRing {
  private readonly ring: Map<number, string> = new Map();
  private readonly sortedKeys: number[] = [];
  private readonly nodes: Map<string, NodeInfo> = new Map();
  private readonly virtualFactor: number;

  constructor(virtualFactor = 150) {
    this.virtualFactor = virtualFactor;
  }

  /**
   * Add a node to the ring.
   * Creates virtualFactor × weight virtual nodes for this physical node.
   */
  addNode(node: NodeInfo): void {
    this.nodes.set(node.id, node);
    const weight = node.weight ?? 1;
    const vnodes = Math.ceil(this.virtualFactor * weight);

    for (let i = 0; i < vnodes; i++) {
      const virtualKey = `${node.id}#vnode${i}`;
      const hash = djb2Hash(virtualKey);
      this.ring.set(hash, node.id);
    }

    this.rebuildSortedKeys();
  }

  /**
   * Remove a node from the ring.
   * Only this node's vnodes are removed — other nodes unaffected.
   */
  removeNode(nodeId: string): void {
    const node = this.nodes.get(nodeId);
    if (!node) return;

    const weight = node.weight ?? 1;
    const vnodes = Math.ceil(this.virtualFactor * weight);

    for (let i = 0; i < vnodes; i++) {
      const virtualKey = `${nodeId}#vnode${i}`;
      const hash = djb2Hash(virtualKey);
      this.ring.delete(hash);
    }

    this.nodes.delete(nodeId);
    this.rebuildSortedKeys();
  }

  /**
   * Get the node responsible for a given key.
   * O(log n) binary search on sorted virtual node positions.
   */
  getNode(key: string): NodeInfo | null {
    if (this.sortedKeys.length === 0) return null;

    const hash = djb2Hash(key);
    const nodeId = this.findSuccessor(hash);
    return this.nodes.get(nodeId) ?? null;
  }

  /**
   * Get N nodes responsible for a key (for replication).
   * Returns distinct physical nodes (skips vnodes of same physical node).
   */
  getReplicaNodes(key: string, replicaCount: number): NodeInfo[] {
    if (this.sortedKeys.length === 0) return [];

    const hash = djb2Hash(key);
    const startIdx = this.findSuccessorIndex(hash);
    const seen = new Set<string>();
    const result: NodeInfo[] = [];

    for (let i = 0; i < this.sortedKeys.length && result.length < replicaCount; i++) {
      const idx = (startIdx + i) % this.sortedKeys.length;
      const nodeId = this.ring.get(this.sortedKeys[idx])!;

      if (!seen.has(nodeId)) {
        seen.add(nodeId);
        const node = this.nodes.get(nodeId);
        if (node) result.push(node);
      }
    }

    return result;
  }

  /** Get load distribution — how many vnodes each physical node owns */
  getDistribution(): Map<string, number> {
    const dist = new Map<string, number>();
    for (const nodeId of this.ring.values()) {
      dist.set(nodeId, (dist.get(nodeId) ?? 0) + 1);
    }
    return dist;
  }

  get nodeCount(): number {
    return this.nodes.size;
  }

  private findSuccessor(hash: number): string {
    const idx = this.findSuccessorIndex(hash);
    return this.ring.get(this.sortedKeys[idx])!;
  }

  private findSuccessorIndex(hash: number): number {
    let lo = 0;
    let hi = this.sortedKeys.length - 1;

    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (this.sortedKeys[mid] < hash) {
        lo = mid + 1;
      } else {
        hi = mid;
      }
    }

    // Wrap around if hash is greater than all positions (clockwise ring)
    if (this.sortedKeys[lo] < hash) return 0;
    return lo;
  }

  private rebuildSortedKeys(): void {
    this.sortedKeys.length = 0;
    for (const key of this.ring.keys()) {
      this.sortedKeys.push(key);
    }
    this.sortedKeys.sort((a, b) => a - b);
  }
}

// ── CRC32 hash (alternative, hardware-accelerated on x86) ─────
// Node.js doesn't expose CRC32 natively, but this JS implementation
// is fast enough for typical shard routing (sub-microsecond per call).
export function crc32(str: string): number {
  let crc = 0xffffffff;
  for (let i = 0; i < str.length; i++) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ str.charCodeAt(i)) & 0xff];
  }
  return ~crc >>> 0;
}

// Pre-computed lookup table (faster than recomputing for each byte)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[i] = c;
  }
  return table;
})();
