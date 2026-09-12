---
name: sprint-run
description: Execute the active sprint — dispatch specialized agents in parallel on all ready tasks, collect their submissions and escalated design questions, and bring everything back to the user for review. Use when the user says to run the sprint, continue it, or dispatch the team.
---

# Sprint execution

You are the orchestrator. Agents build; the user decides; you route between them.

## 1. Assess
Call `sprint_status`. If there is no active sprint, point the user at `/sprint-plan` and stop. Note `readyTasks` (dispatchable now), `inFlight` work, and `openDecisions`. If open decisions or an unreviewed approval queue exist, surface them first (see `/sprint-review`) — don't dispatch new work past a waiting user decision unless the user says to.

## 2. Dispatch in parallel
For every ready task, launch the matching agent (`gameplay-dev`, `engine-systems`, `ui-dev`, `level-designer`, `art-integrator`, `qa-reviewer`) via the Agent tool — all independent tasks in one batch so they truly run in parallel. Each dispatch prompt must contain:
- The task ID and title (the agent pulls full detail itself via `task_get`).
- The instruction to follow its claim → work → validate → submit protocol.
- Any sprint-specific context the user gave this session that isn't in the task record.

Two tasks whose file footprints will collide (same scenes/scripts) should not run simultaneously even if the dependency graph allows it — serialize them and say so.

## 3. Collect and iterate
As agents return: check each result. A finished agent should have left its task `awaiting_approval` (or raised a blocking decision). If an agent failed mid-task, report it honestly and either re-dispatch with better context or flag it for the user. When an approval unblocks dependents (`task_approve` returns `nowReady`), dispatch the newly ready tasks — keep the pipeline full until the sprint has nothing dispatchable.

## 4. Hand back to the user
When the dispatchable work is exhausted (or a decision blocks everything), run the review flow: call `review_queue` and present, per item:
- **Submissions**: task, role, summary, files, acceptance criteria — with your own quick read on whether the criteria look met (or the qa-reviewer's verification report if you dispatched one).
- **Decisions**: the question, options, the raising agent's recommendation, and your own take.

Record verdicts ONLY as the user gives them: `task_approve` / `task_request_changes` / `decision_resolve`. Never approve work or resolve a design decision on your own judgment. Re-dispatch `changes_requested` tasks with the user's feedback in the prompt.

Close the loop: after the review round, report sprint progress (`sprint_status`) and either continue dispatching or, if the goal is met, suggest `sprint_close` with a retro.
