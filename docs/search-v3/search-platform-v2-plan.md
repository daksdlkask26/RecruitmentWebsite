# Job Search Platform V2 — E2E Remediation and Quality Plan

> Kế hoạch thực thi độc lập dành cho Codex trong repository `D:\HCMUS\PROJECT`.
> Chỉ triển khai trực tiếp trong `web/` và các file CI/package liên quan ở repository root.
> Không tạo, chỉnh sửa hoặc đồng bộ bất kỳ nội dung nào trong `spec-kit/`.

## 0. Trạng thái và cách sử dụng

- **Mục tiêu:** hoàn thiện Job Search song ngữ Anh–Việt, chịu lỗi typo, có taxonomy vận hành được, ranking đúng, UI minh bạch và quality gate E2E.
- **Phạm vi chính:** Job Search. Company Search chỉ sửa phần nền tảng dùng chung, regression và test gate liên quan.
- **Trạng thái ban đầu:** chưa đạt release gate.
- Codex phải triển khai tuần tự; chỉ đổi `[ ]` thành `[x]` khi có bằng chứng kiểm thử hoặc dữ liệu.
- Sau mỗi phase, cập nhật “Execution evidence”; không sửa acceptance criteria để hợp thức hóa kết quả.

“E2E hoàn chỉnh” không phải lời hứa tuyệt đối không bao giờ có bug. Nó nghĩa là mọi invariant, regression corpus, migration, browser flow, accessibility, relevance, performance và rollback gate đã đạt bằng bằng chứng có thể lặp lại.

---

## 1. Chỉ dẫn bắt buộc cho Codex

### 1.1. An toàn repository và database

1. Đọc `AGENTS.md`; dùng CodeGraph trước `rg`/đọc file khi cần hiểu code.
2. Chạy `git status --short` và xem focused diff trước mỗi phase.
3. Bảo toàn worktree; không reset, clean, restore, checkout đè hoặc format ngoài phạm vi.
4. Không tự commit, push, merge hoặc tạo PR khi chưa được yêu cầu.
5. Không chỉnh sửa `spec-kit/`.
6. Không dùng `prisma db push`, reset database, sửa migration đã deploy hoặc xóa dữ liệu để làm test pass.
7. Migration mới phải additive, forward-compatible và theo đúng sequence hiện tại.
8. Không sửa generated Prisma trực tiếp; sửa schema/version rồi generate bằng command chuẩn.
9. Script ghi dữ liệu phải dry-run mặc định, chỉ ghi với flag rõ như `--apply`.
10. Không log raw query, dữ liệu cá nhân hoặc private job content trong metric/CI artifact mặc định.

### 1.2. Kỷ luật triển khai

1. Không viết special case trong resolver cho từng câu như `bác sĩ`, `bảo vệ`, `frotend`.
2. Sửa đúng abstraction: normalization, taxonomy, vocabulary, resolver, retrieval hoặc ranking.
3. Không dùng occupation label rộng để giả làm bản dịch title.
4. Không tự gắn dữ liệu máy sinh thành `HUMAN_VERIFIED`.
5. LLM/embedding chỉ tạo suggestion/fallback có feature flag; không quyết định canonical mapping.
6. Không dùng semantic search để che lỗi lexical/taxonomy.
7. Không dùng OR vô điều kiện để “luôn có kết quả”.
8. `LITERAL` không translation/alias expansion, typo correction hoặc semantic fallback.
9. Mỗi request dùng một catalog snapshot/version từ resolve đến recovery.
10. Không báo hoàn thành nếu mới có schema/interface/helper/test nhưng production call path chưa dùng.

### 1.3. Quy chuẩn UI/UX

- Giữ route, URL contract, Search button fallback và Back/Forward.
- Dùng component hiện có và token `--sh-*` từ `web/src/frontend/styles/tokens.css`.
- Không thêm theme/font/màu hardcode song song.
- Candidate Search hỗ trợ EN/VI qua i18n hiện hành; không hardcode copy trong component.
- Hỗ trợ keyboard, focus-visible, screen reader, 200% zoom, responsive, dark mode và reduced motion.
- Không gọi deterministic translation/typo correction là “AI Search”.
- Chỉ gắn nhãn AI khi thật sự dùng semantic/LLM suggestion và nói rõ đây là gợi ý.
- Guided empty state chỉ dùng khi có hành động phục hồi thật.

---

## 2. Baseline đã xác minh ngày 2026-09-02

Codex phải chạy lại trước khi sửa vì dữ liệu có thể thay đổi.

### 2.1. Dữ liệu và catalog

| Chỉ số                            | Baseline |
| --------------------------------- | -------: |
| Tổng `JobPosting`                 |   51.943 |
| Candidate-visible jobs            |   14.187 |
| Distinct candidate-visible titles |      398 |
| `JobSearchProjection`             |   14.187 |
| Compiled title definitions        |      398 |
| `AUTO_HIGH_CONFIDENCE`            |       20 |
| `REQUIRES_REVIEW`                 |      374 |
| `INTENTIONAL_UNTRANSLATED`        |        4 |
| `HUMAN_VERIFIED`                  |        0 |
| Pending `SearchMappingReview`     |      378 |

`canonical.vi = English title` không được tính là bản dịch Việt. Coverage schema 398/398 không đồng nghĩa coverage song ngữ 398/398.

### 2.2. Regression thực tế

| Query                       | Baseline                       | Kết quả bắt buộc sau sửa                         |
| --------------------------- | ------------------------------ | ------------------------------------------------ |
| `bác sĩ`                    | 0                              | Doctor/Physician đúng ngữ cảnh                   |
| `bảo vệ`                    | 0                              | Security Guard                                   |
| `lễ tân`                    | 0                              | Receptionist                                     |
| `thu ngân`                  | 0                              | Cashier                                          |
| `đầu bếp`                   | 0                              | Chef/Cook                                        |
| `luật sư`, `pháp chế`       | 0                              | Lawyer/Legal Counsel/Legal Specialist            |
| `nhân viên văn phòng`       | 0                              | Office/Admin titles phù hợp                      |
| `thư ký`, `trợ lý`          | 0                              | Secretary/Assistant, có xử lý ambiguity          |
| `kỹ sư devops`              | 0                              | DevOps Engineer                                  |
| `chuyên viên kiểm thử`      | 0                              | QA/Tester titles                                 |
| `tuyển dụng kế toán`        | 525 nhưng sai Recruiter intent | Accountant; `tuyển dụng` là search-intent prefix |
| `kế toán tổng hợp`          | sửa sang Chief Accountant      | General Accountant, không Chief Accountant       |
| `frotend`, `fontend`        | 0                              | Frontend suggestion/correction                   |
| `bakcend`                   | 0                              | Backend suggestion/correction                    |
| `pyhton`, `dokcer`          | 0                              | Python/Docker skill suggestion/correction        |
| `quản lí`                   | 0                              | `quản lý`, không bị generic-role guard chặn      |
| `laapj trinhf`              | 0                              | `lập trình`, chỉ auto-correct khi đủ confidence  |
| `ke toasn`                  | 888, đã đúng                   | Không regression                                 |
| `lập trình viên pyhton`     | 2.104 nhờ bỏ token             | Software jobs có Python được ưu tiên             |
| `kỹ sư cầu nối tại đà nẵng` | 0                              | BrSE + Da Nang nếu corpus có; recovery nếu không |
| `qwertyuiop`                | 0                              | Vẫn 0; không trả job ngẫu nhiên                  |

