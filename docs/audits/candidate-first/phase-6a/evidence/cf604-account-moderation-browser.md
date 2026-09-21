# CF-604 account, session, and moderation browser evidence

Current isolated rerun: `candidate_phase6a_20260919_final_e2e_test` with dedicated Candidate, Recruiter, outsider, and platform-admin browser identities.

Status: **PASS**, 3/3 cases:

- session revocation: target session REST 401, control session REST 200, control socket remains connected;
- account suspension: stale target reload is rejected and redirected to login, target REST 401, recruiter control REST 200, peer presence OFFLINE;
- moderation restriction: the authoritative admin suspension path uses `POLICY_VIOLATION`, records revocation cause `MODERATION`, disconnects both target sockets, keeps outsider control connected, and returns target REST 401/control REST 200.

Runtime probes recorded SESSION, ACCOUNT, and MODERATION cleanup with target socket and conversation memberships reduced to zero. The artifact contains no credentials, cookies, message content, notification payloads, or PII.
