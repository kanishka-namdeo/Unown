/**
 * tags.ts — the repo-map tag layer (aider's repomap, ported to Bun).
 *
 * A Tag is one def-or-ref fact about a file: where a symbol is DEFINED
 * (`kind: "def"`, e.g. `function greet`) or REFERENCED (`kind: "ref"`, e.g.
 * the `greet(...)` call site in another file). Tags are the atoms the
 * reference graph (graph.ts) is built from — aider's whole insight is that
 * "who references whom" ranks files better than any text heuristic.
 *
 * Extraction has two tiers:
 *   1. tree-sitter (treesitter.ts drives it): per-grammar queries ported
 *      from aider's `queries/tree-sitter-languages/*-tags.scm`, ADAPTED for
 *      web-tree-sitter 0.27 — the doc-comment blocks (`(comment)* @doc .` +
 *      `#strip!`/`#select-adjacent!`) are dropped (the wasm query compiler
 *      rejects those predicates) and the `#not-eq?`/`#not-match?` guards
 *      (which compile but DO NOT filter captures in web-tree-sitter —
 *      verified) are enforced HERE in code instead.
 *   2. regex fallback (this file, pure): per-language def regexes for
 *      grammars we do not vendor (defs only; the graph's self-edge lane
 *      keeps those files ranked). Aider's floor below that is the bare
 *      filename — render.ts handles it.
 *
 * Purity contract: everything in this file is pure (no fs, no pi imports);
 * treesitter.ts injects captures INTO `tagsFromCaptures`.
 */

export interface Tag {
        /** Path relative to the repo root (aider's rel_fname). */
        relFname: string;
        /** 0-based line of the def/ref (aider keeps tree-sitter's row). */
        line: number;
        /** The symbol name (identifier text). */
        name: string;
        kind: "def" | "ref";
}

/** Extension → tree-sitter grammar name (vendored wasm, see
 * native/grammars/). Mirrors aider's grep_ast mapping (.tsx is a real
 * grammar here — the tsx build of tree-sitter-typescript — rather than
 * parsing .tsx with the plain TS grammar). */
const EXT_TO_GRAMMAR: Record<string, string> = {
        ts: "typescript",
        mts: "typescript",
        cts: "typescript",
        tsx: "tsx",
        js: "javascript",
        mjs: "javascript",
        cjs: "javascript",
        jsx: "javascript",
        py: "python",
        pyi: "python",
};

/** Vendored grammars (treesitter.ts refuses anything else — ABI pinning). */
export const VENDORED_GRAMMARS = new Set(["typescript", "tsx", "javascript", "python"]);

export function grammarForExt(ext: string): string | null {
        return EXT_TO_GRAMMAR[ext] ?? null;
}

/** The extension (lowercased, no dot) of a relative path. Pure. */
export function extOf(relFname: string): string {
        const base = relFname.slice(relFname.lastIndexOf("/") + 1);
        const dot = base.lastIndexOf(".");
        if (dot <= 0) return ""; // ".env"-style dotfiles have no extension
        return base.slice(dot + 1).toLowerCase();
}

// ---------------------------------------------------------------------------
// Per-grammar queries (aider's .scm, web-tree-sitter-0.27-compatible)
// ---------------------------------------------------------------------------

/** JavaScript tags (aider javascript-tags.scm minus doc-comment blocks and
 * predicates). `constructor` method defs and `require(...)` call refs are
 * filtered in `tagsFromCaptures` — see the module header. */
const JS_QUERY = `
(method_definition
  name: (property_identifier) @name.definition.method)

(class_declaration
  name: (_) @name.definition.class)

(function_declaration
  name: (identifier) @name.definition.function)

(generator_function_declaration
  name: (identifier) @name.definition.function)

(lexical_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)]))

(variable_declaration
  (variable_declarator
    name: (identifier) @name.definition.function
    value: [(arrow_function) (function_expression)]))

(function_expression
  name: (identifier) @name.definition.function)

(assignment_expression
  left: [
    (identifier) @name.definition.function
    (member_expression
      property: (property_identifier) @name.definition.function)
  ]
  right: [(arrow_function) (function_expression)])

(pair
  key: (property_identifier) @name.definition.function
  value: [(arrow_function) (function_expression)])

(call_expression
  function: (identifier) @name.reference.call)

(call_expression
  function: (member_expression
    property: (property_identifier) @name.reference.call))

(new_expression
  constructor: (_) @name.reference.class)
`;