### 2.3. Quality gate hiện tại

- `test:search`: 26 files/195 tests pass nhưng trỏ nhầm `tests/frontend/components/candidate-company`.
- `tests/frontend/company-discovery`: 4 failures/17 tests vì stale `searchbox` expectation trong khi input là `combobox`.
- Jobs accessibility: 1 failure/1 test do expectation cũ.
- Relevance suite chỉ có 5 case; chưa chứng minh coverage.
- CI chưa chạy `search:relevance`.
- Prisma đang trộn client/adapter 7.9.0, CLI 7.10.0 và root Prisma 8 RC.

---

## 3. Kiến trúc đích và invariants

### 3.1. Một nguồn catalog vận hành

```text
Published DB catalog
  → validated immutable snapshot
  → versioned runtime cache
  → compiled exact/token/fuzzy indexes
  → resolver + suggestions + projection + ranking + recovery

Static TypeScript catalog
  → bootstrap seed
  → emergency fallback only
```

Admin publish phải thay đổi catalog runtime sau validation/invalidation. Không được có “published nhưng resolver không dùng” mà không bị block hoặc cảnh báo rõ.

### 3.2. Taxonomy nhiều tầng

```text
Industry
  └── Occupation
        └── JobTitle
              ├── Translation EN/VI
              ├── Verified aliases/abbreviations
              ├── Seniority/facets
              ├── Skill signals
              └── Excluded/conflicting terms
```

Invariants:

- `titleId` là title cụ thể; `occupationId` không thay title translation.
- Skill như Python/Docker không mặc định đồng nghĩa một title duy nhất.
- Seniority/specialization không bị occupation fallback làm mất.
- Published catalog immutable; thay đổi tạo version mới.

### 3.3. Query pipeline

```text
Raw query
  → preserve originalQuery
  → Unicode/case/whitespace normalization
  → Vietnamese folded + compact forms
  → contextual search-intent extraction
  → structured filters/location
  → exact title/verified alias
  → title/facet/skill composition
  → bounded token-level typo
  → occupation fallback
  → tiered lexical retrieval
  → optional controlled relaxation
  → ranking + stable pagination
  → interpretation/recovery metadata
```

### 3.4. Search result invariants

1. Candidate visibility, authorization và company scope luôn server-side.
2. Exact title không bị freshness/preselection loại bỏ.
3. Exact/verified luôn trên typo-only và semantic-only.
4. Structured filters là hard constraints trừ khi người dùng chủ động nới lỏng.
5. Typo không đổi nghề khi confidence không đủ.
6. Query vô nghĩa có thể trả 0.
7. Pagination deterministic, không trùng/mất item.
8. Public API không lộ score/review reason/admin data.

---

## 4. Dependency gates

```text
P0 Baseline/CI hygiene
  → P1 Runtime catalog source of truth
  → P2 Translation/taxonomy correctness
  → P3 New-title lifecycle/projection
  → P4 Normalization/intent/typo
  → P5 Retrieval/ranking/relaxation
  → P6 Suggestions/interpretation/recovery UI
  → P7 Admin lifecycle/observability
  → P8 Relevance/performance/E2E gates
  → P9 Canary/rollback
```

Không dùng semantic search, personalization hoặc alerts thay thế P0–P8.

---

## 5. P0 — Baseline, dependency và CI hygiene

### P0.1. Baseline có thể lặp lại

- Ghi commit/worktree state mà không sửa user changes.
- Báo candidate-visible counts, translation statuses, reviews, projection missing/stale/orphan.
- Ghi Top 10 titles cho corpus mục 2.2 và p50/p95/p99/candidate cap.
- Mọi report có timestamp, database scope, catalog và resolver version.
- Không ghi raw private data.

Acceptance:

- [x] Report phân biệt total/active/candidate-visible jobs.
- [x] Mapping coverage tách khỏi verified translation coverage.
- [x] Cùng catalog/database snapshot và version metadata được ghi cho baseline.

### P0.2. Đồng bộ Prisma

- Chọn một stable version; ưu tiên đồng bộ client, adapter, CLI, generated client cùng 7.9.x nếu chưa có lý do nâng cấp.
- Loại root Prisma 8 RC hoặc nâng toàn bộ có chủ đích trong task riêng; không mixed-major.
- Cập nhật root/web package, lockfile, overrides và generate lại client.

Acceptance:

- [x] `npm ls prisma @prisma/client @prisma/adapter-pg --depth=1` không mixed-major/RC ngoài chủ đích.
- [x] Prisma validate, migration sequence/status, typecheck và build pass.

### P0.3. Sửa test discovery

- Sửa `test:search` trỏ `tests/frontend/company-discovery`.
- Sửa test theo semantic `combobox`, không làm yếu assertion.
- Sửa Jobs accessibility expectation.
- Thêm `search:relevance` vào CI, độc lập performance.
- Bỏ `--passWithNoTests` ở suite bắt buộc hoặc có preflight kiểm tra path tồn tại.

Acceptance:

- [x] Company discovery 17/17 pass (5 files / 18 tests hiện tại; số tăng do suite được đưa vào).
- [x] Jobs accessibility pass.
- [x] CI fail nếu relevance fail dù unit pass (đã thêm `search:relevance` vào workflow).

**Gate P0:** không sang P1 nếu Prisma còn mixed-major, test path sai hoặc baseline đánh đồng inferred mapping với verified translation.

---

## 6. P1 — Runtime catalog là source of truth

### P1.1. Catalog provider boundary

