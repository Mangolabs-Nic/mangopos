---
sidebar_position: 2
---

# Required decisions

These are gates, not implementation details. Close them before moving code or importing real business data.

| Decision | Owner | Evidence of closure |
| --- | --- | --- |
| Base-license obligations | Gerald and both founders | GPL license, no attribution required. |
| Intellectual property | Both founders | Gerald owns all POS code (including core based on PoopPOS). Explicitly agreed between founders. |
| Repository ownership and access | Both founders | @geraldb1996 and @khincer are admins. Branch protection: require PR, 1 approval, status checks, no force push/delete. |
| Pilot deployment model | Kirk Incer and Gerald | Hybrid deployment. Domain: mango-labs.dev. Hosting: Railway (provisional). Owner: Kirk Incer. |
| Actual technical baseline | Technical owner | Backend: Nest.JS. Frontend: React. Database: Postgres (Supabase). Auth: Supabase. |
| Data to migrate | Technical owner and pilot business | To be defined after technical audit of desktop POS source. |

## Current status

All six required decisions are now closed. The project is cleared to proceed to Phase 1 (Commercial foundation).

## Decision principles

- Prefer a small installation with a proven restore path over speculative platform complexity.
- Isolate each business's data.
- Preserve existing pilot workflows before redesigning the interface.
- Version deployments, schema migrations, and imports so they can be identified and repeated.
- Design for Spanish-speaking support, intermittent internet, modest hardware, and low data use.

## Stop conditions

Do not import or publish real business data until the data migration plan is finalized after the technical audit. Do not commit to electronic invoicing until its legal and technical requirements have been researched separately.

