# CF-403 mutation-to-read matrix

- Generated: 2026-09-18T08:40:36.453Z
- Database: undefined
- Body reads after every mutation: **PASS**

| Mutation group | Result |
| --- | --- |
| public company profile fields change | **PASS** |
| company verification inactive | **PASS** |
| company verification active | **PASS** |
| admin company ban | **PASS** |
| admin company unban | **PASS** |
| recruiter closes approved job | **PASS** |
| recruiter reopens approved job | **PASS** |
| admin approves/republishes job projection (hide leg) | **PASS** |
| admin approves/republishes job projection (restore leg) | **PASS** |
| standalone deadline lifecycle worker archives job | **PASS** |
| deadline lifecycle restoration | **PASS** |

The worker leg runs in a separate Node process and the first reads are made through the already-running production Next process.
