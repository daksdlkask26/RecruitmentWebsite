# Candidate-first Phase 6A Plan: Reliable Single-instance Notification and Messaging

**Version:** 1.0  
**Prepared:** 19 September 2026  
**Scope:** CF-601 through CF-604, then the integrated Phase 6A gate  
**Starting point:** commit `ac17ec1efb70` on branch `audit_improvement` — Candidate-first Phase 5 is `DONE / VERIFIED`; the working tree contains a preserved documentation-only status correction outside this plan  
**Dependency:** CF-301 durable application/notification foundations are complete; Phase 6A targets one application instance, while the live deployment topology remains outside this plan until evidenced  
**Current status:** `DONE / VERIFIED` — CF-601 through CF-604 and the integrated Phase 6A gate have current final-source executable evidence; two unrelated baseline suite failures remain explicit `FAIL` exceptions under the gate policy

## 1. Purpose

Phase 6A shall make Candidate-facing notification and general messaging reliable on one application instance under disconnect, reconnect, database delay/failure, session revocation, multiple tabs, duplicate events, and large conversation lists.

The phase closes audit finding F14 by making socket initialization and cleanup race-safe, removing the current per-conversation sequential authorization pattern, defining honest persistence/delivery/read semantics, and proving the complete runtime behavior with fault-oriented executable evidence.

The target behavior is:

`authenticate -> initialize safely -> become ready -> publish best-effort realtime -> recover from durable REST/history -> clean up exactly once`

PostgreSQL and authorized REST reads remain authoritative. Socket.IO accelerates delivery and invalidation; it must not become the only copy of a message, notification, read boundary, authorization decision, or recovery cursor.

Phase 6A is mandatory even while NextGen Careers runs one application instance. Multi-instance transport, shared presence, Redis or another cross-process bus belong to Phase 6B and are explicitly excluded here.

## 2. Normative language and evidence states

The terms **MUST**, **MUST NOT**, **SHOULD**, and **MAY** are normative:

- **MUST / MUST NOT:** required for Phase 6A acceptance.
- **SHOULD:** expected unless current executable evidence supports a smaller or safer alternative.
- **MAY:** optional and must not broaden the phase or introduce speculative infrastructure.

Completion states are strict:

- `NOT_STARTED`: no implementation or current execution evidence exists for the work item.
- `IMPLEMENTED`: source changed, but one or more required evidence classes are missing.
- `VERIFIED`: every acceptance criterion has current executable evidence on the final source.
- `UNVERIFIED`: evidence is missing, stale, inferred only from inspection, interrupted, or belongs to an older source state.
- `BLOCKED`: a precise external or environmental blocker remains after reasonable safe attempts.

Static inspection, typecheck, lint, unit tests, integration tests, browser tests, performance probes, and cleanup are separate evidence classes. One class must not be reported as another.

## 3. Review verdict and anti-over-engineering rules

The roadmap order `CF-601 -> CF-602 -> CF-603 -> CF-604` is correct. The implementation must preserve and improve the current architecture rather than replace it.

1. Keep the existing Socket.IO gateway, messaging services, repository ports, PostgreSQL message history, sequence/read boundaries, React Query notification cache, and REST recovery paths.
2. Fix the proven connection-lifecycle race in the existing gateway. Do not create a second realtime server or parallel registry.
3. Measure the current database/query behavior before selecting batch or lazy-join changes. Do not add caching, a message broker, denormalized authorization tables, or new indexes without measured need.
4. Prefer one bounded authorization projection or lazy room admission over a new authorization subsystem.
5. Do not persist a `DELIVERED` state unless the product actually implements an authenticated client acknowledgement contract. Until then, present the durable state honestly as sent/persisted and read.
6. Do not introduce Redis, a Socket.IO cluster adapter, distributed locks, shared presence, sticky-session infrastructure, or a multi-instance harness in Phase 6A.
7. Do not convert application-scoped Recruitment Messaging from REST/refetch to Socket.IO. General Messaging and Recruitment Messaging remain separate domains and protocols.
8. Do not merge notifications and messages into one aggregate. They may share invalidation/recovery principles without sharing storage or authorization models.
9. Do not redesign the Messaging or Notification UI. Make only state/copy/accessibility changes required to represent the verified connection and delivery contract.
10. Reuse existing EN/VI copy, `--sh-*` tokens, focus behavior, reduced-motion support, components, and responsive layouts.
11. Do not add a database migration unless a failing acceptance criterion proves that the current durable schema cannot represent the required contract. Document rollback before any migration is accepted.
12. Do not modify SpecKit artifacts, branches, templates, tasks, checklists, or configuration as part of this phase.
13. Do not refactor unrelated Support, Connections, Recruitment Messaging, Admin Notification, or email-worker flows merely because they share Socket.IO or notification concepts.
14. A green focused suite is not the final gate. Runtime fault evidence, database-backed recovery, browser behavior, regression checks, and cleanup are required.

## 4. Current repository baseline

### 4.1 Program and dependency state

- Candidate-first Phase 3 is `DONE`; CF-301 provides durable application submission and notification foundations.
- Candidate-first Phases 4 and 5 are `DONE / VERIFIED` on their recorded evidence.
- The roadmap schedules CF-601 through CF-604 after CF-301 and classifies Phase 6A as the mandatory single-instance realtime phase.
- Phase 6B remains conditional on a future topology decision. It is not an entry requirement for Phase 6A.

### 4.2 Existing capabilities that must be preserved

