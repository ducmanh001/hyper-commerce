// ============================================================
// HYPERCOMMERCE — Tools: Service Call Tools
//
// Pre-built tools for agents to call internal services.
// Provides typed, validated interfaces so agents don't need
// to construct raw HTTP requests.
// ============================================================

import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { AxiosInstance } from 'axios';
import axios from 'axios';

export interface OrderDetails {
  orderId: string;
  userId: string;
  status: string;
  totalAmount: number;
  items: Array<{ productId: string; name: string; quantity: number; price: number }>;
  createdAt: string;
  shippingAddress: string;
  trackingNumber?: string;
}

export interface RefundResult {
  success: boolean;
  refundId?: string;
  amount: number;
  error?: string;
}

@Injectable()
export class ServiceCallToolsService {
  private readonly logger = new Logger(ServiceCallToolsService.name);
  private readonly http: AxiosInstance;

  // Service base URLs (internal, not exposed externally)
  private readonly ORDER_URL: string;
  private readonly PAYMENT_URL: string;
  private readonly INVENTORY_URL: string;
  private readonly USER_URL: string;

  constructor(private readonly config: ConfigService) {
    this.ORDER_URL = config.get('ORDER_SERVICE_URL') ?? 'http://order-service:3003';
    this.PAYMENT_URL = config.get('PAYMENT_SERVICE_URL') ?? 'http://payment-service:3007';
    this.INVENTORY_URL = config.get('INVENTORY_SERVICE_URL') ?? 'http://inventory-service:3004';
    this.USER_URL = config.get('USER_SERVICE_URL') ?? 'http://user-service:3001';

    this.http = axios.create({
      timeout: 5000,
      headers: {
        'X-Internal-Token': config.get('INTERNAL_SERVICE_TOKEN') ?? '',
        'Content-Type': 'application/json',
      },
    });
  }

  // ── Order Tools ────────────────────────────────────────────

  async getOrderDetails(orderId: string): Promise<OrderDetails | null> {
    try {
      const { data } = await this.http.get<OrderDetails>(`${this.ORDER_URL}/v1/orders/${orderId}`);
      return data;
    } catch (err) {
      this.logger.warn(`Failed to fetch order ${orderId}`, err);
      return null;
    }
  }

  async getUserOrders(userId: string, limit = 5): Promise<OrderDetails[]> {
    try {
      const { data } = await this.http.get<{ orders: OrderDetails[] }>(
        `${this.ORDER_URL}/v1/orders?userId=${userId}&limit=${limit}`,
      );
      return data.orders;
    } catch {
      return [];
    }
  }

  // ── Payment Tools ──────────────────────────────────────────

  async initiateRefund(
    orderId: string,
    amount: number,
    reason: string,
    correlationId: string,
  ): Promise<RefundResult> {
    try {
      const { data } = await this.http.post<RefundResult>(
        `${this.PAYMENT_URL}/v1/refunds`,
        { orderId, amount, reason },
        { headers: { 'X-Correlation-Id': correlationId } },
      );
      return data;
    } catch (err: unknown) {
      const errorMessage = axios.isAxiosError(err)
        ? (err.response?.data as { message?: string })?.message
        : String(err);
      return { success: false, amount, error: errorMessage ?? 'Refund failed' };
    }
  }

  // ── Inventory Tools ────────────────────────────────────────

  async checkStock(productId: string, variantId: string): Promise<number> {
    try {
      const { data } = await this.http.get<{ available: number }>(
        `${this.INVENTORY_URL}/v1/stock/${productId}/${variantId}`,
      );
      return data.available;
    } catch {
      return 0;
    }
  }

  // ── User Tools ─────────────────────────────────────────────

  async getUserProfile(userId: string): Promise<{ name: string; email: string } | null> {
    try {
      const { data } = await this.http.get(`${this.USER_URL}/v1/users/${userId}`);
      return data as { name: string; email: string };
    } catch {
      return null;
    }
  }
}
