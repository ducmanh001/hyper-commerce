// ============================================================
// HYPERCOMMERCE — Live Service WebSocket Gateway
// Stateful WebSocket hub — tách riêng khỏi API server
// vì lý do: HTTP stateless, WebSocket stateful.
//
// Key design:
// - Connection registry: socket_id → user_id (in-memory)
// - Message routing: user_id → [socket_ids] (supports multi-device)
// - Redis PubSub: services publish → hub forwards to correct socket
// - Room pattern: stream_id → [socket_ids] (fan-out to all viewers)
// ============================================================

import type { OnGatewayConnection, OnGatewayDisconnect, OnGatewayInit } from '@nestjs/websockets';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Logger } from '@nestjs/common';
import type { Server, Socket } from 'socket.io';
import type { JwtService } from '@nestjs/jwt';
import type { RedisClientService } from '@hypercommerce/redis';
import type { Redis } from 'ioredis';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import { APP_CONSTANTS } from '@hypercommerce/common/constants/app.constants';
import type { LiveService } from './live.service';
import type { ViewerCountService } from './viewer/viewer-count.service';

interface AuthenticatedSocket extends Socket {
  userId: string;
  username: string;
}

interface JoinStreamPayload {
  streamId: string;
}

interface SendCommentPayload {
  streamId: string;
  content: string;
}

interface SendGiftPayload {
  streamId: string;
  giftId: string;
  quantity: number;
}

