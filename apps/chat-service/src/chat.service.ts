import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import type { Repository } from 'typeorm';
import type { ConfigService } from '@nestjs/config';
import OpenAI from 'openai';
import type { KafkaProducerService } from '@hypercommerce/kafka';
import type { RedisClientService } from '@hypercommerce/redis';
import { Conversation, ConversationType, ConversationStatus } from './entities/conversation.entity';
import { ChatMessage, MessageSenderType, MessageType } from './entities/message.entity';

const AI_SYSTEM_PROMPT = `Bạn là trợ lý AI của HyperCommerce — nền tảng thương mại xã hội Việt Nam.
Nhiệm vụ: hỗ trợ khách hàng về đơn hàng, sản phẩm, thanh toán, vận chuyển, và khiếu nại.

Nguyên tắc:
- Trả lời bằng ngôn ngữ mà khách dùng (tiếng Việt hoặc tiếng Anh)
- Thân thiện, chuyên nghiệp, ngắn gọn (tối đa 150 từ mỗi câu trả lời)
- Nếu cần tra cứu đơn hàng/sản phẩm → yêu cầu cung cấp mã đơn hàng
- Nếu vấn đề phức tạp (hoàn tiền >500K, tranh chấp, tài khoản bị khóa) → escalate sang nhân viên
- Luôn kết thúc bằng câu hỏi xem khách còn cần hỗ trợ gì không
- KHÔNG hứa hẹn điều gì không chắc chắn về thời gian giao hàng hay hoàn tiền`;

// Intent detection keywords → quick action mapping
const INTENT_KEYWORDS: Record<string, string> = {
  'hủy đơn|cancel order|huỷ đơn': 'cancel_order',
  'hoàn tiền|refund|trả hàng': 'refund',
  'giao hàng|shipping|vận chuyển|tracking': 'track_order',
  'thanh toán|payment|tiền': 'payment_issue',
  'tài khoản|account|đăng nhập|login': 'account_issue',
  'đánh giá|review|nhận xét': 'review',
};

// Escalation triggers — these always go to human
const ESCALATION_TRIGGERS = [
  'tài khoản bị khóa',
  'account banned',
  'fraud',
  'gian lận',
  'kiện',
  'báo cáo',
  'report',
  'bị lừa',
  'scam',
];

export interface SendMessageDto {
  conversationId: string;
  senderId: string;
  senderType: MessageSenderType;
  content: string;
  messageType?: MessageType;
  metadata?: Record<string, unknown>;
}

export interface CreateConversationDto {
  type: ConversationType;
  buyerId: string;
  sellerId?: string;
  orderId?: string;
  initialMessage?: string;
}

