# CF-403 Home runtime cache and safety invalidation

- Generated: 2026-09-18T08:40:54.226Z
- Database: undefined
- coldRead: **PASS**
- warmPublicCacheHit: **PASS**
- preMutationProjection: **PASS**
- realSafetyMutationRoute: **PASS**
- firstReadAfterSafetyMutation: **PASS**
- safetyInvalidationImmediate: **PASS**
- catalogueUnchanged: **PASS**

- Limitation: PostgreSQL counters are the runtime hit/miss signal because this force-dynamic page does not emit x-nextjs-cache.
- Limitation: The safety mutation is the production admin route and its first Home, job-list, and company-detail bodies are checked after the committed ban.