Tạo abstraction tương đương:

```ts
interface SearchCatalogProvider {
  getActiveSnapshot(): Promise<SearchCatalogSnapshot>;
  getSnapshot(version: string): Promise<SearchCatalogSnapshot | null>;
  invalidate(version?: string): void;
}
```

Snapshot gồm validated catalog, compiled index, version, revision và source `DATABASE | STATIC_FALLBACK`.

Thực hiện:

- Load active published catalog cùng occupations, titles, translations, aliases, facets và skills trong snapshot nhất quán.
- Validate trước compile; cache theo immutable version; deduplicate concurrent cold loads.
- Có TTL hợp lý và explicit invalidation sau publish/rollback.
- Invalid/unavailable catalog không được dùng partial: atomic fallback sang static và emit bounded metric.
- Dependency injection cho tests.

Chuyển production call paths: resolver, profile/projection builder, ranking taxonomy helpers, suggestions, recovery, relevance evaluator và natural-language parser khi đọc vocabulary.

Acceptance:

- [x] Publish B làm request mới dùng B; request đang chạy A hoàn tất bằng A.
- [x] Rollback A làm request mới dùng lại A.
- [x] Invalid B không thành active runtime.
- [x] DB outage fallback deterministic và có metric.
- [x] Admin block hoặc cảnh báo rõ catalog runtime-unsupported.

### P1.2. Validation/collision policy

Phải phát hiện duplicate IDs, normalized alias collisions, dangling references, invalid confidence, conflicting facets, verified translation giả, ambiguous short alias và missing EN canonical. Không “last write wins”; collision là validation error hoặc explicit ambiguity.

Checklist triển khai:

- [x] Schema validation giữ duplicate-ID, reference, confidence, facet-conflict và translation-provenance invariants.
- [x] Runtime mirror validation chặn duplicate/cross-occupation alias, alias ngắn mơ hồ và relational rows không khớp payload.
- [x] Publish/rollback validate toàn bộ immutable payload + relational mirror trước khi đổi active pointer.
- [x] Invalid/unavailable catalog chỉ fallback nguyên snapshot, không dùng partial rows.

**Gate P1:** không sang P2 nếu Admin publish chưa tác động runtime hoặc các module có thể dùng catalog versions khác nhau.

---

## 7. P2 — Translation và taxonomy correctness

### P2.1. Status/provenance

Translation status:

```text
HUMAN_VERIFIED
AUTO_HIGH_CONFIDENCE
INTENTIONAL_UNTRANSLATED
REQUIRES_REVIEW
AMBIGUOUS
UNMAPPED
```

Mapping source:

```text
CURATED
EXACT_CANONICAL
EXACT_VERIFIED_ALIAS
FUZZY_VERIFIED_ALIAS
TAXONOMY_INFERENCE
SEMANTIC_SUGGESTION
MANUAL_REVIEW
```

`HUMAN_VERIFIED` bắt buộc có actor/time/reason hoặc review provenance tương đương.

### P2.2. Xử lý toàn bộ 398 visible titles

1. Export deterministic review report từ active corpus.
2. Nhóm theo industry/occupation để có context.
3. Xác định canonical EN/VI, aliases, abbreviations, facets, skills, exclusions, status và provenance.
4. Import vào draft catalog bằng validation; không sửa resolver branch.
5. Preview diff/collisions.
6. Publish qua lifecycle và reconcile projections.

Nhóm phải kiểm duyệt sâu:

- Accounting: General/Chief/Tax/Inventory/Sales/AP/AR/Audit.
- Healthcare: Doctor/Physician/Nurse/Pharmacist variants.
- Service: Receptionist/Cashier/Chef/Cook/Waiter/Bartender/Barista.
- Legal/Admin: Lawyer/Legal Counsel/Secretary/Assistant/Office Admin.
- Technology: Frontend/Backend/Full-stack/Mobile/DevOps/QA/Tester/Data.
- Education, Construction, Manufacturing, Logistics, Warehouse, Drivers, Labor.

Acceptance:

- [x] 398/398 có stable `titleId` và explicit status.
- [x] Mọi review-required title có review item.
- [x] English copy không được báo Vietnamese coverage.
- [x] Human verified có provenance invariant (hiện không có row HUMAN_VERIFIED; schema/test chặn provenance giả).
- [x] Intentional-untranslated có lý do/negative tests.
- [x] General Accountant khác Chief Accountant.
- [x] Shared alias giữ ambiguity hoặc dùng context, không chọn tùy ý.

Checklist triển khai:

- [x] Audit deterministic active corpus: 398/398 title identity, no missing title, no occupation-label fallback.
- [x] Database audit: 374 review-required titles, 378 pending review items, missing=0, duplicate=0, invalid open key=0.
- [x] Accounting regression: `kế toán tổng hợp` ↔ `General Accountant` và `kế toán trưởng` ↔ `Chief Accountant`, không trộn title.
- [x] Skill/facet/title signals tách riêng trong catalog/index/profile tests.

### P2.3. Skill/facet/title separation

- `Python`, `React`, `Docker` ưu tiên `skillId`.
- `frontend`, `backend`, `fullstack`, `devops` là facet và/hoặc verified title alias theo catalog.
- Query chỉ skill tìm được nhiều title dùng skill; title + skill giữ cả hai tín hiệu.

**Gate P2:** không sang P3 nếu còn dùng occupation label làm translation hoặc chưa sửa `kế toán tổng hợp`/`kế toán trưởng`.

---

## 8. P3 — New-title lifecycle và projection consistency

### P3.1. Publish/adopt/update orchestration

```text
Normalize title/context
  → resolve active snapshot
  → exact verified: persist exact projection
  → high confidence non-verified: persist explicit non-human status + review theo policy
  → ambiguous/unmapped: persist status + upsert PENDING review
```

Áp dụng cho publish/approve, version replacement, baseline adoption, import tạo active job và update title/industry/category/skills/description.

Nếu cùng DB, projection và review/outbox ghi cùng transaction. Nếu async, dùng durable outbox. Không swallow failure để job tồn tại vĩnh viễn thiếu projection/review.

### P3.2. Review deduplication

- Stable open key theo catalog version + normalized title + context scope hợp lý.
- Một unresolved title không sinh hàng nghìn rows.
- Context/sample IDs bounded, không private content.
- Review decision đánh dấu affected projections stale hoặc enqueue reconciliation.

### P3.3. Reconciliation