| Capability            | Current source behavior                                                                                            | Phase 6A responsibility                                                     |
| --------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| Socket authentication | The `/chat` namespace authenticates the Better Auth-backed session before accepting a socket                       | Preserve fail-closed authentication and neutral denial                      |
| Durable messages      | Message acceptance is service/repository-backed and uses stable sequence/idempotency behavior                      | Keep persistence authoritative before realtime publication                  |
| Durable read boundary | `lastReadSequence` is stored per conversation participant                                                          | Prove monotonic, multi-tab convergence and reconnect recovery               |
| Authorized history    | REST history is scoped by authenticated participant and paginated by sequence                                      | Use as the recovery path for missed or duplicated realtime events           |
| Local registry        | Socket identity, session, user, and conversation membership use in-process maps                                    | Make lifecycle cleanup exact on one instance; do not distribute it here     |
| Presence              | Multiple sockets per user and a disconnect grace period already exist                                              | Prevent premature ONLINE and stale OFFLINE/ONLINE transitions               |
| Access revocation     | Block, connection, membership, session, account, and moderation paths can remove room access or disconnect sockets | Prove correct scope across multiple tabs and sessions                       |
| Client reconnect      | The client refetches authoritative state after `connect` and access revocation                                     | Prove catch-up, deduplication, unread convergence, and failure states       |
| Notifications         | Notification pages/counts are durable and periodically refetched; local events invalidate React Query state        | Prove that realtime interruption cannot lose the durable notification state |
| Existing tests        | Focused messaging, notification, security, accessibility, performance, and Playwright coverage exists              | Extend the smallest relevant suites; do not build a second test framework   |

### 4.3 Proven source-level lifecycle gap

The current `/chat` connection callback performs this sequence:

1. register the socket in the local socket registry;
2. register Candidate presence;
3. await account-room join;
4. query all authorized conversation IDs;
5. for each conversation, await access/context/block authorization;
6. await conversation-room join and update the local registry;
7. register message/join/leave handlers;
8. register the disconnect cleanup handler.

Because cleanup is installed after several awaited boundaries, a client can disconnect during initialization after local state is published but before the cleanup listener exists. Static inspection proves the unsafe ordering. A concrete leak or stale-presence runtime failure remains `UNVERIFIED` until CF-601 fault tests reproduce it.

### 4.4 Proven source-level query pattern

Connection initialization first lists all conversation IDs and then authorizes each conversation separately. Each authorization can read conversation access, context eligibility, and block state. Presence publication and message fan-out also repeat access checks per conversation or local socket.

This is a source-proven per-conversation sequential pattern. Its exact PostgreSQL query count, pool wait, and latency at 1/10/40/100 conversations are not currently measured. The existing Candidate-first realtime probe uses repository contract doubles and explicitly does not claim database-backed query latency.

### 4.5 Current durability and recovery boundary

- Message rows and read boundaries are durable in PostgreSQL.
- REST history supplies the authoritative message page and current sequence.
- The client deduplicates incoming messages by ID or sequence.
- The client requests an authoritative refetch after socket connection or access revocation.
- Notification pages and unread count refetch every 30 seconds while visible and can be invalidated by a local notification-changed event.
- Current message presentation distinguishes sent and read. It does not provide a durable authenticated delivered acknowledgement.

These are useful primitives, not proof of the integrated CF-603 contract. Missed-event catch-up, duplicate/reordered delivery, multi-tab read convergence, notification convergence, and session revocation must run on the final implementation.

### 4.6 Existing evidence boundary

Existing tests cover individual behaviors such as:

- same-process Socket.IO message delivery;
- multiple-tab presence counting and disconnect grace;
- messaging block and access enforcement;
- durable message send and deduplication;
- message history and read state;
- session revocation browser behavior;
- notification repository, context-read, convergence, privacy, and UI behavior;
- in-memory realtime widths and connect/reconnect measurements.

They do not currently establish the Phase 6A integrated gate because they do not collectively prove disconnect at every initialization await, database-backed query growth, durable catch-up after intentionally dropped events, all revocation scopes, final-source browser behavior, and task-owned cleanup in one accepted evidence set.

## 5. Scope boundaries

### 5.1 Included

- CF-601 through CF-604.
- General Messaging `/chat` connection initialization and cleanup.
- In-process socket registry, presence registry, room admission, and realtime publisher where directly required by the four work items.
- Messaging repository/service changes required to batch or bound authorization reads.
- Durable message history, read-boundary, reconnect, deduplication, and access-revocation behavior.
- Candidate-facing in-app Notification invalidation, polling/recovery, unread/read convergence, and honest UI state where affected.
- Candidate and peer/recruiter browser journeys needed to prove the Candidate-facing contract.
- Existing Support and Connections namespaces only for focused regression when a shared Socket.IO server lifecycle change can affect them.
- Existing logging/metrics only where needed to record initialization failure, cleanup, query count, socket-ready latency, reconnect, and recovery without message content or PII.
- Stable audit evidence under `docs/audits/candidate-first/phase-6a/evidence/` and a final `integrated-gate.md` when implementation is executed.

### 5.2 Excluded

- Phase 6B / CF-651 through CF-653.
- Redis, shared pub/sub, multi-instance Socket.IO adapters, sticky-session deployment, distributed presence, and two-instance load testing.
- Changing the deployment topology or claiming multi-instance readiness.
- Moving Recruitment Messaging to Socket.IO or merging it with General Messaging.
- Group chat, attachments, typing indicators, reactions, message edit/delete, search redesign, push notifications, or a new notification product.
- Email-provider delivery and transactional email worker changes unless a Phase 6A regression is caused by the current changes.
- New AI, scoring, recommendation, application-ranking, or recruiter decision behavior.
- Broad Messaging/Notification visual redesign or Phase 7 UI consolidation.
- Unrelated dependency upgrades, schema cleanup, module splitting, or observability-platform rollout.
- Production deployment, production data mutation, shared `smarthire` database mutation, or real-user notification delivery.
- Any SpecKit file or workflow.

## 6. Non-negotiable invariants

