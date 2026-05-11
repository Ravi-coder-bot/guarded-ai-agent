import React, { useState, useEffect } from "react";
import { Plus, Trash2, ToggleLeft, ToggleRight, Shield, ChevronDown, ChevronUp, AlertTriangle } from "lucide-react";
import { policyApi, type PolicyRule } from "../api/client.ts";

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  block: { label: "Block", color: "bg-red-900/50 text-red-300 border-red-800" },
  require_approval: { label: "Require Approval", color: "bg-yellow-900/50 text-yellow-300 border-yellow-800" },
  validate_input: { label: "Validate Input", color: "bg-blue-900/50 text-blue-300 border-blue-800" },
  allow_only: { label: "Allow Only", color: "bg-green-900/50 text-green-300 border-green-800" },
  rate_limit: { label: "Rate Limit", color: "bg-purple-900/50 text-purple-300 border-purple-800" },
};

const BLANK: Omit<PolicyRule, "id" | "createdAt" | "updatedAt"> = {
  name: "",
  description: "",
  type: "block",
  enabled: true,
  toolPattern: "",
  priority: 0,
};

export default function PolicyManager({ onUpdate }: { onUpdate?: () => void }) {
  const [rules, setRules] = useState<PolicyRule[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ ...BLANK });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    try {
      const data = await policyApi.list();
      setRules(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load rules");
    }
  }

  useEffect(() => { load(); }, []);

  async function toggle(id: string) {
    try {
      const updated = await policyApi.toggle(id);
      setRules((prev) => prev.map((r) => (r.id === id ? updated : r)));
      onUpdate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to toggle");
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this rule?")) return;
    try {
      await policyApi.delete(id);
      setRules((prev) => prev.filter((r) => r.id !== id));
      onUpdate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete");
    }
  }

  async function save() {
    if (!form.name.trim() || !form.toolPattern.trim()) {
      setError("Name and Tool Pattern are required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const rule = await policyApi.create(form);
      setRules((prev) => [rule, ...prev]);
      setForm({ ...BLANK });
      setShowForm(false);
      onUpdate?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create rule");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="p-4 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-purple-400" />
          <h2 className="font-semibold text-gray-100">Policy Rules</h2>
          <span className="text-xs bg-gray-800 text-gray-400 rounded-full px-2 py-0.5">{rules.length}</span>
        </div>
        <button
          onClick={() => { setShowForm(!showForm); setError(null); }}
          className="flex items-center gap-1.5 text-sm bg-blue-600 hover:bg-blue-500 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Plus className="w-4 h-4" />
          Add Rule
        </button>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}

      {/* Add rule form */}
      {showForm && (
        <div className="bg-gray-800 border border-gray-700 rounded-xl p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-300">New Policy Rule</h3>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Name *</label>
              <input
                value={form.name}
                onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                placeholder="e.g. Block delete tools"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Tool Pattern *</label>
              <input
                value={form.toolPattern}
                onChange={(e) => setForm((p) => ({ ...p, toolPattern: e.target.value }))}
                placeholder="e.g. delete_*, *, create_note"
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Type *</label>
              <select
                value={form.type}
                onChange={(e) => setForm((p) => ({ ...p, type: e.target.value as PolicyRule["type"] }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
              >
                <option value="block">Block</option>
                <option value="require_approval">Require Approval</option>
                <option value="validate_input">Validate Input</option>
                <option value="allow_only">Allow Only</option>
                <option value="rate_limit">Rate Limit</option>
              </select>
            </div>
            <div className="space-y-1">
              <label className="text-xs text-gray-500">Priority (higher = first)</label>
              <input
                type="number"
                value={form.priority}
                onChange={(e) => setForm((p) => ({ ...p, priority: parseInt(e.target.value) || 0 }))}
                className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          {/* Conditional fields */}
          {form.type === "validate_input" && (
            <div className="grid grid-cols-3 gap-3 pt-1 border-t border-gray-700">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Field to check</label>
                <input
                  value={form.conditionField ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, conditionField: e.target.value }))}
                  placeholder="e.g. path, query"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Operator</label>
                <select
                  value={form.conditionOperator ?? "contains"}
                  onChange={(e) => setForm((p) => ({ ...p, conditionOperator: e.target.value }))}
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                >
                  <option value="contains">Contains</option>
                  <option value="not_contains">Does not contain</option>
                  <option value="starts_with">Starts with</option>
                  <option value="matches_regex">Matches regex</option>
                </select>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Value</label>
                <input
                  value={form.conditionValue ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, conditionValue: e.target.value }))}
                  placeholder="e.g. /etc, DROP TABLE"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          {form.type === "rate_limit" && (
            <div className="grid grid-cols-2 gap-3 pt-1 border-t border-gray-700">
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Max calls</label>
                <input
                  type="number"
                  value={form.rateLimitCount ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, rateLimitCount: parseInt(e.target.value) || undefined }))}
                  placeholder="e.g. 5"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">Window (ms)</label>
                <input
                  type="number"
                  value={form.rateLimitWindowMs ?? ""}
                  onChange={(e) => setForm((p) => ({ ...p, rateLimitWindowMs: parseInt(e.target.value) || undefined }))}
                  placeholder="e.g. 60000"
                  className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>
          )}

          <div className="space-y-1">
            <label className="text-xs text-gray-500">Description</label>
            <input
              value={form.description ?? ""}
              onChange={(e) => setForm((p) => ({ ...p, description: e.target.value }))}
              placeholder="Optional description..."
              className="w-full bg-gray-900 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-100 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex gap-2 pt-1">
            <button
              onClick={save}
              disabled={saving}
              className="bg-blue-600 hover:bg-blue-500 disabled:opacity-50 px-4 py-2 rounded-lg text-sm font-medium transition-colors"
            >
              {saving ? "Saving..." : "Create Rule"}
            </button>
            <button
              onClick={() => { setShowForm(false); setForm({ ...BLANK }); setError(null); }}
              className="bg-gray-700 hover:bg-gray-600 px-4 py-2 rounded-lg text-sm transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Rules list */}
      <div className="space-y-2">
        {rules.length === 0 && (
          <div className="text-center text-gray-500 text-sm py-8">No policy rules yet. Add one above.</div>
        )}
        {rules.map((rule) => (
          <RuleCard key={rule.id} rule={rule} onToggle={toggle} onDelete={remove} />
        ))}
      </div>
    </div>
  );
}

