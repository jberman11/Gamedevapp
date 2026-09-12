#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { loadState, saveState, logEvent, nextId, findOrThrow, statePath } from "./state.js";
import { godotCheck, defaultProjectPath } from "./godot.js";

export const ROLES = [
  "gameplay-dev",
  "engine-systems",
  "ui-dev",
  "level-designer",
  "art-integrator",
  "qa-reviewer",
];

const TASK_STATUSES = [
  "todo",
  "in_progress",
  "blocked",
  "awaiting_approval",
  "changes_requested",
  "approved",
  "dropped",
];

const server = new McpServer({ name: "godot-sprint", version: "0.1.0" });

function text(data) {
  const body = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text: body }] };
}

function fail(message) {
  return { content: [{ type: "text", text: message }], isError: true };
}

/** Load state, run fn(state), persist, and serialize the result. */
function mutate(fn) {
  return async (args) => {
    try {
      const state = loadState();
      const result = fn(state, args ?? {});
      saveState(state);
      return text(result);
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  };
}

/** Read-only variant: no save. */
function query(fn) {
  return async (args) => {
    try {
      return text(fn(loadState(), args ?? {}));
    } catch (err) {
      return fail(String(err?.message ?? err));
    }
  };
}

function depsSatisfied(state, task) {
  return (task.deps ?? []).every(
    (d) => state.tasks.find((t) => t.id === d)?.status === "approved"
  );
}

function taskSummary(state, t) {
  return {
    id: t.id,
    sprintId: t.sprintId,
    title: t.title,
    role: t.role,
    status: t.status,
    deps: t.deps,
    ready: t.status === "todo" && depsSatisfied(state, t),
    claimedBy: t.claimedBy,
  };
}

// ---------------------------------------------------------------------------
// Project plan
// ---------------------------------------------------------------------------

server.registerTool(
  "plan_get",
  {
    description:
      "Get the overall project plan: game name, vision, design pillars, and design notes. " +
      "Read this before planning a sprint or starting any task.",
    inputSchema: {},
  },
  query((state) => state.project)
);

server.registerTool(
  "plan_update",
  {
    description:
      "Update the overall project plan. Only provided fields change. Use after direction/design " +
      "discussions with the user so agents share a single source of truth.",
    inputSchema: {
      name: z.string().optional().describe("Game/project name"),
      vision: z.string().optional().describe("One-paragraph statement of what this game is"),
      pillars: z.array(z.string()).optional().describe("Design pillars every task must respect"),
      designNotes: z
        .string()
        .optional()
        .describe("Freeform running design notes / decisions summary"),
    },
  },
  mutate((state, args) => {
    for (const key of ["name", "vision", "pillars", "designNotes"]) {
      if (args[key] !== undefined) state.project[key] = args[key];
    }
    state.project.updatedAt = new Date().toISOString();
    logEvent(state, "plan_updated", Object.keys(args).join(", "));
    return state.project;
  })
);

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

server.registerTool(
  "sprint_create",
  {
    description:
      "Create a new sprint and make it the active sprint. Do this after the sprint's goal and " +
      "makeup have been agreed with the user.",
    inputSchema: {
      name: z.string().describe("Short sprint name, e.g. 'Sprint 3: Combat feel'"),
      goal: z.string().describe("What must be true at sprint end"),
    },
  },
  mutate((state, { name, goal }) => {
    const open = state.sprints.find((s) => s.status === "active");
    if (open) throw new Error(`Sprint ${open.id} ('${open.name}') is still active. Close it first.`);
    const sprint = {
      id: nextId(state, "sprint"),
      name,
      goal,
      status: "active",
      createdAt: new Date().toISOString(),
      closedAt: null,
      retro: null,
    };
    state.sprints.push(sprint);
    state.activeSprintId = sprint.id;
    logEvent(state, "sprint_created", `${sprint.id}: ${name}`);
    return sprint;
  })
);

server.registerTool(
  "sprint_status",
  {
    description:
      "Full status of a sprint (defaults to the active one): tasks by status, open decisions, and " +
      "what is ready to be worked in parallel. Call this before dispatching agents and when reporting to the user.",
    inputSchema: {
      sprintId: z.string().optional().describe("Sprint id; defaults to the active sprint"),
    },
  },
  query((state, { sprintId }) => {
    const id = sprintId ?? state.activeSprintId;
    if (!id) return { sprint: null, note: "No active sprint. Use sprint_create." };
    const sprint = findOrThrow(state.sprints, id, "Sprint");
    const tasks = state.tasks.filter((t) => t.sprintId === id);
    const decisions = state.decisions.filter((d) => d.sprintId === id && d.status === "open");
    const byStatus = {};
    for (const s of TASK_STATUSES) byStatus[s] = tasks.filter((t) => t.status === s).length;
    return {
      sprint,
      counts: byStatus,
      readyTasks: tasks.filter((t) => t.status === "todo" && depsSatisfied(state, t)).map((t) => taskSummary(state, t)),
      inFlight: tasks
        .filter((t) => ["in_progress", "blocked", "awaiting_approval", "changes_requested"].includes(t.status))
        .map((t) => taskSummary(state, t)),
      openDecisions: decisions,
    };
  })
);

server.registerTool(
  "sprint_list",
  { description: "List all sprints with status.", inputSchema: {} },
  query((state) => state.sprints)
);

server.registerTool(
  "sprint_close",
  {
    description:
      "Close a sprint with a retro summary. Requires user sign-off; unapproved tasks are surfaced " +
      "so the user can decide to carry them over or drop them.",
    inputSchema: {
      sprintId: z.string().optional().describe("Defaults to the active sprint"),
      retro: z.string().describe("Retro summary: what shipped, what slipped, lessons"),
    },
  },
  mutate((state, { sprintId, retro }) => {
    const id = sprintId ?? state.activeSprintId;
    if (!id) throw new Error("No active sprint to close.");
    const sprint = findOrThrow(state.sprints, id, "Sprint");
    const unfinished = state.tasks.filter(
      (t) => t.sprintId === id && !["approved", "dropped"].includes(t.status)
    );
    sprint.status = "closed";
    sprint.closedAt = new Date().toISOString();
    sprint.retro = retro;
    if (state.activeSprintId === id) state.activeSprintId = null;
    logEvent(state, "sprint_closed", id);
    return {
      sprint,
      unfinishedTasks: unfinished.map((t) => taskSummary(state, t)),
      note: unfinished.length
        ? "These tasks are not approved. Move them to the next sprint with task_update, or drop them."
        : "All tasks resolved.",
    };
  })
);

// ---------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------

server.registerTool(
  "task_create",
  {
    description:
      "Create a task in a sprint, assigned to a specialist role. Write acceptance criteria the " +
      "reviewer can verify. Use deps for ordering; independent tasks run in parallel.",
    inputSchema: {
      sprintId: z.string().optional().describe("Defaults to the active sprint"),
      title: z.string(),
      description: z.string().describe("What to build and why, with file/scene pointers if known"),
      role: z
        .string()
        .describe(`Specialist role that should take this. Standard roles: ${ROLES.join(", ")}`),
      acceptance: z.array(z.string()).describe("Checkable acceptance criteria"),
      deps: z.array(z.string()).optional().describe("Task ids that must be approved first"),
    },
  },
  mutate((state, args) => {
    const sprintId = args.sprintId ?? state.activeSprintId;
    if (!sprintId) throw new Error("No active sprint. Create one with sprint_create.");
    findOrThrow(state.sprints, sprintId, "Sprint");
    for (const d of args.deps ?? []) findOrThrow(state.tasks, d, "Dependency task");
    const task = {
      id: nextId(state, "task"),
      sprintId,
      title: args.title,
      description: args.description,
      role: args.role,
      acceptance: args.acceptance,
      deps: args.deps ?? [],
      status: "todo",
      claimedBy: null,
      submission: null,
      feedback: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    state.tasks.push(task);
    logEvent(state, "task_created", `${task.id} [${task.role}] ${task.title}`);
    return task;
  })
);

server.registerTool(
  "task_list",
  {
    description:
      "List tasks with optional filters. readyOnly=true returns unclaimed todo tasks whose " +
      "dependencies are approved — the set that can be dispatched to agents in parallel right now.",
    inputSchema: {
      sprintId: z.string().optional().describe("Defaults to the active sprint"),
      role: z.string().optional(),
      status: z.enum(TASK_STATUSES).optional(),
      readyOnly: z.boolean().optional(),
    },
  },
  query((state, { sprintId, role, status, readyOnly }) => {
    const sid = sprintId ?? state.activeSprintId;
    let tasks = state.tasks.filter((t) => !sid || t.sprintId === sid);
    if (role) tasks = tasks.filter((t) => t.role === role);
    if (status) tasks = tasks.filter((t) => t.status === status);
    if (readyOnly) tasks = tasks.filter((t) => t.status === "todo" && depsSatisfied(state, t));
    return tasks.map((t) => taskSummary(state, t));
  })
);

server.registerTool(
  "task_get",
  {
    description: "Get a task's full detail, including description, acceptance criteria, submission, and feedback history.",
    inputSchema: { taskId: z.string() },
  },
  query((state, { taskId }) => findOrThrow(state.tasks, taskId, "Task"))
);

server.registerTool(
  "task_update",
  {
    description:
      "Edit a task's fields (title, description, role, acceptance, deps, sprintId). Use to reshape " +
      "the plan or carry a task to another sprint. Does not change status.",
    inputSchema: {
      taskId: z.string(),
      title: z.string().optional(),
      description: z.string().optional(),
      role: z.string().optional(),
      acceptance: z.array(z.string()).optional(),
      deps: z.array(z.string()).optional(),
      sprintId: z.string().optional(),
    },
  },
  mutate((state, args) => {
    const task = findOrThrow(state.tasks, args.taskId, "Task");
    if (args.sprintId) findOrThrow(state.sprints, args.sprintId, "Sprint");
    for (const d of args.deps ?? []) {
      if (d === task.id) throw new Error("A task cannot depend on itself.");
      findOrThrow(state.tasks, d, "Dependency task");
    }
    for (const key of ["title", "description", "role", "acceptance", "deps", "sprintId"]) {
      if (args[key] !== undefined) task[key] = args[key];
    }
    task.updatedAt = new Date().toISOString();
    logEvent(state, "task_updated", task.id);
    return task;
  })
);

server.registerTool(
  "task_claim",
  {
    description:
      "Claim a task before working it (sets in_progress). Fails if dependencies are not approved " +
      "or another agent holds it. Also used to resume a changes_requested task.",
    inputSchema: {
      taskId: z.string(),
      agent: z.string().describe("Claiming agent's role/name, e.g. 'gameplay-dev'"),
    },
  },
  mutate((state, { taskId, agent }) => {
    const task = findOrThrow(state.tasks, taskId, "Task");
    if (!["todo", "changes_requested"].includes(task.status)) {
      throw new Error(`Task ${taskId} is '${task.status}', not claimable.`);
    }
    if (!depsSatisfied(state, task)) {
      throw new Error(`Task ${taskId} has unapproved dependencies: ${task.deps.join(", ")}`);
    }
    task.status = "in_progress";
    task.claimedBy = agent;
    task.updatedAt = new Date().toISOString();
    logEvent(state, "task_claimed", `${taskId} by ${agent}`);
    return task;
  })
);

server.registerTool(
  "task_submit",
  {
    description:
      "Submit completed work for approval (sets awaiting_approval). Include everything a reviewer " +
      "needs: what changed, which files/scenes, how acceptance criteria were verified. The user — " +
      "not the submitting agent — approves.",
    inputSchema: {
      taskId: z.string(),
      summary: z.string().describe("What was built and how acceptance criteria were met"),
      files: z.array(z.string()).describe("Files/scenes created or modified"),
      notes: z.string().optional().describe("Caveats, follow-ups, or anything needing attention"),
    },
  },
  mutate((state, { taskId, summary, files, notes }) => {
    const task = findOrThrow(state.tasks, taskId, "Task");
    if (task.status !== "in_progress") {
      throw new Error(`Task ${taskId} is '${task.status}'; only in_progress tasks can be submitted.`);
    }
    task.status = "awaiting_approval";
    task.submission = { summary, files, notes: notes ?? "", submittedAt: new Date().toISOString() };
    task.updatedAt = new Date().toISOString();
    logEvent(state, "task_submitted", taskId);
    return task;
  })
);

server.registerTool(
  "task_approve",
  {
    description:
      "Approve a submitted task. ONLY call after the user has explicitly approved this task in " +
      "conversation — never on an agent's or your own judgment. Approval unblocks dependent tasks.",
    inputSchema: {
      taskId: z.string(),
      feedback: z.string().optional().describe("Optional user feedback to record"),
    },
  },
  mutate((state, { taskId, feedback }) => {
    const task = findOrThrow(state.tasks, taskId, "Task");
    if (task.status !== "awaiting_approval") {
      throw new Error(`Task ${taskId} is '${task.status}', not awaiting_approval.`);
    }
    task.status = "approved";
    if (feedback) task.feedback.push({ at: new Date().toISOString(), verdict: "approved", feedback });
    task.updatedAt = new Date().toISOString();
    logEvent(state, "task_approved", taskId);
    const unblocked = state.tasks.filter(
      (t) => t.status === "todo" && t.deps.includes(taskId) && depsSatisfied(state, t)
    );
    return { task, nowReady: unblocked.map((t) => taskSummary(state, t)) };
  })
);

server.registerTool(
  "task_request_changes",
  {
    description:
      "Send a submitted task back with the user's requested changes (sets changes_requested). " +
      "ONLY call to record the user's verdict, with their feedback.",
    inputSchema: {
      taskId: z.string(),
      feedback: z.string().describe("What must change before resubmission"),
    },
  },
  mutate((state, { taskId, feedback }) => {
    const task = findOrThrow(state.tasks, taskId, "Task");
    if (task.status !== "awaiting_approval") {
      throw new Error(`Task ${taskId} is '${task.status}', not awaiting_approval.`);
    }
    task.status = "changes_requested";
    task.feedback.push({ at: new Date().toISOString(), verdict: "changes_requested", feedback });
    task.updatedAt = new Date().toISOString();
    logEvent(state, "task_changes_requested", taskId);
    return task;
  })
);

server.registerTool(
  "task_drop",
  {
    description: "Drop a task from the plan (user decision only). Fails if other tasks depend on it.",
    inputSchema: { taskId: z.string(), reason: z.string() },
  },
  mutate((state, { taskId, reason }) => {
    const task = findOrThrow(state.tasks, taskId, "Task");
    const dependents = state.tasks.filter(
      (t) => t.deps.includes(taskId) && !["approved", "dropped"].includes(t.status)
    );
    if (dependents.length) {
      throw new Error(
        `Tasks depend on ${taskId}: ${dependents.map((t) => t.id).join(", ")}. Update their deps first.`
      );
    }
    task.status = "dropped";
    task.feedback.push({ at: new Date().toISOString(), verdict: "dropped", feedback: reason });
    task.updatedAt = new Date().toISOString();
    logEvent(state, "task_dropped", `${taskId}: ${reason}`);
    return task;
  })
);

// ---------------------------------------------------------------------------
// Decisions (design calls escalated to the user)
// ---------------------------------------------------------------------------

server.registerTool(
  "decision_request",
  {
    description:
      "Raise a design/direction question that only the user can answer (art direction, mechanics " +
      "trade-offs, scope calls). Agents MUST use this instead of guessing on design-level choices. " +
      "Set blocksTask=true if work cannot continue until answered.",
    inputSchema: {
      question: z.string().describe("The decision needed, with enough context to answer"),
      options: z.array(z.string()).describe("Concrete options with trade-offs"),
      recommendation: z.string().optional().describe("The raising agent's recommendation and why"),
      taskId: z.string().optional().describe("Related task, if any"),
      raisedBy: z.string().describe("Role/name of the agent raising this"),
      blocksTask: z.boolean().optional().describe("If true, the related task is set to blocked"),
    },
  },
  mutate((state, args) => {
    let task = null;
    if (args.taskId) task = findOrThrow(state.tasks, args.taskId, "Task");
    const decision = {
      id: nextId(state, "decision"),
      sprintId: task?.sprintId ?? state.activeSprintId,
      taskId: args.taskId ?? null,
      question: args.question,
      options: args.options,
      recommendation: args.recommendation ?? "",
      raisedBy: args.raisedBy,
      status: "open",
      resolution: null,
      createdAt: new Date().toISOString(),
    };
    state.decisions.push(decision);
    if (args.blocksTask && task && task.status === "in_progress") {
      task.status = "blocked";
      task.updatedAt = new Date().toISOString();
    }
    logEvent(state, "decision_requested", `${decision.id} by ${args.raisedBy}`);
    return decision;
  })
);

server.registerTool(
  "decision_list",
  {
    description: "List decisions. Defaults to open ones — the design calls waiting on the user.",
    inputSchema: { includeResolved: z.boolean().optional() },
  },
  query((state, { includeResolved }) =>
    state.decisions.filter((d) => includeResolved || d.status === "open")
  )
);

server.registerTool(
  "decision_resolve",
  {
    description:
      "Record the user's call on an open decision. ONLY call with the user's actual answer from " +
      "conversation. Unblocks the related task if it was blocked on this.",
    inputSchema: {
      decisionId: z.string(),
      choice: z.string().describe("The user's decision"),
      rationale: z.string().optional().describe("The user's reasoning, for the design record"),
    },
  },
  mutate((state, { decisionId, choice, rationale }) => {
    const decision = findOrThrow(state.decisions, decisionId, "Decision");
    if (decision.status !== "open") throw new Error(`Decision ${decisionId} is already resolved.`);
    decision.status = "resolved";
    decision.resolution = { choice, rationale: rationale ?? "", resolvedAt: new Date().toISOString() };
    let task = null;
    if (decision.taskId) {
      task = state.tasks.find((t) => t.id === decision.taskId);
      const stillBlockedBy = state.decisions.some(
        (d) => d.taskId === decision.taskId && d.status === "open"
      );
      if (task && task.status === "blocked" && !stillBlockedBy) {
        task.status = "in_progress";
        task.updatedAt = new Date().toISOString();
      }
    }
    logEvent(state, "decision_resolved", `${decisionId}: ${choice}`);
    return { decision, task: task ? taskSummary(state, task) : null };
  })
);

// ---------------------------------------------------------------------------
// Review queue + activity
// ---------------------------------------------------------------------------

server.registerTool(
  "review_queue",
  {
    description:
      "Everything waiting on the user right now: submitted tasks awaiting approval and open design " +
      "decisions. Present this to the user item by item and record their verdicts.",
    inputSchema: {},
  },
  query((state) => ({
    awaitingApproval: state.tasks
      .filter((t) => t.status === "awaiting_approval")
      .map((t) => ({
        id: t.id,
        title: t.title,
        role: t.role,
        acceptance: t.acceptance,
        submission: t.submission,
      })),
    openDecisions: state.decisions.filter((d) => d.status === "open"),
  }))
);

server.registerTool(
  "activity_log",
  {
    description: "Recent sprint activity (most recent last). Useful for catching up after a break.",
    inputSchema: { limit: z.number().int().min(1).max(200).optional() },
  },
  query((state, { limit }) => state.events.slice(-(limit ?? 30)))
);

// ---------------------------------------------------------------------------
// Godot
// ---------------------------------------------------------------------------

server.registerTool(
  "godot_check",
  {
    description:
      "Validate the Godot project headlessly. mode 'import' re-imports assets and surfaces " +
      "parse/load errors; 'script-check' checks one .gd file (target); 'run-tests' runs the GUT " +
      "suite if installed. Agents should run this before task_submit. Requires GODOT_BIN to point " +
      `at a Godot 4.6 executable; project dir defaults to '${defaultProjectPath()}' (GODOT_PROJECT_DIR).`,
    inputSchema: {
      mode: z.enum(["import", "script-check", "run-tests"]).optional(),
      projectPath: z.string().optional().describe("Godot project root containing project.godot"),
      target: z.string().optional().describe("res:// or relative path to a .gd file (script-check)"),
    },
  },
  async (args) => {
    const result = godotCheck(args ?? {});
    const body = `ok: ${result.ok}\n${result.output || "(no output)"}`;
    return result.ok ? text(body) : { content: [{ type: "text", text: body }], isError: true };
  }
);

// ---------------------------------------------------------------------------

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(`[godot-sprint] ready — state file: ${statePath()}`);
}

main().catch((err) => {
  console.error("[godot-sprint] fatal:", err);
  process.exit(1);
});