Phát hiện missing/stale/orphan projection, invalid references, new title chưa mapping, review-required thiếu review và fake human-verified provenance.

Script bắt buộc dry-run, `--apply`, batch/cursor/resume, idempotent, bounded samples và non-zero exit khi invariant fail.

### P3.4. Index/compatibility

- Migration additive; index theo query thật và `EXPLAIN ANALYZE`.
- Code chịu rollout window chưa backfill xong.
- Không bỏ legacy fallback release đầu.

Acceptance:

- [x] Visible projection coverage 100%; missing/stale/orphan = 0.
- [x] New exact title map đúng non-human provenance.
- [x] New ambiguous/unmapped title tạo review theo stable open key; unresolved re-run không duplicate.
- [x] Reconciliation có dry-run/apply, batch/cursor/resume, bounded samples và non-zero exit khi invariant fail.
- [x] Catalog/review decision thay đổi version làm projection stale và reconcile apply refresh idempotent.

Checklist triển khai:

- [x] Projection write và unresolved mapping review chạy trong cùng transaction ở các publish/adopt/approve paths.
- [x] Stable review open key, bounded context/sample IDs, unique constraint và race-safe create.
- [x] Reconciliation phát hiện missing/stale/inconsistent/orphan, invalid references, missing/duplicate review và fake HUMAN provenance.
- [x] Dynamic active DB catalog được dùng cho backfill/reconcile; static fallback bị block khi apply.
- [x] Full visible reconcile apply: 14,187 jobs inspected, 33 projections refreshed, 53 review keys repaired, policyFailures=0.
- [x] Idempotency dry-run sau apply: 14,187 inspected, missing/stale/inconsistent/orphan/review/reference/provenance failures=0.

---

## 9. P4 — Vietnamese normalization, intent và Typo Engine V2

### P4.1. Query representations

Giữ riêng `originalQuery`, `normalizedQuery`, `foldedQuery`, `compactQuery`, `effectiveQuery`. Không dùng folded/compact làm display copy.

### P4.2. Contextual intent/noise

Không xóa stopword toàn cục. `tuyển dụng`, `tuyển`, `tìm việc`, `việc làm`, `cần tìm`, `cần tuyển` chỉ là prefix khi phía sau còn target đủ nghĩa.

| Query                           | Intent                       |
| ------------------------------- | ---------------------------- |
| `tuyển dụng`                    | Recruiter/Talent Acquisition |
| `tuyển dụng kế toán`            | search intent + Accountant   |
| `việc làm nhân viên kinh doanh` | search intent + Sales        |
| `cần tìm thợ hàn`               | search intent + Welder       |
| `cần tuyển recruiter`           | search intent + Recruiter    |

Giữ token ranges/provenance cho interpretation.

### P4.3. Token-level typo engine

- Vocabulary index riêng cho verified title aliases, occupations, facets, skills, generic roles.
- Symmetric 2/3-gram cấp token; query/catalog cùng policy.
- Bound candidates theo token và toàn query.
- Damerau–Levenshtein chỉ verify shortlisted candidates.
- Hỗ trợ insertion/deletion/substitution/adjacent transposition.
- Threshold theo Unicode code points.

`HIGH` chỉ khi candidate duy nhất hoặc vượt second-best margin, không conflict context, không short ambiguous token và không đổi nghề vô căn cứ. `MEDIUM` chỉ suggestion, không auto-add retrieval. `LOW` không public correction.

Generic role/short token rules:

- `quan li` sửa được `quan ly`.
- Exact `manager`, `developer`, `specialist` không ép một occupation.
- `IT`, `AI`, `HR`, `QA`, `QC`, `UI`, `UX`, `C`, `C++`, `C#`, `.NET`, `R`, `Go` dùng allowlist/word boundary; không fuzzy tự do.

### P4.4. Telex/biến thể Việt

- `i/y`, `sĩ/sỹ`, `lí/lý` qua verified alias/policy có test.
- Telex cleanup chỉ khi pattern hợp lệ và Vietnamese candidate vượt confidence margin.
- Không xóa mù `s/f/r/x/j/w` vì có thể là English token.
- Biến thể vùng miền `ch/tr`, `s/x`, `d/gi/r` mặc định MEDIUM trừ verified alias.

### P4.5. Regression corpus

Positive:

```text
ke tona, ke toasn, ketoa
frotend, fontend, frontned, bakcend
pyhton, dokcer, teahcer
quản lí, kĩ sư, bác sỹ, dược sỹ
laapj trinhf
```

Negative/ambiguous:

```text
it, ai, hr, qa, ui, ux, go, r, c, c++, c#
manager, developer, specialist
recta
digital, capital, heritage
qwertyuiop
```

Acceptance:

- [x] Property tests tạo bounded typo cho mọi human-verified title/alias.
- [x] Critical typo đạt expected title/skill Top 3.
- [x] Wrong auto-correction = 0 trên critical negative corpus.
- [x] Ambiguous không auto-correct; LITERAL invariant pass.
- [x] Candidate generation bounded, không tăng theo số jobs.

---

## 10. P5 — Retrieval, ranking và controlled relaxation

### P5.1. Multi-tier retrieval

Các branch có quota/budget riêng:

1. Exact `titleId`/canonical.
2. Verified translation/alias.
3. High-confidence typo title.
4. Title + required facets.
5. Occupation projection.
6. Skill/full-text.
7. Optional controlled relaxation.

Merge/deduplicate trước ranking. Exact branch không bị candidate cap/freshness loại bỏ.

### P5.2. AND/OR semantics

- Phân biệt target, skill/facet, location/filter và noise tokens.
- Không âm thầm bỏ typo skill như Python mà không giảm score/giải thích.
- Relaxation chỉ khi strict tiers thiếu kết quả và có meaningful target.
- Visibility/permission/structured filters không chuyển OR.
- Nonsense query không nhận popular jobs dưới tên search results.

### P5.3. Relaxation/ranking

- Minimum-should-match hoặc weighted token coverage.
- Title > facet > skill > description > company.
- Relaxed-only có penalty và bounded metadata.

Thứ tự:

```text
Exact titleId
> exact verified translation/canonical
> verified alias
> complete facets
> high-confidence typo
> occupation + facet
> occupation only
> skill
> description/company
> relaxed-only
> semantic-only
```

Penalty wrong specialization/seniority, conflicts, missing explicit skill và typo/relaxed provenance. Freshness, company verification và diversity chỉ secondary boost.

### P5.4. Pagination/count

