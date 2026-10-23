// M7 E2E: the /promote pipeline against real Agnes + the real engine.
// 1) distill a substantive session into a Program draft (real chatText)
// 2) save it to the project store
// 3) schedule the routine (real engine REST) + test-run it
// 4) report the outcome (auto-delete would fire on failure)
import { runPromoteCommand, promoteShow } from "../src/promote-cli.ts";
import { chatText } from "../src/llm.ts";
import { readFileSync } from "node:fs";

const cwd = "/tmp/m7-scratch";
const entries = [
	{ message: { role: "user", content: "Every morning before standup I need you to check the overnight test logs and post a one-line summary of failures to the team channel. You did this manually yesterday and it worked well — make it a standing thing. Do not rerun tests and do not touch any branches." } },
	{ message: { role: "assistant", content: "Checked the overnight logs and posted the summary. The failures were two flaky router tests." } },
	{ message: { role: "user", content: "Perfect. Same thing every weekday at 09:00 please." } },
];

const deps = { cwd, chat: chatText, entries };

console.log("== /promote (distill)");
const draft = await runPromoteCommand("the overnight log summary", deps);
console.log(draft.level, "|", draft.message.slice(0, 120).replace(/\n/g, " "));
if (draft.level === "error") process.exit(1);

console.log("== /promote show (parked draft)");
const shown = promoteShow(deps);
console.log(shown.message.slice(0, 500));
const raw = readFileSync(`${cwd}/.unown/promote-draft.md`, "utf8");

console.log("== /promote save project");
const saved = await runPromoteCommand("save project", { ...deps, entries: [] });
console.log(saved.level, "|", saved.message.slice(0, 160).replace(/\n/g, " "));

console.log("== /promote schedule (real engine + real test-run)");
const sched = await runPromoteCommand("schedule --delay-minutes 600", { ...deps, entries: [] });
console.log(sched.level, "|", sched.message.slice(0, 400).replace(/\n/g, " "));
console.log("M7-E2E-PROMOTE-DONE");
process.exit(sched.level === "info" ? 0 : 1);
