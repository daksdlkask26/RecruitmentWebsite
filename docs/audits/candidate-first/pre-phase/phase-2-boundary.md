# Pre-Phase 2 — Vá hàng rào an toàn cho toàn bộ Direct CV

**Tên work package:** Pre-Phase 2 — Unified CV Security Boundary  
**Ngày lập:** 2026-09-07  
**Sản phẩm:** NextGen Careers  
**Phạm vi kỹ thuật:** mã nguồn SmartHire trong `web/`  
**Đối tượng thực thi:** Codex (GPT-5)  
**Trạng thái ban đầu:** PLAN — chưa được phép đánh dấu hoàn tất nếu chưa có đủ evidence ở mục Definition of Done
**Trạng thái thực thi hiện tại:** DONE_WITH_LIMITATION — unified CV security boundary đã được kiểm chứng; Candidate browser smoke desktop/mobile và các gate bắt buộc đã PASS. Docker Scout được ghi nhận là giới hạn môi trường được defer, không phải blocker của Phase 2; Applications/Job Board failures vẫn là baseline ngoài phạm vi.
**Phase 2:** ĐƯỢC PHÉP BẮT ĐẦU CF-201; không thực hiện CF-201 trong lượt này

## 1. Mệnh lệnh thực thi

Thực hiện kế hoạch này theo đúng thứ tự vertical slice. Không chỉ sửa Team Application rồi dừng lại, vì cùng đường lưu trữ Direct CV đang được dùng bởi Profile CV và Job Application. Không commit, push, deploy, chạy migration trên database dùng chung, reset/clean working tree hoặc dừng service của người dùng nếu chưa được yêu cầu rõ ràng.

Trước mỗi lần sửa:

1. Đọc `AGENTS.md` ở repository root.
2. Xác nhận repo root là `D:\HCMUS\PROJECT` và production code nằm trong `web/`.
3. Chạy `git status --short --branch`; bảo toàn toàn bộ thay đổi có sẵn.
4. Chạy `codegraph status`; nếu index sẵn sàng thì dùng `codegraph explore`, `node`, `callers`, `callees`, `impact` trước khi tìm thủ công.
5. Đọc source hiện tại, không dựa vào line number trong plan nếu code đã dịch chuyển.
6. Chỉ dùng database test cô lập có tên chứa `test`, `spec` hoặc `e2e`; không được trỏ test vào database phát triển/dùng chung.

Sau hai lần thử cùng một hướng không thành công, dừng lặp, ghi nguyên nhân và đổi chiến thuật.

## 2. Mục tiêu

Đưa tất cả CV do Candidate upload qua một security boundary thống nhất trước khi file có thể:

- được xác nhận thành Candidate CV;
- gắn vào Job Application hoặc Team Application;
- đi vào OCR/parser/classifier/scoring;
- được recruiter/company owner preview hoặc download.

Kết quả bắt buộc:

1. Raw upload luôn được kiểm tra kích thước/định dạng trước admission.
2. Artifact luôn được mã hóa bằng AES-256-GCM application envelope trước storage; S3 SSE-KMS chỉ là lớp bổ sung, không thay thế envelope.
3. Artifact mới luôn ở `QUARANTINED` và có `CvScanAssessment(QUEUED)` bền vững.
4. Chỉ assessment `CLEAN`, còn hiệu lực theo policy, mới cho phép promote, OCR, preview hoặc download.
5. `INFECTED`, `INDETERMINATE`, scanner timeout/unavailable và evidence thiếu đều fail closed.
6. Retry có trạng thái bền vững, lease/idempotency rõ ràng và không tạo application/notification trùng.
7. Multipart request bị chặn tổng kích thước và part count trước khi framework parse toàn bộ payload, hoặc được thay bằng upload endpoint streaming/bounded riêng.
8. Team, Job Application và Profile CV không còn tự lưu raw bytes qua `prepareDirectApplicationCv`.

## 3. Hiện trạng đã được chứng minh — không cần điều tra lại từ đầu

### 3.1. Standard CV Import

Đường chuẩn hiện có:

```text
bounded ingress
  -> validateCvFileBytes
  -> plaintext SHA-256
  -> AES-256-GCM envelope encryption
  -> CvStoredArtifact(QUARANTINED)
  -> CvScanAssessment(QUEUED)
  -> ClamAV worker
  -> CLEAN only
  -> artifact AVAILABLE
  -> extraction / parser / confirm
```

Điểm chạm chính:

- `web/src/backend/services/cv-import/receive-cv-content.ts`
- `web/src/backend/cv/encryption/artifact-cryptor.ts`
- `web/src/backend/cv/encryption/integrity-verified-reader.ts`
- `web/src/backend/cv/workers/scan-stage.ts`
- `web/src/backend/cv/workers/extraction-stage.ts`
- `web/src/backend/cv/workers/cv-worker-resources.ts`
- `web/prisma/schema.prisma`: `CvUpload`, `CvStoredArtifact`, `CvScanAssessment`

### 3.2. Direct CV đang không an toàn

