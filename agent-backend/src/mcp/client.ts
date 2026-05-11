/**
 * MCP Client Manager
 * Manages connections to multiple MCP servers.
 * Tool discovery is dynamic — no tool lists are hardcoded.
 * Supports both stdio (local processes) and SSE (remote servers).
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { SSEClientTransport } from "@modelcontextprotocol/sdk/client/sse.js";
import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface MCPServerConfig {
  id: string;
  name: string;
  transport: "stdio" | "sse";
  // stdio
  command?: string;
  args?: string[];
  cwd?: string;
  // sse
  url?: string;
  apiKey?: string;
}

export interface DiscoveredTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  serverId: string;
  serverName: string;
}

interface ServerState {
  config: MCPServerConfig;
  client: Client | null;
  tools: DiscoveredTool[];
  status: "connecting" | "ready" | "degraded" | "offline";
  lastError?: string;
  reconnectAttempts: number;
}

const servers = new Map<string, ServerState>();

/**
 * Register and connect to an MCP server.
 */
export async function addMcpServer(config: MCPServerConfig): Promise<void> {
  const state: ServerState = {
    config,
    client: null,
    tools: [],
    status: "connecting",
    reconnectAttempts: 0,
  };
  servers.set(config.id, state);
  await connectServer(config.id);
}

/**
 * Discover all tools from all connected MCP servers.
 * Returns a flat list — no hardcoded names.
 */
export function getAllTools(): DiscoveredTool[] {
  const tools: DiscoveredTool[] = [];
  for (const state of servers.values()) {
    if (state.status === "ready") {
      tools.push(...state.tools);
    }
  }
  return tools;
}

/**
 * Get the status of all MCP servers (for dashboard).
 */
export function getServerStatuses(): Array<{
  id: string;
  name: string;
  status: string;
  toolCount: number;
  lastError?: string;
}> {
  return Array.from(servers.values()).map((s) => ({
    id: s.config.id,
    name: s.config.name,
    status: s.status,
    toolCount: s.tools.length,
    lastError: s.lastError,
  }));
}

/**
 * Execute a tool call on the appropriate MCP server.
 * Returns structured result or throws on error.
 */
export async function executeTool(
  toolName: string,
  toolInput: Record<string, unknown>
): Promise<{ content: string; isError: boolean }> {
  // Find which server owns this tool
  const ownerState = findToolOwner(toolName);
  if (!ownerState) {
    return {
      content: `Tool "${toolName}" not found on any connected MCP server.`,
      isError: true,
    };
  }

  if (!ownerState.client || ownerState.status !== "ready") {
    return {
      content: `MCP server "${ownerState.config.name}" is not ready (status: ${ownerState.status}).`,
      isError: true,
    };
  }

  try {
    const result = await Promise.race([
      ownerState.client.callTool({ name: toolName, arguments: toolInput }),
      timeout(30_000, `Tool "${toolName}" timed out after 30s`),
    ]);

    const content = extractContent(result);
    return { content, isError: false };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);

    // Mark server degraded if it crashed
    if (msg.includes("transport") || msg.includes("connection") || msg.includes("closed")) {
      ownerState.status = "degraded";
      ownerState.lastError = msg;
      scheduleReconnect(ownerState.config.id);
    }

    return { content: `Tool execution failed: ${msg}`, isError: true };
  }
}

/**
 * Refresh tool lists from all connected servers.
 */
export async function refreshAllTools(): Promise<void> {
  const promises = Array.from(servers.keys()).map((id) => refreshServerTools(id));
  await Promise.allSettled(promises);
}

// ─── Private ─────────────────────────────────────────────────────────────────

