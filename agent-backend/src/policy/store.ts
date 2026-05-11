import { v4 as uuidv4 } from "uuid";
import { db } from "../db/database.js";
import type { PolicyRule, PolicyType } from "./types.js";

type Row = Record<string, unknown>;

function rowToRule(row: Row): PolicyRule {
  return {
    id: String(row["id"]),
    name: String(row["name"]),
    description: row["description"] ? String(row["description"]) : undefined,
    type: String(row["type"]) as PolicyType,
    enabled: row["enabled"] === true || row["enabled"] === 1,
    toolPattern: String(row["tool_pattern"]),
    conditionField: row["condition_field"] ? String(row["condition_field"]) : undefined,
    conditionOperator: row["condition_operator"] as PolicyRule["conditionOperator"] ?? undefined,
    conditionValue: row["condition_value"] ? String(row["condition_value"]) : undefined,
    rateLimitCount: row["rate_limit_count"] != null ? Number(row["rate_limit_count"]) : undefined,
    rateLimitWindowMs: row["rate_limit_window_ms"] != null ? Number(row["rate_limit_window_ms"]) : undefined,
    priority: Number(row["priority"] ?? 0),
    createdAt: String(row["created_at"]),
    updatedAt: String(row["updated_at"]),
  };
}

export function getAllRules(): PolicyRule[] {
  return db.policyRules.all().map(rowToRule);
}

export function getRuleById(id: string): PolicyRule | undefined {
  const row = db.policyRules.get(id);
  return row ? rowToRule(row) : undefined;
}

export function createRule(input: Omit<PolicyRule, "id" | "createdAt" | "updatedAt">): PolicyRule {
  const now = new Date().toISOString();
  const id = uuidv4();
  db.policyRules.insert({
    id,
    name: input.name,
    description: input.description ?? null,
    type: input.type,
    enabled: input.enabled,
    tool_pattern: input.toolPattern,
    condition_field: input.conditionField ?? null,
    condition_operator: input.conditionOperator ?? null,
    condition_value: input.conditionValue ?? null,
    rate_limit_count: input.rateLimitCount ?? null,
    rate_limit_window_ms: input.rateLimitWindowMs ?? null,
    priority: input.priority,
    created_at: now,
    updated_at: now,
  });
  return getRuleById(id)!;
}

export function updateRule(id: string, input: Partial<Omit<PolicyRule, "id" | "createdAt" | "updatedAt">>): PolicyRule | undefined {
  const existing = getRuleById(id);
  if (!existing) return undefined;
  const now = new Date().toISOString();
  const merged = { ...existing, ...input };
  db.policyRules.update(id, {
    name: merged.name,
    description: merged.description ?? null,
    type: merged.type,
    enabled: merged.enabled,
    tool_pattern: merged.toolPattern,
    condition_field: merged.conditionField ?? null,
    condition_operator: merged.conditionOperator ?? null,
    condition_value: merged.conditionValue ?? null,
    rate_limit_count: merged.rateLimitCount ?? null,
    rate_limit_window_ms: merged.rateLimitWindowMs ?? null,
    priority: merged.priority,
    updated_at: now,
  });
  return getRuleById(id);
}

export function deleteRule(id: string): boolean {
  return db.policyRules.delete(id);
}

export function toggleRule(id: string): PolicyRule | undefined {
  const rule = getRuleById(id);
  if (!rule) return undefined;
  return updateRule(id, { enabled: !rule.enabled });
}

export function seedDefaultRules(): void {
  if (db.policyRules.count() > 0) return;

  createRule({
    name: "Block delete operations",
    description: "Prevent any delete_* tools from running (demo — disabled by default)",
    type: "block",
    enabled: false,
    toolPattern: "delete_*",
    priority: 100,
  });

  createRule({
    name: "Approve bulk list operations",
    description: "Require human approval before listing all notes",
    type: "require_approval",
    enabled: false,
    toolPattern: "list_notes",
    priority: 50,
  });

  createRule({
    name: "Block SQL injection in search",
    description: "Prevent SQL injection attempts in search queries",
    type: "validate_input",
    enabled: true,
    toolPattern: "search_notes",
    conditionField: "query",
    conditionOperator: "not_contains",
    conditionValue: "DROP TABLE",
    priority: 75,
  });
}