Các đường sau đang dùng `prepareDirectApplicationCv` và raw `storage.put()`:

- Team Application: `prepareTeamApplicationCv`.
- Direct Job Application: `JobApplicationService.submit`.
- Direct Profile CV: `POST /api/account/candidate-cvs`.

`validateCvUploadContent` là content/classification preflight, không phải antivirus. Hàm này hiện còn truyền cứng `scanStatus: "CLEAN"` cho extractor dù chưa có scanner evidence. Không được giữ hành vi này.

`ApplicationDocument.safetyAssessmentId` hiện chỉ là chuỗi được tạo ra, không có foreign key tới assessment thực. Không được coi chuỗi này là bằng chứng an toàn.

### 3.3. Open gate đang thiếu

- `openTeamApplicationCv` chỉ kiểm tra owner và retention rồi mở storage.
- `OpenApplicationDocumentService` authorize recruiter rồi mở storage, không chứng minh assessment `CLEAN`.
- `X-Content-Type-Options: nosniff`, `private, no-store` và filename sanitization phải giữ lại, nhưng chúng không thay thế malware gate.

### 3.4. Multipart đang parse trước khi giới hạn

Các route Team, Job Application và Profile CV gọi `request.formData()` trước khi giới hạn tổng request/part. Kiểm tra `File.size <= 5 MB` sau parse không ngăn multipart memory/CPU exhaustion.

## 4. Các quyết định kiến trúc đã chốt

Model thực thi không được tự thay các quyết định sau bằng giải pháp ngắn hơn.

### D1 — Một nguồn sự thật cho scan

Dùng `CvUpload` + `CvStoredArtifact` + `CvScanAssessment` làm nguồn sự thật duy nhất cho admission/encryption/scan. Không tạo `cvScanStatus` ở ba bảng khác nhau rồi cập nhật đồng bộ thủ công.

Các bảng nghiệp vụ có thể giữ snapshot phục vụ hiển thị/retention, nhưng quyền mở file phải được chứng minh bằng foreign key tới source artifact và scan assessment thật.

### D2 — Không scan đồng bộ trong HTTP request

Không gọi ClamAV trực tiếp trong request Team/Job/Profile. Request phải tạo admission bền vững, trả trạng thái xử lý, worker scan bất đồng bộ và client poll/retry theo contract. Scanner unavailable không được làm request treo lâu hoặc cho phép file đi tiếp.

### D3 — Không hard-code CLEAN

Cấm truyền `scanStatus: "CLEAN"` nếu giá trị không được đọc từ `CvScanAssessment` đã hoàn tất. Parser/extractor/classifier không được chạy trước scan.

### D4 — Fail closed ở tầng service, không chỉ UI

Ẩn nút download chưa đủ. `openTeamApplicationCv`, `OpenApplicationDocumentService`, OCR/scoring workers và mọi storage reader phải tự kiểm tra evidence. Gọi service trực tiếp hoặc đoán URL vẫn phải bị từ chối.

### D5 — S3 SSE-KMS là defense in depth

Giữ SSE-KMS và private bucket policy hiện có. Raw plaintext vẫn phải được mã hóa application envelope trước khi gọi filesystem/S3 adapter.

### D6 — Không phá ownership/reconciliation đã có

Giữ các invariant của `CandidateCvArtifactPromotion`: stage ledger trước object write, claim sau DB commit, preserve-on-unknown và cleanup idempotent. Khi thay raw artifact bằng secure artifact, phải chuyển ownership tương đương; không xóa cơ chế reconciliation để “đơn giản hóa”.

### D7 — Hai bước cho Direct upload

Direct upload phải tách thành:

1. **Admission:** nhận file, mã hóa, quarantine, queue scan, trả `202` cùng opaque `uploadId` và trạng thái.
2. **Finalize:** chỉ khi upload thuộc đúng Candidate và assessment mới nhất là `CLEAN`, promote artifact rồi mới tạo/confirm bản ghi nghiệp vụ.

Nếu cần tương thích UI cũ, route cũ được phép trở thành orchestration facade, nhưng không được chờ scan vô hạn hoặc submit domain row trước CLEAN.

## 5. Contract dữ liệu đích

### 5.1. Mở rộng enum và quan hệ hiện có

Đề xuất tối thiểu; tên cuối cùng có thể điều chỉnh theo naming convention hiện tại nhưng semantics không được thay đổi:

```prisma
enum CvUploadPurpose {
  PROFILE_IMPORT
  PROFILE_DIRECT
  JOB_APPLICATION_DIRECT
  TEAM_APPLICATION_DIRECT
}

enum CvProcessingMode {
  IMPORT_AND_PARSE
  SCAN_ONLY
}
```

Thêm vào `CvUpload`:

```prisma
purpose        CvUploadPurpose    @default(PROFILE_IMPORT)
processingMode CvProcessingMode   @default(IMPORT_AND_PARSE)
policyVersion  String
```

Yêu cầu:

