// libs/grpc/src/grpc.module.ts
// NestJS gRPC microservice configuration.
// Provides helper functions to register gRPC microservices and clients.

import { join } from 'path';
import type { ClientProviderOptions, GrpcOptions } from '@nestjs/microservices';
import { Transport } from '@nestjs/microservices';

// Path to proto files (resolved at runtime)
const PROTO_DIR = join(__dirname, 'proto');

export const GRPC_SERVICES = {
  USER: 'hypercommerce.user.UserService',
  ORDER: 'hypercommerce.order.OrderService',
  INVENTORY: 'hypercommerce.inventory.InventoryService',
  SEARCH: 'hypercommerce.search.SearchService',
  PAYMENT: 'hypercommerce.payment.PaymentService',
} as const;

export type GrpcServiceName = (typeof GRPC_SERVICES)[keyof typeof GRPC_SERVICES];

// Injection tokens for gRPC clients
export const GRPC_USER_SERVICE = 'GRPC_USER_SERVICE';
export const GRPC_ORDER_SERVICE = 'GRPC_ORDER_SERVICE';
export const GRPC_INVENTORY_SERVICE = 'GRPC_INVENTORY_SERVICE';
export const GRPC_SEARCH_SERVICE = 'GRPC_SEARCH_SERVICE';
export const GRPC_PAYMENT_SERVICE = 'GRPC_PAYMENT_SERVICE';

// Default port assignments (override via env vars)
export const GRPC_PORTS = {
  USER: 5001,
  ORDER: 5002,
  INVENTORY: 5003,
  SEARCH: 5004,
  PAYMENT: 5005,
  FEED: 5006,
  NOTIFICATION: 5007,
  AI: 5008,
} as const;

/**
 * Build gRPC microservice options (for main.ts connectMicroservice).
 * Usage:
 *   app.connectMicroservice(grpcMicroserviceOptions('USER', ['user']));
 */
export function grpcMicroserviceOptions(
  service: keyof typeof GRPC_PORTS,
  packages: string[],
  protoFiles: string[],
): GrpcOptions {
  const port = parseInt(process.env[`GRPC_${service}_PORT`] ?? '', 10) || GRPC_PORTS[service];

  return {
    transport: Transport.GRPC,
    options: {
      url: `0.0.0.0:${port}`,
      package: packages.map((p) => `hypercommerce.${p}`),
      protoPath: protoFiles.map((f) => join(PROTO_DIR, `${f}.proto`)),
      maxReceiveMessageLength: 1024 * 1024 * 10, // 10MB
      maxSendMessageLength: 1024 * 1024 * 10,
      keepalive: {
        keepaliveTimeMs: 10000,
        keepaliveTimeoutMs: 5000,
        keepalivePermitWithoutCalls: 1,
        http2MaxPingsWithoutData: 0,
      },
    },
  };
}

/**
 * Build gRPC client options (for ClientsModule.register).
 * Usage:
 *   ClientsModule.register([grpcClientOptions('USER_CLIENT', 'USER', ['user'])])
 */
export function grpcClientOptions(
  name: string,
  service: keyof typeof GRPC_PORTS,
  packages: string[],
  protoFiles: string[],
  host?: string,
): ClientProviderOptions {
  const port = parseInt(process.env[`GRPC_${service}_PORT`] ?? '', 10) || GRPC_PORTS[service];

  const resolvedHost = host ?? process.env[`GRPC_${service}_HOST`] ?? 'localhost';

  return {
    name,
    transport: Transport.GRPC,
    options: {
      url: `${resolvedHost}:${port}`,
      package: packages.map((p) => `hypercommerce.${p}`),
      protoPath: protoFiles.map((f) => join(PROTO_DIR, `${f}.proto`)),
      maxReceiveMessageLength: 1024 * 1024 * 10,
      maxSendMessageLength: 1024 * 1024 * 10,
    },
  };
}

// ── Pre-built client registrations ───────────────────────────

export const USER_GRPC_CLIENT = grpcClientOptions(GRPC_USER_SERVICE, 'USER', ['user'], ['user']);

export const ORDER_GRPC_CLIENT = grpcClientOptions(
  GRPC_ORDER_SERVICE,
  'ORDER',
  ['order'],
  ['order'],
);

export const INVENTORY_GRPC_CLIENT = grpcClientOptions(
  GRPC_INVENTORY_SERVICE,
  'INVENTORY',
  ['inventory'],
  ['inventory'],
);

export const SEARCH_GRPC_CLIENT = grpcClientOptions(
  GRPC_SEARCH_SERVICE,
  'SEARCH',
  ['search'],
  ['search'],
);

export const PAYMENT_GRPC_CLIENT = grpcClientOptions(
  GRPC_PAYMENT_SERVICE,
  'PAYMENT',
  ['payment'],
  ['payment'],
);
