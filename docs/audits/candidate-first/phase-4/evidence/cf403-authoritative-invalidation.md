# CF-403 authoritative mutation-to-read verification

- Generated: 2026-09-18T08:40:06.872Z
- Database: undefined
- Direct Prisma is restricted to fixture setup/read-only state checks; every listed mutation uses its production route, service, or worker boundary.

| Mutation/failure/race | Result |
| --- | --- |
| authoritative recruiter company profile PATCH | **PASS** |
| profile PATCH validation failure does not invalidate | **PASS** |
| authoritative company moderation ban | **PASS** |
| authoritative company moderation unban | **PASS** |
| stale company moderation command rolls back without invalidation | **PASS** |
| authoritative admin job approval and republish | **PASS** |
| stale job approval command rolls back without invalidation | **PASS** |
| authoritative recruiter close service | **PASS** |
| authoritative recruiter reopen service | **PASS** |
| concurrent moderation commands have one commit and one stale loser | **PASS** |
| restore after concurrent moderation race | **PASS** |
| standalone lifecycle worker commits and invalidates across process boundary | **PASS** |
| authoritative verification approval publishes company visibility | **PASS** |
