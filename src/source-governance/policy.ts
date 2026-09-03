import type { Operation, PolicyDecision, SourcePolicy } from "./types";

function snapshot(policy: SourcePolicy): string {
  const canonical = JSON.stringify(policy, Object.keys(policy).sort());
  return `policy:${policy.source_id}:${canonical}`;
}

export function evaluateSourcePolicy(
  policy: SourcePolicy | undefined,
  operation: Operation,
  now = new Date(),
): PolicyDecision {
  if (!policy) return { authorized: false, reason: "source_policy_missing", source_id: "unknown", operation, policy_snapshot: "none" };
  if (policy.permission !== "approved") return { authorized: false, reason: `permission_${policy.permission}`, source_id: policy.source_id, operation, policy_snapshot: snapshot(policy) };
  if (policy.allowed_operations.includes(operation) === false) return { authorized: false, reason: "operation_not_allowlisted", source_id: policy.source_id, operation, policy_snapshot: snapshot(policy) };
  if (policy.blocked_operations.includes(operation)) return { authorized: false, reason: "operation_blocked", source_id: policy.source_id, operation, policy_snapshot: snapshot(policy) };
  if (policy.expires_at && new Date(policy.expires_at).getTime() <= now.getTime()) return { authorized: false, reason: "policy_expired", source_id: policy.source_id, operation, policy_snapshot: snapshot(policy) };
  if (!Number.isInteger(policy.rate_limit.requests_per_minute) || policy.rate_limit.requests_per_minute <= 0) return { authorized: false, reason: "invalid_rate_limit", source_id: policy.source_id, operation, policy_snapshot: snapshot(policy) };
  if (policy.robots_policy === "respect" && policy.access_mode === "public" && !policy.url.startsWith("https://") && !policy.url.startsWith("http://")) return { authorized: false, reason: "invalid_source_url", source_id: policy.source_id, operation, policy_snapshot: snapshot(policy) };
  return { authorized: true, reason: "approved", source_id: policy.source_id, operation, policy_snapshot: snapshot(policy) };
}