function RuleCard({ rule, onToggle, onDelete }: { rule: PolicyRule; onToggle: (id: string) => void; onDelete: (id: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  const meta = TYPE_LABELS[rule.type] ?? { label: rule.type, color: "bg-gray-800 text-gray-400 border-gray-700" };

  return (
    <div className={`border rounded-xl transition-all ${rule.enabled ? "border-gray-700 bg-gray-800/50" : "border-gray-800 bg-gray-900/30 opacity-60"}`}>
      <div className="flex items-center gap-3 p-3">
        <button onClick={() => onToggle(rule.id)} className="flex-shrink-0 text-gray-400 hover:text-gray-200 transition-colors">
          {rule.enabled ? <ToggleRight className="w-5 h-5 text-green-400" /> : <ToggleLeft className="w-5 h-5" />}
        </button>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-gray-100 truncate">{rule.name}</span>
            <span className={`text-xs border rounded-full px-2 py-0.5 flex-shrink-0 ${meta.color}`}>{meta.label}</span>
            <code className="text-xs bg-gray-900 text-gray-400 rounded px-1.5 py-0.5 font-mono">{rule.toolPattern}</code>
          </div>
          {rule.description && <p className="text-xs text-gray-500 mt-0.5 truncate">{rule.description}</p>}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button onClick={() => setExpanded(!expanded)} className="text-gray-500 hover:text-gray-300 p-1 transition-colors">
            {expanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
          <button onClick={() => onDelete(rule.id)} className="text-gray-500 hover:text-red-400 p-1 transition-colors">
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>
      {expanded && (
        <div className="px-4 pb-3 text-xs text-gray-400 space-y-1 border-t border-gray-700 pt-2">
          <div>Priority: {rule.priority}</div>
          {rule.conditionField && <div>Condition: <code className="text-gray-300">{rule.conditionField} {rule.conditionOperator} "{rule.conditionValue}"</code></div>}
          {rule.rateLimitCount && <div>Rate limit: {rule.rateLimitCount} calls / {(rule.rateLimitWindowMs ?? 60000) / 1000}s</div>}
          <div>Created: {new Date(rule.createdAt).toLocaleString()}</div>
        </div>
      )}
    </div>
  );
}