@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);
  private readonly openai: OpenAI;
  private readonly AI_MODEL = 'gpt-4o';
  private readonly MAX_CONTEXT_MESSAGES = 20;
  /** Active typing indicators: conversationId → Set<userId> */
  private readonly typingUsers = new Map<string, Set<string>>();

  constructor(
    @InjectRepository(Conversation)
    private readonly convRepo: Repository<Conversation>,
    @InjectRepository(ChatMessage)
    private readonly msgRepo: Repository<ChatMessage>,
    private readonly kafka: KafkaProducerService,
    private readonly redis: RedisClientService,
    private readonly config: ConfigService,
  ) {
    this.openai = new OpenAI({ apiKey: this.config.get<string>('OPENAI_API_KEY') });
  }

  // ── Conversation management ────────────────────────────────

  async createConversation(dto: CreateConversationDto): Promise<Conversation> {
    // Check for existing open AI conversation for this buyer
    if (dto.type === ConversationType.AI_SUPPORT) {
      const existing = await this.convRepo.findOne({
        where: {
          buyerId: dto.buyerId,
          type: ConversationType.AI_SUPPORT,
          status: ConversationStatus.OPEN,
        },
      });
      if (existing) return existing;
    }

    const conv = this.convRepo.create({
      type: dto.type,
      buyerId: dto.buyerId,
      sellerId: dto.sellerId,
      orderId: dto.orderId,
    });
    const saved = await this.convRepo.save(conv);

    if (dto.initialMessage) {
      await this.sendMessage({
        conversationId: saved.id,
        senderId: dto.buyerId,
        senderType: MessageSenderType.BUYER,
        content: dto.initialMessage,
      });
    } else if (dto.type === ConversationType.AI_SUPPORT) {
      // Auto-send greeting
      await this.saveAiMessage(
        saved.id,
        'Xin chào! Tôi là trợ lý AI của HyperCommerce. Tôi có thể giúp gì cho bạn hôm nay? 😊',
        [],
        0,
      );
    }

    return saved;
  }

  async getConversation(id: string): Promise<Conversation> {
    const conv = await this.convRepo.findOne({ where: { id } });
    if (!conv) throw new NotFoundException(`Conversation ${id} not found`);
    return conv;
  }

  async getMessages(conversationId: string, limit = 50, beforeId?: string): Promise<ChatMessage[]> {
    const qb = this.msgRepo
      .createQueryBuilder('m')
      .where('m.conversationId = :conversationId', { conversationId })
      .orderBy('m.createdAt', 'DESC')
      .take(limit);

    if (beforeId) {
      const ref = await this.msgRepo.findOne({ where: { id: beforeId } });
      if (ref) qb.andWhere('m.createdAt < :refDate', { refDate: ref.createdAt });
    }

    return qb.getMany();
  }

  async markRead(conversationId: string, userId: string): Promise<void> {
    const conv = await this.getConversation(conversationId);
    if (conv.buyerId === userId) {
      await this.convRepo.update(conversationId, { buyerUnreadCount: 0 });
    } else if (conv.sellerId === userId) {
      await this.convRepo.update(conversationId, { sellerUnreadCount: 0 });
    }
    await this.msgRepo.query(
      `UPDATE chat_messages SET "readAt" = NOW() WHERE "conversationId" = $1 AND "senderId" != $2 AND "readAt" IS NULL`,
      [conversationId, userId],
    );
  }

  // ── Message handling ───────────────────────────────────────

  async sendMessage(
    dto: SendMessageDto,
  ): Promise<{ userMessage: ChatMessage; aiReply?: ChatMessage }> {
    const conv = await this.getConversation(dto.conversationId);

    // Save user message
    const userMsg = await this.msgRepo.save(
      this.msgRepo.create({
        conversationId: dto.conversationId,
        senderType: dto.senderType,
        senderId: dto.senderId,
        messageType: dto.messageType ?? MessageType.TEXT,
        content: dto.content,
        metadata: dto.metadata,
      }),
    );

    // Update unread counts for the other party
    if (dto.senderType === MessageSenderType.BUYER) {
      await this.convRepo.update(dto.conversationId, {
        sellerUnreadCount: () => '"sellerUnreadCount" + 1',
        updatedAt: new Date(),
      });
    } else if (dto.senderType === MessageSenderType.SELLER) {
      await this.convRepo.update(dto.conversationId, {
        buyerUnreadCount: () => '"buyerUnreadCount" + 1',
        updatedAt: new Date(),
      });
    }

    // Publish Kafka event for notification-service
    await this.kafka.publish({
      topic: 'chat.message_sent',
      partitionKey: dto.conversationId,
      value: {
        conversationId: dto.conversationId,
        messageId: userMsg.id,
        senderType: dto.senderType,
        senderId: dto.senderId,
        buyerId: conv.buyerId,
        sellerId: conv.sellerId,
        preview: dto.content.substring(0, 100),
        correlationId: dto.conversationId,
      },
    });

    // AI response — only for AI_SUPPORT conversations where buyer sent a message
    if (conv.type === ConversationType.AI_SUPPORT && dto.senderType === MessageSenderType.BUYER) {
      const aiReply = await this.generateAiReply(conv, dto.content);
      return { userMessage: userMsg, aiReply };
    }

    return { userMessage: userMsg };
  }

  // ── AI reply generation ────────────────────────────────────

  private async generateAiReply(conv: Conversation, userMessage: string): Promise<ChatMessage> {
    // Check escalation triggers first (no LLM cost)
    if (this.shouldEscalate(userMessage)) {
      await this.escalateConversation(conv.id);
      return this.saveAiMessage(
        conv.id,
        'Tôi hiểu đây là vấn đề cần được xem xét kỹ hơn. Tôi đang kết nối bạn với nhân viên hỗ trợ của chúng tôi. Vui lòng đợi trong giây lát.',
        conv.aiContext,
        0,
      );
    }

    // Detect intent for quick action cards
    const intent = this.detectIntent(userMessage);

    // Build conversation context (last N messages)
    const context = [
      ...conv.aiContext.slice(-this.MAX_CONTEXT_MESSAGES),
      { role: 'user' as const, content: userMessage, timestamp: new Date().toISOString() },
    ];

    try {
      const completion = await this.openai.chat.completions.create({
        model: this.AI_MODEL,
        messages: [
          { role: 'system', content: AI_SYSTEM_PROMPT },
          ...context.map((m) => ({ role: m.role, content: m.content })),
        ],
        temperature: 0.7,
        max_tokens: 300,
      });

      const replyText =
        completion.choices[0].message.content ??
        'Xin lỗi, tôi không thể xử lý yêu cầu này. Bạn vui lòng thử lại.';
      const tokensUsed = completion.usage?.total_tokens ?? 0;

      // Persist updated context in conversation
      const newContext = [
        ...context,
        { role: 'assistant' as const, content: replyText, timestamp: new Date().toISOString() },
      ].slice(-this.MAX_CONTEXT_MESSAGES);

      await this.convRepo.update(conv.id, { aiContext: newContext });

      const metadata = intent
        ? { intent, quickReplies: this.quickRepliesForIntent(intent) }
        : undefined;
      return this.saveAiMessage(conv.id, replyText, context, tokensUsed, metadata);
    } catch (err) {
      this.logger.error('OpenAI call failed', err);
      return this.saveAiMessage(
        conv.id,
        'Xin lỗi, hệ thống đang gặp sự cố. Vui lòng thử lại sau.',
        context,
        0,
      );
    }
  }

  private async saveAiMessage(
    conversationId: string,
    content: string,
    context: unknown[],
    tokensUsed: number,
    metadata?: Record<string, unknown>,
  ): Promise<ChatMessage> {
    return this.msgRepo.save(
      this.msgRepo.create({
        conversationId,
        senderType: MessageSenderType.AI,
        messageType: metadata?.quickReplies ? MessageType.QUICK_REPLY : MessageType.TEXT,
        content,
        tokensUsed,
        metadata,
      }),
    );
  }

  private async escalateConversation(conversationId: string): Promise<void> {
    await this.convRepo.update(conversationId, { status: ConversationStatus.ESCALATED });
    await this.kafka.publish({
      topic: 'chat.escalated',
      partitionKey: conversationId,
      value: {
        conversationId,
        escalatedAt: new Date().toISOString(),
        correlationId: conversationId,
      },
    });
    this.logger.log(`Conversation ${conversationId} escalated to human`);
  }

  // ── Typing indicator (Redis, no DB write) ─────────────────

  setTyping(conversationId: string, userId: string, isTyping: boolean): void {
    if (!this.typingUsers.has(conversationId)) {
      this.typingUsers.set(conversationId, new Set());
    }
    const set = this.typingUsers.get(conversationId)!;
    isTyping ? set.add(userId) : set.delete(userId);
  }

  getTypingUsers(conversationId: string): string[] {
    return [...(this.typingUsers.get(conversationId) ?? [])];
  }

  // ── Utility ────────────────────────────────────────────────

  private shouldEscalate(message: string): boolean {
    const lower = message.toLowerCase();
    return ESCALATION_TRIGGERS.some((trigger) => lower.includes(trigger));
  }

  private detectIntent(message: string): string | null {
    const lower = message.toLowerCase();
    for (const [pattern, intent] of Object.entries(INTENT_KEYWORDS)) {
      if (new RegExp(pattern, 'i').test(lower)) return intent;
    }
    return null;
  }

  private quickRepliesForIntent(intent: string): string[] {
    const replies: Record<string, string[]> = {
      cancel_order: ['Xem đơn hàng của tôi', 'Điều kiện hủy đơn', 'Hủy ngay'],
      refund: ['Cách hoàn tiền', 'Thời gian hoàn tiền', 'Tạo yêu cầu hoàn tiền'],
      track_order: ['Xem trạng thái đơn hàng', 'Liên hệ shipper', 'Đơn hàng bị trễ'],
      payment_issue: ['Phương thức thanh toán', 'Thanh toán thất bại', 'Hóa đơn của tôi'],
    };
    return replies[intent] ?? [];
  }
}