1. A message is acknowledged as successful only after the authoritative persistence contract succeeds.
2. Realtime publication failure must not roll back or hide a message that already committed; authorized REST history must recover it.
3. No socket may join or remain in a conversation room without current server-side participant, context, archive, block, account, and session authorization.
4. A socket that disconnects during initialization must leave no local identity, session, conversation, or presence residue.
5. Cleanup is idempotent and safe before, during, and after initialization.
6. Presence becomes `ONLINE` only after the socket reaches the defined ready boundary; it becomes `OFFLINE` only after the last valid socket leaves and the existing grace policy expires.
7. Closing one tab must not mark the account offline while another valid tab remains connected.
8. Session revocation disconnects only sockets for the revoked session. Account suspension or moderation disconnects all affected account sockets.
9. Read boundaries are monotonic. A delayed tab or duplicate request cannot reduce `lastReadSequence` or restore unread state already committed as read.
10. Duplicate or reordered realtime events cannot create duplicate durable messages or regress the visible read boundary.
11. Message content, notification payload details, credentials, session identifiers, and PII must not be added to logs or evidence.
12. Neutral authorization failures remain neutral; the transport must not reveal conversation existence, participant identity, block direction, or tenant membership.
13. Candidate and recruiter/company authorization remain separate and server-authoritative.
14. General Messaging and Recruitment Messaging storage, authorization, and protocol boundaries remain separate.
15. Socket.IO remains an optimization over durable state, not a replacement for persistence and recovery.
16. No test may be skipped, weakened, or converted to a mock merely to obtain a green result.

## 7. Authoritative Phase 6A contracts

### 7.1 Connection lifecycle contract

The implementation may use flags, a small local state object, or an equivalent existing primitive. It must preserve these observable states without requiring a new framework:

| State            | Required behavior                                                                                      |
| ---------------- | ------------------------------------------------------------------------------------------------------ |
| `AUTHENTICATING` | No registry, presence, or conversation membership is published before authentication succeeds          |
| `INITIALIZING`   | Cleanup/error handling is already installed; partial room/registry work remains reversible             |
| `READY`          | Account routing and the selected authorized room strategy are active; presence may be published ONLINE |
| `CLOSING`        | New initialization work stops; all owned local state is removed exactly once                           |
| `CLOSED`         | No local socket/session/conversation/presence residue remains                                          |

The code need not expose these names publicly. The behavior and transition tests are required.

### 7.2 Room-admission contract

- Account rooms and conversation rooms are server-derived; the browser cannot choose another user account room.
- Conversation admission fails closed when access, context eligibility, block state, archive state, session, or account state is invalid.
- Phase 6A may retain bounded eager join, introduce lazy join, or combine account-room invalidation with active-conversation rooms.
- The selected strategy must preserve list-only notification of new durable messages through an authoritative refetch path.
- A room optimization must not weaken authorization or rely on a stale client conversation list.

### 7.3 Persistence, publication, recovery, and read contract

| Concept              | Meaning in Phase 6A                                                                                                    |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `ENQUEUED`           | An internal operation was accepted for processing; not proof of persistence or peer visibility                         |
| `PERSISTED` / `SENT` | The authoritative message or notification record committed successfully                                                |
| `DELIVERED`          | May be claimed only when an authenticated client acknowledgement contract exists; Socket.IO emit alone is insufficient |
| `READ`               | The authorized reader's monotonic read boundary committed to PostgreSQL                                                |

If no authenticated delivered acknowledgement is implemented, the UI must use honest `SENT`/`READ` semantics and must not manufacture a delivered indicator.

After reconnect, focus return, access restoration, or a detected sequence gap, the client must reconcile from authorized REST/history. Reconciliation must deduplicate by stable message identity/sequence and restore the server-authoritative unread/read state.

### 7.4 Notification contract

- The notification database row and read state are authoritative.
- Realtime/local invalidation may reduce visible latency but cannot be the only discovery mechanism.
- Polling/refetch remains available when realtime is disconnected, missed, or disabled.
- Notification count, pages, context-read, and message/application views converge after retry/reconnect.
- A failed notification side effect must not corrupt the durable message or application transaction.
- Copy and badges must not imply delivery/read guarantees that the backend does not record.

### 7.5 Revocation contract

- Conversation block/connection/membership changes remove only affected conversation access.
- Session revocation disconnects the target session's sockets and preserves other valid sessions for the same account.
- Account suspension and moderation disconnect every affected socket on the current instance.
- A disconnected or revoked socket cannot rejoin using stale local state; it must reauthenticate and reauthorize.
- REST remains fail-closed even if a realtime revocation event is missed.

## 8. Dependency order and hard gates

Phase 6A must run as four sequential vertical slices:

`Entry gate -> CF-601 -> CF-602 -> CF-603 -> CF-604 -> integrated Phase 6A gate`

Rules:

1. CF-602 must not optimize initialization before CF-601 makes partial initialization safely reversible.
2. CF-602 must capture a database-backed pre-change query/latency baseline before changing query shape or room policy.
3. CF-603 must preserve the CF-601/602 lifecycle and authorization contract while adding recovery/convergence behavior.
4. CF-604 must run on the final source and must not reuse earlier partial evidence as a current pass.
5. A slice may be `VERIFIED` only when its own required evidence passes and no earlier invariant regresses.
6. If a source contradiction changes the proposed architecture, the root agent must adapt to current evidence and record the decision; it must not force a stale plan assumption.

## 9. Entry gate — baseline and safety proof

Before source changes:

1. Confirm the current branch, HEAD, working-tree changes, and ownership of any running server, lock, build output, database, and port.
2. Preserve the existing Candidate-first README correction and every unrelated dirty file.
3. Confirm the active `/chat` path, WebSocket-only transport, authentication boundary, registry/presence ownership, and REST recovery route behavior.
4. Inventory the exact general Messaging and Notification suites affected by Phase 6A.
5. Run or record a focused current baseline for messaging, notification, session-revocation, and Support/Connections namespace smoke where practical.
6. Capture pre-change Socket.IO runtime behavior for disconnect during initialization.
7. Capture database-backed query count, query grouping, socket-ready p50/p95, reconnect p50/p95, room count, and failure rate for 1/10/40/100 conversations.
8. Confirm whether current list-only delivery relies on eager conversation rooms, an account room, or refetch invalidation before selecting the smallest optimization.
9. Set both `DATABASE_URL` and `DIRECT_URL` to the same isolated PostgreSQL database whose name contains `test`, `spec`, or `e2e` for every write-capable test.
10. Apply the full current migration sequence to the isolated database and record the exact migration count.
11. Do not modify source until the baseline and the first failing/insufficient contract are written into evidence.