- Migration backfill toàn bộ row cũ thành `PROFILE_IMPORT`, `IMPORT_AND_PARSE` và policy version tương ứng với policy hiện hành.
- Không dùng nullable lâu dài chỉ để né backfill.
- `SCAN_ONLY` sau CLEAN không tự enqueue parser/import draft; nó chuyển sang trạng thái terminal an toàn dành cho finalize. Nếu enum `CvUploadStatus` thiếu trạng thái thích hợp, thêm `SECURITY_CLEAN` thay vì lạm dụng `EXTRACTION_QUEUED`.
- Assessment phải lưu `engineName`, `engineVersion`, `signatureVersion`, thời điểm hoàn tất và policy version được đánh giá. Nếu policy version đặt ở upload, assessment vẫn cần snapshot hoặc immutable binding để biết scan chạy theo policy nào.

### 5.2. Foreign key evidence cho consumer

Thêm quan hệ thật, không chỉ chuỗi tự do:

- `CandidateCv.sourceArtifactId -> CvStoredArtifact.id`
- `CandidateCv.scanAssessmentId -> CvScanAssessment.id`
- `ApplicationDocument.sourceArtifactId -> CvStoredArtifact.id`
- `ApplicationDocument.scanAssessmentId -> CvScanAssessment.id`
- `TeamApplication.cvSourceArtifactId -> CvStoredArtifact.id`
- `TeamApplication.cvScanAssessmentId -> CvScanAssessment.id`

Ràng buộc service bắt buộc xác minh:

- artifact và assessment cùng `uploadId`, `accountId`;
- assessment trỏ đúng `sourceArtifactId`;
- assessment `status = CLEAN` và `completedAt != null`;
- artifact `status = AVAILABLE`, chưa bị inaccessible/deleted/hết retention;
- upload thuộc đúng Candidate;
- `purpose` phù hợp với consumer;
- policy/engine/signature không stale theo policy hiện hành;
- digest/byte length của snapshot domain trùng artifact.

Không thể biểu diễn toàn bộ invariant cross-table bằng Prisma schema; phải có transaction/service guard và integration tests.

### 5.3. Chuyển tiếp cột cũ

Không xóa ngay các cột `cvStorageKey`, `storageKey`, `storageKeyEncrypted`, `safetyAssessmentId` trong cùng migration đầu tiên.

Thực hiện expand/verify/contract:

1. **Expand:** thêm relation nullable và code dual-read fail closed.
2. **Backfill:** chỉ gắn evidence cho row có thể chứng minh provenance; row legacy không chứng minh được phải bị `ordinaryAccessDenied`/unavailable, không tự đánh dấu CLEAN.
3. **Verify:** script read-only đếm `safe`, `legacy_denied`, `inconsistent`, `missing`.
4. **Contract:** chỉ bỏ cột cũ ở migration sau, ngoài Pre-Phase 2, khi rollout evidence đầy đủ.

Migration dự kiến tiếp theo hiện là `090_unified_cv_security_boundary`; phải kiểm tra lại sequence trước khi tạo, không được giả định nếu repository đã có migration mới.

## 6. API contract đích

### 6.1. Admission endpoint dùng chung

Ưu tiên tạo service dùng chung và route Candidate-scoped, ví dụ:

```text
POST /api/account/cv-admissions
Content-Type: application/octet-stream hoặc raw document body
Headers:
  Content-Length: bắt buộc, 1..5_000_000
  X-CV-Filename: encoded/sanitized metadata
  X-CV-Purpose: PROFILE_DIRECT | JOB_APPLICATION_DIRECT | TEAM_APPLICATION_DIRECT
  Idempotency-Key: bắt buộc
```

Không bắt buộc giữ đúng tên route/header trên nếu OpenAPI convention hiện tại khác. Bắt buộc giữ semantics:

- reject missing/invalid/chunked unbounded length theo boundary hiện hành;
- stream/buffer tối đa 5 MB có cutoff trong lúc đọc;
- validate magic bytes và MIME/extension contract;
- SHA-256 plaintext;
- AES-256-GCM trước storage;
- DB finalize tạo `QUARANTINED` + `QUEUED` trong transaction;
- replay cùng idempotency + cùng digest trả cùng upload;
- cùng idempotency + digest khác trả conflict;
- response `202` không tiết lộ locator/key/path.

Response mẫu:

```json
{
  "uploadId": "opaque-id",
  "status": "SCAN_QUEUED",
  "retryAfterSeconds": 2
}
```

### 6.2. Poll status

Tái sử dụng projection/status endpoint hiện có nếu authorization và purpose phù hợp. Candidate chỉ đọc upload của chính mình.

UI cần phân biệt:

- `SCAN_QUEUED` / `SCANNING`: đang kiểm tra;
- `SECURITY_CLEAN`: có thể finalize;
- `INFECTED`: từ chối, không retry cùng bytes;
- `SCAN_FAILED`/indeterminate: cho retry có giới hạn;
- expired/deleted/cancelled: upload lại.

Không trả engine internals nhạy cảm cho Candidate; log/audit vẫn lưu evidence cần thiết.

### 6.3. Finalize Team Application

Endpoint finalize nhận JSON bounded, không nhận lại file:

