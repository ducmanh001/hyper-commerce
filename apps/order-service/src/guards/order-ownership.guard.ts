import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from '@hypercommerce/common';
import type { OrderRepository } from '../repositories/order.repository';

/**
 * OrderOwnershipGuard
 *
 * Ensures a user can only access their own orders.
 * Admins bypass this check.
 *
 * Applied at route level: @UseGuards(JwtAuthGuard, OrderOwnershipGuard)
 */
@Injectable()
export class OrderOwnershipGuard implements CanActivate {
  constructor(private readonly orderRepo: OrderRepository) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Request & { user: JwtPayload }>();
    const user = request.user;

    // Admins can access any order
    if (user.role === 'ADMIN' || user.role === 'SUPER_ADMIN') {
      return true;
    }

    const orderId = request.params['id'];
    if (!orderId) return false;

    const order = await this.orderRepo.findById(orderId);
    if (!order) throw new NotFoundException(`Order ${orderId} not found`);

    if (order.userId !== user.sub) {
      throw new ForbiddenException('You do not have access to this order');
    }

    return true;
  }
}
