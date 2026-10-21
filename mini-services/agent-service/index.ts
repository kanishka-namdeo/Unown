/**
 * agent-service — mini-service wrapper (port 3030) that boots the
 * pi self-learning layer: memory seeding, task seeding, the router
 * (background learning), and the REST+SSE API for the TUI dashboard
 * and API clients (see docs/detached-engine-architecture.md).
 */
import { startServer } from "../../pi-repo/packages/self-learning/src/index.ts";

async function main() {
        const server = startServer(Number(process.env.PI_AGENT_PORT ?? 3030));
        if (!server) {
                // startServer already logged the reason (single-instance lock).
                // Exit 0: "already running" is a healthy state for a supervisor.
                process.exit(0);
        }
}

main().catch((err) => {
        console.error("[agent-service] fatal:", err);
        process.exit(1);
});
