import type { OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  MessageBody,
  ConnectedSocket,
  WsException,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { Logger } from '@nestjs/common';
import type { JwtService } from '@nestjs/jwt';
import type { ChatService, SendMessageDto } from './chat.service';
import type { MessageType } from './entities/message.entity';
import { MessageSenderType } from './entities/message.entity';
import { ConversationType } from './entities/conversation.entity';

// Socket.IO events:
// Client → Server: join_conversation, send_message, typing_start, typing_stop, mark_read
// Server → Client: message_received, typing_update, conversation_updated, queue_position

@WebSocketGateway({
  cors: { origin: process.env.FRONTEND_URL ?? 'http://localhost:3000', credentials: true },
  namespace: '/chat',
})
export class ChatGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(ChatGateway.name);
  /** socketId → userId mapping */
  private readonly socketUsers = new Map<string, string>();

  constructor(
    private readonly chatService: ChatService,
    private readonly jwtService: JwtService,
  ) {}

  async handleConnection(socket: Socket): Promise<void> {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ??
        socket.handshake.headers.authorization?.replace('Bearer ', '');
      if (!token) {
        socket.disconnect();
        return;
      }

      const payload = this.jwtService.verify(token);
      this.socketUsers.set(socket.id, payload.sub);
      socket.data.userId = payload.sub;
      socket.data.role = payload.role;
      this.logger.debug(`User ${payload.sub} connected [${socket.id}]`);
    } catch {
      socket.disconnect();
    }
  }

  handleDisconnect(socket: Socket): void {
    this.socketUsers.delete(socket.id);
    this.logger.debug(`Socket ${socket.id} disconnected`);
  }

  // ── Join a conversation room ────────────────────────────────

  @SubscribeMessage('join_conversation')
  async handleJoin(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId as string;
    if (!userId) throw new WsException('Unauthorized');

    const conv = await this.chatService.getConversation(data.conversationId);

    // Authorization: only buyer, seller, or admin can join
    const isParticipant =
      conv.buyerId === userId || conv.sellerId === userId || socket.data.role === 'ADMIN';
    if (!isParticipant) throw new WsException('Forbidden');

    await socket.join(`conv:${data.conversationId}`);
    await this.chatService.markRead(data.conversationId, userId);

    // Send last 50 messages on join
    const messages = await this.chatService.getMessages(data.conversationId, 50);
    socket.emit('message_history', {
      conversationId: data.conversationId,
      messages: messages.reverse(),
    });

    this.logger.debug(`User ${userId} joined conv ${data.conversationId}`);
  }

  // ── Send a message ─────────────────────────────────────────

  @SubscribeMessage('send_message')
  async handleMessage(
    @MessageBody()
    data: {
      conversationId: string;
      content: string;
      messageType?: MessageType;
      metadata?: Record<string, unknown>;
    },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId as string;
    if (!userId) throw new WsException('Unauthorized');

    const conv = await this.chatService.getConversation(data.conversationId);
    const senderType = conv.buyerId === userId ? MessageSenderType.BUYER : MessageSenderType.SELLER;

    const dto: SendMessageDto = {
      conversationId: data.conversationId,
      senderId: userId,
      senderType,
      content: data.content,
      messageType: data.messageType,
      metadata: data.metadata,
    };

    // Emit user message to room immediately (optimistic UI)
    const { userMessage, aiReply } = await this.chatService.sendMessage(dto);

    this.server.to(`conv:${data.conversationId}`).emit('message_received', {
      conversationId: data.conversationId,
      message: userMessage,
    });

    // If AI replied, emit AI message
    if (aiReply) {
      this.server.to(`conv:${data.conversationId}`).emit('message_received', {
        conversationId: data.conversationId,
        message: aiReply,
      });
    }
  }

  // ── Start new AI chat (convenience shortcut) ───────────────

  @SubscribeMessage('start_ai_chat')
  async handleStartAiChat(
    @MessageBody() data: { initialMessage?: string; orderId?: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId as string;
    if (!userId) throw new WsException('Unauthorized');

    const conv = await this.chatService.createConversation({
      type: ConversationType.AI_SUPPORT,
      buyerId: userId,
      orderId: data.orderId,
      initialMessage: data.initialMessage,
    });

    await socket.join(`conv:${conv.id}`);
    const messages = await this.chatService.getMessages(conv.id, 10);
    socket.emit('ai_chat_started', { conversation: conv, messages: messages.reverse() });
  }

  // ── Typing indicators ──────────────────────────────────────

  @SubscribeMessage('typing_start')
  handleTypingStart(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId as string;
    this.chatService.setTyping(data.conversationId, userId, true);
    socket.to(`conv:${data.conversationId}`).emit('typing_update', {
      conversationId: data.conversationId,
      typingUsers: this.chatService.getTypingUsers(data.conversationId),
    });
  }

  @SubscribeMessage('typing_stop')
  handleTypingStop(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    const userId = socket.data.userId as string;
    this.chatService.setTyping(data.conversationId, userId, false);
    socket.to(`conv:${data.conversationId}`).emit('typing_update', {
      conversationId: data.conversationId,
      typingUsers: this.chatService.getTypingUsers(data.conversationId),
    });
  }

  @SubscribeMessage('mark_read')
  async handleMarkRead(
    @MessageBody() data: { conversationId: string },
    @ConnectedSocket() socket: Socket,
  ) {
    await this.chatService.markRead(data.conversationId, socket.data.userId as string);
  }

  // ── Called by other services to push notifications ─────────

  pushMessageToRoom(conversationId: string, message: unknown): void {
    this.server.to(`conv:${conversationId}`).emit('message_received', { conversationId, message });
  }
}