```json
{
  "companyId": "...",
  "role": "RECRUITER",
  "cvUploadId": "..."
}
```

Trong cùng transaction logic:

1. Lock/đọc upload, artifact, assessment và Candidate ownership.
2. Chạy `assertCvArtifactSafeForUse`.
3. Kiểm tra company/opportunity/membership/duplicate như service hiện tại.
4. Tạo `TeamApplication` với FK evidence và snapshot filename/MIME/size/digest.
5. Claim/persist promotion ownership đúng commit boundary.
6. Chỉ sau commit mới phát notification idempotent.

Không tạo `SUBMITTED` hoặc notification khi scan còn queued/failed/infected.

### 6.4. Finalize Profile CV

Chỉ tạo `CandidateCv.confirmedAt` sau CLEAN. Candidate CV chưa CLEAN không xuất hiện trong picker dùng để apply. Nếu cần hiển thị progress, dùng upload status projection riêng, không giả vờ nó là confirmed CV.

### 6.5. Finalize Direct Job Application

Direct Job Application phải tham chiếu secure upload/Candidate CV đã CLEAN. Giữ các kiểm tra profile, answers, consent, draft revision, attempt limit và idempotency hiện tại.

Không được:

- tạo `CandidateCv` confirmed trước CLEAN;
- tạo `JobApplication` rồi hy vọng scan sau;
- phát notification hoặc scoring work trước CLEAN;
- gán `safetyAssessmentId` ngẫu nhiên thay cho relation thật.

## 7. Multipart request boundary

Thực hiện một trong hai phương án, ưu tiên phương án A.

### Phương án A — raw bounded upload riêng

- File đi qua raw-body admission endpoint như Standard CV Import.
- Metadata nghiệp vụ gửi trong JSON finalize request riêng.
- Không còn multipart chứa file ở Team/Profile/Job submit.
- Đây là phương án ít rủi ro DoS và dễ tái sử dụng encryption/scan nhất.

### Phương án B — multipart parser streaming có quota

Chỉ dùng nếu framework/runtime hiện tại hỗ trợ parser streaming được kiểm soát và có test thật. Bắt buộc:

- kiểm tra `Content-Length` tổng trước parse;
- hard limit tổng body, mỗi file, mỗi text field và tổng số part;
- chỉ cho phép đúng field name, từ chối duplicate file field;
- cutoff trong lúc stream, không chỉ sau `formData()`;
- cleanup partial object khi disconnect/parser failure;
- test missing `Content-Length`, forged smaller length, chunked oversize, nhiều part nhỏ, duplicate file và boundary malformed.

Không được coi cấu hình proxy không nằm trong repository là bằng chứng duy nhất.

## 8. Shared security services phải tạo

Tên có thể theo convention, nhưng trách nhiệm phải tách rõ:

### 8.1. `CvAdmissionService`

- Authorize Candidate.
- Bounded read và format admission.
- Gọi artifact cryptor.
- Ghi quarantine artifact và scan work.
- Xử lý idempotency/replay/cleanup unknown outcome.

Ưu tiên refactor/reuse logic trong `ReceiveCvContentService`; không copy nguyên một pipeline thứ hai.

### 8.2. `CvSafetyEvidenceService`

Cung cấp một hàm duy nhất, ví dụ:

```ts
assertCvArtifactSafeForUse({
  candidateUserId,
  uploadId,
  artifactId,
  assessmentId,
  expectedPurpose,
  now,
});
```

Hàm phải trả metadata immutable cần cho consumer hoặc throw typed error. Không trả boolean mơ hồ. Error bên ngoài không tiết lộ tenant, locator, scanner topology hoặc malware signature.

### 8.3. `OpenSafeCvArtifactService`

- Authorize actor/domain object trước.
- Gọi safety evidence service.
- Dùng `IntegrityVerifiedReader` để decrypt và kiểm tra authentication tag/digest.
- Chỉ sau đó mới tạo stream response.
- Nếu integrity fail: deny, schedule deletion/reconciliation và audit.

Team/Application/Profile download phải dùng service này, không tự gọi `createCvWorkerStorage().open()`.

## 9. Thứ tự triển khai bắt buộc

## Slice 0 — Characterization và test đỏ

Mục tiêu: chứng minh lỗ hổng bằng test trước khi sửa.

Tạo test cho:

1. PDF có magic bytes hợp lệ và chứa EICAR phải không thể trở thành Team Application downloadable.
2. Assessment thiếu/QUEUED/PROCESSING/INDETERMINATE/INFECTED/CANCELLED đều bị open gate từ chối.
3. Chỉ CLEAN + artifact AVAILABLE + evidence khớp mới mở được.
4. `validateCvUploadContent` không được gọi trước CLEAN và không được hard-code CLEAN.
5. Team finalize trước scan trả conflict/processing, không tạo row `SUBMITTED`.
6. Multipart oversize/part flood bị chặn trước `request.formData()` hoặc route không còn multipart.

Không sửa expected để test xanh. Lưu tên test và failure message làm evidence.