/** TypeScript tags (aider typescript-tags.scm verbatim — no predicates to
 * strip). The tsx build uses the same query (the grammars share node
 * types; JSX elements simply never match these patterns). */
const TS_QUERY = `
(function_signature
  name: (identifier) @name.definition.function)

(method_signature
  name: (property_identifier) @name.definition.method)

(abstract_method_signature
  name: (property_identifier) @name.definition.method)

(abstract_class_declaration
  name: (type_identifier) @name.definition.class)

(internal_module
  name: (identifier) @name.definition.module)

(interface_declaration
  name: (type_identifier) @name.definition.interface)

(type_annotation
  (type_identifier) @name.reference.type)

(new_expression
  constructor: (identifier) @name.reference.class)

(function_declaration
  name: (identifier) @name.definition.function)

(method_definition
  name: (property_identifier) @name.definition.method)

(class_declaration
  name: (type_identifier) @name.definition.class)

(type_alias_declaration
  name: (type_identifier) @name.definition.type)

(enum_declaration
  name: (identifier) @name.definition.enum)
`;

/** Python tags (aider python-tags.scm verbatim). */
const PY_QUERY = `
(class_definition
  name: (identifier) @name.definition.class)

(function_definition
  name: (identifier) @name.definition.function)

(call
  function: [
      (identifier) @name.reference.call
      (attribute
        attribute: (identifier) @name.reference.call)
  ])
`;

/** The per-grammar query sources (grammar name → query). */
export const TREE_SITTER_QUERIES: Record<string, string> = {
        javascript: JS_QUERY,
        typescript: TS_QUERY,
        tsx: TS_QUERY,
        python: PY_QUERY,
};

/** The minimal capture shape treesitter.ts feeds in (decoupled from the
 * web-tree-sitter node type so tests can drive the projection hermetically). */
export interface RawCapture {
        name: string;
        node: {
                startPosition: { row: number };
                text: string;
        };
}

/** Method-definition names that are language noise, not symbols (aider's
 * `#not-eq? "constructor"` guard, enforced in code — web-tree-sitter
 * compiles `#not-eq?` but does not filter captures). */
const NOISE_DEF_NAMES = new Set(["constructor"]);

/** Call-reference names that are loader noise (aider's `#not-match?
 * ^(require)$` guard, same story). */
const NOISE_REF_NAMES = new Set(["require"]);

/** Project web-tree-sitter captures into Tags (pure). Capture names follow
 * aider's grammar: `name.definition.*` → def, `name.reference.*` → ref;
 * anything else is ignored. The noise filters land here because the
 * `#not-eq?`/`#not-match?` predicates do not filter under web-tree-sitter
 * (verified against 0.27.1 — see module header). */
export function tagsFromCaptures(relFname: string, captures: RawCapture[]): Tag[] {
        const tags: Tag[] = [];
        for (const cap of captures) {
                if (!cap.name.startsWith("name.definition.") && !cap.name.startsWith("name.reference.")) continue;
                const name = cap.node.text;
                if (!name) continue;
                const kind: "def" | "ref" = cap.name.startsWith("name.definition.") ? "def" : "ref";
                if (kind === "def" && NOISE_DEF_NAMES.has(name)) continue;
                if (kind === "ref" && NOISE_REF_NAMES.has(name)) continue;
                tags.push({ relFname, line: cap.node.startPosition.row, name, kind });
        }
        return tags;
}

// ---------------------------------------------------------------------------
// Regex fallback (defs only — for grammars we do not vendor)
// ---------------------------------------------------------------------------

/** One def-extraction rule: a regex whose group 1 is the symbol name. */
export interface FallbackRule {
        exts: string[];
        /** Matched per line; must capture the name in group 1. */
        def: RegExp;
}

