import { describe, expect, it } from "vitest";
import { evaluateSourcePolicy } from "../src/source-governance/policy";
import { createProvenanceRecord } from "../src/source-governance/provenance";
import type { SourcePolicy } from "../src/source-governance/types";

const policy: SourcePolicy = {
  source_id: "src_123",
  url: "https://example.com",
  access_mode: "public",
  permission: "approved",
  robots_policy: "respect",
  rate_limit: { requests_per_minute: 30 },
  allowed_operations: ["metadata", "research", "summarization"],
  blocked_operations: ["full_content_extraction", "commercial_use"],
  retention_days: 30,
  created_at: "2026-09-02T00:00:00Z",
};

describe("RTV Source Governance Fiber", () => {
  it("allows an explicitly allowlisted operation", () => {
    expect(evaluateSourcePolicy(policy, "research").authorized).toBe(true);
  });

  it("blocks an operation that is not allowlisted", () => {
    expect(evaluateSourcePolicy(policy, "classification").reason).toBe("operation_not_allowlisted");
  });

  it("blocks explicitly prohibited operations even if otherwise approved", () => {
    expect(evaluateSourcePolicy({ ...policy, allowed_operations: ["commercial_use"] }, "commercial_use").authorized).toBe(false);
    expect(evaluateSourcePolicy({ ...policy, allowed_operations: ["full_content_extraction"] }, "full_content_extraction").reason).toBe("operation_blocked");
  });

  it("fails closed for missing, denied, or expired policy", () => {
    expect(evaluateSourcePolicy(undefined, "research").authorized).toBe(false);
    expect(evaluateSourcePolicy({ ...policy, permission: "denied" }, "research").authorized).toBe(false);
    expect(evaluateSourcePolicy({ ...policy, expires_at: "2020-01-01T00:00:00Z" }, "research").authorized).toBe(false);
  });

  it("rejects invalid rate limits", () => {
    expect(evaluateSourcePolicy({ ...policy, rate_limit: { requests_per_minute: 0 } }, "research").reason).toBe("invalid_rate_limit");
  });

  it("creates provenance linking an artifact to its source and policy snapshot", () => {
    const record = createProvenanceRecord({
      artifact_id: "art_01",
      operation: "ai_generation",
      source_id: policy.source_id,
      source_url: policy.url,
      document_id: "doc_123",
      document_version: 4,
      policy_snapshot: "policy:src_123:v4",
      transformation: "summarize",
    });
    expect(record.provenance_id).toMatch(/^prov_[0-9a-f]+$/);
    expect(record.policy_snapshot).toBe("policy:src_123:v4");
  });
});
