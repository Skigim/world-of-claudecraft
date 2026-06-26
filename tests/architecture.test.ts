import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

// Enforces the two load-bearing src/sim invariants from the root CLAUDE.md as a
// real, always-on check instead of convention-only prose: the sim is the
// host-agnostic deterministic core, so it imports nothing from render/ui/game/net
// or Three.js, touches no DOM/browser globals, and draws no randomness or time
// from outside its seeded Rng + sim clock. A violation here means the same
// src/sim code can no longer run unchanged in Node, the browser, and the RL env,
// or that same-seed-same-world determinism is broken. Keep this green.

const repoRoot = fileURLToPath(new URL('..', import.meta.url));
const simRoot = join(repoRoot, 'src', 'sim');

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts') && !name.endsWith('.d.ts')) out.push(full);
  }
  return out;
}

// Blank out comments while preserving line count and column positions, so prose
// (a code comment that names Math.random, or "the search window") cannot create a
// false positive. String literals are left intact: the dotted patterns matched
// below (Math.random, window., ...) do not appear inside the sim's player text.
function stripComments(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '))
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// A specifier a host-agnostic sim file must never import. Returns the offending
// layer/package, or null when the import is allowed.
function forbiddenImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(render|ui|game|net)\//);
  return layer ? layer[1] : null;
}

