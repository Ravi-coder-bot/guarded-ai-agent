# Deployment Guide

## Option A — Railway (Recommended, free tier available)

### 1. Push to GitHub
```bash
cd guarded-ai-agent
git init
git add .
git commit -m "Initial commit"
gh repo create guarded-ai-agent --public --source=. --push
```

### 2. Deploy backend + MCP on Railway
1. Go to railway.app → New Project → Deploy from GitHub
2. Select your repo and keep the Railway root directory as the repository root.
   Do not set the root directory to `agent-backend`, because Railway also needs
   `custom-mcp-server` so the backend can spawn the local MCP process.
3. Set environment variables:
   - `GEMINI_API_KEY` = your key
   - `EXA_API_KEY` = your key (optional)
   - `PORT` = 3001
   - `FRONTEND_URL` = your deployed dashboard URL (add after step 4)
   - Leave `NODE_BINARY` unset; only set `MCP_NODE_BINARY` if you have a stable custom Node path
4. Deploy → copy the Railway URL (e.g. `https://your-app.railway.app`)

> Note: The custom MCP server runs as a child process spawned by the backend.
> Both live in the same Railway service — no separate deployment needed.

### 3. Deploy dashboard on Vercel
```bash
cd dashboard
npm i -g vercel
vercel
# Set VITE_API_URL to your Railway backend URL when prompted
```

Or in `vite.config.ts`, replace the proxy target with your Railway URL for production.

### 4. Update CORS
In Railway, set `FRONTEND_URL` to your Vercel URL.

---

## Option B — Render

### Backend (Web Service)
- Root dir: `agent-backend`
- Build command: `npm install && npm run build`
- Start command: `node dist/index.js`
- Add env vars same as above

### Dashboard (Static Site)
- Root dir: `dashboard`
- Build command: `npm install && npm run build`
- Publish dir: `dist`
- Add env var: `VITE_API_BASE_URL=https://your-render-backend.onrender.com`

---

## Option C — Fly.io

```bash
# Backend
cd agent-backend
fly launch --name guarded-ai-backend
fly secrets set ANTHROPIC_API_KEY=sk-...
fly deploy

# Dashboard
cd ../dashboard
fly launch --name guarded-ai-dashboard
fly deploy
```

---

## Custom MCP Server Notes

The custom MCP server (`custom-mcp-server`) is spawned as a child process by the agent backend via stdio transport. When deploying:

1. Build it first: `npm run build --prefix custom-mcp-server`
2. The backend's `mcp/client.ts` resolves `custom-mcp-server/dist/index.js`
   from the repository root at runtime
3. In a monorepo deployment, both directories must be present

For containerized deployments, use the Dockerfile below:

```dockerfile
FROM node:20-slim
WORKDIR /app

# Install all packages
COPY custom-mcp-server/package*.json ./custom-mcp-server/
RUN cd custom-mcp-server && npm ci

COPY agent-backend/package*.json ./agent-backend/
RUN cd agent-backend && npm ci

# Build
COPY custom-mcp-server/ ./custom-mcp-server/
RUN cd custom-mcp-server && npm run build

COPY agent-backend/ ./agent-backend/
RUN cd agent-backend && npm run build

WORKDIR /app/agent-backend
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

---

## Environment Variables Reference

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `ANTHROPIC_API_KEY` | ✅ | — | Claude API key |
| `EXA_API_KEY` | ❌ | — | Exa search (remote MCP) |
| `PORT` | ❌ | 3001 | Backend port |
| `FRONTEND_URL` | ❌ | http://localhost:5173 | For CORS |
| `APPROVAL_TIMEOUT_MS` | ❌ | 300000 | 5 minutes |
| `NODE_ENV` | ❌ | development | production in deployment |
