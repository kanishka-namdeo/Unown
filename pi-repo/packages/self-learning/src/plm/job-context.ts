/**
 * plm/job-context.ts — the in-process job→run parent link.
 *
 * Engine runs execute inside router jobs (a harness cycle's baseline/candidate
 * runs, a dream's canary runs, a mint pass's solvability proof). For the
 * Process Registry's parent/child contract (run → job), runAgent needs the
 * id of the job process currently executing — the router sets it here for
 * the duration of execute(), every other lane reads null (a manual
 * POST /api/tasks/:id/run has no job parent).
 *
 * Module-level state is deliberate (the alternative — threading a context
 * object through runAgentWithRetry → runAgent — would touch every call site
 * in harness/mint/dream for a telemetry field). Single-threaded engine +
 * busy mutex guarantee one writer at a time; the finally clears it on every
 * exit path, and a crashed job cannot leak it past the process exit.
 */

let currentJobProcessId: string | null = null;
let currentJobId: string | null = null;

/** The router calls this for the duration of a job execution. */
export function setJobProcessContext(jobProcessId: string | null, jobId: string | null): void {
	currentJobProcessId = jobProcessId;
	currentJobId = jobId;
}

/** The owning job process id, when runAgent runs inside a job (else null). */
export function getJobProcessContext(): { jobProcessId: string | null; jobId: string | null } {
	return { jobProcessId: currentJobProcessId, jobId: currentJobId };
}
