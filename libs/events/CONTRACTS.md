# Event Contract Governance

Tai lieu nay bo sung cho `EVENTS.md` va quy dinh cach thay doi event contract.

## Nguyen tac

- Moi topic co owner ro rang theo domain.
- Producer khong duoc thay doi payload theo cach pha backward compatibility ma khong version hoa.
- Consumer phai chap nhan field moi ma khong vo.

## Dinh danh

- Topic dat ten theo domain + event.
- Vi du:
  - `order-created`
  - `payment-captured`
  - `analytics-events`

## Phien ban

- Them field moi: hop le neu consumer cu van bo qua duoc.
- Xoa field hoac doi nghia field: phai tao version moi.
- Khi can breaking change:
  - tao topic moi, hoac
  - them `schemaVersion`

## Payload toi thieu

Moi event nghiep vu quan trong nen co:

- `eventId`
- `eventName`
- `occurredAt`
- `aggregateId`
- `aggregateType`
- `schemaVersion`
- `producer`
- `payload`

## Reliability

- Producer critical path nen dung outbox hoac co co che replay duoc.
- Consumer phai idempotent.
- Topic critical phai co retry strategy va DLQ strategy ro rang.

## Review checklist

- Event nay do team nao own?
- Co consumer nao dang doc khong?
- Thay doi nay co backward-compatible khong?
- Can replay du lieu cu khong?
- Can cap nhat dashboard/alert/runbook khong?
