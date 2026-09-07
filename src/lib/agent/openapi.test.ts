import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { agentOpenApi } from "./openapi";

// The spec is hand-written; this keeps it honest. Every route file under
// src/app/api/agent must have a matching path + method here, and the spec
// must not describe an endpoint that does not exist.

const ROOT = join(process.cwd(), "src/app/api/agent");

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (name === "route.ts") out.push(full);
  }
  return out;
}

function routesOnDisk(): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>();
  for (const file of walk(ROOT)) {
    const rel = file.slice(ROOT.length, -"/route.ts".length).replace(/\[([^\]]+)\]/g, "{$1}") || "/";
    const src = readFileSync(file, "utf8");
    const methods = new Set(
      [...src.matchAll(/export (?:const|async function) (GET|POST|PATCH|PUT|DELETE)\b/g)].map((m) => m[1].toLowerCase()),
    );
    map.set(rel, methods);
  }
  return map;
}

describe("agent OpenAPI spec", () => {
  const disk = routesOnDisk();
  const spec = agentOpenApi.paths as Record<string, Record<string, unknown>>;

  it("describes every route file and method", () => {
    const missing: string[] = [];
    for (const [path, methods] of disk) {
      for (const m of methods) if (!spec[path]?.[m]) missing.push(`${m.toUpperCase()} ${path}`);
    }
    expect(missing).toEqual([]);
  });

  it("describes nothing that does not exist", () => {
    const phantom: string[] = [];
    for (const [path, ops] of Object.entries(spec)) {
      for (const m of Object.keys(ops)) if (!disk.get(path)?.has(m)) phantom.push(`${m.toUpperCase()} ${path}`);
    }
    expect(phantom).toEqual([]);
  });

  it("requires both credentials on every operation", () => {
    expect(agentOpenApi.security).toEqual([{ agentKey: [], onBehalfOf: [] }]);
    expect(Object.keys(agentOpenApi.components.securitySchemes)).toEqual(["agentKey", "onBehalfOf"]);
  });

  it("has more than a handful of routes on disk (the walker works)", () => {
    expect(disk.size).toBeGreaterThan(20);
  });
});