/** Per-language def regexes (the research's fallback set). Anchored to line
 * start, tolerant of leading whitespace and export/visibility prefixes.
 * These are deliberately conservative: a missed def costs one map line; a
 * false positive costs a misleading line, so patterns require the classic
 * keyword shapes. */
export const REGEX_FALLBACK_RULES: FallbackRule[] = [
        { exts: ["go"], def: /^func\s+(?:\([^)]*\)\s*)?([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["rs"], def: /^\s*(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?(?:extern\s+"[^"]*"\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["rs"], def: /^\s*(?:pub\s+)?(?:struct|enum|trait|mod|type)\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["java"], def: /^\s*(?:public|private|protected|static|final|abstract|synchronized|native|\s)*\s*(?:class|interface|enum|record)\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["rb"], def: /^\s*def\s+([A-Za-z_][A-Za-z0-9_]*[?!=]?)/ },
        { exts: ["rb"], def: /^\s*(?:class|module)\s+([A-Z][A-Za-z0-9_]*)/ },
        { exts: ["php"], def: /^\s*(?:public|private|protected|static|abstract|final|\s)*function\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["cs"], def: /^\s*(?:public|private|protected|internal|static|sealed|abstract|async|partial|readonly|\s)*\s*(?:class|interface|record|struct|enum)\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["swift"], def: /^\s*(?:public|private|internal|fileprivate|open|final|static|class|\s)*func\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["kt"], def: /^\s*(?:public|private|internal|protected|open|abstract|final|sealed|data|inline|\s)*fun\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["kt"], def: /^\s*(?:public|private|internal|protected|open|abstract|sealed|data|\s)*(?:class|object|interface)\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["scala"], def: /^\s*(?:private\[[^\]]*\]\s+)?(?:final\s+)?(?:sealed\s+)?(?:abstract\s+)?(?:case\s+)?class\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["scala"], def: /^\s*(?:private\[[^\]]*\]\s+)?(?:final\s+)?def\s+([A-Za-z_][A-Za-z0-9_]*)/ },
        { exts: ["sh", "bash"], def: /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\)\s*\{/ },
        { exts: ["lua"], def: /^\s*(?:local\s+)?function\s+([A-Za-z_][A-Za-z0-9_.]*)/ },
        { exts: ["ex", "exs"], def: /^\s*def(?:p|module)?\s+([A-Za-z_][A-Za-z0-9_?!]*)/ },
        { exts: ["c", "h", "cpp", "cc", "hpp"], def: /^\s*(?:class|struct|enum|namespace)\s+([A-Za-z_][A-Za-z0-9_]*)/ },
];

/** Extract def tags with the regex fallback (pure, defs only — no refs;
 * the graph's self-edge lane keeps def-only files ranked). Caps matches
 * per file to bound pathological inputs (minified files, vendored dumps). */
export function regexFallbackTags(relFname: string, code: string, maxDefs = 400): Tag[] {
        const ext = extOf(relFname);
        const rules = REGEX_FALLBACK_RULES.filter((r) => r.exts.includes(ext));
        if (rules.length === 0) return [];
        const tags: Tag[] = [];
        const lines = code.split("\n");
        for (let i = 0; i < lines.length && tags.length < maxDefs; i++) {
                for (const rule of rules) {
                        const m = rule.def.exec(lines[i]);
                        if (m?.[1]) {
                                tags.push({ relFname, line: i, name: m[1], kind: "def" });
                                break; // first matching rule wins per line
                        }
                }
        }
        return tags;
}

/** Aider's "looks meaningful" heuristic (edge-weight multiplier ×10): mixed
 * case / snake_case / kebab-case AND length ≥ 8 — i.e. identifiers that
 * carry real semantics, not `x`, `foo`, `data`. Pure. */
export function looksMeaningful(ident: string): boolean {
        if (ident.length < 8) return false;
        return /^(.*[a-z].*[_A-Z].*|.*[_-].*)$/.test(ident) && !/^[A-Z0-9_]+$/.test(ident);
}
