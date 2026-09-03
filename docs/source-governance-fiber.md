# RTV Source Governance Fiber

Canonical ingestion contract:

**Source → Policy → Fetch → Normalize → Provenance → AI → Output → Audit**

## Non-negotiable controls

1. A fetch job must have an approved source policy before network access.
2. Authorization is operation-specific; `approved` does not mean every operation is permitted.
3. The policy engine, not an LLM, determines whether an operation is authorized.
4. Blocked operations include credentialed access, CAPTCHA bypass, paywall bypass, and anti-bot bypass. Implementations must not attempt to circumvent those controls.
5. Every generated artifact must retain provenance to the source, document/version, policy snapshot, and transformation.
6. Rate limits and retention are properties of the source policy and must be enforced by the worker/runtime.
7. Credentials for authorized private sources remain server-side and must never enter client bundles, logs, fixtures, or generated artifacts.

## Planned persistence model

- `sources`
- `source_policies`
- `crawl_jobs`
- `crawl_pages`
- `extracted_documents`
- `document_versions`
- `provenance_records`
- `extraction_events`
- `crawl_errors`
- `ai_artifacts`
- `audit_events`

## AI Builder contract

The AI Builder receives source material only after the backend policy decision. The model may transform permitted material, but it cannot grant permission to access or copy a source.

## Metering

Record fetch, parse, OCR, embedding, model input/output, rendering, and storage as separate metered operations. Credit settlement belongs to the canonical server-side ledger; clients cannot authoritatively submit usage or price.

## MongoDB adapter boundary

The policy and provenance modules in `src/source-governance/` are storage-agnostic. MongoDB persistence should be introduced behind repository interfaces so governance decisions remain unit-testable without requiring a live database.
