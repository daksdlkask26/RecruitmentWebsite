# CF-406 Home cache final verification

- Generated: 2026-09-18T08:21:36.382Z
- Reproduction command: `node --conditions=react-server --import tsx scripts/probe-cf406-home-cache.mjs`
- Database: undefined
- Warm samples: 20
- Warm-hit rate: **100.0%**
- Zero public repository calls on true hit: **PASS**
- First read after authoritative safety mutation: **PASS**

- Limitation: The warm-hit probe invokes the production Home composer directly so repository calls can be observed at the real class boundary; mutation-to-read timing is accepted only from the v2 independent authoritative CF-403 proof.
- Limitation: A true hit is defined as the source-final cached public snapshot returning the same projection with zero calls to either public repository prototype.