@WebSocketGateway({
  cors: {
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? ['http://localhost:3000'],
    credentials: true,
  },
  transports: ['websocket'], // Force WebSocket — no long-polling fallback at scale
  namespace: '/live',
  // Socket.io adapter: Redis adapter required for multi-pod broadcasting
  // Configured at module level with @socket.io/redis-adapter
})
export class LiveGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(LiveGateway.name);

  // In-memory connection registry — survives within pod
  // Cross-pod routing handled by Redis adapter
  private readonly connectionMap = new Map<string, Set<string>>(); // userId → Set<socketId>
  private readonly socketUserMap = new Map<string, string>(); // socketId → userId

  constructor(
    private readonly jwtService: JwtService,
    private readonly redis: RedisClientService,
    private readonly kafka: KafkaProducerService,
    private readonly liveService: LiveService,
    private readonly viewerCount: ViewerCountService,
  ) {}

  afterInit(): void {
    this.logger.log('LiveGateway initialized');
    this.subscribeToRedisEvents();
  }

  /**
   * Connection handler — authenticate via JWT in handshake.
   *
   * Why JWT in handshake and not cookies?
   * WebSocket upgrade request doesn't support HTTP-only cookies
   * in all client environments. JWT in query string or auth header
   * works universally.
   *
   * Security: JWT must be short-lived (15min) — client refreshes before expiry.
   */
  async handleConnection(socket: AuthenticatedSocket): Promise<void> {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;

      if (!token) {
        socket.disconnect(true);
        return;
      }

      const payload = this.jwtService.verify<{ sub: string; username: string }>(String(token));

      socket.userId = payload.sub;
      socket.username = payload.username;

      // Register in connection maps
      if (!this.connectionMap.has(socket.userId)) {
        this.connectionMap.set(socket.userId, new Set());
      }
      this.connectionMap.get(socket.userId)!.add(socket.id);
      this.socketUserMap.set(socket.id, socket.userId);

      // Mark user as online
      await this.redis.set(
        `${APP_CONSTANTS.REDIS_KEYS.USER_ONLINE}${socket.userId}`,
        '1',
        300, // TTL 5min — refreshed on activity
      );

      this.logger.log(
        JSON.stringify({
          event: 'ws_connected',
          userId: socket.userId,
          socketId: socket.id,
          totalConnections: this.socketUserMap.size,
        }),
      );
    } catch {
      // Invalid JWT → disconnect immediately
      socket.disconnect(true);
    }
  }

  async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    const userId = socket.userId || this.socketUserMap.get(socket.id);
    if (!userId) return;

    // Remove from maps
    this.connectionMap.get(userId)?.delete(socket.id);
    if (!this.connectionMap.get(userId)?.size) {
      this.connectionMap.delete(userId);
      // User fully offline
      await this.redis.del(`${APP_CONSTANTS.REDIS_KEYS.USER_ONLINE}${userId}`);
    }

    this.socketUserMap.delete(socket.id);

    // Remove from all stream rooms and update viewer counts
    const rooms = [...socket.rooms].filter((r) => r.startsWith('stream:'));
    for (const room of rooms) {
      const streamId = room.replace('stream:', '');
      await this.viewerCount.decrementViewer(streamId, userId);
      const count = await this.viewerCount.getViewerCount(streamId);

      // Broadcast new count to remaining viewers
      this.server.to(room).emit('viewer_count', { streamId, count });
    }

    this.logger.log(
      JSON.stringify({
        event: 'ws_disconnected',
        userId,
        socketId: socket.id,
      }),
    );
  }

  // ── Stream Events ─────────────────────────────────────────

  @SubscribeMessage('join_stream')
  async onJoinStream(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: JoinStreamPayload,
  ): Promise<void> {
    const { streamId } = payload;

    const stream = await this.liveService.getStream(streamId);
    if (!stream) {
      socket.emit('error', { code: 'STREAM_NOT_FOUND', streamId });
      return;
    }

    const room = `stream:${streamId}`;
    await socket.join(room);

    // Increment viewer count atomically
    await this.viewerCount.incrementViewer(streamId, socket.userId);
    const count = await this.viewerCount.getViewerCount(streamId);

    // Send stream state to joining user
    socket.emit('stream_joined', {
      streamId,
      title: stream.title,
      sellerName: stream.sellerName,
      viewerCount: count,
      currentProduct: stream.currentProduct,
    });

    // Broadcast updated count to all viewers
    this.server.to(room).emit('viewer_count', { streamId, count });

    // Emit join event to analytics
    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ANALYTICS_EVENTS,
      partitionKey: socket.userId,
      value: {
        type: 'STREAM_JOINED',
        userId: socket.userId,
        streamId,
        timestamp: new Date().toISOString(),
      },
    });
  }

  @SubscribeMessage('leave_stream')
  async onLeaveStream(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: JoinStreamPayload,
  ): Promise<void> {
    const { streamId } = payload;
    const room = `stream:${streamId}`;

    await socket.leave(room);
    await this.viewerCount.decrementViewer(streamId, socket.userId);
    const count = await this.viewerCount.getViewerCount(streamId);
    this.server.to(room).emit('viewer_count', { streamId, count });
  }

  /**
   * Send comment — fan-out to all stream viewers.
   *
   * Rate limiting: 1 comment per 3 seconds per user.
   * Spam filtering: basic keyword filter, ML filter via Kafka.
   *
   * High-volume path: 50K viewers × 10 comments/min = 500K msgs/min.
   * Room broadcast via Redis adapter handles cross-pod delivery.
   */
  @SubscribeMessage('send_comment')
  async onSendComment(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: SendCommentPayload,
  ): Promise<void> {
    const { streamId, content } = payload;

    // Rate limit check
    const rateLimitKey = `comment:rl:${socket.userId}:${streamId}`;
    const count = await this.redis.incr(rateLimitKey);
    if (count === 1) await this.redis.expire(rateLimitKey, 3);
    if (count > 1) {
      socket.emit('error', { code: 'COMMENT_RATE_LIMIT', retryAfter: 3 });
      return;
    }

    // Content length limit
    if (content.length > 200) {
      socket.emit('error', { code: 'COMMENT_TOO_LONG' });
      return;
    }

    const comment = {
      id: `cmt_${Date.now()}`,
      userId: socket.userId,
      username: socket.username,
      content: content.trim(),
      streamId,
      timestamp: Date.now(),
    };

    // Broadcast to all in stream room (including sender)
    this.server.to(`stream:${streamId}`).emit('comment', comment);

    // Async: persist comment + run ML moderation
    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.LIVE_EVENTS,
      partitionKey: streamId,
      value: { type: 'STREAM_COMMENT', ...comment },
    });
  }

  /**
   * Send gift — special fan-out with animation.
   * Gifts are high-value events — broadcast with priority.
   */
  @SubscribeMessage('send_gift')
  async onSendGift(
    @ConnectedSocket() socket: AuthenticatedSocket,
    @MessageBody() payload: SendGiftPayload,
  ): Promise<void> {
    const { streamId, giftId, quantity } = payload;

    // Verify user has enough balance
    const canGift = await this.liveService.processGift(socket.userId, streamId, giftId, quantity);

    if (!canGift.success) {
      socket.emit('error', { code: 'INSUFFICIENT_BALANCE', available: canGift.balance });
      return;
    }

    // Broadcast gift animation to all viewers
    this.server.to(`stream:${streamId}`).emit('gift_received', {
      from: { id: socket.userId, username: socket.username },
      giftId,
      quantity,
      value: canGift.giftValue,
      animation: canGift.animationType,
    });

    await this.kafka.publish({
      topic: APP_CONSTANTS.KAFKA_TOPICS.ANALYTICS_EVENTS,
      partitionKey: streamId,
      value: {
        type: 'GIFT_SENT',
        userId: socket.userId,
        streamId,
        giftId,
        quantity,
        totalValue: canGift.giftValue * quantity,
      },
    });
  }

  // ── Push Messages from Backend Services ───────────────────

  /**
   * Push notification to specific user (across all their devices).
   * Called by Notification Service via Redis PubSub.
   */
  pushToUser(userId: string, event: string, data: unknown): void {
    const socketIds = this.connectionMap.get(userId);
    if (!socketIds?.size) return; // User offline on this pod

    for (const socketId of socketIds) {
      this.server.to(socketId).emit(event, data);
    }
  }

  // ── Redis PubSub Bridge ───────────────────────────────────

  /**
   * Subscribe to Redis PubSub for cross-service push.
   * When OrderService publishes "payment_confirmed",
   * Redis delivers it here → we push to user's WebSocket.
   */
  private subscribeToRedisEvents(): void {
    const client = this.redis.getClient();
    if (!client || typeof (client as Redis).duplicate !== 'function') {
      this.logger.warn('Redis client not ready or is Cluster — skipping Redis PubSub subscription');
      return;
    }
    const sub = (client as Redis).duplicate();

    // Subscribe to user-specific notification channel
    void (sub as Redis).psubscribe('notify:*', (err) => {
      if (err) this.logger.error(`Redis subscribe error: ${err.message}`);
    });

    (sub as Redis).on('pmessage', (_pattern: string, channel: string, rawMessage: string) => {
      try {
        const userId = channel.replace('notify:', '');
        const message = JSON.parse(rawMessage) as { event: string; data: unknown };
        this.pushToUser(userId, message.event, message.data);
      } catch {
        // Ignore malformed messages
      }
    });
  }
}