If an executable pre-change failure cannot be reproduced, the source-proven unsafe ordering remains a valid hardening target, but the plan must classify the runtime symptom as `UNVERIFIED` and use a deterministic fault-injection test before claiming the fix.

## 10. CF-601 — Race-safe connection initialization and cleanup

### 10.1 Problem

The disconnect cleanup listener is currently installed after awaited room joins and per-conversation authorization. A client can disconnect while the socket is already registered or marked online but before cleanup exists. Error and disconnect paths can also interleave with later initialization work.

### 10.2 Required implementation

1. Install disconnect and initialization-error cleanup before the first awaited boundary after authentication.
2. Use one idempotent cleanup path for disconnect, initialization error, explicit close, and partially completed initialization.
3. Track only state owned by the socket so cleanup removes the exact local identity, session, conversation rooms, and presence registration created by that socket.
4. Guard every long boundary and loop iteration with the current socket/initialization state; stop work when the socket is no longer connected or initialization was cancelled.
5. Do not publish ONLINE before the ready boundary is reached.
6. Ensure partial room joins are left or made harmless by socket disconnection and registry cleanup.
7. Catch initialization errors, emit only a safe transport error when appropriate, and prevent unhandled promise rejections.
8. Preserve normal reconnect, multi-tab grace, explicit conversation join/leave, and access-revocation behavior.
9. Keep cleanup local to the current instance. Do not add a distributed registry.
10. Add only the smallest lifecycle abstraction required to make ordering and tests deterministic.

### 10.3 CF-601 acceptance criteria

- Disconnect before account-room join leaves no socket, session, room, or presence residue.
- Disconnect while listing authorized conversations leaves no residue.
- Disconnect during conversation authorization leaves no residue and stops the remaining loop.
- Disconnect after a room join but before handler registration leaves no registry room membership.
- A thrown account-room join, repository call, authorization call, or conversation-room join reaches the same cleanup path.
- Cleanup can run more than once without throwing or corrupting another socket.
- ONLINE is not published for a socket that never becomes ready.
- With two tabs for one account, closing one tab keeps the account online; closing the last tab produces one delayed OFFLINE transition.
- Reconnect after an interrupted initialization creates one valid ready socket and no duplicate presence transition outside the grace policy.
- Runtime has zero unhandled rejections in the fault matrix.

### 10.4 Required CF-601 evidence

- Focused lifecycle unit tests for idempotent cleanup and state transitions.
- Real Socket.IO integration tests with controllable promises/faults at each initialization boundary.
- Presence and socket-registry regression suites.
- Existing same-process message gateway and block/revocation regressions.
- A machine-readable residue table per fault point: socket identity, session membership, conversation memberships, presence state, emitted transitions, and unhandled errors.
- Targeted TypeScript, ESLint, Prettier, and `git diff --check` for changed files.

## 11. CF-602 — Bounded authorization and socket-ready cost

### 11.1 Problem

Initialization and presence publication currently perform authorization work per conversation. At larger histories this can create sequential database waterfalls and delay socket readiness. The current in-memory probe cannot establish the database-backed cost.

### 11.2 Required implementation

1. Record the pre-change database query count and timing at 1/10/40/100 conversations before changing repository or room behavior.
2. Select the smallest source-supported strategy:
   - one bounded bulk authorization projection;
   - lazy conversation join with account-level invalidation/refetch;
   - or a measured combination of both.
3. Keep server-side participant, context, archive, block, session, and account authorization authoritative.
4. Avoid three or more sequential query groups per conversation during initial connection.
5. Bound the number of initially joined rooms or prove with current data/measurement that the selected eager-join maximum is safe.
6. Preserve delivery/refetch for a user who remains on the conversation list and has not opened a thread.
7. Avoid loading message bodies or private data merely to authorize room admission.
8. Keep cursors and page limits on REST conversation/history reads.
9. Do not add cache invalidation, indexes, or denormalized tables without query-plan evidence.
10. Update the existing Candidate-first realtime probe or add one narrowly scoped database-backed Phase 6A probe; do not replace existing general messaging performance tests.

### 11.3 Performance and query gate

For each of 1/10/40/100 conversations, record at least three final-source repetitions with the same configuration:

- total SQL query count during connection initialization;
- count by access/context/block category;
- socket-ready p50 and p95;
- reconnect p50 and p95;
- rooms joined per socket;
- message accepted-to-peer-visible p50 and p95;
- error/timeout rate;
- pool wait when observable;
- heap delta as diagnostic evidence, not as an unreviewed hard threshold.

The final gate requires:

- no sequential per-conversation access/context/block waterfall;
- query growth that is bounded independently of the number of conversations or grows only through explicitly paged/batched operations;
- no timeout or failed initialization at 100 conversations;
- existing message accepted-to-peer-visible p95 remains below 1,000 ms;
- existing conversation-list and message-history p95 remain below 2,000 ms;
- a socket-ready p95 threshold is fixed in the pre-change evidence before optimization and cannot be relaxed after seeing the final result. The default target is at most 2,000 ms for 100 conversations unless the measured entry baseline proves that a different explicit product threshold is required.

### 11.4 CF-602 acceptance criteria

- The 1/10/40/100 database-backed matrix completes with zero authorization leaks and zero initialization failures.
- Query evidence proves the old sequential pattern is removed or bounded.
- The selected eager/lazy strategy preserves message visibility and authoritative catch-up.
- Unauthorized, blocked, archived, revoked, foreign, and stale conversations are not joined or exposed.
- Presence publication no longer repeats unbounded per-conversation authorization work.
- The final implementation meets all fixed performance thresholds without hiding cold/warm distinctions.
- No Redis, cross-process bus, or Phase 6B mechanism is introduced.

### 11.5 Required CF-602 evidence

- Pre-change and final database-backed query/timing artifacts using the same dataset and environment.
- Repository/authorization tests for the selected bulk or lazy strategy.
- 1/10/40/100 Socket.IO runtime matrix.
- Existing messaging performance suite.
- Query-plan evidence only for queries changed or shown to be material; do not inventory unrelated indexes.
- Regression proving list-only and open-thread users recover the same durable message state.

