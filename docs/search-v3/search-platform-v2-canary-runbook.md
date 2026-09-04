# Search Platform V2 — Canary và rollback runbook

Tài liệu này là operational gate cho P9. Không bật traffic canary nếu chưa có
đủ báo cáo định lượng và browser E2E thật. Các ngưỡng trong runbook khớp với
`src/backend/services/search/search-canary-gate.ts`.

## Ownership

- **Search Platform On-call:** điều phối rollout, theo dõi latency/error và
  thực hiện stop-the-line.
- **Taxonomy/Data owner:** chịu trách nhiệm catalog version, translation,
  collision, review queue và projection invariant.
- **SRE/Release owner:** chịu trách nhiệm migration, feature flags, canary
  traffic, rollback drill và lưu evidence.

Mọi lệnh publish/rollback catalog vẫn phải đi qua Admin Request Boundary,
step-up, optimistic concurrency và idempotency key. Không sửa trực tiếp active
pointer bằng SQL trong production.

## Feature flags và thứ tự bật

Các flag server-side đều mặc định an toàn theo code:

| Flag | Mặc định | Mục đích |
| --- | --- | --- |
| `SEARCH_DB_CATALOG_ENABLED` | `true` | Chọn DB catalog; tắt để fallback nguyên snapshot static |
| `SEARCH_TYPO_V2_ENABLED` | `true` | Bật/tắt auto typo correction V2 |
| `SEARCH_RETRIEVAL_V2_ENABLED` | `true` | Bật/tắt retrieval variants V2 |
| `SEARCH_RANKING_V2_ENABLED` | `true` | Bật/tắt scoring/ranking V2 |
| `SEARCH_RELAXATION_ENABLED` | `true` | Bật/tắt related-title/relaxation tier |
| `SEARCH_SEMANTIC_FALLBACK_ENABLED` | `false` | Semantic fallback có timeout/circuit breaker |

Bật theo thứ tự: DB catalog → typo → retrieval → ranking → relaxation →
semantic. Mỗi thay đổi phải ghi flag snapshot, catalog/resolver version, owner,
thời gian và evidence. Tắt từng flag để rollback nóng; không drop migration.

## Stop-the-line thresholds

Gate yêu cầu tối thiểu 100 mẫu và dừng ngay khi một điều kiện sau không đạt:

- error rate > 1%;
- supported zero-result rate > 2%;
- wrong auto-correction > 1% hoặc critical wrong-correction > 0%;
- catalog fallback > 5% hoặc candidate-cap rate > 5%;
- Search p95 > 2.000 ms hoặc p99 > 5.000 ms;
- relevance, projection invariant, migration hoặc browser E2E không PASS;
- runtime catalog version không quan sát được;
- rollback chưa sẵn sàng.

Report phải chứa số liệu bounded, không ghi raw query/title/user ID. Kiểm tra
report bằng:

```powershell
npm run search:canary:gate --workspace @smarthire/web -- --report <report.json>
```

Gate trả non-zero và mã `stopLineReasons` ổn định khi phải dừng. Self-test của
gate chạy được trong CI:

```powershell
npm run search:canary:gate:self-test --workspace @smarthire/web
```

## Rollout checklist

1. Deploy additive migrations và xác nhận `db:status`, migration sequence,
   Prisma validate.
2. Deploy provider/dual-read-write với fallback còn bật.
3. Bootstrap draft, chạy audit/reconcile dry-run rồi apply theo batch; xác nhận
   missing/stale/orphan/review invariant bằng 0.
4. Publish catalog qua Admin UI/API có rationale; ghi version/revision.
5. Chạy Search relevance, performance, contract/security, frontend/accessibility
   và browser E2E trên production-like data.
6. Tạo canary report, chạy `search:canary:gate`; chỉ bật traffic nhỏ khi gate
   PASS.
7. Theo dõi các ngưỡng trong ít nhất một release window; tăng traffic theo
   approval của Release owner.

## Rollback procedure

1. Nếu lỗi ở typo/retrieval/ranking/relaxation/semantic, tắt đúng flag lỗi và
   giữ `SEARCH_DB_CATALOG_ENABLED` nếu catalog còn hợp lệ.
2. Nếu catalog lỗi, tắt `SEARCH_DB_CATALOG_ENABLED` để fallback nguyên snapshot
   static; không dùng partial rows.
3. Nếu cần khôi phục taxonomy, dùng Admin rollback tới version đã validate với
   expected revision mới nhất, reason và idempotency key riêng.
4. Xác nhận request mới nhìn thấy catalog version cũ; request đang chạy hoàn
   tất theo snapshot đã capture.
5. Chạy lại reconcile dry-run/apply idempotently, performance và canary gate
   trước khi bật lại traffic.
6. Ghi lại correlation ID, version/revision, flag snapshot, metrics trước/sau,
   người thực hiện và thời điểm. Không xoá audit append-only.

## Evidence bắt buộc

Mỗi rollout/rollback phải lưu:

- canary report đã qua `search:canary:gate`;
- output relevance/performance và projection/catalog audit;
- browser E2E matrix (EN/VI, themes, viewport 320 px/200% zoom, reduced motion,
  keyboard, axe);
- migration status và build artifact;
- correlation IDs của publish/rollback và active runtime version sau switch;
- quyết định owner nếu tiếp tục hoặc stop-the-line.

Tại thời điểm viết runbook, browser runtime staging/canary thật chưa được
khởi tạo trong môi trường local; do đó runbook và gate đã sẵn sàng nhưng P9
không được đánh dấu hoàn tất nếu chưa có evidence staging thực tế.