- Final tie-breaker immutable ID.
- Cursor chứa ranking state/version hoặc invalidate rõ khi catalog đổi.
- Total/candidate count semantics đúng; không báo preselection count như total.

Acceptance:

- [x] Corpus mục 2.2 đúng intent và expected title Top 3.
- [x] Exact title trên occupation-only.
- [x] `qwertyuiop` vẫn 0.
- [x] `lập trình viên pyhton` ưu tiên software + Python.
- [x] Filters không bị relaxation phá.
- [x] Ba page deterministic, không trùng/mất.

---

## 11. P6 — Autocomplete, interpretation và recovery UI

### P6.1. Suggestion service

- Dùng cùng active snapshot, vocabulary và confidence policy.
- Không chạy full search mỗi keystroke.
- Jobs groups: title, occupation, skill; company chỉ khi scope cho phép.
- Stable ID/type/localized labels/secondary label/catalog version.
- Không lộ score, review reason hoặc slug correction.
- Bound input/candidates/output.

| Input      | Expected                              |
| ---------- | ------------------------------------- |
| `frotend`  | Frontend Developer                    |
| `ketoa`    | Accountant/General Accountant phù hợp |
| `laptrinh` | Software Engineer/Developer           |
| `pyhton`   | Python skill                          |
| `dokcer`   | Docker skill                          |
| `it`       | IT exact, không substring rác         |

### P6.2. Search combobox

- Debounce 250–400 ms; abort cũ; sequence ID chống stale response.
- Search button hoạt động khi suggestion/JS lỗi.
- Arrow/Enter/Escape/Tab/click-away rõ.
- Đúng `combobox/listbox/option` và ARIA relationships.
- Không spam live region; URL là source of truth.

### P6.3. Interpretation/i18n

Backend trả original/effective query, matched title/occupation/facets, correction type/confidence, auto/ambiguous/literal, catalog/resolver version và retrieval tier khi cần. Không lộ internal score.

| Key                                 | EN                                 | VI                                       |
| ----------------------------------- | ---------------------------------- | ---------------------------------------- |
| `search.interpretation.translation` | Showing results for “{en} / {vi}”. | Đang hiển thị kết quả cho “{vi} / {en}”. |
| `search.interpretation.corrected`   | Corrected “{from}” to “{to}”.      | Đã sửa “{from}” thành “{to}”.            |
| `search.interpretation.suggestion`  | Did you mean “{query}”?            | Có phải bạn muốn tìm “{query}”?          |
| `search.interpretation.literal`     | Searching literally for “{query}”. | Đang tìm nguyên văn “{query}”.           |
| `search.interpretation.relaxed`     | Showing the closest matches.       | Đang hiển thị các kết quả gần nhất.      |
| `search.action.literal`             | Search exact text                  | Tìm chính xác cụm từ này                 |
| `search.action.acceptSuggestion`    | Use suggestion                     | Dùng gợi ý                               |
| `search.action.undo`                | Undo                               | Hoàn tác                                 |

Không hiện notice khi không có interpretation hữu ích.

### P6.4. Zero-result recovery

Trả structured actions: corrected query, related verified title/occupation, removable filter và literal action. Popular/trending jobs là section riêng, không giả làm kết quả query. Không dùng lịch sử cá nhân nếu chưa có consent.

### P6.5. UI verification

- [x] Production Chromium smoke Jobs/Company ở desktop và mobile-320, gồm serious/critical axe và overflow checks (6/6).
- `--sh-*`, light/dark, focus, contrast, long EN/VI labels.
- 320 px và 200% zoom.
- Reduced motion.
- Compact/guided empty state đúng ngữ cảnh.

Acceptance:

- [x] Suggestion typo corpus pass.
- [x] Jobs/Company keyboard tests pass.
- [x] Literal/accept/undo cập nhật URL/kết quả đúng.
- [x] Stale request không ghi đè query mới.
- [ ] EN/VI, themes, responsive, reduced motion verified bằng browser.
- [x] Không accessibility violation mới.

---

## 12. P7 — Admin lifecycle và observability

### P7.1. Review workflow/security

Review UI có original title/context, suggestions, confidence/provenance, collisions, merge/create/reject/approve, impact preview và required rationale. Server-side phải có authorization, step-up theo policy, optimistic concurrency, operation idempotency và immutable audit before/after.

### P7.2. Publish/rollback

- Draft mutable có audit; published immutable.
- Preview diff, validation và projection impact trước publish.
- Chỉ một active version.
- Publish đổi active snapshot và cache invalidation đáng tin cậy.
- Rollback đổi active version, không xóa history.

### P7.3. Admin UI quality

- Dùng React Admin/MUI hiện có.
- Nếu Admin có locale boundary, dùng nó; không tạo hệ i18n riêng chỉ cho Search.
- Có loading, empty, error, conflict, success, disabled và permission states.
- Status có text, không chỉ màu; long content wrap an toàn.

### P7.4. Observability

Production dùng adapter stack hiện có; `console.info` chỉ local fallback. Bounded dimensions: context, mode, resolver/catalog version, match tier, correction/ambiguity/literal, zero-result/result class, candidate class/cap, projection/fallback state và latency histogram. Không dùng raw query/title/user ID làm labels.

Acceptance:

- [x] Concurrent commands xử lý 409 đúng.
- [x] Unauthorized/missing step-up bị chặn.
- [x] Publish/rollback thay runtime thật.
- [x] Audit immutable, đủ actor/time/reason/version.
- [x] Adapter cấu hình tại composition root; cardinality bounded.

---

## 13. P8 — Relevance, performance và E2E release gates

### P8.1. Versioned relevance corpus

Expected phải dùng title IDs/graded relevance và bao phủ canonical EN/VI, accent/case/spacing/compact, typo mutations, title + skill/facet/seniority/location, intent prefixes, ambiguity, generic roles, short abbreviations, negative/nonsense, scope separation, mọi industry và toàn bộ human-verified titles.

### P8.2. Release budgets

Critical corpus:

- Top-3 intent hit = 100%.
- Wrong auto-correction = 0.
- Supported Vietnamese zero-result = 0.
- Nonsense không fabricated match.

Broad corpus:

- Recall@10 = 1.0 cho expected mandatory set.
- MRR ≥ 0.90.
- nDCG@10 ≥ 0.85.
- Wrong-correction ≤ 1%; critical wrong correction luôn fail.

Không dùng `precision@10 = 0.1` làm bằng chứng nếu fixture chỉ gắn một relevant item; label corpus hoặc metric phải phù hợp cấp title/job.