const IMPORT_RE = /\b(?:import|export)\b[^;'"]*?\bfrom\s*['"]([^'"]+)['"]/g;
const DYN_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
const DOM_GLOBAL_RE = /\b(document|window|navigator|localStorage|sessionStorage)\s*[.[]/;
const NONDETERMINISM_RE = /\b(Math\.random|Date\.now|performance\.now)\b/;

const simFiles = walk(simRoot);

function scanLines(re: RegExp, files: string[] = simFiles): string[] {
  const violations: string[] = [];
  for (const file of files) {
    const lines = stripComments(readFileSync(file, 'utf8')).split('\n');
    lines.forEach((line, i) => {
      if (re.test(line)) violations.push(`${relative(repoRoot, file)}:${i + 1}  ${line.trim()}`);
    });
  }
  return violations;
}

describe('src/sim architecture invariants', () => {
  it('finds the sim source tree', () => {
    expect(simFiles.length).toBeGreaterThan(10);
  });

  it('imports nothing from render/ui/game/net or three (host-agnostic core)', () => {
    const violations: string[] = [];
    for (const file of simFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const specs: string[] = [];
      for (const m of src.matchAll(IMPORT_RE)) specs.push(m[1]);
      for (const m of src.matchAll(DYN_IMPORT_RE)) specs.push(m[1]);
      for (const spec of specs) {
        const bad = forbiddenImport(spec);
        if (bad) violations.push(`${relative(repoRoot, file)} imports '${spec}' (${bad})`);
      }
    }
    expect(violations, `src/sim must stay host-agnostic:\n${violations.join('\n')}`).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(DOM_GLOBAL_RE);
    expect(violations, `src/sim must run headless (no DOM globals):\n${violations.join('\n')}`).toEqual([]);
  });

  it('draws no randomness or wall-clock time outside Rng + the sim clock', () => {
    const violations = scanLines(NONDETERMINISM_RE);
    expect(
      violations,
      `all sim randomness/time goes through Rng (src/sim/rng.ts) and the sim clock:\n${violations.join('\n')}`,
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// IWorld seam purity (W1b). The seam render/ui depend on is src/world_api.ts (the
// aggregate interface + the COMMAND_NAMES wire table) plus every facet interface
// under src/world_api/. W1 split IWorld into those files as a string-free,
// TYPE-ONLY boundary: every host (render/ui/game/net) and the server talk to the
// world ONLY through it, so it sits ABOVE them and must import nothing from
// render/ui/game/net/server (or DOM/Three), pull only TYPES from src/sim (a value
// sim import would drag the deterministic engine into the seam), and run no
// i18n/UI logic (no t()/tSim()/tServer()). Without this scan the facet files'
// purity is convention-only; a later W6-W10 re-home could add a net/ui import or a
// t() call to a facet and no gate would redden. This closes that gap. The two
// blessed value sites are COMMAND_NAMES (world_api.ts) and OVERHEAD_EMOTES +
// isOverheadEmoteId (chat.ts); string literals are NOT banned (only imports + DOM
// + i18n calls are), and the one sanctioned runtime sim import is chat.ts pulling
// OVERHEAD_EMOTE_IDS to back its isOverheadEmoteId guard.

const worldApiEntry = join(repoRoot, 'src', 'world_api.ts');
const worldApiRoot = join(repoRoot, 'src', 'world_api');
const worldApiFiles = [worldApiEntry, ...walk(worldApiRoot)];

// IMPORT_RE, widened with a leading binding-clause capture (group 1) so the seam
// pass can tell a type-only sim import (`import type {T}` or every specifier
// inline `type`-prefixed) from a value one. Group 2 is the module specifier.
const SEAM_IMPORT_RE = /\b(?:import|export)\b([^;'"]*?)\bfrom\s*['"]([^'"]+)['"]/g;

// i18n / runtime-UI calls the type-only seam must never make.
const I18N_CALL_RE = /\b(?:tSim|tServer|t)\s*\(/;

// A specifier the IWorld seam must never import: the host layers, the server, and
// Three. The seam sits above all of them (they depend on it, never the reverse).
// Returns the offending layer/package, or null when the import is allowed.
function forbiddenSeamImport(spec: string): string | null {
  if (spec === 'three' || spec.startsWith('three/')) return 'three';
  const layer = spec.match(/(?:^|\/)(render|ui|game|net|server)\//);
  return layer ? layer[1] : null;
}

// True when the specifier resolves into src/sim (`../sim/...`, `./sim/...`).
function isSimSpecifier(spec: string): boolean {
  return /(?:^|\/)sim\//.test(spec);
}

// The runtime (value) bindings an import clause brings in. Empty for a type-only
// import: a statement-level `import type {...}`, or a named import whose every
// specifier is inline `type`-prefixed. Returns SOURCE names (the part before
// `as`), for allowlist matching and reporting.
function runtimeBindings(clause: string): string[] {
  const trimmed = clause.trim();
  if (trimmed === 'type' || trimmed.startsWith('type ')) return [];
  const brace = trimmed.match(/\{([^}]*)\}/);
  const names = brace
    ? brace[1]
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    : trimmed
      ? [trimmed]
      : [];
  return names
    .filter((n) => n !== 'type' && !n.startsWith('type '))
    .map((n) => n.split(/\s+as\s+/)[0].trim());
}

// The ONLY sanctioned runtime sim import on the seam, keyed by repo-relative file:
// chat.ts pulls OVERHEAD_EMOTE_IDS to back its isOverheadEmoteId guard. Any OTHER
// value sim import, in chat.ts or any other facet, still reddens the gate, so this
// is a per-site allowlist, not a blanket file-level exemption.
const SANCTIONED_VALUE_SIM_IMPORTS: Record<string, ReadonlySet<string>> = {
  'src/world_api/chat.ts': new Set(['OVERHEAD_EMOTE_IDS']),
};

describe('src/world_api IWorld seam purity invariants', () => {
  it('finds the IWorld seam (world_api.ts + every facet file)', () => {
    expect(worldApiFiles).toContain(worldApiEntry);
    // world_api.ts + the 20 facet files; tolerant of the seam growing.
    expect(worldApiFiles.length).toBeGreaterThanOrEqual(20);
  });

  it('imports nothing from render/ui/game/net/server or three (the seam sits above them)', () => {
    const violations: string[] = [];
    for (const file of worldApiFiles) {
      const src = stripComments(readFileSync(file, 'utf8'));
      const specs: string[] = [];
      for (const m of src.matchAll(SEAM_IMPORT_RE)) specs.push(m[2]);
      for (const m of src.matchAll(DYN_IMPORT_RE)) specs.push(m[1]);
      for (const spec of specs) {
        const bad = forbiddenSeamImport(spec);
        if (bad) violations.push(`${relative(repoRoot, file)} imports '${spec}' (${bad})`);
      }
    }
    expect(violations, `the IWorld seam must stay layer-agnostic:\n${violations.join('\n')}`).toEqual([]);
  });

  it('pulls only TYPES from src/sim (a value sim import would drag the engine into the seam)', () => {
    const violations: string[] = [];
    for (const file of worldApiFiles) {
      const rel = relative(repoRoot, file);
      const allowed = SANCTIONED_VALUE_SIM_IMPORTS[rel] ?? new Set<string>();
      const src = stripComments(readFileSync(file, 'utf8'));
      for (const m of src.matchAll(SEAM_IMPORT_RE)) {
        const [, clause, spec] = m;
        if (!isSimSpecifier(spec)) continue;
        for (const name of runtimeBindings(clause)) {
          if (!allowed.has(name)) {
            violations.push(`${rel} value-imports '${name}' from '${spec}' (sim imports must be type-only)`);
          }
        }
      }
    }
    expect(
      violations,
      `the IWorld seam imports src/sim for TYPES only (use \`import type\`):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('makes no t()/tSim()/tServer() i18n call (no runtime UI logic on the type-only seam)', () => {
    const violations = scanLines(I18N_CALL_RE, worldApiFiles);
    expect(
      violations,
      `the IWorld seam is i18n-free (render/ui localize on their side):\n${violations.join('\n')}`,
    ).toEqual([]);
  });

  it('touches no DOM/browser globals', () => {
    const violations = scanLines(DOM_GLOBAL_RE, worldApiFiles);
    expect(violations, `the IWorld seam must run headless (no DOM globals):\n${violations.join('\n')}`).toEqual([]);
  });
});
