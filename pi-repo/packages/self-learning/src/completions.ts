/**
 * completions.ts — `unown completions <shell>`: static completion scripts.
 *
 * The command surface is small and static, so generated-per-invocation
 * scripts (deno/Cobra style) buy nothing over checked-in templates: these
 * are literal strings validated by tests, one per shell — bash, zsh, fish,
 * powershell. All ASCII, LF endings, no shell execution at install time
 * (the user pipes/evals them by choice; docs show both the eval one-liner
 * and the write-to-file form).
 *
 * Test contract: every script must mention every CLI command word; the
 * powershell one must be ASCII-safe for the ISE codepage (no smart quotes).
 */

const COMMANDS = [
	"setup",
	"providers",
	"models",
	"init",
	"init-agents",
	"memory",
	"doctor",
	"doctor-instructions",
	"mcp",
	"automations",
	"engine",
	"repomap",
	"usage",
	"webcache",
	"sessions",
	"blame",
	"recipes",
	"wiki",
	"delegations",
	"watch",
	"acp",
	"dashboard",
	"note",
	"update",
	"changelog",
	"info",
	"completions",
	"uninstall",
	"help",
] as const;

const MCP_SUBCOMMANDS = ["add", "add-http", "add-json", "list", "get", "remove", "test", "elicitation"];
const AUTOMATIONS_SUBCOMMANDS = ["list", "create", "edit", "pause", "resume", "run", "history", "delete"];
const SESSIONS_SUBCOMMANDS = ["list", "export", "import"];
const RECIPES_SUBCOMMANDS = ["list", "run", "create", "validate"];
const WIKI_SUBCOMMANDS = ["generate", "search", "list", "show"];
const WATCH_SUBCOMMANDS = ["list", "run", "roots"];
const WEBCACHE_SUBCOMMANDS = ["stats", "clear", "sweep"];
const PROVIDERS_SUBCOMMANDS = ["list", "add", "remove", "key", "default", "test", "refresh"];
const ENGINE_SUBCOMMANDS = ["status", "start", "stop", "restart", "repair", "serve"];

const UPDATE_FLAGS = [
	"--check",
	"--json",
	"--allow-dirty",
	"--rollback",
	"--dry-run",
	"--skip",
	"--unskip",
	"--snooze",
	"--help",
];
const SESSION_FLAGS = [
	"-p",
	"--print",
	"--plan",
	"--goal",
	"--verbose",
	"--mode",
	"--output-format",
	"--tools",
	"--append-system-prompt",
	"--no-session",
	"--session",
	"--model",
	"--effort",
	"--mcp-servers",
	"--no-agents-md",
	"--provider",
	"--no-split",
];

export const COMPLETIONS_HELP = `unown completions <shell> — print a completion script

Usage:
  unown completions bash        bash completion (stdout)
  unown completions zsh         zsh completion
  unown completions fish        fish completion
  unown completions powershell  PowerShell Register-ArgumentCompleter

Install (bash):   unown completions bash > ~/.local/share/bash-completion/completions/unown
Install (zsh):    unown completions zsh > ~/.zfunc/_unown (and enable compinit)
Install (fish):   unown completions fish > ~/.config/fish/completions/unown.fish
Install (pwsh):   unown completions powershell >> $PROFILE`;

export function cmdCompletions(argv: string[], ctx: { log?: (l: string) => void } = {}): number {
	const log = ctx.log ?? ((l: string) => console.log(l));
	const shell = argv[0];
	switch (shell) {
		case "bash":
			log(bashCompletion());
			return 0;
		case "zsh":
			log(zshCompletion());
			return 0;
		case "fish":
			log(fishCompletion());
			return 0;
		case "powershell":
			log(powershellCompletion());
			return 0;
		case "-h":
		case "--help":
			// clig.dev: --help never RUNS the command (audit 2-b F3 —
			// `completions --help` used to error "unknown shell").
			log(COMPLETIONS_HELP);
			return 0;
		case undefined:
			log("usage: unown completions bash|zsh|fish|powershell");
			return 1;
		default:
			log(`unown completions: unknown shell "${shell}" (bash, zsh, fish, powershell)`);
			return 1;
	}
}