## 12. CF-603 — Durable notification, message recovery, and convergence

### 12.1 Problem

The code contains durable history, read sequences, notification polling, realtime events, and reconnect refetch. Phase 6A lacks one current evidence set proving that these mechanisms converge under missed, duplicate, delayed, and revoked realtime conditions.

### 12.2 Required implementation

1. Define and apply the `ENQUEUED`, `PERSISTED/SENT`, optional authenticated `DELIVERED`, and `READ` meanings from Section 7.
2. Keep persistence before publication for messages and durable notifications.
3. Detect or safely recover sequence gaps through authoritative history/refetch. A full refetch on reconnect is acceptable when bounded and already supported.
4. Deduplicate realtime and REST results by durable ID/sequence.
5. Make read-boundary updates monotonic and idempotent across tabs and retries.
6. Reconcile conversation list, open message history, notification pages, unread count, and context-read state after reconnect or access change.
7. Preserve polling/refetch when realtime is unavailable; do not make notification discovery depend solely on `window` events.
8. Revalidate the session before sensitive socket actions and keep REST authorization authoritative.
9. Ensure session, account, moderation, block, connection, and membership revocations affect exactly the required sockets/conversations.
10. Keep logs content-free and include only safe operational dimensions such as phase, outcome, duration, count, and correlation identifier where already supported.
11. Update UI copy/state only when necessary to avoid false `DELIVERED`, stale unread, or false online claims.
12. Preserve EN/VI, keyboard/focus behavior, live-region restraint, dark mode, responsive behavior, and reduced motion for touched UI.

### 12.3 Required recovery matrix

| Scenario                                  | Required result                                                            |
| ----------------------------------------- | -------------------------------------------------------------------------- |
| Event emitted normally                    | Receiver sees one message; authoritative history contains one message      |
| Event dropped after commit                | Receiver recovers the message through reconnect/refetch/history            |
| Duplicate event                           | UI and durable history show one logical message                            |
| Events arrive out of order                | Sequence reconciliation produces authoritative order                       |
| Client disconnects before acknowledgement | Retry/idempotency returns the durable result without a duplicate           |
| One tab marks read                        | Other tab converges to the committed boundary and cannot regress it        |
| Reconnect after missed read event         | History/list/unread count converge from PostgreSQL                         |
| Notification invalidation missed          | Poll/refetch reveals the durable notification                              |
| Notification read retried                 | Read state remains idempotent and unread count stays correct               |
| Conversation access revoked               | Affected room is left; REST fails closed; unrelated access remains         |
| One session revoked                       | Only target-session sockets disconnect                                     |
| Account/moderation revocation             | All affected account sockets disconnect on the instance                    |
| Realtime publisher unavailable            | Persisted data remains readable; UI exposes recoverable connectivity state |

### 12.4 CF-603 acceptance criteria

- No required user-visible state depends solely on receiving one realtime event.
- Persisted messages and notifications are recoverable after intentional event loss.
- Duplicate/reordered events do not duplicate messages, regress order, or reduce a read boundary.
- Multi-tab notification count and message read state converge to the authoritative server state.
- Session and account revocation behave at the correct scope.
- UI does not display `DELIVERED` without an authenticated acknowledgement contract.
- Offline/reconnecting/error states are understandable in EN/VI and do not trap keyboard focus.
- Security/privacy suites confirm no message content or private notification payload enters logs/evidence.

### 12.5 Required CF-603 evidence

- Database-backed message persistence, idempotency, history, and read tests.
- Notification repository, convergence, context-read, privacy, and failure-isolation tests.
- Socket event-drop, duplicate, reorder, reconnect, and publisher-failure integration tests.
- Two-tab and two-session browser tests.
- Existing session-revocation, block/report, and access-change browser tests.
- Focused Candidate/recruiter journey at desktop and mobile widths for touched UI states.
- Accessibility checks for connection status, unread/read labels, retry actions, and announcements.

## 13. CF-604 — Final single-instance runtime matrix

### 13.1 Purpose

CF-604 is the final execution slice. It does not add a new architecture. It runs the complete Phase 6A contract on final source and closes gaps exposed by the matrix.

### 13.2 Required runtime matrix

The final matrix must cover:

- authentication success/failure;
- disconnect at every initialization await/fault point;
- account-room join failure;
- database timeout/failure during access/context/block lookup;
- conversation-room join failure;
- immediate disconnect/reconnect loops;
- multiple tabs for one session;
- multiple sessions for one account;
- Candidate and authorized peer/recruiter in separate browser contexts;
- message send retry and duplicate client operation ID;
- intentionally dropped, duplicated, and reordered realtime events;
- read convergence across tabs;
- block/unblock and conversation access revocation;
- session revoke, logout, account suspension, and moderation disconnect;
- notification creation, missed invalidation, retry, context-read, read-all, and unread-count convergence;
- 1/10/40/100 conversation query/socket-ready measurements;
- Support and Connections namespace smoke after shared server changes;
- keyboard, focus, EN/VI, light/dark, reduced motion, and responsive behavior for touched states;
- server shutdown and test-owned cleanup.

### 13.3 CF-604 acceptance criteria

- Every mandatory matrix row is `PASS`; no required row is skipped.
- Registry, session membership, room membership, and presence residue are zero after each fault case.
- Unhandled rejection count is zero.
- Durable history recovers every committed message whose realtime event was missed.
- Notification polling/refetch recovers every committed notification whose invalidation event was missed.
- Authorization and privacy remain fail-closed.
- Query/performance thresholds from CF-602 pass on the final source.
- Browser and accessibility checks pass for every touched state.
- Shared Support/Connections namespaces show no regression from server lifecycle changes.
- The isolated database, task-owned server, ports, fixtures, logs, temporary builds, and process handles are cleaned up and independently verified absent.

### 13.4 Required CF-604 evidence

- Machine-readable runtime/fault matrix.
- Database-backed query/performance report with pre-change/final comparison.
- Focused Vitest totals by suite and test count.
- Production-like Socket.IO server/browser totals, including viewport/theme/locale where UI changed.
- Accessibility result with serious/critical violation counts.
- TypeScript, targeted ESLint, Prettier, build, Prisma validation, migration sequence, and `git diff --check` results.
- Cleanup ledger with process ownership, port status, database absence, and retained artifact paths.

