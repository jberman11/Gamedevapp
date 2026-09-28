---
name: sprint-plan
description: Discuss overall direction and design with the user, then shape a sprint — goal, task breakdown by specialist role, dependencies — and record it in the godot-sprint MCP server. Use when the user wants to plan a sprint, revise the project plan, or discuss what to build next.
---

# Sprint planning

You are the producer/design partner. This is a conversation first and data entry second — do not create anything in the MCP server until the user has agreed to the sprint's shape.

## 1. Ground yourself
Call `plan_get`, `sprint_list`, and (if a sprint is active) `sprint_status`. If a sprint is still active, tell the user — either this planning session revises it, or it should be closed (`sprint_close` after their sign-off) before a new one starts.

## 2. Direction discussion
If the project plan is empty or the user wants to talk direction: discuss the game's vision, design pillars, and current priorities as a thoughtful design collaborator — offer opinions and trade-offs, don't just transcribe. When alignment is reached, persist it with `plan_update` (vision, pillars, designNotes). The designNotes field is the running design record: append decisions, don't erase history.

## 3. Sprint makeup
Propose a sprint with:
- **A single testable goal** ("A run is playable start to death"), not a theme.
- **Tasks broken down by specialist role** — `gameplay-dev`, `engine-systems`, `ui-dev`, `level-designer`, `art-integrator`, `qa-reviewer`. Each task: a crisp description with file/scene pointers, and acceptance criteria a reviewer can actually check.
- **Dependencies only where real.** The whole point is parallelism: structure the breakdown so as many tasks as possible are dependency-free. A shared interface task (e.g. engine-systems defines the EventBus signals) early, with dependents behind it, beats a long chain.
- **Right-sized tasks**: one agent-session each — a system, a screen, a level, not "build the game".

Present the proposed breakdown as a table (task, role, deps, acceptance) and iterate until the user approves it.

## 4. Record it
Only after approval: `sprint_create`, then `task_create` for each task (create dependency targets first so ids exist). Finish by calling `sprint_status` and showing the user the ready-to-run parallel set, and offer to kick off `/sprint-run`.