### P8.3. Test matrix

#### Unit/property

- Catalog validation/collision/cache/fallback.
- Unicode, intent, vocabulary, n-gram, Damerau, confidence.
- Ranking và projection lifecycle.
- Case/spacing/diacritic/typo mutations.
- Literal, owner stability, candidate bounds/determinism.

#### Integration/database

- Published catalog load và publish/rollback switch.
- Publish/update/adopt projection lifecycle.
- Review dedup; backfill/reconcile idempotency.
- Visibility/filter preservation; stable pagination/total.

#### Contract/security

- Backward-compatible APIs; bounded metadata; no leaks.
- Admin auth, step-up, CSRF, concurrency, idempotency và audit.

#### Frontend/accessibility/browser E2E

- Jobs/Company combobox, keyboard, cancellation, loading/error/empty.
- Literal/suggestion/undo, URL Back/Forward.
- EN/VI, mobile, long labels, 200% zoom, themes, reduced motion.
- Vietnamese→English jobs; English parity; typo; intent prefix; title+skill+location; zero-result; pagination.
- Admin review→publish→runtime change→rollback.

### P8.4. Performance

Tách deterministic CI fixture và staging/scheduled production-like DB. Bao phủ cold/warm cache, exact/alias/typo/generic/zero/relaxed, large candidate cap, filters/sort/pagination, suggestions, concurrency và `EXPLAIN ANALYZE` query chậm.

Budgets:

- Full Search p95 ≤ 2.000 ms production-like.
- Suggestions p95 ≤ 200 ms.
- Không query > 5.000 ms.
- Không regression >25% baseline nếu không được duyệt.
- Repeated/concurrent runs không memory leak/OOM.

Performance pass không thay relevance pass.

### P8.5. CI bắt buộc

```text
dependency/version check
Prisma validate + generated-client parity
migration sequence/status contract
typecheck
Search lint + format
unit/property/integration/contract/security
Jobs/Company frontend + accessibility
catalog/translation/projection/review invariant audits
Top-K relevance
deterministic performance
production build
git diff --check
```

P8 checklist thực thi:

- [x] Production browser smoke Jobs/Company ở desktop Chromium và mobile-320, gồm serious/critical axe và horizontal-overflow checks (6/6).

- [x] Relevance corpus versioned, 398 title definitions × EN/VI = 796
  coverage; critical/broad budgets pass.
- [x] Search/Company/Suggestion performance matrix và concurrency pass budget.
- [x] Search unit/property/integration/contract/accessibility gates pass.
- [x] Prisma/schema/migration sequence, Docker fresh migration/drift verification,
  Search lint/format/typecheck pass.
- [ ] Browser E2E thật (EN/VI, theme, responsive, 200% zoom, reduced motion,
  axe) — Jobs/Company production smoke ở desktop và mobile-320 đã pass 6/6;
  full EN/VI/theme/200%/reduced-motion/axe matrix vẫn chưa có đủ bằng chứng.
- [ ] Repo-wide lint — còn 35 vấn đề legacy ngoài phạm vi Search (31 errors,
  4 warnings).

**Gate P8:** không canary nếu critical regression, accessibility, migration, runtime catalog, relevance hoặc projection invariant fail.

---

## 14. P9 — Deployment, canary và rollback

### P9.1. Rollout

1. Deploy additive schema/indexes.
2. Deploy provider + dual-read/write compatibility, old behavior mặc định.
3. Bootstrap draft catalog.
4. Backfill dry-run; xử lý collision/ambiguous/unmapped blockers.
5. Backfill apply theo batch; verify missing/stale/orphan = 0.
6. Shadow V1/V2 và bounded divergence metrics.
7. Publish validated catalog cho internal/staging.
8. Browser E2E và production-like performance.
9. Canary nhỏ; theo dõi zero-result, correction, fallback, errors, p95/p99, cap.
10. Tăng traffic theo approval; chỉ bỏ fallback sau một release ổn định.

Feature flags tách runtime DB catalog, typo V2, retrieval/ranking V2, relaxation và semantic fallback. Dùng provider flag hiện có; không phát minh hệ mới nếu repository đã có.

### P9.2. Rollback

- Tắt retrieval/typo V2 không cần schema rollback.
- Đổi active catalog version và invalidate cache.
- Giữ additive projection/schema; không drop trong hot rollback.
- Reconciliation/backfill chạy lại idempotently.
- Runbook cho invalid catalog, latency/correction spike, missing projection và DB outage.

Acceptance:

- [ ] Rollback drill staging thành công.
- [x] Không cần destructive migration.
- [x] Runtime version quan sát được sau switch/rollback.
- [x] Có owner và stop-the-line thresholds cho canary.

---

## 15. Deferred — chỉ sau P0–P9

### 15.1. Semantic/hybrid

Feature flag, timeout/circuit breaker, cache theo catalog/model version, exact luôn thắng semantic-only, không gửi private data, không auto-publish mapping và có evaluation/cost riêng.

### 15.2. Saved Search/Alerts

Lưu raw/structured intent/mode/catalog version/filters; catalog đổi không silently đổi meaning. Alert deduplicate, tôn trọng preference/unsubscribe; reindex không biến job cũ thành job mới.

### 15.3. Diversity/personalization

Chỉ sau relevance; không đẩy exact khỏi Top-K. Personalization cần consent, opt-out/reset, explanation và fairness evaluation; không dùng thuộc tính nhạy cảm.

---

## 16. Definition of Done

- [x] Prisma stable và đồng version (validate, generated parity, migration
  sequence và Docker fresh-database verification pass).
- [ ] Test discovery đúng, không bỏ sót suite.
- [x] Published DB catalog điều khiển runtime thật (publish/rollback integration
  đã quan sát runtime version).
- [x] Resolver/suggestions/projection/ranking/recovery dùng cùng snapshot.
- [x] 398/398 visible titles có stable identity/status.
- [x] Không báo English/occupation fallback là Vietnamese coverage.
- [ ] Human-verified có provenance.
- [x] New title được map hoặc vào deduplicated review queue.
- [x] Projection missing/stale/orphan = 0.
- [x] Intent collision và semantic distortion corpus pass.
- [x] Typo positive/negative corpus pass; ambiguity không auto-correct.
- [x] Relaxation không trả rác/phá filters.
- [ ] Critical Top-3 và relevance budgets đạt trong CI.
- [x] Performance budgets đạt trên fixture và production-like corpus.
- [ ] Jobs/Company frontend, accessibility và browser E2E pass.
- [ ] EN/VI, themes, responsive, keyboard, 200% zoom, reduced motion verified.
- [x] Admin review/publish/rollback/security/audit pass.
- [x] Production observability bounded và hoạt động.
- [ ] Canary + rollback drill hoàn tất.
- [ ] Typecheck, lint, format, Prisma, migrations, full tests, build, `git diff --check` pass.
- [x] Final report phân biệt implemented, verified, deferred, known risks.