## 14. Final integrated Phase 6A gate

Phase 6A may be reported as `DONE / VERIFIED` only when:

1. CF-601, CF-602, CF-603, and CF-604 are individually `VERIFIED` on the final source.
2. Connection cleanup is installed before awaited initialization work and is proven idempotent at every fault point.
3. Presence is never published for a socket that failed to become ready and never remains stale after final disconnect.
4. Initial authorization no longer performs the proven sequential per-conversation waterfall.
5. The final database-backed 1/10/40/100 matrix meets the fixed query and performance thresholds.
6. Durable message/history/read and notification/read contracts recover from missed realtime events.
7. Duplicate/reordered events and multi-tab/session cases converge without duplicate data or regressed read state.
8. Session/account/moderation and conversation-level revocation have current executable evidence.
9. General Messaging and Recruitment Messaging boundaries remain intact.
10. No Phase 6B infrastructure or unsupported `DELIVERED` claim was added.
11. Focused, integration, security/privacy, browser, accessibility, performance, static, and cleanup evidence all pass in their declared scope.
12. Every acceptance criterion is classified `PASS`, `FAIL`, or `UNVERIFIED`; no missing evidence is promoted to PASS.

An unrelated baseline failure may be recorded separately only when current evidence proves it is outside the Phase 6A diff and cannot affect a Phase 6A invariant. It must remain `FAIL` or `UNVERIFIED`; it must not be hidden or relabelled.

## 15. Expected impact area

The exact final diff is evidence-driven. Likely impact areas are listed for review, not as permission to edit all files.

### 15.1 Backend realtime lifecycle

- `web/src/backend/messaging/realtime/socket-io-chat-gateway.ts`
- `web/src/backend/messaging/realtime/messaging-socket-registry.ts`
- `web/src/backend/messaging/realtime/messaging-presence-registry.ts`
- `web/src/backend/messaging/realtime/register-chat-events.ts`
- `web/src/backend/messaging/realtime/messaging-realtime-publisher.ts`
- `web/src/backend/messaging/realtime/messaging-realtime-hub.ts`
- `web/src/backend/messaging/realtime/messaging-authority-enforcement.ts`

### 15.2 Authorization, repository, and service boundary

- `web/src/backend/messaging/ports/messaging-repository.ts`
- `web/src/backend/messaging/ports/realtime-publisher.ts`
- `web/src/backend/repositories/messaging/prisma-messaging-conversation-repository.ts`
- existing messaging eligibility/block repositories only where measured batching requires them
- existing send/read/list/history services only where recovery or convergence tests prove a gap

### 15.3 Candidate UI and notification recovery

- `web/src/frontend/features/messaging/client/use-chat-connection.ts`
- `web/src/frontend/features/messaging/client/use-chat-events.ts`
- `web/src/frontend/features/messaging/client/use-conversations.ts`
- `web/src/frontend/features/messaging/client/use-message-history.ts`
- `web/src/frontend/features/messaging/client/use-send-message.ts`
- existing Messaging components/copy/styles only for required state presentation
- `web/src/frontend/features/notifications/client/use-notifications.ts`
- `web/src/frontend/features/notifications/client/use-notification-context-read.ts`
- existing Notification components/copy/styles only where convergence or honest-state evidence requires changes

### 15.4 Tests, probes, and evidence

- focused backend messaging/notification unit, contract, integration, security, and performance tests
- `web/tests/system/e2e/messaging/`
- existing notification frontend/accessibility suites
- `web/scripts/measure-candidate-first-realtime.mjs` or one narrowly scoped Phase 6A database-backed companion
- `web/scripts/measure-messaging-performance.mjs`
- stable artifacts under `docs/audits/candidate-first/phase-6a/evidence/`

Support, Connections, Recruitment Messaging, Admin Notification, and email modules are regression surfaces, not default edit targets.

## 16. Data, migration, compatibility, and rollback

### 16.1 Default data decision

No database migration is expected. Existing message identity/sequence, conversation participants, read boundary, notification rows, and session/account authority should be sufficient for Phase 6A.

If a migration becomes necessary:

1. prove the failing acceptance criterion cannot be met safely with the current schema;
2. use an additive backward-compatible change;
3. document old/new mixed-version behavior;
4. provide deployment order and rollback/disable behavior;
5. apply it only to isolated test databases during verification;
6. do not mutate shared `smarthire` without separate explicit authorization.

### 16.2 Runtime compatibility

- Existing REST clients must continue to recover history and notification state when realtime is disabled.
- Existing socket event names and payloads should remain compatible unless a proven contract defect requires an additive versioned change.
- A lazy-room strategy must retain list-only message awareness through account invalidation/refetch.
- A lifecycle fix must not change Support or Connections namespace authorization.
- Feature flags must fail safely; disabling realtime must not disable durable Messaging/Notification reads.

### 16.3 Rollback

- Lifecycle/query changes must remain separable from any optional UI state changes.
- If a room-admission optimization regresses delivery, rollback to the last verified bounded strategy while keeping CF-601 cleanup safety.
- If optional delivery acknowledgement is attempted and fails acceptance, remove the unsupported `DELIVERED` presentation and retain durable `SENT/READ` behavior.
- No rollback may restore the unsafe cleanup ordering after CF-601 is verified.

## 17. Test strategy and required matrices

### 17.1 Focused source and contract tests

- socket authentication and event schemas;
- lifecycle/cleanup state transitions;
- socket/session/conversation registry ownership;
- presence multi-tab and grace behavior;
- room authorization and neutral errors;
- message send/idempotency/history/read;
- block, connection, membership, session, account, and moderation revocation;
- notification repository, context read, unread convergence, failure isolation, and privacy;
- General Messaging versus Recruitment Messaging architecture boundaries.

### 17.2 Isolated PostgreSQL integration

