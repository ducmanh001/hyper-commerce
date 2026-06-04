import {
  Controller,
  Post,
  Get,
  Patch,
  Body,
  Param,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import type { JwtPayload } from '@hypercommerce/common';
import { JwtAuthGuard, CurrentUser } from '@hypercommerce/common';
import type { ChatService, CreateConversationDto } from './chat.service';
import { ConversationType } from './entities/conversation.entity';
import { MessageSenderType } from './entities/message.entity';

@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  @Post('conversations')
  @ApiOperation({ summary: 'Start a new conversation (AI or buyer-seller)' })
  async createConversation(
    @Body()
    body: { type: ConversationType; sellerId?: string; orderId?: string; initialMessage?: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const dto: CreateConversationDto = {
      type: body.type ?? ConversationType.AI_SUPPORT,
      buyerId: user.sub,
      sellerId: body.sellerId,
      orderId: body.orderId,
      initialMessage: body.initialMessage,
    };
    return this.chatService.createConversation(dto);
  }

  @Get('conversations/:id/messages')
  @ApiOperation({ summary: 'Get paginated messages for a conversation' })
  async getMessages(
    @Param('id') id: string,
    @Query('limit') limit = 50,
    @Query('beforeId') beforeId?: string,
  ) {
    return this.chatService.getMessages(id, Number(limit), beforeId);
  }

  @Patch('conversations/:id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Mark all messages as read' })
  async markRead(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
    await this.chatService.markRead(id, user.sub);
  }

  @Post('conversations/:id/messages')
  @ApiOperation({ summary: 'Send a message (REST fallback — prefer WebSocket)' })
  async sendMessage(
    @Param('id') id: string,
    @Body() body: { content: string },
    @CurrentUser() user: JwtPayload,
  ) {
    const conv = await this.chatService.getConversation(id);
    return this.chatService.sendMessage({
      conversationId: id,
      senderId: user.sub,
      senderType: conv.buyerId === user.sub ? MessageSenderType.BUYER : MessageSenderType.SELLER,
      content: body.content,
    });
  }
}