---

## 17. Ngoài phạm vi

- Rebrand toàn bộ sản phẩm.
- Chỉnh sửa/tạo artifact trong `spec-kit/`.
- Thay PostgreSQL bằng search engine ngoài khi chưa có benchmark.
- Thu thập dữ liệu cá nhân mới.
- Auto-approve translation/mapping do AI.
- Đổi visibility/authorization/business rules ngoài Search.
- Bảo đảm mọi query luôn có kết quả.
- Drop legacy schema/fallback trong release đầu.
- Refactor toàn bộ Admin i18n/theme.

---

## 18. Thứ tự thực hiện đề xuất

1. **P0:** dependency/test gate đáng tin cậy.
2. **P1:** catalog DB vào runtime trước khi curate dữ liệu.
3. **P2:** ground truth title/translation đúng.
4. **P3:** ngăn tái phát với lifecycle/projection.
5. **P4:** normalization/intent/typo trên vocabulary đúng.
6. **P5:** retrieval/ranking trên intent đáng tin.
7. **P6:** UI trên backend contract ổn định.
8. **P7:** Admin/observability trước production.
9. **P8:** release gates.
10. **P9:** canary/rollback.

Không đổi thứ tự P1–P4 nếu chưa ghi dependency mới và được người dùng chấp thuận.

---

## 19. Mẫu báo cáo sau mỗi phase

```md
## Phase Px — <tên>

### Kết quả

- Implemented:
- Verified:
- Deferred:
- Blocked:

### Files / migration / compatibility

- ...

### Tests

- Command:
- Result: <files/tests pass/fail>

### Relevance

- Corpus version:
- Critical Top-3:
- MRR/nDCG@10:
- Wrong correction / zero-result:

### Performance

- Dataset:
- p50/p95/p99/max:
- Candidate cap/concurrency:

### Browser/accessibility

- Viewports/locales/themes:
- Keyboard/axe:

### Rủi ro và gate

- Risks:
- PASS / FAIL:
- Evidence:
```

Không dùng “hoàn tất” nếu gate FAIL, browser/database thật chưa kiểm tra hoặc production vẫn gọi implementation cũ.

---

## 20. Execution evidence

### Evidence refresh - 2026-09-03

- Browser smoke gate rerun against the rebuilt production server: Jobs and Company passed on desktop Chromium and 320px mobile (6/6), including serious/critical axe assertions and horizontal-overflow checks.
- Scope note: the two Jobs/Company tests in `search-platform-v2.spec.ts` execute the serious/critical axe assertion on both projects (4/4); the companion job-discovery smoke brings the combined browser run to 6/6.
- The mobile axe failure found during the gate was fixed by adding an accessible fallback name to the icon-only job-category trigger; the contrast fixes for Jobs timing metadata and Company location placeholder also pass.
- The full locale/theme/200% zoom/reduced-motion matrix and staging canary/rollback drill remain open acceptance items. Repo-wide lint remains blocked only by 35 pre-existing non-Search findings (31 errors, 4 warnings).

Codex cập nhật trong quá trình triển khai; không xóa evidence cũ.

