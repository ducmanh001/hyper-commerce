# ADR 0002: Web Session Uses HttpOnly Cookies

## Status

Accepted

## Context

Web app tung luu access token va refresh token trong client-side persisted store.
Dieu nay de gay rui ro hon khi co XSS va lam token bi phat tan qua rong trong FE layer.

## Decision

Web session se su dung:

- `httpOnly` cookie cho `access token`
- `httpOnly` cookie cho `refresh token`
- FE store chi giu `user snapshot`
- BFF route doc cookie va forward token toi gateway khi can

Ngoai le tam thoi:

- Luong WebSocket/live co the dung route cap `socket token` trung gian cho den khi co co che token rieng ngan han.

## Consequences

### Tot

- Giam phu thuoc vao local storage cho auth
- Giam nguy co lo token qua browser persistence
- Request same-origin qua BFF don gian hon

### Chi phi

- Can them bootstrap session
- Can chuan hoa logout/session sync
- Luong websocket can migration rieng
