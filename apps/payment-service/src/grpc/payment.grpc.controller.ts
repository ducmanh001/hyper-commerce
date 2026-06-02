// apps/payment-service/src/grpc/payment.grpc.controller.ts
// gRPC for internal payment queries from order-service, notification-service.

import { Controller, UseFilters } from '@nestjs/common';
import { GrpcMethod } from '@nestjs/microservices';
import { GrpcExceptionFilter } from '@hypercommerce/grpc';

interface GetPaymentStatusRequest {
  paymentId: string;
}

interface GetPaymentByOrderRequest {
  orderId: string;
}

interface RefundPaymentRequest {
  paymentId: string;
  amount: number;
  reason: string;
  requestedBy: string;
}

@Controller()
@UseFilters(new GrpcExceptionFilter())
export class PaymentGrpcController {
  // constructor(private readonly paymentService: PaymentService) {}

  @GrpcMethod('PaymentService', 'GetPaymentStatus')
  async getPaymentStatus(data: GetPaymentStatusRequest) {
    // const payment = await this.paymentService.findById(data.paymentId);
    return {
      paymentId: data.paymentId,
      orderId: '',
      status: 'COMPLETED',
      method: 'stripe',
      amount: 0,
      currency: 'VND',
      gatewayTransactionId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  @GrpcMethod('PaymentService', 'GetPaymentByOrder')
  async getPaymentByOrder(data: GetPaymentByOrderRequest) {
    // const payment = await this.paymentService.findByOrderId(data.orderId);
    return {
      paymentId: '',
      orderId: data.orderId,
      status: 'COMPLETED',
      method: 'stripe',
      amount: 0,
      currency: 'VND',
      gatewayTransactionId: '',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
  }

  @GrpcMethod('PaymentService', 'RefundPayment')
  async refundPayment(data: RefundPaymentRequest) {
    // const result = await this.paymentService.refund(data.paymentId, data.amount, data.reason);
    return {
      success: true,
      refundId: `refund_${data.paymentId}_${Date.now()}`,
      message: 'Refund initiated',
    };
  }
}
