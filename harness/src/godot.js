import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

function godotBinary() {
  return process.env.GODOT_BIN || "godot";
}

export function defaultProjectPath() {
  return process.env.GODOT_PROJECT_DIR || "game";
}

function run(args, timeoutMs) {
  const result = spawnSync(godotBinary(), args, {
    encoding: "utf8",
    timeout: timeoutMs,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.error) {
    if (result.error.code === "ENOENT") {
      return {
        ok: false,
        output:
          `Godot binary '${godotBinary()}' not found. Set GODOT_BIN to the ` +
          `path of your Godot 4.6 executable (headless-capable) and retry.`,
      };
    }
    return { ok: false, output: `Failed to run Godot: ${result.error.message}` };
  }
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  return { ok: result.status === 0, exitCode: result.status, output };
}

export function godotCheck({ projectPath, mode, target }) {
  const proj = path.resolve(projectPath || defaultProjectPath());
  if (!fs.existsSync(path.join(proj, "project.godot"))) {
    return {
      ok: false,
      output:
        `No project.godot found in '${proj}'. Pass projectPath or set ` +
        `GODOT_PROJECT_DIR to the Godot project root.`,
    };
  }

  switch (mode) {
    case "script-check": {
      if (!target) return { ok: false, output: "mode 'script-check' requires 'target' (a .gd file)." };
      return run(["--headless", "--path", proj, "--check-only", "-s", target], 60_000);
    }
    case "run-tests": {
      if (fs.existsSync(path.join(proj, "addons", "gut"))) {
        return run(
          ["--headless", "--path", proj, "-s", "res://addons/gut/gut_cmdln.gd", "-gexit"],
          10 * 60_000
        );
      }
      return {
        ok: false,
        output: "No test framework found (expected addons/gut). Install GUT or run scene-level checks instead.",
      };
    }
    case "import":
    default:
      // Re-imports assets and surfaces parse/load errors without opening the editor.
      return run(["--headless", "--path", proj, "--import"], 5 * 60_000);
  }
}
