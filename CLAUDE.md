# Godot Sprint Harness

This repository is a multi-agent game development harness for **Godot 4.6**. Claude Code acts as
producer/orchestrator; specialized subagents build the game in parallel; the **user makes every
approval and design call**. The `godot-sprint` MCP server (auto-started from `.mcp.json`) is the
single source of truth for the plan, sprints, tasks, approvals, and escalated design decisions.

## Layout
- `harness/` — the MCP server (Node.js, ESM). `npm install` here once; no build step.
- `.claude/agents/` — the specialist team: `gameplay-dev`, `engine-systems`, `ui-dev`,
  `level-designer`, `art-integrator`, `qa-reviewer`.
- `.claude/skills/` — the workflow: `/sprint-plan` → `/sprint-run` → `/sprint-review`.
- `game/` — the Godot 4.6 project (create with the Godot editor; `project.godot` lives here).
- `.sprint/state.json` — sprint state, committed to git so history travels with the repo.

## The loop
1. **`/sprint-plan`** — discuss direction and sprint makeup with the user; record the agreed plan
   (`plan_update`, `sprint_create`, `task_create`). Minimize dependencies so tasks parallelize.
2. **`/sprint-run`** — dispatch one subagent per ready task, all in one parallel batch. Agents
   claim → build → `godot_check` → `task_submit`. They escalate design questions via
   `decision_request` instead of guessing.
3. **`/sprint-review`** — serve the `review_queue` to the user item by item; record their verdicts
   with `task_approve` / `task_request_changes` / `decision_resolve`. Approvals unblock dependents;
   keep dispatching until the sprint goal is met, then `sprint_close` with a retro.

## Hard rules
- **Never** call `task_approve`, `task_request_changes`, or `decision_resolve` without an explicit
  user verdict from this conversation. Agents never call them at all.
- Agents only work tasks they have claimed, and only touch files their task requires.
- Design-level choices (mechanics, art direction, scope, architecture others build on) always go
  through `decision_request` — the user runs design.
- Run `godot_check` before every `task_submit`; broken imports or script errors must not reach review.
- GDScript: static typing, signals up / calls down, `@export` tunables, snake_case files. Details
  live in each agent definition.
- Commit at meaningful checkpoints (approved tasks, closed sprints) with clear messages; the
  `.sprint/` state changes belong in those commits.

## Environment
- `GODOT_BIN` must point at a Godot 4.6 executable for `godot_check` to work (warn the user if
  validation is unavailable, don't silently skip it).
- Server env (set in `.mcp.json`): `SPRINT_STATE_DIR=.sprint`, `GODOT_PROJECT_DIR=game`.
- Harness smoke test: `cd harness && npm test`.
