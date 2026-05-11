import { Router } from "express";
import { getAllRules, getRuleById, createRule, updateRule, deleteRule, toggleRule } from "../policy/store.js";
import { getPendingApprovals, resolveApproval } from "../policy/engine.js";
import { broadcastToAll } from "../index.js";

export const policyRouter = Router();

policyRouter.get("/approvals/pending", (_req, res) => res.json(getPendingApprovals()));

policyRouter.post("/approvals/:id/resolve", (req, res) => {
  const { decision, resolvedBy } = req.body as { decision: "approved"|"denied"; resolvedBy?: string };
  if (!["approved","denied"].includes(decision)) return res.status(400).json({ error: "decision must be approved or denied" });
  const approval = resolveApproval(req.params["id"]!, decision, resolvedBy);
  if (!approval) return res.status(404).json({ error: "Approval not found or already resolved" });
  broadcastToAll({ type: "approval_resolved", approvalId: req.params["id"], decision });
  res.json(approval);
});

policyRouter.get("/", (_req, res) => res.json(getAllRules()));
policyRouter.get("/:id", (req, res) => {
  const rule = getRuleById(req.params["id"]!);
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  res.json(rule);
});
policyRouter.post("/", (req, res) => {
  const body = req.body;
  if (!body.name || !body.type || !body.toolPattern) return res.status(400).json({ error: "name, type, and toolPattern required" });
  const rule = createRule({ name: body.name, description: body.description, type: body.type, enabled: body.enabled ?? true, toolPattern: body.toolPattern, conditionField: body.conditionField, conditionOperator: body.conditionOperator, conditionValue: body.conditionValue, rateLimitCount: body.rateLimitCount, rateLimitWindowMs: body.rateLimitWindowMs, priority: body.priority ?? 0 });
  broadcastToAll({ type: "policies_updated" });
  res.status(201).json(rule);
});
policyRouter.patch("/:id", (req, res) => {
  const rule = updateRule(req.params["id"]!, req.body);
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  broadcastToAll({ type: "policies_updated" });
  res.json(rule);
});
policyRouter.delete("/:id", (req, res) => {
  const ok = deleteRule(req.params["id"]!);
  if (!ok) return res.status(404).json({ error: "Rule not found" });
  broadcastToAll({ type: "policies_updated" });
  res.json({ success: true });
});
policyRouter.post("/:id/toggle", (req, res) => {
  const rule = toggleRule(req.params["id"]!);
  if (!rule) return res.status(404).json({ error: "Rule not found" });
  broadcastToAll({ type: "policies_updated" });
  res.json(rule);
});