- current migration sequence applied in full;
- representative datasets of 1/10/40/100 conversations;
- authorized, blocked, archived, foreign, revoked, and stale rows;
- monotonic read updates and concurrent tabs;
- persisted message with intentionally suppressed realtime publication;
- notification creation/read/retry with missed invalidation;
- query count and query grouping captured from the real repository path;
- cleanup by task namespace and final absence probe.

### 17.3 Socket.IO runtime fault matrix

- real HTTP server and real Socket.IO client;
- deterministic gates controlling each initialization await;
- disconnect and error at each gate;
- residue and unhandled-rejection collection;
- reconnect and repeated disconnect cycles;
- duplicate/reordered/dropped event injection after durable commit;
- session/account/conversation access revocation;
- final gateway/server shutdown.

### 17.4 Browser matrix

At minimum for touched user-visible states:

| Dimension | Required coverage                                                                    |
| --------- | ------------------------------------------------------------------------------------ |
| Actors    | Candidate and authorized peer/recruiter; foreign/blocked actor denial                |
| Contexts  | Separate browser contexts, two tabs, two sessions                                    |
| Widths    | 320, 375, 768, 1280 CSS pixels where layout/state changed                            |
| Locale    | EN and VI                                                                            |
| Theme     | Light and dark where the current application supports them                           |
| Input     | Keyboard-only plus pointer                                                           |
| Motion    | `prefers-reduced-motion` for touched indicators/transitions                          |
| States    | connecting, ready, reconnecting, offline/error, sent/persisted, read, retry, revoked |

If Phase 6A makes no visual/layout change, retain the existing component/accessibility regression scope and run focused production-like browser journeys for connection/recovery behavior rather than duplicating the full Phase 7 matrix.

### 17.5 Performance matrix

- existing `perf:messaging` thresholds;
- Candidate-first realtime 1/10/40/100 widths;
- database-backed query count and socket-ready timing;
- at least three same-configuration final repetitions per width;
- cold/warm distinction where database or connection pooling affects interpretation;
- no cross-process or multi-instance claim.

### 17.6 Regression scope

- `npm run test:messaging` or the exact expanded equivalent;
- notification focused suites affected by changed invalidation/read behavior;
- `npm run test:messaging:e2e` on an isolated database and task-owned server;
- Support and Connections socket smoke if shared server lifecycle code changes;
- TypeScript, targeted lint/format, production build, Prisma validation, migration sequence, and diff check.

Commands are evidence templates, not permission to target a shared database or stop an unowned process.

## 18. Evidence contract

Canonical Phase 6A evidence should use stable semantic filenames under `docs/audits/candidate-first/phase-6a/evidence/`, for example:

- `entry-baseline.json` and `.md`;
- `cf601-lifecycle-fault-matrix.json` and `.md`;
- `cf602-query-and-socket-ready.json` and `.md`;
- `cf603-recovery-and-convergence.json` and `.md`;
- `cf604-browser-runtime-matrix.json` and `.md`;
- `cleanup.json` and `.md`.

Each artifact must record:

- source identity and dirty-worktree qualification;
- exact command and working directory;
- database name and proof that both database URLs targeted it;
- environment/runtime mode without secrets;
- start/end timestamps;
- PASS/FAIL/SKIP counts;
- thresholds and whether they were fixed before the final run;
- failures and retained limitations;
- process/port/database/build ownership;
- cleanup result;
- content-free hashes where appropriate.

Failed and interrupted runs remain visible until a stronger same-scope final-source rerun supersedes them. Historical evidence must not be silently rewritten as current proof.

## 19. Repository, environment, and cleanup safety

1. Preserve all pre-existing tracked and untracked changes.
2. Do not reset, clean, commit, push, deploy, or stop a user-owned process.
3. Do not edit Candidate-first README status corrections or unrelated audit artifacts unless separately requested.
4. Do not modify any SpecKit artifact.
5. Every data-writing test must set matching `DATABASE_URL` and `DIRECT_URL` to an isolated database whose name contains `test`, `spec`, or `e2e`.
6. Never mutate shared `smarthire` or an unverified database.
7. Use task-specific fixture prefixes, users, sessions, conversations, messages, notifications, and correlation IDs.
8. Use a task-owned port and build output; do not remove or reuse an unowned Next.js lock/output.
9. Record process ownership before stopping a server. Stop only task-owned processes.
10. Remove only task-owned fixtures, isolated databases, logs, temporary builds, and process handles.
11. Retain canonical audit artifacts and required failed-run evidence.
12. Verify cleanup independently: no listener on the task port, isolated database absent, task fixtures absent, and no leaked child process.
13. Keep secrets, cookies, message content, notification private payloads, and PII out of logs and artifacts.

## 20. Risk register

| Risk                                                 | Impact                                          | Mitigation                                                                           |
| ---------------------------------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------------ |
| Early cleanup unregisters another socket             | False offline or lost delivery                  | Scope cleanup by exact socket ID; test two tabs/sessions                             |
| ONLINE is published before readiness                 | Stale presence after interrupted initialization | Publish only at defined ready boundary                                               |
| Batch authorization weakens tenant/context checks    | Cross-user or cross-company leak                | Preserve server-derived participant/context/block checks; negative integration tests |
| Lazy join causes list-only clients to miss updates   | Stale conversation list/unread count            | Account-level invalidation plus authoritative refetch; browser proof                 |
| Eager join remains unbounded                         | Slow connect/reconnect                          | Measure and bound/paginate or adopt lazy join                                        |
| Realtime failure is treated as persistence failure   | User retries and creates confusion/duplicates   | Persist first; idempotent retry; REST recovery                                       |
| UI claims delivered without receiver acknowledgement | Misleading product semantics                    | Default to SENT/PERSISTED and READ only                                              |
| Reconnect duplicates or reorders messages            | Incorrect thread history                        | Durable ID/sequence deduplication and authoritative reconciliation                   |
| Multi-tab read state regresses                       | Incorrect unread badge                          | Monotonic server boundary and refetch convergence                                    |
| Session revocation disconnects all account sessions  | Availability/security regression                | Session-indexed socket tests and account-level separate path                         |
| Query optimization adds speculative cache/index      | Complexity and invalidation risk                | Baseline first; smallest repository change; query plan only when material            |
| General and Recruitment Messaging are merged         | Authorization/domain regression                 | Architecture boundary tests; Recruitment Messaging remains REST/refetch              |
| Shared server changes break Support/Connections      | Cross-namespace regression                      | Focused namespace smoke before final gate                                            |
| Runtime test leaks server/database/process           | Developer environment damage                    | Task ownership ledger and independent cleanup probes                                 |

