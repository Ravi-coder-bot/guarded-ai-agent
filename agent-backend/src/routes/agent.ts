import { Router } from "express";
import { v4 as uuidv4 } from "uuid";
import { runAgent } from "../agent.js";
import { getServerStatuses } from "../mcp/client.js";
import { broadcastToAll } from "../index.js";
import { db } from "../db/database.js";

export const agentRouter = Router();

agentRouter.post("/", async (req, res) => {
  const { message, conversationId, history = [] } = req.body as {
    message: string; conversationId?: string; history?: Array<{ role: "user"|"assistant"; content: string }>;
  };
  if (!message?.trim()) return res.status(400).json({ error: "message is required" });

  const convId = conversationId ?? uuidv4();

  db.conversations.insertIfAbsent({ id: convId, started_at: new Date().toISOString(), total_input_tokens: 0, total_output_tokens: 0, model: "claude-sonnet-4-20250514", message_count: 0 });
  db.logs.insert({ id: uuidv4(), conversation_id: convId, timestamp: new Date().toISOString(), role: "user", content: message });

  const msgs = [...history, { role: "user" as const, content: message }];

  try {
    const result = await runAgent(convId, msgs, (event) => {
      broadcastToAll({ type: "agent_event", conversationId: convId, event });
    });
    broadcastToAll({ type: "conversation_updated", conversationId: convId });
    return res.json({ conversationId: convId, response: result.finalMessage, events: result.events, usage: result.usage });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: msg });
  }
});

agentRouter.get("/servers", (_req, res) => res.json(getServerStatuses()));