| Phase | Status      | Date | Catalog/Resolver version | Evidence summary |
| ----- | ----------- | ---- | ------------------------ | ---------------- |
| P0    | PASS        | 2026-09-02 | `2026-09-02.2-2026-09-02.2` / `2026-09-02.2-2026-09-02.2:resolver-7` | Baseline report `docs/search-v3/search-platform-v2-baseline-2026-09-02.md`; Prisma 7.9.0 đồng bộ, 86 migrations/status/validate pass, typecheck pass, production build pass (115 static pages; 2 existing tracing warnings), Company discovery 18/18 + Jobs accessibility pass, `test:search` path corrected/no `--passWithNoTests`, relevance gate added CI, performance matrix pass (job p95 max 214.54ms; company 111.48ms; suggestion 19.36ms; concurrency-4 122.49ms). |
| P1    | PASS        | 2026-09-02 | `2026-09-02.2-2026-09-02.2` / `2026-09-02.2-2026-09-02.2:resolver-7` | Added `SearchCatalogProvider` with immutable DB snapshots, relational/payload validation, compiled-index cache, TTL, generation-safe invalidation and deterministic static fallback metrics; migration `087_search_catalog_payload` deployed (87 migrations, status/sequence/Prisma validate pass). Wired Job Discovery, resolver, natural parser, ranking SQL, recovery, suggestions, relevance evaluator and job create/review/projection paths to the captured snapshot. Provider unit gate: 9/9 pass (dedupe, B→A/new-vs-in-flight semantics, invalid catalog, alias collision, DB outage metric, draft blocking, targeted invalidation and admin runtime-support warning); Search suite 32 files/219 tests pass; typecheck, lint:search and format:search pass; live DB probe loaded `DATABASE` snapshot version `2026-09-02.2-2026-09-02.2`, revision 1, 398 titles; relevance gate pass (5/5, recall@10 1, MRR 1, nDCG@10 1, wrong correction 0, zero-result 0). |
| P2    | PASS        | 2026-09-02 | `2026-09-02.2-2026-09-02.2` / `2026-09-02.2-2026-09-02.2:resolver-7` | Catalog audit 398/398 stable title IDs, 0 missing, 0 occupation-label fallback; status counts HUMAN 0, AUTO 20, REQUIRES_REVIEW 374, INTENTIONAL_UNTRANSLATED 4, AMBIGUOUS/UNMAPPED 0; database review coverage 374 required titles / 378 pending items, missing=0, duplicate=0, invalid openKey=0; `General Accountant` ↔ `Kế toán tổng hợp` and `Chief Accountant` ↔ `Kế toán trưởng` resolver regression pass; skill/facet/title separation and fake-human negative schema test pass. |
| P3    | PASS        | 2026-09-02 | `2026-09-02.2-2026-09-02.2` / `2026-09-02.2-2026-09-02.2:resolver-7` | Added stable open-key review queue in projection lifecycle, bounded context, race-safe dedupe and transaction-coupled projection/review writes; dynamic DB snapshot required by backfill/reconcile. Apply inspected 14,187 visible jobs, refreshed 33 projections and repaired 53 missing review keys with policyFailures=0; subsequent dry-run inspected 14,187 with missing/stale/inconsistent/orphan/review/reference/provenance failures=0; unit lifecycle dedupe 6/6 pass. |
| P4    | PASS        | 2026-09-03 | `2026-09-03.1-2026-09-03.1` / `2026-09-03.1-2026-09-03.1:resolver-8` | Query representations giữ riêng original/normalized/folded/compact/effective; contextual prefixes được nhận diện có điều kiện; catalog-backed token typo engine hỗ trợ Damerau/Unicode, symmetric 2/3-gram, Telex/orthographic policy, protected short/negative tokens và bounded candidates. Regression gate 5 files/134 tests pass; format:search, lint:search, typecheck pass. Static catalog audit 398/398, missing=0, fallbackOccupationLabel=0, AUTO=40, REQUIRES_REVIEW=354, INTENTIONAL_UNTRANSLATED=4, AMBIGUOUS/UNMAPPED=0, complete=true. Bootstrap đã sửa để catalog mới có active version sẽ tạo `DRAFT`; chưa activate DB version vì môi trường hiện không có active admin grant/session hợp lệ, activation sẽ thực hiện qua P7 authenticated lifecycle. |
| P5    | PASS        | 2026-09-03 | `2026-09-03.1-2026-09-03.1` / `2026-09-03.1-2026-09-03.1:resolver-8` | Retrieval/ranking đã dùng các tier có thứ tự, exact title pool được union trước candidate cap; explicit/inferred skill được AND-gate và cộng điểm, filters/visibility vẫn strict. Search integration 10/10 pass (exact SEO identity, `lập trình viên pyhton` chỉ trả Python Developer, `qwertyuiop` 0, deterministic 3-page no duplicate); full Search suite 33 files/268 tests pass; format:search, lint:search, typecheck pass. |
| P6    | PARTIAL     | 2026-09-03 | `2026-09-03.1-2026-09-03.1` / `2026-09-03.1-2026-09-03.1:resolver-8` | Autocomplete/ARIA/keyboard cho Jobs (cả `JobSearchForm` và legacy `FilterBar`) và Company; Search fallback; debounce + abort/sequence chống stale; interpretation literal/suggestion/Undo cập nhật URL/kết quả; targeted frontend 8 files/58 tests pass, full Search suite 40 files/287 tests pass, lint/format/typecheck pass. Production Playwright smoke `search-platform-v2.spec.ts` + `job-discovery.spec.ts` pass 6/6 ở desktop Chromium và mobile-320; phát hiện rồi sửa overflow detail ở 320px. Production browser axe serious/critical smoke cũng pass 6/6 sau khi sửa accessible name của category trigger và contrast; full EN/VI/themes/200%/reduced-motion matrix vẫn chưa đủ bằng chứng; in-app browser runtime vẫn báo `failed to write kernel assets: The system cannot find the path specified (os error 3)`, nên phase vẫn PARTIAL. |
| P7    | PASS        | 2026-09-03 | `2026-09-02.2-2026-09-02.2` / `2026-09-03.1-2026-09-03.1:resolver-8` | Added diagnostics-channel composition adapter and registered it in `web/server.ts` plus Next `instrumentation.ts`; production avoids unbounded console labels and metrics keep bounded enums/versions only. Search catalog admin lifecycle integration used an isolated temporary administrator/session and cloned active DB catalog: publish switched runtime to the draft, rollback restored the prior snapshot, stale and concurrent commands produced `AdminCommandConflict` (HTTP 409 mapping covered by unit contract), and idempotent replay returned the original correlation. Immutable audit/rationale evidence was asserted for actor/session/time/reason/version; append-only audit trigger was preserved. P7 focused security/observability/lifecycle gates: 5 files / 11 tests pass; `format:search`, `lint:search`, and typecheck pass. Fixture cleanup removes mutable rows and retains append-only audit evidence by design. |
| P8    | PARTIAL     | 2026-09-03 | `2026-09-02.2-2026-09-02.2` / `2026-09-03.1-2026-09-03.1:resolver-8` | Versioned relevance corpus `2026-09-03.catalog-coverage-v2`: 16 curated cases plus 796/796 canonical title-language coverage, recall@10=1, MRR=1, nDCG@10=1, wrong-correction=0, zero-result=0; unit evaluator pass. Latest production-like read-only performance (5 iterations + warmup) passed 19 job queries (p95 max 303.72 ms), 5 company queries (p95 max 114.55 ms), 4 suggestion queries (p95 max 24.66 ms), filter/pagination (p95 21.30 ms), concurrency-4 (p95 117.54 ms), and heap growth 80.13 MB under 768 MB; all below budgets. Search suite 40 files/287 tests pass; Search lint/format/typecheck, Prisma validate/status/migration sequence, Docker fresh migration/drift verification, catalog audit and production build (115 pages; 2 existing filesystem-tracing warnings) pass. Added fresh-CI catalog bootstrap, `test:search:e2e` and canary-gate self-test. Production browser smoke is 6/6 on desktop/mobile-320 with serious/critical axe assertions and no horizontal overflow; full EN/VI/theme/200%/reduced-motion matrix remains unverified; repo-wide lint still has 35 pre-existing non-Search problems (31 errors, 4 warnings). |
| P9    | PARTIAL     | 2026-09-03 | `2026-09-02.2-2026-09-02.2` / `2026-09-03.1-2026-09-03.1:resolver-8` | Added server-only release flags (`SEARCH_DB_CATALOG_ENABLED`, `SEARCH_TYPO_V2_ENABLED`, `SEARCH_RETRIEVAL_V2_ENABLED`, `SEARCH_RANKING_V2_ENABLED`, `SEARCH_RELAXATION_ENABLED`, `SEARCH_SEMANTIC_FALLBACK_ENABLED`) with atomic fallback/rollback behavior and 4 flag tests. Added bounded `search-canary-gate` schema/evaluator, CLI and self-test (3 gate tests + CI self-test), owner/stop-the-line thresholds, rollout/rollback runbook `docs/search-v3/search-platform-v2-canary-runbook.md`, and CI browser-gate wiring. Additive migration/runtime switch evidence is complete; P7 integration verified runtime rollback and Playwright smoke is 6/6. Staging canary/rollback drill was not run because this environment has no staging deployment, so acceptance remains unchecked. |
