# CF-604 database fault-injection evidence

Current isolated rerun: `candidate_phase6a_20260919_final_e2e_test` using real Prisma PostgreSQL repositories and the production Socket.IO gateway.

Status: **PASS**, 4/4 cases:

- initial socket authorization;
- conversation access lookup;
- context authorization;
- block-state lookup.

Each injected failure failed closed with a generic client-safe error, recovered successfully after the fault was removed, emitted no unauthorized server event, produced no unhandled rejection, and cleaned socket/session/conversation/room state to zero. Presence transitions were observed as ONLINE then OFFLINE. The harness is single-process and does not claim Phase 6B multi-instance behavior.