## 21. Time estimate

| Work                                                           | Expected active time | Upper review bound |
| -------------------------------------------------------------- | -------------------: | -----------------: |
| Entry baseline, fault harness, and database-backed measurement |            3–5 hours |            7 hours |
| CF-601 lifecycle and cleanup                                   |            4–7 hours |           10 hours |
| CF-602 authorization/query bounding                            |            5–9 hours |           12 hours |
| CF-603 recovery, notification, revocation, and UI state        |            5–9 hours |           12 hours |
| CF-604 final runtime/browser/performance gate and cleanup      |            5–8 hours |           10 hours |
| **Total**                                                      |      **22–38 hours** |       **51 hours** |

These are active engineering estimates, not calendar commitments. If the same unresolved cause survives two materially different safe approaches, stop speculative edits, classify the blocker, preserve the current evidence, and report the smallest next decision.

## 22. Phase 6A Definition of Done

Phase 6A is `DONE / VERIFIED` only when all of the following are true:

- CF-601 through CF-604 are individually `VERIFIED`.
- The connection lifecycle is race-safe and cleanup is idempotent.
- Registry, room, session, and presence residue are zero across the fault matrix.
- ONLINE/OFFLINE transitions are correct for one tab, multiple tabs, reconnect, and initialization failure.
- Initial authorization cost is measured and no longer follows the per-conversation sequential waterfall.
- Existing messaging performance thresholds and the fixed socket-ready threshold pass.
- Missed/duplicate/reordered realtime events reconcile to one authoritative durable state.
- Message and notification history/read/unread state converges across tabs and reconnects.
- Revocation behavior passes for conversation, session, account, and moderation scope.
- Authorization/privacy/logging tests pass.
- Browser and accessibility evidence covers every touched user-visible state.
- Support/Connections shared-server regression is clear where applicable.
- General Messaging and Recruitment Messaging remain separate.
- No unsupported delivered state, Phase 6B infrastructure, shared database mutation, or SpecKit change exists.
- Static/build/database/migration/diff gates pass in their declared scope.
- Task-owned resources are cleaned and independently verified absent.
- The final integrated gate and evidence index classify every required criterion as `PASS`, `FAIL`, or `UNVERIFIED`.

## 23. Initial status ledger

| Work item                | Initial status         | Required closure evidence                                                                                              |
| ------------------------ | ---------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Entry gate               | `NOT_STARTED`          | Current focused baseline, fault reproduction/harness, database-backed 1/10/40/100 baseline, isolated environment proof |
| CF-601                   | `PLANNED / UNVERIFIED` | Initialization fault matrix, zero residue, zero unhandled rejection, multi-tab presence                                |
| CF-602                   | `PLANNED / UNVERIFIED` | Pre/final database query and socket-ready comparison, bounded authorization, performance regressions                   |
| CF-603                   | `PLANNED / UNVERIFIED` | Dropped/duplicate/reordered event recovery, notification/read convergence, revocation, UI/accessibility                |
| CF-604                   | `PLANNED / UNVERIFIED` | Final full single-instance runtime matrix, browser, static gates, cleanup                                              |
| Integrated Phase 6A gate | `UNVERIFIED`           | All work items verified on final source with no required FAIL/UNVERIFIED criterion                                     |

No existing focused or historical evidence is promoted to current Phase 6A PASS by this plan.

### 23.1 Current closure record

The initial ledger above is historical. The current closure is recorded in [`evidence/final-closure-ledger.json`](evidence/final-closure-ledger.json) and [`integrated-gate.md`](integrated-gate.md): CF-601, CF-602, CF-603, CF-604, and the integrated Phase 6A gate are `DONE / VERIFIED`. The full Notification suite remains `FAIL` at 24/25 files and 67/68 tests because the unchanged SpecKit OpenAPI contract omits `COMPANY_INVITATION`; the full Connections suite remains `FAIL` at 9/10 files and 19/20 tests because an unchanged UI fixture expects `Disconnect` in an empty state. Both failures are retained as explicit outside-scope baseline exceptions, while their affected Phase 6A/shared scopes pass.

## 24. Required final report

The completion report must contain:

1. Final verdict: `DONE / VERIFIED`, `PARTIAL`, `FAIL`, or `BLOCKED`.
2. Root causes found and the smallest implemented corrections.
3. Before/after connection lifecycle and room/query strategy.
4. Durable message/notification/recovery semantics after the change.
5. Important files changed.
6. CF-601 through CF-604 status with acceptance criteria classified `PASS`, `FAIL`, or `UNVERIFIED`.
7. Exact test commands and PASS/FAIL/SKIP totals by evidence class.
8. Database-backed 1/10/40/100 query, socket-ready, reconnect, message-delivery, and failure metrics.
9. Browser/accessibility coverage and results.
10. Security/privacy/revocation evidence.
11. Unchanged baseline failures or accepted limitations, kept separate from passing suites.
12. Temporary database, process, port, build, fixture, log, and artifact cleanup state.
13. Explicit confirmation that no shared database, deployment, SpecKit artifact, or Phase 6B infrastructure was changed.
14. The next work item only if the overall Phase 6A gate remains open.

## 25. Execution instruction

Execute this plan with one root agent in dependency order. Investigate current source and runtime evidence, complete CF-601 end to end, then CF-602, CF-603, and CF-604. Make the smallest justified changes, preserve unrelated work, use isolated data, and continue through the integrated gate while safe in-scope work remains.

Do not call a subagent unless the user explicitly requests one. Do not stop after a plan, source-only inspection, or focused green suite when required runtime, browser, performance, or cleanup evidence remains. Do not implement Phase 6B and do not modify SpecKit.
