import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiOkResponse } from '@nestjs/swagger';
import { JwtAuthGuard, CurrentUser } from '@hypercommerce/common';
import type { WalletService } from './wallet.service';
import type { TopupDto, TransactionQueryDto } from './dto/wallet.dto';

interface AuthUser {
  id: string;
}

@ApiTags('Wallet')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  // GET /api/v1/wallet/balance
  @Get('balance')
  @ApiOperation({ summary: 'Get current wallet balance (VND dong)' })
  @ApiOkResponse({ description: 'Returns balance in VND dong' })
  async getBalance(@CurrentUser() user: AuthUser) {
    const balance = await this.walletService.getBalance(user.id);
    return { userId: user.id, balance };
  }

  // POST /api/v1/wallet/topup
  @Post('topup')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Top up wallet — rate limited 5/hour' })
  async topup(@CurrentUser() user: AuthUser, @Body() dto: TopupDto) {
    const tx = await this.walletService.topup(user.id, dto.amount, dto.refId);
    return {
      transactionId: tx.id,
      amount: tx.amount,
      balanceAfter: tx.balanceAfter,
      type: tx.type,
      createdAt: tx.createdAt,
    };
  }

  // GET /api/v1/wallet/transactions
  @Get('transactions')
  @ApiOperation({ summary: 'List wallet transactions for current user' })
  async listTransactions(@CurrentUser() user: AuthUser, @Query() query: TransactionQueryDto) {
    const items = await this.walletService.listTransactions(user.id, query);
    return { data: items, total: items.length };
  }
}
