import { Router } from "express";
import { db } from "../db/database.js";

export const logsRouter = Router();

logsRouter.get("/conversations", (req, res) => {
  const limit = parseInt(String(req.query["limit"] ?? "20"));
  const offset = parseInt(String(req.query["offset"] ?? "0"));
  res.json({ conversations: db.conversations.all(limit, offset), total: db.conversations.count(), limit, offset });
});

logsRouter.get("/conversations/:id", (req, res) => {
  const conv = db.conversations.get(req.params["id"]!);
  if (!conv) return res.status(404).json({ error: "Conversation not found" });
  const logs = db.logs.forConversation(req.params["id"]!);
  res.json({ conversation: conv, logs });
});

logsRouter.get("/stats", (_req, res) => {
  const totalConversations = db.conversations.count();
  const totalToolCalls = db.logs.countByRole("tool_call");
  const totalBlocked = db.logs.countByRole("policy_block");
  const { totalInputTokens, totalOutputTokens } = db.stats();
  const topBlockedTools = db.logs.topBlockedTools();
  res.json({
    totalConversations,
    totalToolCalls,
    totalBlocked,
    blockRate: totalToolCalls > 0 ? (totalBlocked / totalToolCalls * 100).toFixed(1) : "0.0",
    totalInputTokens,
    totalOutputTokens,
    estimatedCostUsd: ((totalInputTokens * 3 + totalOutputTokens * 15) / 1_000_000).toFixed(4),
    topBlockedTools,
  });
});
