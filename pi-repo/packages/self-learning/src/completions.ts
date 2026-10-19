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
        "models",
        "init",
        "memory",
        "doctor",
        "mcp",
        "automations",
        "usage",
        "note",
        "update",
        "changelog",
        "info",
        "completions",
        "uninstall",
] as const;

const MCP_SUBCOMMANDS = ["add", "add-http", "add-json", "list", "get", "remove", "test"];
const AUTOMATIONS_SUBCOMMANDS = ["list", "create", "edit", "pause", "resume", "run", "history", "delete"];

const UPDATE_FLAGS = ["--check", "--json", "--allow-dirty", "--rollback", "--help"];
const SESSION_FLAGS = [
        "-p",
        "--print",
        "--plan",
        "--goal",
        "--verbose",
        "--mode",
        "--tools",
        "--append-system-prompt",
        "--no-session",
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
                "    automations)",
                `      COMPREPLY=( $(compgen -W "${AUTOMATIONS_SUBCOMMANDS.join(" ")}" -- "$cur") )`,
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
                '    "models:list configured models"',
                '    "init:scaffold .unown project memory"',
                '    "memory:print the effective memory stack"',
                '    "doctor:run configuration diagnostics"',
                '    "mcp:manage MCP server configs (add/list/get/remove/test)"',
                '    "automations:scheduled recurring agent runs (list/create/edit/pause/resume/run/history/delete)"',
                '    "usage:token & cost report for the LLM bridge (--days/--model/--json)"',
                '    "note:deliver a session note to the engine"',
                '    "update:self-update to the newest release"',
                '    "changelog:print recent CHANGELOG sections"',
                '    "info:print the support bundle"',
                '    "completions:print shell completion scripts"',
                '    "uninstall:remove the unown CLI"',
                "  )",
                "  _arguments \\",
                '    "1: :->command" \\',
                '    "-p[one-shot print mode]" \\',
                '    "--plan[read-only plan mode]" \\',
                '    "--verbose[verbose decisions on stderr]" \\',
                '    "--mode[output mode]:mode:(json text)" \\',
                '    "--version[print the version]" \\',
                '    "--help[help text]"',
                "  case $state in",
                "    command)",
                "      _describe 'command' commands",
                "      ;;",
                "  esac",
                "  case $words[1] in",
                "    update)",
                '      _arguments "--check[report only]" "--json[machine-readable]" "--allow-dirty[autostash]" "--rollback[undo last update]" "*:version:"',
                "      ;;",
                "    mcp)",
                `      _arguments "1:subcommand:(${MCP_SUBCOMMANDS.join(" ")})"`,
                "      ;;",
                "    automations)",
                `      _arguments "1:subcommand:(${AUTOMATIONS_SUBCOMMANDS.join(" ")})"`,
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
                lines.push(`complete -c unown -l ${flag.replace(/^-+/, "")} -d "${flag}"`);
        }
        for (const flag of UPDATE_FLAGS) {
                lines.push(
                        `complete -c unown -n "__fish_seen_subcommand_from update" -l ${flag.replace(/^-+/, "")} -d "${flag}"`,
                );
        }
        lines.push('complete -c unown -n "__fish_seen_subcommand_from completions" -a "bash zsh fish powershell"');
        lines.push(`complete -c unown -n "__fish_seen_subcommand_from mcp" -a "${MCP_SUBCOMMANDS.join(" ")}"`);
        lines.push(`complete -c unown -n "__fish_seen_subcommand_from automations" -a "${AUTOMATIONS_SUBCOMMANDS.join(" ")}"`);
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
                "    $flags = @('-p','--print','--plan','--verbose','--help','--version')",
                "    $updateFlags = @('--check','--json','--allow-dirty','--rollback')",
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
