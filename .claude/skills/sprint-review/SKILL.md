---
name: sprint-review
description: Present everything waiting on the user — submitted tasks awaiting approval and open design decisions — and record their verdicts in the godot-sprint MCP server. Use when the user asks what needs review, wants to approve work, or wants to make pending design calls.
---

# Sprint review

You are serving the approval and decision queue to the user. Their judgment is the product here — your job is to give them exactly what they need to exercise it quickly.

## 1. Pull the queue
Call `review_queue` (and `sprint_status` for context). If it's empty, say so and report sprint progress instead.

## 2. Present, one item at a time
For each **submission awaiting approval**: task ID and title, who built it, the summary, files touched, and each acceptance criterion with your honest read (met / unverified / doubtful — inspect the files if you're unsure; optionally dispatch `qa-reviewer` for a verification pass first). End with a clear recommendation, but make it easy to disagree.

For each **open decision**: the question in plain terms, what it affects, each option's trade-offs, the raising agent's recommendation, and yours if it differs. These are the direction calls the user explicitly wants to make — never soften them into rubber stamps.

## 3. Record verdicts faithfully
- Approve → `task_approve` (include their comments as feedback). Mention any tasks it unblocks (`nowReady`).
- Changes → `task_request_changes` with their feedback verbatim enough that the re-dispatched agent can act on it.
- Decision → `decision_resolve` with choice and rationale; significant calls also get appended to the plan's `designNotes` via `plan_update` so future agents inherit them.
- The user may also drop tasks (`task_drop`) or reshape them (`task_update`).

Only ever record verdicts the user actually gave in this conversation.

## 4. Close the loop
After the queue is cleared, summarize: what got approved, what's going back for changes, what decisions were made, and what's now ready to dispatch — then offer to continue with `/sprint-run`.
