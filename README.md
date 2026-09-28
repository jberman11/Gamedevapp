# Godot Sprint Harness

A multi-agent sprint harness for building games in **Godot 4.6** with [Claude Code](https://claude.ai/code).

You talk direction and design; Claude plans sprints with you, then dispatches a team of
specialized agents — gameplay, engine/systems, UI, level design, art integration, QA — that work
their tasks **in parallel** and submit results back. Nothing ships without you: every submission
lands in an approval queue, and every design-level question the agents hit is escalated to you as
an explicit decision. All of it is coordinated through a local MCP server (`godot-sprint`) that
keeps the plan, tasks, approvals, and decision log as versioned state in the repo.

## Setup (your machine)

Prereqs: [Node.js 20+](https://nodejs.org), [Claude Code](https://claude.ai/code), and
[Godot 4.6](https://godotengine.org/download) if you want headless validation.

```bash
git clone https://github.com/jberman11/gamedevapp.git
cd gamedevapp
npm install --prefix harness
export GODOT_BIN=/path/to/godot   # optional but recommended (headless-capable binary)
claude
```

Claude Code picks up the `godot-sprint` MCP server from `.mcp.json` automatically (approve it when
prompted). Create your Godot project in `game/` (so `game/project.godot` exists) — from the Godot
editor, or ask Claude to scaffold it.

## Workflow

| Command | What happens |
|---|---|
| `/sprint-plan` | Discuss direction, pillars, and sprint makeup; the agreed plan and task breakdown are recorded in the sprint server. |
| `/sprint-run` | All ready tasks are dispatched to their specialist agents in one parallel batch; agents claim, build, validate headlessly, and submit. |
| `/sprint-review` | Everything waiting on you — submissions and escalated design decisions — is served item by item; your verdicts are recorded and unblock downstream tasks. |

You can also just talk: "what's the sprint status?", "send T4 back, the HUD scaling is wrong",
"close the sprint" — the orchestrator uses the same tools conversationally.

## How it fits together

- **`harness/`** — the `godot-sprint` MCP server (Node, no build step). Tools for the project plan,
  sprints, tasks with dependency gating, an approval queue, escalated decisions, an activity log,
  and `godot_check` (headless import validation, per-script checks, GUT test runs).
- **`.claude/agents/`** — six specialist agent definitions with Godot 4.6 craft standards baked in.
  Agents cannot approve their own work or resolve design questions — by construction.
- **`.claude/skills/`** — the three workflow skills above.
- **`.sprint/state.json`** — sprint state, committed so plan/decision history travels with the code.
- **`game/`** — your Godot 4.6 project.

## Harness development

```bash
cd harness
npm test   # exercises the full task lifecycle against a scratch state dir
```
