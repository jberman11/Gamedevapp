// Exercises the full sprint lifecycle against a scratch state dir.
// Run with: npm test
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "sprint-smoke-"));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [path.join(here, "..", "src", "server.js")],
  env: { ...process.env, SPRINT_STATE_DIR: stateDir },
});
const client = new Client({ name: "smoke", version: "0.0.1" });
await client.connect(transport);

async function call(name, args, { expectError = false } = {}) {
  const r = await client.callTool({ name, arguments: args });
  assert.equal(
    Boolean(r.isError),
    expectError,
    `${name}: expected isError=${expectError}, got ${Boolean(r.isError)}: ${r.content?.[0]?.text}`
  );
  const txt = r.content?.[0]?.text ?? "";
  try {
    return JSON.parse(txt);
  } catch {
    return txt;
  }
}

const tools = await client.listTools();
assert.ok(tools.tools.length >= 20, "expected 20+ tools");

await call("plan_update", { name: "Smoke", vision: "test game", pillars: ["fast"] });
const sprint = await call("sprint_create", { name: "S: core", goal: "playable loop" });
assert.equal(sprint.status, "active");

const t1 = await call("task_create", {
  title: "movement", description: "d", role: "gameplay-dev", acceptance: ["a"],
});
const t2 = await call("task_create", {
  title: "hud", description: "d", role: "ui-dev", acceptance: ["a"], deps: [t1.id],
});

// Dependency gating
const ready = await call("task_list", { readyOnly: true });
assert.deepEqual(ready.map((t) => t.id), [t1.id]);
await call("task_claim", { taskId: t2.id, agent: "ui-dev" }, { expectError: true });

// Claim + decision blocking
await call("task_claim", { taskId: t1.id, agent: "gameplay-dev" });
const d1 = await call("decision_request", {
  question: "grid or free?", options: ["grid", "free"], taskId: t1.id,
  raisedBy: "gameplay-dev", blocksTask: true,
});
await call("task_submit", { taskId: t1.id, summary: "x", files: [] }, { expectError: true });
await call("decision_resolve", { decisionId: d1.id, choice: "free" });

// Submit → review queue → approve unblocks dependent
await call("task_submit", { taskId: t1.id, summary: "done", files: ["p.gd"] });
const queue = await call("review_queue", {});
assert.equal(queue.awaitingApproval.length, 1);
const approved = await call("task_approve", { taskId: t1.id });
assert.deepEqual(approved.nowReady.map((t) => t.id), [t2.id]);

// Changes-requested loop
await call("task_claim", { taskId: t2.id, agent: "ui-dev" });
await call("task_submit", { taskId: t2.id, summary: "hud v1", files: ["hud.tscn"] });
await call("task_request_changes", { taskId: t2.id, feedback: "wrong anchor" });
await call("task_claim", { taskId: t2.id, agent: "ui-dev" });
await call("task_submit", { taskId: t2.id, summary: "hud v2", files: ["hud.tscn"] });
await call("task_approve", { taskId: t2.id });

// Close out
const closed = await call("sprint_close", { retro: "all good" });
assert.equal(closed.unfinishedTasks.length, 0);

// godot_check fails gracefully without a project
await call("godot_check", { mode: "import" }, { expectError: true });

const log = await call("activity_log", { limit: 50 });
assert.ok(log.some((e) => e.type === "sprint_closed"));

await client.close();
fs.rmSync(stateDir, { recursive: true, force: true });
console.log("smoke test passed");