**Gate Slice 0:** có test đỏ đúng nguyên nhân; không cần EICAR thật gây hại — dùng chuỗi kiểm thử chuẩn trong fixture cô lập, không ghi nó vào storage dùng chung.

## Slice 1 — Schema expand và migration an toàn

1. Thêm enum/field/relation theo mục 5.
2. Tạo migration kế tiếp đúng sequence.
3. Backfill default cho Standard Import cũ.
4. Không tự đánh dấu legacy Direct artifact là CLEAN.
5. Cập nhật Prisma client theo workflow repository.
6. Thêm migration verification script/check.

**Gate Slice 1:** Prisma validate/generate và migration test trên database test sạch đạt; rollback strategy được ghi rõ; không mutate database dùng chung.

## Slice 2 — Common admission/encryption

1. Trích xuất logic dùng chung từ Standard Import.
2. Tạo raw bounded admission contract.
3. Bảo toàn idempotency, quota, encryption AAD và cleanup semantics.
4. Thêm purpose/processing mode.
5. `SCAN_ONLY` dừng ở trạng thái CLEAN có thể finalize, không chạy parser ngoài ý muốn.

**Gate Slice 2:** filesystem chứa ciphertext, không chứa plaintext marker; decrypt đúng context thành công; sai AAD/tag/digest fail closed; assessment QUEUED được tạo đúng một lần.

## Slice 3 — Worker và policy freshness

1. Scan worker xử lý cả Standard và Direct admission.
2. CLEAN cập nhật artifact availability và upload status phù hợp processing mode.
3. INFECTED schedule deletion/inaccessibility như Standard.
4. Timeout/unavailable/stale signatures thành INDETERMINATE/SCAN_FAILED có retry policy.
5. Không tạo extraction job cho `SCAN_ONLY` nếu chưa được yêu cầu.
6. Lưu policy/engine/signature evidence đầy đủ.

**Gate Slice 3:** CLEAN, INFECTED, unavailable, timeout, stale definition, lease expiry, duplicate worker và retry concurrency đều có integration evidence.

## Slice 4 — Team Application end-to-end

1. Đổi UI/route Team thành admission → poll → finalize.
2. `TeamApplication` chỉ SUBMITTED sau CLEAN.
3. Thay direct storage key bằng secure artifact/assessment relation theo expand phase.
4. `openTeamApplicationCv` dùng open-safe service.
5. Notification chỉ sinh một lần sau successful finalize.
6. Retention xóa/deny đúng secure artifact ownership; không làm hỏng Candidate CV khác.

**Gate Slice 4:** EICAR bị block; owner đúng tenant chỉ mở CLEAN; non-owner/missing/stale/infected đều 404/unavailable; retry không tạo application/notification trùng.

## Slice 5 — Profile CV và Direct Job Application

1. Đổi `POST /api/account/candidate-cvs` sang secure admission/finalize.
2. Candidate picker chỉ trả confirmed + CLEAN CV.
3. Đổi multipart direct apply sang uploadId/CandidateCv đã CLEAN.
4. `ApplicationDocument` lưu relation evidence thật.
5. `OpenApplicationDocumentService`, preview, text extraction và scoring đều dùng safety gate.
6. Xóa mọi `scanStatus: "CLEAN"` giả lập khỏi production source.

**Gate Slice 5:** Profile/Job/Team cùng test matrix; direct apply vẫn giữ consent, answers, attempt limit, draft revision và idempotency.

## Slice 6 — Legacy data, UI states và observability

1. Dual-read chỉ cho phép legacy row khi có evidence backfill đáng tin cậy; còn lại deny với trạng thái có thể hỗ trợ.
2. UI EN/VI cho scanning, retryable failure, infected/rejected, expired và retry.
3. Loading không làm mất form data; refresh/resume theo uploadId.
4. Log metrics không chứa filename, CV text, malware payload, locator hoặc PII.
5. Audit các lần denied open, integrity failure, infected outcome và retry exhaustion.
6. Viết script reconciliation read-only và worker repair có dry-run mặc định.

**Gate Slice 6:** EN/VI, keyboard, focus, 320/375/768/1280, dark mode và reduced motion được kiểm tra; metrics phân biệt queued/clean/infected/indeterminate/denied-open.

## Slice 7 — Contract cleanup

Trong Pre-Phase 2 chỉ được dừng ở deprecation nếu chưa có rollout evidence. Không drop cột cũ cùng lúc với expand.

1. Tìm toàn bộ caller còn dùng `prepareDirectApplicationCv` hoặc raw storage open.
2. Xóa caller production sau khi mọi consumer dùng secure boundary.
3. Giữ adapter/helper chỉ khi test hoặc migration repair còn cần và có comment deprecation.
4. Chạy CodeGraph impact để chứng minh không còn bypass path.

**Gate Slice 7:** repository search không còn production path ghi/mở Direct CV raw; migration contract/drop được tách sang work item sau nếu rollout chưa đủ.

## 10. Test matrix bắt buộc

### 10.1. Admission

