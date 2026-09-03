export type AccessMode = "public" | "api" | "upload" | "feed" | "authorized_private";
export type Permission = "approved" | "pending" | "denied" | "expired";
export type Operation = "metadata" | "research" | "summarization" | "classification" | "transformation" | "commercial_use" | "full_content_extraction";

export interface RateLimitPolicy {
  requests_per_minute: number;
}

export interface SourcePolicy {
  source_id: string;
  url: string;
  access_mode: AccessMode;
  permission: Permission;
  robots_policy: "respect" | "not_applicable" | "explicitly_authorized";
  rate_limit: RateLimitPolicy;
  allowed_operations: Operation[];
  blocked_operations: Operation[];
  retention_days: number;
  expires_at?: string;
  created_at: string;
}

export interface PolicyDecision {
  authorized: boolean;
  reason: string;
  source_id: string;
  operation: Operation;
  policy_snapshot: string;
}

export interface CrawlJob {
  job_id: string;
  source_id: string;
  operation: Operation;
  requested_at: string;
  status: "queued" | "running" | "completed" | "blocked" | "failed";
}

export interface ProvenanceRecord {
  provenance_id: string;
  artifact_id: string;
  operation: string;
  source_id: string;
  source_url: string;
  document_id?: string;
  document_version?: number;
  policy_snapshot: string;
  collected_at?: string;
  transformation?: string;
  created_at: string;
}
