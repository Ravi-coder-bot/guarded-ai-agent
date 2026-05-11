import { v4 as uuidv4 } from "uuid";
import { db } from "../db/database.js";
import { getAllRules } from "./store.js";
import type { PolicyCheckResult, PolicyRule, ToolCall, ApprovalRequest } from "./types.js";
import { INJECTION_PATTERNS } from "./types.js";

const TYPE_PRIORITY: Record<string, number> = {
  block: 500,
  allow_only: 400,
  require_approval: 300,
  validate_input: 200,
  rate_limit: 100,
};

export async function checkPolicy(
  toolCall: ToolCall,
  conversationId: string,
  approvalTimeoutMs = 300_000
): Promise<PolicyCheckResult> {
  const injectionResult = detectInjection(toolCall);
  if (injectionResult) return injectionResult;

  const rules = getAllRules()
    .filter((r) => r.enabled)
    .filter((r) => matchesPattern(toolCall.name, r.toolPattern))
    .sort((a, b) => {
      const pa = TYPE_PRIORITY[a.type] ?? 0;
      const pb = TYPE_PRIORITY[b.type] ?? 0;
      return pb - pa || b.priority - a.priority;
    });

  if (rules.length === 0) {
    return { action: "allowed", message: "No matching policy rules." };
  }

  for (const rule of rules) {
    const result = await evaluateRule(rule, toolCall, conversationId, approvalTimeoutMs);
    if (result.action !== "allowed") return result;
  }

  return { action: "allowed", message: "All policy checks passed." };
}

export function resolveApproval(
  approvalId: string,
  decision: "approved" | "denied",
  resolvedBy = "admin"
): ApprovalRequest | undefined {
  const row = db.approvals.get(approvalId);
  if (!row || row["status"] !== "pending") return undefined;
  const now = new Date().toISOString();
  db.approvals.update(approvalId, { status: decision, resolved_at: now, resolved_by: resolvedBy });
  return db.approvals.get(approvalId) as unknown as ApprovalRequest;
}

export function getPendingApprovals(): ApprovalRequest[] {
  return db.approvals.pending() as unknown as ApprovalRequest[];
}

export async function waitForApproval(
  approvalId: string,
  timeoutMs: number
): Promise<"approved" | "denied" | "timeout"> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const row = db.approvals.get(approvalId);
    if (!row) return "denied";
    if (row["status"] === "approved") return "approved";
    if (row["status"] === "denied") return "denied";
    if (row["status"] === "timeout") return "timeout";
    await sleep(1000);
  }
  db.approvals.update(approvalId, { status: "timeout" });
  return "timeout";
}

// ─── Private ─────────────────────────────────────────────────────────────────

function detectInjection(toolCall: ToolCall): PolicyCheckResult | null {
  const inputStr = JSON.stringify(toolCall.input);
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(inputStr)) {
      return {
        action: "injection_detected",
        message: `Prompt injection attempt detected in tool "${toolCall.name}". Tool call blocked.`,
      };
    }
  }
  return null;
}

async function evaluateRule(
  rule: PolicyRule,
  toolCall: ToolCall,
  conversationId: string,
  approvalTimeoutMs: number
): Promise<PolicyCheckResult> {
  switch (rule.type) {
    case "block":
      return { action: "blocked", rule, message: `Tool "${toolCall.name}" is blocked by policy: "${rule.name}".` };

    case "allow_only":
      return { action: "allowed", message: "Tool is in the allow-only list." };

    case "require_approval": {
      const approvalId = createApprovalRequest(toolCall, conversationId, rule.id, approvalTimeoutMs);
      return { action: "approval_required", rule, message: `Tool "${toolCall.name}" requires human approval.`, approvalId };
    }

    case "validate_input": {
      if (!rule.conditionField || !rule.conditionOperator || !rule.conditionValue) {
        return { action: "allowed", message: "Validation rule incomplete, skipping." };
      }
      const fieldValue = String(toolCall.input[rule.conditionField] ?? "");
      const passes = evaluateCondition(fieldValue, rule.conditionOperator, rule.conditionValue);
      if (!passes) {
        return { action: "validation_failed", rule, message: `Input validation failed for "${rule.conditionField}" in tool "${toolCall.name}". Policy: "${rule.name}".` };
      }
      return { action: "allowed", message: "Input validation passed." };
    }

    case "rate_limit": {
      if (!rule.rateLimitCount || !rule.rateLimitWindowMs) {
        return { action: "allowed", message: "Rate limit rule incomplete." };
      }
      const limited = checkRateLimit(toolCall.name, rule.rateLimitCount, rule.rateLimitWindowMs);
      if (limited) {
        return { action: "rate_limited", rule, message: `Tool "${toolCall.name}" rate limited: max ${rule.rateLimitCount} calls per ${rule.rateLimitWindowMs / 1000}s.` };
      }
      return { action: "allowed", message: "Rate limit not exceeded." };
    }

    default:
      return { action: "allowed", message: "Unknown rule type." };
  }
}

function matchesPattern(toolName: string, pattern: string): boolean {
  if (pattern === "*") return true;
  if (pattern === toolName) return true;
  if (pattern.endsWith("*")) return toolName.startsWith(pattern.slice(0, -1));
  if (pattern.startsWith("*")) return toolName.endsWith(pattern.slice(1));
  return false;
}

function evaluateCondition(
  value: string,
  operator: NonNullable<PolicyRule["conditionOperator"]>,
  expected: string
): boolean {
  switch (operator) {
    case "contains": return value.toLowerCase().includes(expected.toLowerCase());
    case "not_contains": return !value.toLowerCase().includes(expected.toLowerCase());
    case "starts_with": return value.toLowerCase().startsWith(expected.toLowerCase());
    case "matches_regex": {
      try { return new RegExp(expected, "i").test(value); } catch { return false; }
    }
    default: return true;
  }
}

function checkRateLimit(toolName: string, maxCount: number, windowMs: number): boolean {
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs).toISOString();
  const current = db.rateLimit.getCount(toolName, windowStart);
  if (current >= maxCount) return true;
  db.rateLimit.increment(toolName, windowStart);
  return false;
}

function createApprovalRequest(
  toolCall: ToolCall,
  conversationId: string,
  policyRuleId: string,
  timeoutMs: number
): string {
  const id = uuidv4();
  const now = new Date().toISOString();
  const timeoutAt = new Date(Date.now() + timeoutMs).toISOString();
  db.approvals.insert({
    id,
    conversation_id: conversationId,
    tool_name: toolCall.name,
    tool_input: JSON.stringify(toolCall.input),
    policy_rule_id: policyRuleId,
    status: "pending",
    created_at: now,
    timeout_at: timeoutAt,
  });
  return id;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
