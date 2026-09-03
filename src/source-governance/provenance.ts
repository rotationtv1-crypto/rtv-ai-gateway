import type { ProvenanceRecord } from "./types";

export function createProvenanceRecord(input: Omit<ProvenanceRecord, "provenance_id" | "created_at">, now = new Date()): ProvenanceRecord {
  const created_at = now.toISOString();
  const seed = `${input.artifact_id}:${input.source_id}:${input.document_id ?? ""}:${input.document_version ?? ""}:${created_at}`;
  return {
    ...input,
    provenance_id: `prov_${hash(seed)}`,
    created_at,
  };
}

function hash(value: string): string {
  let h = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    h ^= value.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}