- Empty, >5 MB, thiếu length, length không hợp lệ.
- Declared length nhỏ hơn/lớn hơn actual.
- PDF/DOC/DOCX hợp lệ theo contract.
- Extension/MIME/magic mismatch.
- ZIP giả DOCX, DOC OLE không có WordDocument.
- Valid magic + EICAR marker.
- Duplicate idempotency cùng bytes và khác bytes.
- Disconnect giữa encrypt, storage complete và DB finalize.

### 10.2. Encryption/integrity

- Storage filesystem không chứa plaintext fixture marker.
- IV 12 byte, authentication tag 16 byte, key version tồn tại.
- Sai account/upload/artifact/kind AAD không decrypt được.
- Ciphertext bị sửa, tag sai, digest sai, byte length sai đều deny và schedule cleanup.
- S3 vẫn gửi SSE-KMS headers đúng key.

### 10.3. Scan

- CLEAN.
- INFECTED/EICAR.
- Scanner unavailable.
- Timeout.
- Malformed protocol response.
- Stale signature/policy.
- Lease expired và worker retry.
- Hai worker cạnh tranh không commit hai kết quả.
- Candidate retry đạt limit và không tạo assessment trùng.

### 10.4. Authorization/open

- Candidate A không dùng upload của Candidate B.
- Company Owner A không mở Team Application của Company B.
- Recruiter không thuộc job/company không mở ApplicationDocument.
- CLEAN nhưng artifact deleted/expired/inaccessible vẫn deny.
- Artifact AVAILABLE nhưng assessment không CLEAN vẫn deny.
- Assessment CLEAN nhưng trỏ artifact khác vẫn deny.
- Download/preview/text/scoring đều dùng cùng gate.

### 10.5. Domain/idempotency

- Finalize trước CLEAN không tạo domain row.
- Hai finalize đồng thời chỉ tạo một Team/Job/Profile result.
- Failure trước commit cleanup temporary ownership.
- Failure sau commit không xóa owned artifact.
- Notification/scoring work không phát trước CLEAN và không trùng khi replay.
- Retention không xóa artifact vẫn được domain row hợp lệ sở hữu.

### 10.6. UI/accessibility

- Resume sau refresh trong lúc scanning.
- Retry scanner failure nhưng không retry infected bytes.
- Copy EN/VI đầy đủ.
- Keyboard/focus/screen reader status announcement.
- Mobile 320/375, tablet 768, desktop 1280, zoom 200%.
- Dark mode và reduced motion.
- Loading/empty/error/retry không làm mất dữ liệu application form.

## 11. Các test/file dự kiến phải chạm

Danh sách định hướng, phải dùng CodeGraph xác minh lại:

- `web/tests/backend/unit/jobs/prepare-direct-application-cv.test.ts`
- `web/tests/backend/unit/company-team-applications/team-storage-unknown.test.ts`
- `web/tests/backend/integration/company-team-applications/candidate-submission.test.ts`
- `web/tests/backend/integration/company-team-applications/storage-unknown-reconciliation.test.ts`
- `web/tests/backend/applications/open-application-document.test.ts`
- `web/tests/backend/integration/cv-import/cv-content-receiver.test.ts`
- `web/tests/backend/integration/cv-import/cv-failure-outcomes.test.ts`
- `web/tests/backend/integration/cv-import/cv-retry-policy.test.ts`
- `web/tests/backend/integration/cv-import/private-cv-storage.contract.test.ts`
- security tests mới cho unified safe-open gate và tenant isolation
- frontend tests cho Team/Profile/Job scanning states
- browser E2E Candidate upload → scan → finalize → recruiter/owner open

Không chỉ sửa test cũ. Phải có regression test gọi service trực tiếp để chứng minh route/UI không phải hàng rào duy nhất.

## 12. Lệnh kiểm chứng tối thiểu

Chạy từ repository root, dùng script workspace hiện có. Điều chỉnh danh sách focused test theo file thực tế.

```text
git status --short --branch
codegraph status
npm run db:migrations:check
npm run db:validate
npm run typecheck
npm run lint
npm run test:cv-import
npm run test:candidate-first
npm run test:applications --workspace @smarthire/web
npm run test:job-board
git diff --check
```

Ngoài ra chạy focused security/integration suite mới trên database test cô lập và ClamAV fixture/live isolated environment. Không được ghi “production-ready” nếu chỉ fixture scanner đạt.

Nếu test toàn repo có lỗi không liên quan:

- không sửa expected/skip để che lỗi;
- ghi command, PASS/FAIL/SKIP;
- chỉ rõ lỗi có liên quan hay baseline ngoài phạm vi;
- focused green không được dùng để tuyên bố toàn sản phẩm xanh.

## 13. Definition of Done

Chỉ đánh dấu Pre-Phase 2 hoàn tất khi tất cả điều kiện sau đạt:

