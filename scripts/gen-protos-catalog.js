#!/usr/bin/env node
/**
 * gen-protos-catalog.js
 * Auto-generates libs/grpc/PROTOS.md from *.proto files
 * Triggered by lint-staged when any proto file changes.
 */

const fs = require('fs');
const path = require('path');
const { globSync } = require('glob');

const PROTO_DIR = path.resolve(__dirname, '../libs/grpc/src/proto');
const OUT = path.resolve(__dirname, '../libs/grpc/PROTOS.md');

/** Parse a single .proto file → { package, serviceName, methods[], messages{} } */
function parseProto(content) {
  const pkg = (content.match(/^package\s+([\w.]+);/m) || [])[1] || '';
  const serviceMatch = content.match(/service\s+(\w+)\s*\{([\s\S]*?)\}/);
  if (!serviceMatch) return null;

  const serviceName = serviceMatch[1];
  const serviceBody = serviceMatch[2];

  const methods = [];
  const rpcRe = /rpc\s+(\w+)\s*\((\w+)\)\s*returns\s*\((\w+)\)/g;
  let m;
  while ((m = rpcRe.exec(serviceBody)) !== null) {
    methods.push({ name: m[1], request: m[2], response: m[3] });
  }

  // Extract message fields (first-level only, for key messages)
  const messages = {};
  const msgRe = /message\s+(\w+)\s*\{([\s\S]*?)\}/g;
  while ((m = msgRe.exec(content)) !== null) {
    const msgName = m[1];
    const msgBody = m[2];
    const fields = [];
    const fieldRe = /(?:repeated\s+)?(\w+)\s+(\w+)\s*=\s*\d+;(?:\s*\/\/\s*(.*))?/g;
    let fm;
    while ((fm = fieldRe.exec(msgBody)) !== null) {
      fields.push({ type: fm[1], name: fm[2], comment: (fm[3] || '').trim() });
    }
    if (fields.length > 0) messages[msgName] = fields;
  }

  return { pkg, serviceName, methods, messages };
}

/** Port map per service name */
const PORTS = {
  InventoryService: '50052',
  OrderService: '50053',
  PaymentService: '50054',
  SearchService: '50055',
  UserService: '50051',
};

/** Which services call each gRPC service */
const CALLERS = {
  InventoryService: 'order-service, flash-sale',
  OrderService: 'payment-service, analytics',
  PaymentService: 'order-service, admin-service',
  SearchService: 'api-gateway, feed-service',
  UserService: 'feed-service, live-service, notification',
};

const protoFiles = globSync(`${PROTO_DIR}/*.proto`).sort();
const services = [];

for (const file of protoFiles) {
  const content = fs.readFileSync(file, 'utf8');
  const parsed = parseProto(content);
  if (parsed) services.push({ file: path.basename(file), ...parsed });
}

const now = new Date().toISOString().slice(0, 10);

let md = `# gRPC Services Catalog

> Auto-generated from \`libs/grpc/src/proto/*.proto\`
> Last updated: ${now} — do not edit manually, changes will be overwritten.

---

## Routing Table

| Service | Proto file | Port | Implements | Called by |
|---|---|---|---|---|
`;

for (const svc of services) {
  const port = PORTS[svc.serviceName] || '—';
  const impl = svc.serviceName.replace('Service', '').toLowerCase() + '-service';
  const callers = CALLERS[svc.serviceName] || '—';
  md += `| \`${svc.serviceName}\` | \`${svc.file}\` | \`:${port}\` | ${impl} | ${callers} |\n`;
}

for (const svc of services) {
  const port = PORTS[svc.serviceName] || '—';
  md += `
---

## ${svc.serviceName} — \`${svc.pkg}\`

| Method | Request | Response | Notes |
|---|---|---|---|
`;
  for (const method of svc.methods) {
    // Get key fields from request message
    const reqFields = svc.messages[method.request] || [];
    const reqSummary = reqFields.slice(0, 3).map(f => f.name).join(', ') || method.request;
    const comment = reqFields.find(f => f.comment)?.comment || '';
    md += `| \`${method.name}\` | \`${method.request}\` (${reqSummary}) | \`${method.response}\` | ${comment} |\n`;
  }
}

md += `
---

## Client Usage Pattern

\`\`\`typescript
@Client({
  transport: Transport.GRPC,
  options: {
    package: 'hypercommerce.{service}',
    protoPath: join(__dirname, '../proto/{service}.proto'),
    url: 'localhost:{port}',
  },
})
private grpcClient: ClientGrpc;

onModuleInit() {
  this.svc = this.grpcClient.getService<ServiceInterface>('{ServiceName}');
}

// Call (returns Observable — wrap with firstValueFrom):
const result = await firstValueFrom(this.svc.methodName(request));
\`\`\`

---

## gRPC Status → HTTP mapping

| gRPC Status | HTTP | Scenario |
|---|---|---|
| \`NOT_FOUND (5)\` | 404 | Resource not found |
| \`INVALID_ARGUMENT (3)\` | 400 | Bad input |
| \`FAILED_PRECONDITION (9)\` | 409 | Insufficient stock / conflict |
| \`UNAUTHENTICATED (16)\` | 401 | Missing/invalid token |
| \`UNAVAILABLE (14)\` | 503 | Service down |
`;

fs.writeFileSync(OUT, md, 'utf8');
const totalMethods = services.reduce((s, svc) => s + svc.methods.length, 0);
console.log(`✅ PROTOS.md regenerated (${services.length} services, ${totalMethods} methods)`);
