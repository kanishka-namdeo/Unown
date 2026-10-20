/**
 * presets.ts — the provider preset table (M4).
 *
 * Lives in its own module with NO imports beyond node builtins so any
 * consumer can load it without dragging terminal dependencies: the CLI
 * (setup.ts / providers-cli.ts re-export) and the interactive TUI — the
 * import-graph detachment tests stay green either way.
 *
 * One table for every terminal surface: the registry (providers.ts) and the
 * CLI wizard offer the same presets.
 */

export interface ProviderPreset {
        /** Provider id written to models.json (also the --provider flag value). */
        id: string;
        label: string;
        baseUrl: string;
        api: "openai-completions" | "anthropic-messages";
        defaultModel: string;
        input: string[];
        keyEnvHint: string;
        note?: string;
}

export const PRESETS: ProviderPreset[] = [
        {
                id: "bridge",
                label: "The bundled llm-bridge (this repo's stack — Dashscope coding plan)",
                baseUrl: `${(process.env.PI_BRIDGE_URL || "http://127.0.0.1:3031").replace(/\/+$/, "")}/v1`,
                api: "openai-completions",
                defaultModel: process.env.PI_MODEL_ID || "kimi-k2.5",
                input: ["text", "image"],
                keyEnvHint: "BRIDGE_UPSTREAM_KEY (in the repo's .env — nothing stored locally)",
                note: "model routing, thinking translation and SSE passthrough handled by the bridge",
        },
        {
                id: "openai",
                label: "OpenAI",
                baseUrl: "https://api.openai.com/v1",
                api: "openai-completions",
                defaultModel: "gpt-4o",
                input: ["text", "image"],
                keyEnvHint: "OPENAI_API_KEY",
        },
        {
                id: "openrouter",
                label: "OpenRouter (one key, every model)",
                baseUrl: "https://openrouter.ai/api/v1",
                api: "openai-completions",
                defaultModel: "openrouter/auto",
                input: ["text", "image"],
                keyEnvHint: "OPENROUTER_API_KEY",
        },
        {
                id: "anthropic",
                label: "Anthropic (Claude)",
                baseUrl: "https://api.anthropic.com",
                api: "anthropic-messages",
                defaultModel: "claude-sonnet-4-5",
                input: ["text", "image"],
                keyEnvHint: "ANTHROPIC_API_KEY",
        },
        {
                id: "dashscope",
                label: "Dashscope (Alibaba Cloud — Qwen/Kimi)",
                baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
                api: "openai-completions",
                defaultModel: "qwen-plus",
                input: ["text", "image"],
                keyEnvHint: "DASHSCOPE_API_KEY",
        },
        {
                id: "deepseek",
                label: "DeepSeek",
                baseUrl: "https://api.deepseek.com/v1",
                api: "openai-completions",
                defaultModel: "deepseek-chat",
                input: ["text"],
                keyEnvHint: "DEEPSEEK_API_KEY",
        },
        {
                id: "agnes",
                label: "Agnes AI (OpenAI-compatible, image-capable)",
                baseUrl: "https://apihub.agnes-ai.com/v1",
                api: "openai-completions",
                defaultModel: "agnes-3.0-flash",
                input: ["text", "image"],
                keyEnvHint: "AGNES_API_KEY",
                note: "flash models also take image input (VLM)",
        },
        {
                id: "custom",
                label: "Any other OpenAI-compatible endpoint (vLLM, llama.cpp, Ollama, …)",
                baseUrl: "http://127.0.0.1:11434/v1",
                api: "openai-completions",
                defaultModel: "",
                input: ["text"],
                keyEnvHint: "your endpoint's key (blank for local servers)",
        },
];