- [ ] Team, Profile và Direct Job CV cùng đi qua AES-256-GCM quarantine + ClamAV assessment.
- [ ] Không production caller nào của Direct CV ghi raw plaintext qua `prepareDirectApplicationCv`.
- [ ] Không production code nào hard-code `scanStatus: "CLEAN"` trước scanner.
- [ ] Mọi preview/download/OCR/parser/scoring path fail closed nếu evidence thiếu hoặc không CLEAN.
- [ ] EICAR fixture bị block trước domain finalize và trước open.
- [ ] Scanner unavailable/timeout có trạng thái retryable bền vững; không submit application.
- [ ] `safetyAssessmentId` ngẫu nhiên không còn được dùng như bằng chứng.
- [ ] Foreign key evidence và cross-table invariant có integration tests.
- [ ] Multipart file path đã được thay bằng raw bounded admission, hoặc streaming parser có đầy đủ quota tests.
- [ ] Ownership, unknown-outcome reconciliation, retention và idempotency không regression.
- [ ] Team/Job/Profile authorization và tenant isolation tests đạt.
- [ ] UI scanning/error/retry đạt EN/VI, keyboard, responsive, dark mode và reduced motion.
- [ ] Migration chạy được trên database test sạch và database test có dữ liệu legacy fixture.
- [ ] Backfill/reconciliation report không tự gắn CLEAN cho row không có evidence.
- [ ] Focused, integration, architecture, security và browser evidence được ghi rõ PASS/FAIL/SKIP.
- [ ] `git diff --check`, typecheck và lint đạt hoặc lỗi ngoài phạm vi được chứng minh cụ thể.
- [ ] Không còn temp artifact, test database fixture, env thật hoặc service do agent tạo mà chưa cleanup.

## 14. Điều kiện phải dừng và báo blocker

Dừng, không đoán, nếu gặp một trong các tình huống:

1. Không có database test cô lập hoặc guard từ chối URL.
2. Cần chạy migration trên database phát triển/dùng chung.
3. Cần secret/KMS/ClamAV production credential.
4. Migration hiện tại đã vượt số dự kiến và có xung đột sequence.
5. Dirty change của người dùng chạm cùng file/schema và không thể merge an toàn.
6. Muốn thay đổi UX/API từ single-request sang async nhưng contract frontend/API hiện hành không đủ để suy ra response compatibility.
7. Legacy data không có provenance đủ để backfill an toàn.

Khi báo blocker, ghi: bước đang làm, evidence, tác động, những hướng an toàn đã thử và quyết định cụ thể cần người dùng chốt.

## 15. Mẫu báo cáo checkpoint sau mỗi slice

```text
Slice:
Status: IMPLEMENTED | VERIFIED | PARTIAL | BLOCKED

Root cause addressed:
- ...

Changed files:
- ...

Behavior before:
- ...

Behavior after:
- ...

Evidence:
- command -> X PASS / Y FAIL / Z SKIP
- database/storage/scanner environment used

Security invariants verified:
- ...

Unverified / blocker:
- ...

Cleanup:
- temp files, containers, database namespace, env

Next exact step:
- ...
```

## 16. Anti-shortcut checklist dành cho model thực thi

Không được làm các việc sau:

- Chỉ thêm `cvScanStatus = CLEAN` mặc định vào `TeamApplication`.
- Sinh UUID mang tên `safetyAssessmentId` rồi coi là scan evidence.
- Dùng content classifier/OCR/PDF parser thay antivirus.
- Hard-code CLEAN để vượt guard của extractor.
- Chỉ disable nút download ở UI.
- Scan sau khi đã gửi notification hoặc cho recruiter mở file.
- Lưu plaintext vì “S3 đã có SSE-KMS”.
- Gọi `request.formData()` rồi mới kiểm tra tổng request size.
- Tự đánh dấu legacy Direct CV là CLEAN trong migration.
- Xóa artifact khi DB outcome không xác định.
- Dùng `skip`, `only`, nới assertion authorization hoặc đổi expected chỉ để test xanh.
- Mass refactor/rebrand ngoài phạm vi.
- Dừng sau khi Team Application xanh trong khi Profile/Job vẫn còn bypass.

## 17. Kết quả bàn giao cuối cùng

Bàn giao phải gồm:

1. Migration expand và rollback/forward strategy.
2. Unified admission/encryption/scan service.
3. Unified safety evidence và safe-open service.
4. Team, Profile và Job Application integrations.
5. Async UI states và EN/VI copy.
6. Security, concurrency, integration và browser tests.
7. Legacy reconciliation dry-run report.
8. CodeGraph caller/impact evidence chứng minh không còn raw bypass.
9. Báo cáo PASS/FAIL/SKIP và phần chưa kiểm chứng.

Nếu một trong ba consumer Team/Profile/Job chưa chuyển sang secure boundary, trạng thái cuối phải là **PARTIAL**, không phải DONE.

## 18. Evidence chạy lại — 2026-09-08

Giữ nguyên stack Docker chính và database `smarthire`. Browser smoke dùng database test cô lập `smarthire_pre_phase2_browser_test_20260908_1`, một CV worker one-off trỏ qua `CV_WORKER_POSTGRES_DB`, bind mount storage riêng và ClamAV socket hiện hữu. Worker, database test, fixture storage và Playwright artifacts đã được cleanup sau khi chạy.

