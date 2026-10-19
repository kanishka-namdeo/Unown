import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { allTasks, findTask } from "./store.ts";
import { paginate } from "./pagination.ts";

const PORT = Number(process.env.PORT ?? 8080);

function json(res: ServerResponse, status: number, body: unknown): void {
	res.writeHead(status, { "content-type": "application/json" });
	res.end(JSON.stringify(body));
}

export const server = createServer((req: IncomingMessage, res: ServerResponse) => {
	const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

	if (req.method === "GET" && url.pathname === "/api/tasks") {
		const page = Number(url.searchParams.get("page") ?? "1");
		const perPage = Number(url.searchParams.get("perPage") ?? "5");
		return json(res, 200, { page, perPage, items: paginate(allTasks(), page, perPage) });
	}

	if (req.method === "GET" && url.pathname.startsWith("/api/tasks/")) {
		const id = url.pathname.slice("/api/tasks/".length);
		const task = findTask(id);
		if (!task) return json(res, 404, { error: `no task ${id}` });
		return json(res, 200, task);
	}

	return json(res, 404, { error: "not found" });
});

if (import.meta.main) {
	server.listen(PORT, () => console.log(`task-api listening on :${PORT}`));
}
