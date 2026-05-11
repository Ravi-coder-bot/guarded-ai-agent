# Guarded AI Agent with MCP Support

A full-stack AI agent system with a real-time policy/guardrails engine, custom MCP server, and admin dashboard.

## Architecture

```
┌─────────────────┐     WebSocket/REST      ┌───────────────────────────────────┐
│   Dashboard      │◄───────────────────────►│         Agent Backend             │
│  (React + Vite)  │                         │  ┌─────────────────────────────┐  │
└─────────────────┘                         │  │     LLM Tool-Use Loop        │  │
                                             │  │   (Gemini 2.0 Flash)         │  │
                                             │  └────────────┬────────────────┘  │
                                             │               │                   │
                                             │  ┌────────────▼────────────────┐  │
                                             │  │      Policy Engine           │  │
                                             │  │  Block/Approve/Validate/     │  │
                                             │  │  RateLimit/InjectionGuard    │  │
                                             │  └────────────┬────────────────┘  │
                                             │               │                   │
                                             │  ┌────────────▼────────────────┐  │
                                             │  │       MCP Client             │  │
                                             │  │   (stdio + SSE transport)    │  │
                                             │  └───────────┬─────────────────┘  │
                                             └─────────────┼─────────────────────┘
                                                           │
                              ┌────────────────────────────┴──────────────────┐
                              │                                                 │
                  ┌───────────▼──────────┐                    ┌────────────────▼──────┐
                  │  Custom MCP Server    │                    │   Remote MCP Server   │
                  │  Notes & Task Mgr    │                    │   Exa Search (SSE)    │
                  │  (stdio, 5 tools)    │                    │   (exa.ai)            │
                  └──────────────────────┘                    └───────────────────────┘
```

## Features

### AI Agent
- Full LLM tool-use loop (Claude decides → Policy checks → MCP executes → result fed back)
- Dynamic tool discovery — no hardcoded tool lists, agent picks up any new MCP server automatically
- Supports stdio and SSE MCP transports
- Connected to 2 MCP servers (1 custom, 1 remote)

### Policy Engine (standalone module)
- **Block**: Prevent specific tools from ever running
- **Require Approval**: Pause execution until a human approves/denies
- **Validate Input**: Enforce rules on tool arguments (e.g. path restrictions)
- **Rate Limit**: Cap how many times a tool can run per minute
- **Allow Only**: Whitelist specific tools, block everything else
- **Prompt Injection Guard**: Detects attempts to bypass policy via crafted inputs
- All rules propagate live via WebSocket — zero restart needed

### Dashboard
- Create, toggle, and delete policy rules
- Real-time conversation logs with tool call visibility
- See which calls were blocked, approved, or modified
- Token/cost tracker per conversation
- Human approval queue for gated tool calls

### Custom MCP Server — Notes & Task Manager
- `create_note` — Create a note with title, content, tags, priority
- `list_notes` — List/filter notes by tag, priority, or status
- `get_note` — Retrieve a single note by ID
- `update_note` — Update title, content, tags, or status
- `delete_note` — Delete a note permanently
- Backed by SQLite, fully persistent

## Quick Start

### 1. Clone and install

```bash
git clone <repo>
cd guarded-ai-agent

# Install all dependencies
npm run install:all
```

### 2. Configure environment

```bash
cp agent-backend/.env.example agent-backend/.env
```

Edit `agent-backend/.env`:
```env
ANTHROPIC_API_KEY=your_anthropic_key
EXA_API_KEY=your_exa_key          # optional — remote MCP server
PORT=3001
FRONTEND_URL=http://localhost:5173
```

### 3. Start all services

```bash
# In three separate terminals:

# Terminal 1: Custom MCP Server (no explicit start needed — agent spawns it)
# But you can test it standalone:
cd custom-mcp-server && npm run dev

# Terminal 2: Agent Backend
cd agent-backend && npm run dev

# Terminal 3: Dashboard
cd dashboard && npm run dev
```

### 4. Open dashboard
Navigate to `http://localhost:5173`

## Project Structure

```
guarded-ai-agent/
├── agent-backend/
│   └── src/
│       ├── index.ts          # Express + WebSocket server
│       ├── agent.ts          # LLM tool-use loop
│       ├── policy/
│       │   ├── engine.ts     # Policy enforcement (standalone module)
│       │   ├── store.ts      # Policy CRUD + persistence
│       │   └── types.ts      # Policy type definitions
│       ├── mcp/
│       │   └── client.ts     # MCP client manager (stdio + SSE)
│       ├── routes/
│       │   ├── agent.ts      # POST /api/chat
│       │   ├── policy.ts     # CRUD /api/policies
│       │   └── logs.ts       # GET /api/logs
│       └── db/
│           └── database.ts   # SQLite setup
├── custom-mcp-server/
│   └── src/
│       └── index.ts          # Notes & Task Manager MCP server
└── dashboard/
    └── src/
        ├── App.tsx
        ├── components/
        │   ├── Chat.tsx
        │   ├── PolicyManager.tsx
        │   ├── LogViewer.tsx
        │   └── ApprovalQueue.tsx
        └── hooks/
            └── useWebSocket.ts
```

## Design Decisions & Edge Cases

### MCP server crash mid-call
The MCP client wraps every tool call in a try/catch with a 30s timeout. If the server process dies, the client catches the error, marks the server as "degraded", attempts reconnection with exponential backoff (1s → 2s → 4s → 30s max), and returns a structured error to the agent so it can tell the user gracefully.

### Prompt injection attempts
The policy engine runs a dedicated injection scan on every tool argument before execution. It checks for patterns like `ignore previous instructions`, `bypass policy`, `admin mode`, etc. Detected injections are logged with HIGH severity, the tool call is blocked, and the agent is told the input was rejected without revealing the policy details (to avoid giving the attacker signal).

### Conflicting rules
Rules are evaluated in priority order: Block > AllowOnly > RequireApproval > ValidateInput > RateLimit. If a Block rule and a RequireApproval rule both match the same tool, Block wins. Conflicts are surfaced in the dashboard with a warning badge.

### Approver offline
When a tool requires approval and no approver responds within a configurable timeout (default: 5 minutes), the tool call times out with a `APPROVAL_TIMEOUT` error. The agent informs the user that the action requires human review and suggests trying again later. The pending approval stays in the queue so an admin can review it retrospectively.

## Stack
- **Backend**: Node.js 20+, TypeScript, Express, ws (WebSockets), better-sqlite3
- **LLM**: Anthropic Claude (claude-sonnet-4-20250514)
- **MCP**: @modelcontextprotocol/sdk (stdio + SSE)
- **Frontend**: React 18, Vite, Tailwind CSS
- **Database**: SQLite (via better-sqlite3)
