import "dotenv/config";
import express from "express";
import cors from "cors";
import { WebSocketServer, WebSocket } from "ws";
import { createServer } from "http";
import { initDatabase } from "./db/database.js";
import { initMcpServers } from "./mcp/client.js";
import { seedDefaultRules } from "./policy/store.js";
import { agentRouter } from "./routes/agent.js";
import { policyRouter } from "./routes/policy.js";
import { logsRouter } from "./routes/logs.js";

const PORT = parseInt(process.env["PORT"] ?? "3001");
const FRONTEND_URL = process.env["FRONTEND_URL"] ?? "http://localhost:5173";

// ─── WebSocket broadcast ──────────────────────────────────────────────────────
const wsClients = new Set<WebSocket>();

export function broadcastToAll(payload: unknown): void {
  const data = JSON.stringify(payload);
  for (const ws of wsClients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(data);
    }
  }
}

// ─── App setup ───────────────────────────────────────────────────────────────
async function main(): Promise<void> {
  // 1. Init database
  initDatabase();
  console.log("[DB] SQLite initialized");

  // 2. Seed default policy rules (if none exist)
  seedDefaultRules();

  // 3. Connect to MCP servers
  console.log("[MCP] Initializing MCP server connections...");
  await initMcpServers();

  // 4. Express app
  const app = express();
  app.use(cors({ origin: FRONTEND_URL, credentials: true }));
  app.use(express.json({ limit: "2mb" }));

  // Health check
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", timestamp: new Date().toISOString() });
  });

  // Routes
  app.use("/api/chat", agentRouter);
  app.use("/api/policies", policyRouter);
  app.use("/api/logs", logsRouter);

  // 404 handler
  app.use((_req, res) => res.status(404).json({ error: "Not found" }));

  // Error handler
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    console.error("[Server Error]", err);
    res.status(500).json({ error: err.message });
  });

  // 5. HTTP + WebSocket server
  const server = createServer(app);
  const wss = new WebSocketServer({ server, path: "/ws" });

  wss.on("connection", (ws) => {
    wsClients.add(ws);
    console.log(`[WS] Client connected (${wsClients.size} total)`);

    // Send current state on connect
    ws.send(JSON.stringify({ type: "connected", timestamp: new Date().toISOString() }));

    ws.on("close", () => {
      wsClients.delete(ws);
      console.log(`[WS] Client disconnected (${wsClients.size} total)`);
    });

    ws.on("error", (err) => {
      console.error("[WS] Error:", err);
      wsClients.delete(ws);
    });

    // Handle messages from dashboard (e.g., approval decisions)
    ws.on("message", (data) => {
      try {
        const msg = JSON.parse(data.toString()) as { type: string };
        console.log("[WS] Message from client:", msg.type);
      } catch {
        // ignore malformed messages
      }
    });
  });

  server.listen(PORT, () => {
    console.log(`
╔═══════════════════════════════════════════════╗
║       Guarded AI Agent Backend                ║
║                                               ║
║  API:       http://localhost:${PORT}             ║
║  WebSocket: ws://localhost:${PORT}/ws            ║
║  Dashboard: ${FRONTEND_URL}         ║
╚═══════════════════════════════════════════════╝
    `);
  });
}

main().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
