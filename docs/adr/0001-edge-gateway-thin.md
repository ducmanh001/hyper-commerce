# ADR 0001: Edge Gateway Must Stay Thin

## Status

Accepted

## Context

`api-gateway` hien tai dang ket hop nhieu vai tro:

- auth
- routing
- rate limit
- websocket coordination
- business endpoint
- truy cap truc tiep DB/Redis/Kafka

Khi quy mo team va traffic tang, gateway day logic nghiep vu se tro thanh:

- nut that ky thuat
- nut that to chuc
- noi de sinh coupling xuyen domain

## Decision

Gateway duoc xem la `edge layer`, khong phai domain service.

Gateway nen uu tien:

- authn/authz
- routing
- rate limiting
- observability
- request shaping
- websocket coordination

Gateway khong nen la source of truth cho domain state.

## Consequences

### Tot

- Boundary ro hon
- Domain ownership ro hon
- De tach service va scale doc lap

### Chi phi

- Can them service/domain API ro hon
- Can projection/read model cho cac endpoint tong hop
- Can refactor dan cac endpoint cu
