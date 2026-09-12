import fs from "node:fs";
import path from "node:path";

const STATE_DIR = process.env.SPRINT_STATE_DIR
  ? path.resolve(process.env.SPRINT_STATE_DIR)
  : path.resolve(process.cwd(), ".sprint");
const STATE_FILE = path.join(STATE_DIR, "state.json");

const EMPTY_STATE = {
  project: {
    name: "",
    vision: "",
    pillars: [],
    designNotes: "",
    updatedAt: null,
  },
  activeSprintId: null,
  sprints: [],
  tasks: [],
  decisions: [],
  events: [],
  counters: { sprint: 0, task: 0, decision: 0 },
};

export function loadState() {
  if (!fs.existsSync(STATE_FILE)) {
    return structuredClone(EMPTY_STATE);
  }
  const raw = fs.readFileSync(STATE_FILE, "utf8");
  const state = JSON.parse(raw);
  // Backfill fields added after older state files were written.
  return { ...structuredClone(EMPTY_STATE), ...state };
}

export function saveState(state) {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const tmp = STATE_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(state, null, 2) + "\n");
  fs.renameSync(tmp, STATE_FILE);
}

export function logEvent(state, type, detail) {
  state.events.push({ at: new Date().toISOString(), type, detail });
  if (state.events.length > 500) state.events.splice(0, state.events.length - 500);
}

export function nextId(state, kind) {
  const prefix = { sprint: "S", task: "T", decision: "D" }[kind];
  state.counters[kind] += 1;
  return `${prefix}${state.counters[kind]}`;
}

export function findOrThrow(list, id, kind) {
  const item = list.find((x) => x.id === id);
  if (!item) throw new Error(`${kind} '${id}' not found`);
  return item;
}

export function statePath() {
  return STATE_FILE;
}