### PASS

- Browser smoke Candidate desktop/mobile: **PASS=2, FAIL=0, SKIP=0**. Cả hai viewport hoàn thành upload → scan `CLEAN` → finalize → retained CV radio selector → apply/open và messaging; chạy production mode với worker trỏ database test.
- Candidate-first focused suite: 16/16 files, **PASS=46, FAIL=0, SKIP=0**. Retained CV fixture đi qua `seedCleanJobApplicationCv` với encrypted artifact, scan evidence và `PROFILE_IMPORT`/`CONFIRMED`, không dùng raw `CandidateCv` shortcut.
- Migration 090 và reconciliation (evidence đã kiểm chứng trên database test cô lập): database sạch deploy đủ 001–090; database pre-090 có legacy CV rows được safe-open từ chối với `DENIED_MISSING_EVIDENCE`; migration không tự gắn `CLEAN`; reconciliation là dry-run và không auto-clean.
- ClamAV live: readiness/Unix socket PASS; ClamAV 1.4.5, signature 28116, synthetic PDF `CLEAN`, EICAR `INFECTED`. Worker smoke ghi nhận hai lần `SCAN=CLEAN`, `EXTRACTION=SUCCEEDED`, `PARSE=SUCCEEDED`.
- CV security regression evidence: draft promotion/failure/retry 39/39 PASS; consent tamper/replay 8/8 PASS; review conflict 2/2 PASS. OpenAPI có `SECURITY_CLEAN`; không còn `CV_STORAGE_NOT_READY` trong các suite đã chạy lại; không còn production safe-open bypass theo CodeGraph/source review.
- Static gates sau thay đổi browser smoke: `npm run typecheck --workspace @smarthire/web`, `npm run lint --workspace @smarthire/web`, `git diff --check`: PASS.

### Defer có bằng chứng

- Docker Scout: **DEFERRED_ENVIRONMENT_LIMITATION** do policy không cho gửi SBOM/image metadata; không coi là blocker của Phase 2. Không đổi expected/skip để che lỗi.
- CV-import evidence carry-forward: 60/61 files PASS; 387 PASS, 1 FAIL, 2 SKIP trên 390 tests; failure duy nhất là Docker Scout vulnerability check.
- Applications baseline ngoài phạm vi: 26 files PASS, 8 FAIL; 125 PASS, 8 FAIL trên 133 tests. Giữ backlog các lỗi application-boundaries phrase, guarded drag/drop, review checkbox contract, pipeline board/recovery/movement, rejection-note privacy assertion và consequential-stage decisions.
- Job Board baseline ngoài phạm vi: 50 files PASS, 6 FAIL; 250 PASS, 11 FAIL trên 261 tests. Giữ backlog discovery filters/loading, applied-jobs completed count, navigation, salary workspace, temporary CV/labels/retry/idempotency UI và report-dialog accessible name. Không còn `CV_STORAGE_NOT_READY` trong rerun.
- Browser accessibility evidence carry-forward: desktop/mobile 2/2 projects PASS, 48 viewport/page/zoom cases PASS. Playwright Chromium được dùng vì CUA surface không khả dụng (`apps=[]`, `browsers=[]`).

### Root cause và thay đổi trực tiếp

- Trước sửa, scan CLEAN giữ lease/failure fields khiến PostgreSQL constraint `CvScanAssessment_terminal` trả `23514`, worker phát `CV_STAGE_FAILED` và smoke fail 0/2. `scan-stage.ts` hiện commit trạng thái CLEAN cùng `failureCode`/lease đã clear.
- Smoke spec chờ `PUT /content` trả 202 trước khi polling trạng thái CV; fixture retained CV gom đủ ciphertext encrypted trước khi ghi storage, giữ nguyên production envelope và evidence.

### Cleanup và trạng thái

- Database test `smarthire_pre_phase2_browser_test_20260908_1` đã drop; truy vấn hậu cleanup chỉ còn database `smarthire`.
- Worker one-off không còn; sáu service chính vẫn `Up`/healthy. Port browser test `3001` không còn listener; namespace storage và tám thư mục artifact tạm của lượt này không còn.
- Database `smarthire` được kiểm tra read-only: `CvUpload=1`, `CandidateCv=8`, `CvScanAssessment=1`, `JobApplication=0`, CV upload mới nhất vẫn là record cũ ngày 2026-08-29; không có fixture smoke trên database chính.
- Không reset/clean, commit, push, deploy, restart/dừng stack chính hoặc sửa `.env.local`.

**Kết luận:** Pre-Phase 2 **DONE_WITH_LIMITATION**. Browser smoke 2/2, Candidate-first 46/46, migration/legacy safety, ClamAV CLEAN/EICAR và static gates đã VERIFIED. Docker Scout là giới hạn môi trường được defer và không chặn Phase 2; Applications/Job Board failures là baseline đã chứng minh và giữ backlog. **CF-201 được phép bắt đầu; không thực hiện Phase 2 trong lượt này.**
