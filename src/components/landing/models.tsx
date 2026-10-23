import { FadeUp } from "./shell";
import { ProviderMark, type ProviderSlug } from "./provider-marks";

/**
 * The Models pane of the proof band (`proof.tsx`).
 *
 * The lock-in objection, answered before it forms. Also the canonical home
 * for the model allow-list and the bridge spec: the hero's trust strip and
 * the FAQ's model answers point here rather than re-listing providers.
 *
 * Marks are CC0 Simple Icons, vendored (see `provider-marks.tsx`). Three
 * tiles are deliberately text-only — OpenAI (its mark was retired at the
 * owner's request), Agnes AI and llama.cpp (no Simple Icons slug for either);
 * DashScope carries the Alibaba Cloud mark.
 *
 * 2026-10-20 compression: the 260-word bridge/local-lane/nonllm paragraph
 * became three sentences with the REPORT links. The local-lane sentence and
 * the complementary-bench figures (54% / 47% / $0) are pinned by
 * `landing-copy.test.tsx` and survive verbatim.
 */

type Tile = { label: string; slug?: ProviderSlug; note?: string };

const TILES: Tile[] = [
  { label: "OpenAI", note: "text-only" },
  { label: "Anthropic", slug: "anthropic" },
  { label: "OpenRouter", slug: "openrouter" },
  { label: "DeepSeek", slug: "deepseek" },
  { label: "Mistral AI", slug: "mistralai" },
  { label: "DashScope", slug: "alibabacloud", note: "Alibaba Cloud" },
  { label: "Agnes AI", note: "text-only · preset" },
  { label: "vLLM", slug: "vllm" },
  { label: "Ollama", slug: "ollama" },
  { label: "llama.cpp", note: "text-only" },
];

export function ModelsPane() {
  return (
    <div data-hue="aqua">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-10">
        <div className="shrink-0 lg:w-52">
          <p className="gb-label text-[10px] text-gold">
            Model agnostic
          </p>
          <p className="mt-2 text-[15px] leading-snug text-ink">
            Bring the brain you already pay for.
          </p>
        </div>

        <div className="min-w-0 flex-1">
          <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {TILES.map((t) => (
              <li
                key={t.label}
                className="gb-panel lift flex h-11 items-center gap-2.5 px-3 hover:border-line-bright"
              >
                {t.slug ? (
                  <ProviderMark slug={t.slug} className="size-4 shrink-0 text-dim" />
                ) : (
                  <span
                    aria-hidden="true"
                    className="size-4 shrink-0 border border-line-bright"
                  />
                )}
                <span className="min-w-0">
                  <span className="block truncate gb-label text-[9px] leading-tight text-ink">
                    {t.label}
                  </span>
                  {t.note ? (
                    <span className="block truncate font-mono text-[9px] leading-tight text-dim">
                      {t.note}
                    </span>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>

          <FadeUp>
            <p className="mt-4 max-w-3xl text-[12.5px] leading-relaxed text-dim">
              Any OpenAI-compatible endpoint works — the bundled bridge maps model
              ids onto an allow-list, injects upstream auth, passes tool calls and
              image content through natively, and streams SSE back untouched. It also
              has a local lane: point{" "}
              <code className="font-mono text-ink">BRIDGE_LOCAL_URL</code> at llama.cpp,
              Ollama or LM Studio and <code className="font-mono text-ink">local-*</code>{" "}
              ids route there keyless, so background learning (note triage, failure
              mining, AutoDream) can run on a small local model while sessions stay on
              the remote one —{" "}
              <code className="font-mono text-ink">
                node benchmarks/local-llm/runner.mjs serve
              </code>{" "}
              downloads llama.cpp and a GGUF on first use and serves the lane. A
              zero-LLM tier (MinHash dedup, activation ranking, LexRank curation) runs
              fully local around the dream call — measured in{" "}
              <code className="font-mono text-ink">benchmarks/nonllm</code>, shipped
              opt-in since H15.
            </p>
            <p className="mt-3 max-w-3xl text-[12.5px] leading-relaxed text-faint">
              The complementary bench measured what a local engine buys around the
              endpoint: shared-prefix calls prefill 54% faster (llama.cpp KV reuse), a
              small local model cuts the remote lane&apos;s input tokens 47% on mining
              jobs, and a sub-1B local model answers image questions at $0 where the
              remote lane bills vision tokens — per-platform timings and verdicts in{" "}
              <a
                href="https://github.com/kanishka-namdeo/Unown/blob/main/benchmarks/complementary/results/REPORT.md"
                target="_blank"
                rel="noreferrer noopener"
                className="font-mono text-[11.5px] text-gold underline-offset-4 hover:underline"
              >
                benchmarks/complementary/results/REPORT.md
              </a>
              . Or skip the bridge entirely with{" "}
              <code className="font-mono text-dim">unown setup --provider</code>. Marks
              are{" "}
              <a
                href="https://simpleicons.org"
                target="_blank"
                rel="noreferrer noopener"
                className="underline underline-offset-2 hover:text-dim"
              >
                Simple Icons
              </a>{" "}
              (CC0), vendored locally.
            </p>
          </FadeUp>
        </div>
      </div>
    </div>
  );
}
