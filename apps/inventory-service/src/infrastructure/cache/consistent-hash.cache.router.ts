/**
 * ConsistentHashCacheRouter — ConsistentHashing applied to Redis cache key routing
 *
 * PROBLEM:
 *   A single Redis node is a single point of failure AND a throughput bottleneck.
 *   Solution: use multiple Redis nodes (sharding).
 *
 * NAIVE SHARDING (Modulo hashing):
 *   node = hash(key) % numNodes
 *   Problem: If we add/remove a node, ~80% of keys change their node.
 *   This causes a cache stampede (everyone misses cache at the same time).
 *
 * CONSISTENT HASHING:
 *   Ring-based scheme where each node owns a range on a hash ring [0, 2^32).
 *   When a node is added/removed, only ~1/N keys need to move.
 *   With virtual nodes (vnodes), load is distributed more evenly.
 *
 * VIRTUAL NODES:
 *   Each physical node gets V virtual positions on the ring.
 *   Higher V = better load balance. V=150 is standard.
 *   A key is assigned to the nearest vnode clockwise.
 *
 * HOW IT'S USED IN INVENTORY SERVICE:
 *   Stock data is read on every product page load (high read throughput).
 *   We shard stock data across N Redis nodes.
 *   ConsistentHashCacheRouter determines which node to read/write for a given product.
 *
 * REAL DEPLOYMENT:
 *   In production you'd use Redis Cluster (built-in consistent hashing with 16384 slots).
 *   This implementation shows HOW consistent hashing works for educational purposes,
 *   and is useful when you need custom routing logic (e.g., route by tenantId, not just key).
 *
 * NOTE: In single-Redis dev setup, this still works — all "nodes" point to the same Redis.
 */
import { Injectable, Logger, Inject } from '@nestjs/common';
import { ConsistentHashRing } from '@hypercommerce/algorithms';
import { RedisClientService } from '@hypercommerce/redis';
import algorithmConfig, { AlgorithmConfigProps } from '@hypercommerce/common/config/algorithm.config';

export interface CacheNode {
  id:   string;  // e.g., "redis-1", "redis-2"
  host: string;
  port: number;
}

@Injectable()
export class ConsistentHashCacheRouter {
  private readonly logger = new Logger(ConsistentHashCacheRouter.name);
  private readonly ring: ConsistentHashRing;

  /** Map of nodeId → RedisClientService (one per shard) */
  private readonly nodeClients = new Map<string, RedisClientService>();

  constructor(
    /** The "default" Redis node — used in single-node setup */
    private readonly defaultRedis: RedisClientService,
    @Inject(algorithmConfig.KEY) private readonly config: AlgorithmConfigProps,
  ) {
    this.ring = new ConsistentHashRing(config.consistentHashing.virtualNodes);
  }

  /**
   * Register Redis cache nodes.
   * In production, call this during module init with all cluster nodes.
   * In dev/test, register a single node (all traffic goes there).
   */
  addNode(node: CacheNode, client: RedisClientService): void {
    this.ring.addNode({ id: node.id, host: node.host, port: node.port });
    this.nodeClients.set(node.id, client);
    this.logger.log(`Cache node registered: ${node.id} (${node.host}:${node.port})`);
  }

  removeNode(nodeId: string): void {
    this.ring.removeNode(nodeId);
    this.nodeClients.delete(nodeId);
    this.logger.warn(`Cache node removed: ${nodeId} — keys will reroute to neighbors`);
  }

  /**
   * Get the Redis client responsible for a given cache key.
   * This is the core routing function — O(log N) via binary search on sorted vnodes.
   */
  getClientForKey(key: string): RedisClientService {
    if (this.nodeClients.size === 0) {
      return this.defaultRedis;
    }

    const nodeInfo = this.ring.getNode(key);
    const nodeId = nodeInfo?.id;
    return (nodeId ? this.nodeClients.get(nodeId) : undefined) ?? this.defaultRedis;
  }

  /**
   * Get a value — automatically routes to the correct shard.
   */
  async get(key: string): Promise<string | null> {
    return this.getClientForKey(key).get(key);
  }

  async set(key: string, value: string, ttlSeconds?: number): Promise<void> {
    return this.getClientForKey(key).set(key, value, ttlSeconds);
  }

  async del(key: string): Promise<void> {
    await this.getClientForKey(key).del(key);
  }

  /** Get raw Buffer value — used for BloomFilter/HLL binary data */
  async getBuffer(key: string): Promise<Buffer | null> {
    return this.getClientForKey(key).getBuffer(key);
  }

  /** Set raw Buffer value */
  async setBuffer(key: string, value: Buffer, ttlSeconds?: number): Promise<void> {
    await this.getClientForKey(key).setBuffer(key, value, ttlSeconds);
  }

  /**
   * Get ring distribution stats — useful for monitoring node load balance.
   * Returns percentage of keyspace each physical node owns.
   */
  getDistributionStats(): Record<string, number> {
    return Object.fromEntries(this.ring.getDistribution());
  }
}