export function bashCompletion(): string {
	return [
		"# bash completion for unown",
		"# install: unown completions bash > ~/.local/share/bash-completion/completions/unown",
		"_unown_completions() {",
		"  local cur prev",
		// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable syntax inside the emitted script, not a TS template
		'  cur="${COMP_WORDS[COMP_CWORD]}"',
		// biome-ignore lint/suspicious/noTemplateCurlyInString: bash variable syntax inside the emitted script, not a TS template
		'  prev="${COMP_WORDS[COMP_CWORD-1]}"',
		`  local commands="${COMMANDS.join(" ")}"`,
		`  local flags="${SESSION_FLAGS.join(" ")} --help --version"`,
		`  local update_flags="${UPDATE_FLAGS.join(" ")}"`,
		"  if [[ $COMP_CWORD -eq 1 ]]; then",
		'    COMPREPLY=( $(compgen -W "$commands $flags" -- "$cur") )',
		"    return 0",
		"  fi",
		'  case "$prev" in',
		"    update)",
		'      COMPREPLY=( $(compgen -W "$update_flags" -- "$cur") )',
		"      return 0",
		"      ;;",
		"    mcp)",
		`      COMPREPLY=( $(compgen -W "${MCP_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    providers)",
		`      COMPREPLY=( $(compgen -W "${PROVIDERS_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    engine)",
		`      COMPREPLY=( $(compgen -W "${ENGINE_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    automations)",
		`      COMPREPLY=( $(compgen -W "${AUTOMATIONS_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    sessions)",
		`      COMPREPLY=( $(compgen -W "${SESSIONS_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    recipes)",
		`      COMPREPLY=( $(compgen -W "${RECIPES_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    wiki)",
		`      COMPREPLY=( $(compgen -W "${WIKI_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    webcache)",
		`      COMPREPLY=( $(compgen -W "${WEBCACHE_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    watch)",
		`      COMPREPLY=( $(compgen -W "${WATCH_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
		"      return 0",
		"      ;;",
		"    completions)",
		'      COMPREPLY=( $(compgen -W "bash zsh fish powershell" -- "$cur") )',
		"      return 0",
		"      ;;",
		"  esac",
		"  return 0",
		"}",
		"complete -F _unown_completions unown",
	].join("\n");
}

export function zshCompletion(): string {
	return [
		"#compdef unown",
		"# zsh completion for unown",
		"# install: unown completions zsh > ~/.zfunc/_unown (and enable compinit)",
		"_unown() {",
		"  local -a commands",
		"  commands=(",
		'    "setup:connect a model provider (wizard or flags)"',
		'    "providers:manage the multi-provider registry (list/add/remove/key/default/test/refresh)"',
		'    "models:list configured models"',
		'    "init:scaffold .unown project memory"',
		'    "init-agents:generate/update AGENTS.md from repo forensics"',
		'    "memory:print the effective memory stack"',
		'    "doctor:run configuration diagnostics"',
		'    "doctor-instructions:audit the instruction set (skills, MCP, hooks)"',
		'    "mcp:manage MCP server configs (add/list/get/remove/test/elicitation)"',
		'    "automations:scheduled recurring agent runs (list/create/edit/pause/resume/run/history/delete)"',
		'    "engine:detached engine supervision (status/start/stop/repair/serve)"',
		'    "usage:token & cost report for the LLM bridge (--days/--model/--json)"',
		'    "webcache:inspect the web results store (stats/clear/sweep)"',
		'    "sessions:session transfer (list/export/import)"',
		'    "blame:receipts-backed blame (which sessions touched a file)"',
		'    "recipes:declarative instruction bundles (list/run/create/validate)"',
		'    "wiki:auto-generated repo wiki (generate/search/list/show)"',
		'    "watch:AI comments in code, resolved by the engine (list/run/roots)"',
		'    "acp:run the ACP editor server on stdio (Zed et al.)"',
		'    "dashboard:the TUI mission control (fullscreen; alias dash)"',
		'    "note:deliver a session note to the engine"',
		'    "update:self-update to the newest release"',
		'    "changelog:print recent CHANGELOG sections"',
		'    "info:print the support bundle"',
		'    "completions:print shell completion scripts"',
		'    "uninstall:remove the unown CLI"',
		'    "help:per-command help pages"',
		"  )",
		"  _arguments \\",
		'    "1: :->command" \\',
		'    "-p[one-shot print mode]" \\',
		'    "--plan[read-only plan mode]" \\',
		'    "--verbose[verbose decisions on stderr]" \\',
		'    "--mode[output mode]:mode:(json text)" \\',
		'    "--output-format[print-mode result format]:format:(json text)" \\',
		'    "--session[resume a specific session file]:session file:" \\',
		'    "--model[route the session to a model id]" \\',
		'    "--effort[thinking effort]:effort:(low medium high)" \\',
		'    "--mcp-servers[MCP server whitelist (csv, empty = none)]" \\',
		'    "--no-agents-md[skip AGENTS.md/memory injection]" \\',
		'    "--provider[pin the session provider]:provider:" \\',
		'    "--no-split[start bare, ignoring saved split-view defaults]" \\',
		'    "--version[print the version]" \\',
		'    "--help[help text]"',
		"  case $state in",
		"    command)",
		"      _describe 'command' commands",
		"      ;;",
		"  esac",
		"  case $words[1] in",
		"    update)",
		'      _arguments "--check[report only]" "--json[machine-readable]" "--allow-dirty[autostash]" "--rollback[undo last update]" "--dry-run[resolve and print only]" "--skip[stop showing a version]" "--unskip[clear skip and snooze]" "--snooze[silence notices for a duration]:duration:" "*:version:"',
		"      ;;",
		"    mcp)",
		`      _arguments "1:subcommand:(${MCP_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    providers)",
		`      _arguments "1:subcommand:(${PROVIDERS_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    engine)",
		`      _arguments "1:subcommand:(${ENGINE_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    automations)",
		`      _arguments "1:subcommand:(${AUTOMATIONS_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    sessions)",
		`      _arguments "1:subcommand:(${SESSIONS_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    recipes)",
		`      _arguments "1:subcommand:(${RECIPES_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    wiki)",
		`      _arguments "1:subcommand:(${WIKI_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    watch)",
		`      _arguments "1:subcommand:(${WATCH_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    webcache)",
		`      _arguments "1:subcommand:(${WEBCACHE_SUBCOMMANDS.join(" ")})"`,
		"      ;;",
		"    completions)",
		'      _arguments "1:shell:(bash zsh fish powershell)"',
		"      ;;",
		"  esac",
		"}",
		'_unown "$@"',
	].join("\n");
}

export function fishCompletion(): string {
	const lines = [
		"# fish completion for unown",
		"# install: unown completions fish > ~/.config/fish/completions/unown.fish",
	];
	for (const cmd of COMMANDS) {
		lines.push(`complete -c unown -n "__fish_use_subcommand" -a "${cmd}"`);
	}
	for (const flag of [...SESSION_FLAGS, "--help", "--version"]) {
		// fish: single-char flags use -s, long flags use -l (audit 2-b D1 —
		// `-p` used to be emitted as `-l p`, an uncompletable long flag).
		const short = /^-[a-zA-Z0-9]$/.test(flag);
		const name = flag.replace(/^-+/, "");
		lines.push(short ? `complete -c unown -s ${name} -d "${flag}"` : `complete -c unown -l ${name} -d "${flag}"`);
	}
	for (const flag of UPDATE_FLAGS) {
		lines.push(
			`complete -c unown -n "__fish_seen_subcommand_from update" -l ${flag.replace(/^-+/, "")} -d "${flag}"`,
		);
	}
	lines.push('complete -c unown -n "__fish_seen_subcommand_from completions" -a "bash zsh fish powershell"');
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from mcp" -a "${MCP_SUBCOMMANDS.join(" ")}"`);
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from providers" -a "${PROVIDERS_SUBCOMMANDS.join(" ")}"`);
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from engine" -a "${ENGINE_SUBCOMMANDS.join(" ")}"`);
	lines.push(
		`complete -c unown -n "__fish_seen_subcommand_from automations" -a "${AUTOMATIONS_SUBCOMMANDS.join(" ")}"`,
	);
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from sessions" -a "${SESSIONS_SUBCOMMANDS.join(" ")}"`);
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from recipes" -a "${RECIPES_SUBCOMMANDS.join(" ")}"`);
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from wiki" -a "${WIKI_SUBCOMMANDS.join(" ")}"`);
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from watch" -a "${WATCH_SUBCOMMANDS.join(" ")}"`);
	lines.push(`complete -c unown -n "__fish_seen_subcommand_from webcache" -a "${WEBCACHE_SUBCOMMANDS.join(" ")}"`);
	return lines.join("\n");
}

export function powershellCompletion(): string {
	const cmds = COMMANDS.join("','");
	return [
		"# PowerShell completion for unown",
		"# install: unown completions powershell >> $PROFILE",
		"Register-ArgumentCompleter -Native -CommandName unown -ScriptBlock {",
		"    param($wordToComplete)",
		`    $commands = @('${cmds}')`,
		"    $flags = @('-p','--print','--plan','--verbose','--mode','--output-format','--session','--model','--effort','--mcp-servers','--no-agents-md','--provider','--no-split','--help','--version')",
		"    $updateFlags = @('--check','--json','--allow-dirty','--rollback','--dry-run','--skip','--unskip','--snooze')",
		"    $completions = @()",
		"    if ($wordToComplete -like '--*') {",
		"        $completions = $updateFlags + $flags",
		"    } else {",
		"        $completions = $commands",
		"    }",
		'    $completions | Where-Object { $_ -like "$wordToComplete*" } | ForEach-Object {',
		"        [System.Management.Automation.CompletionResult]::new($_, $_, 'ParameterValue', $_)",
		"    }",
		"}",
	].join("\n");
}
