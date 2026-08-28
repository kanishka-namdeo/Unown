/**
 * Smoke test: drive pi headlessly through the llm-bridge with tools.
 */
import { createAgentSessionServices, createAgentSessionFromServices, SessionManager, SettingsManager } from "../../pi-repo/packages/coding-agent/dist/index.js";

const cwd = "/tmp/pi-smoke/workspace";
const agentDir = "/tmp/pi-smoke/agent-dir";

async function main() {
	const services = await createAgentSessionServices({
		cwd,
		agentDir,
		settingsManager: SettingsManager.inMemory(),
	});
	const model = services.modelRuntime.getModel("zai-bridge", "glm-4-plus");
	if (!model) throw new Error("Model not found: zai-bridge/glm-4-plus — available: " + services.modelRuntime.getAvailableSnapshot().map((m: any) => `${m.provider}/${m.id}`).join(", "));

	const sessionManager = SessionManager.inMemory(cwd);
	const { session } = await createAgentSessionFromServices({
		services,
		sessionManager,
		model,
		thinkingLevel: "off",
	});

	let events: string[] = [];
	session.subscribe((e: any) => {
		if (e.type === "tool_execution_start") events.push(`tool_start: ${e.toolName}`);
		if (e.type === "tool_execution_end") events.push(`tool_end: ${e.toolName} isError=${e.isError}`);
		if (e.type === "message_end" && e.message?.role === "assistant") {
			const text = (e.message.content ?? []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
			if (text) events.push("assistant: " + text.slice(0, 200));
		}
	});

	await session.prompt("Read the file note.txt in the current directory and tell me exactly what it says. Then create a file called done.txt containing the word 'done'.");
	console.log("=== EVENTS ===");
	for (const e of events) console.log(e);
	console.log("=== done.txt ===");
	try {
		console.log(await Bun.file(cwd + "/done.txt").text());
	} catch {
		console.log("(not created)");
	}
	session.dispose();
	process.exit(0);
}

main().catch((e) => {
	console.error("FAILED:", e);
	process.exit(1);
});