async function connectServer(serverId: string): Promise<void> {
  const state = servers.get(serverId);
  if (!state) return;

  try {
    const client = new Client(
      { name: "guarded-ai-agent", version: "1.0.0" },
      { capabilities: {} }
    );

    let transport;
    if (state.config.transport === "stdio") {
      const command = state.config.command!;
      const args = state.config.args ?? [];
      const cwd = state.config.cwd;

      transport = new StdioClientTransport({
        command,
        args,
        env: {
          ...process.env,
          ...(state.config.apiKey ? { API_KEY: state.config.apiKey } : {}),
        },
        ...(cwd ? { cwd } : {}),
      });
    } else {
      const url = new URL(state.config.url!);
      transport = new SSEClientTransport(url);
    }

    await client.connect(transport);
    state.client = client;
    state.reconnectAttempts = 0;

    await refreshServerTools(serverId);
    state.status = "ready";
    state.lastError = undefined;

    console.log(
      `[MCP] Connected to "${state.config.name}" — ${state.tools.length} tools discovered`
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    state.status = "degraded";
    state.lastError = msg;
    console.error(`[MCP] Failed to connect to "${state.config.name}": ${msg}`);
    scheduleReconnect(serverId);
  }
}

async function refreshServerTools(serverId: string): Promise<void> {
  const state = servers.get(serverId);
  if (!state?.client) return;

  try {
    const result = await state.client.listTools();
    state.tools = result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema as Record<string, unknown>) ?? {},
      serverId,
      serverName: state.config.name,
    }));
  } catch (err) {
    console.error(`[MCP] Failed to list tools from "${state.config.name}": ${err}`);
  }
}

function findToolOwner(toolName: string): ServerState | undefined {
  for (const state of servers.values()) {
    if (state.tools.some((t) => t.name === toolName)) return state;
  }
  return undefined;
}

function scheduleReconnect(serverId: string): void {
  const state = servers.get(serverId);
  if (!state) return;

  state.reconnectAttempts++;
  const delay = Math.min(1000 * Math.pow(2, state.reconnectAttempts - 1), 30_000);

  console.log(`[MCP] Scheduling reconnect to "${state.config.name}" in ${delay}ms (attempt ${state.reconnectAttempts})`);

  setTimeout(async () => {
    if (servers.has(serverId)) {
      state.status = "connecting";
      await connectServer(serverId);
    }
  }, delay);
}

function extractContent(result: unknown): string {
  if (!result || typeof result !== "object") return String(result);
  const r = result as Record<string, unknown>;
  if (Array.isArray(r["content"])) {
    return r["content"]
      .map((c: unknown) => {
        if (typeof c === "object" && c !== null && "text" in c) {
          return String((c as Record<string, unknown>)["text"]);
        }
        return JSON.stringify(c);
      })
      .join("\n");
  }
  if (typeof r["content"] === "string") return r["content"];
  return JSON.stringify(result);
}

function timeout(ms: number, message: string): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(message)), ms)
  );
}

/**
 * Initialize default MCP servers from environment.
 */
export async function initMcpServers(): Promise<void> {
  // process.execPath = the exact node binary running this process.
  // Avoids ENOENT when Railway/nvm/mise puts node at a non-standard PATH.
  const nodeBin = process.execPath;

  // After tsc compiles src/ → dist/, __dirname is agent-backend/dist/mcp/
  // So we need ../../../ to reach the repo root, then custom-mcp-server/
  const customServerPath = path.resolve(
    __dirname,
    "../../../custom-mcp-server/dist/index.js"
  );
  const customServerCwd = path.resolve(
    __dirname,
    "../../../custom-mcp-server"
  );

  console.log(`[MCP] Node binary: ${nodeBin}`);
  console.log(`[MCP] Custom MCP server path: ${customServerPath}`);

  // Custom MCP Server (stdio)
  await addMcpServer({
    id: "custom-notes",
    name: "Notes & Task Manager",
    transport: "stdio",
    command: nodeBin,
    args: [customServerPath],
    cwd: customServerCwd,
  });

  // Remote MCP Server (SSE) — Exa Search, if API key is set
  if (process.env["EXA_API_KEY"]) {
    await addMcpServer({
      id: "exa-search",
      name: "Exa Search",
      transport: "sse",
      url: "https://mcp.exa.ai/sse",
      apiKey: process.env["EXA_API_KEY"],
    });
  } else {
    console.log("[MCP] EXA_API_KEY not set — skipping Exa Search server");
    // Fallback: use a simple fetch MCP server
    console.log("[MCP] Note: Set EXA_API_KEY in .env to enable web search tools");
  }
}
