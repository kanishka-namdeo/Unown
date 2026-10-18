import { FadeUp } from "./shell";
import { ProviderMark, type ProviderSlug } from "./provider-marks";

/**
 * The lock-in objection, answered before it forms. This band is also the
 * canonical home for the model allow-list and the bridge spec: `hero.tsx`'s
 * trust strip, `faq.tsx`'s "which models" answer and the `Z` decode all point
 * here rather than re-listing providers.
 *
 * Marks are CC0 Simple Icons, vendored (see `provider-marks.tsx`). OpenAI and
 * DashScope are deliberately text-only: one mark was retired at its owner's
 * request, the other has no slug.
 */

type Tile = { label: string; slug?: ProviderSlug; note?: string };

const TILES: Tile[] = [
  { label: "OpenAI", note: "text-only" },
  { label: "Anthropic", slug: "anthropic" },
  { label: "OpenRouter", slug: "openrouter" },
  { label: "DeepSeek", slug: "deepseek" },
  { label: "Mistral AI", slug: "mistralai" },
  { label: "DashScope", slug: "alibabacloud", note: "Alibaba Cloud" },
  { label: "vLLM", slug: "vllm" },
  { label: "Ollama", slug: "ollama" },
  { label: "llama.cpp", note: "text-only" },
];

export function ModelsBand() {
  return (
    <section data-hue="aqua" className="border-y border-line py-12">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-12">
            <div className="shrink-0 lg:w-60">
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

              <p className="mt-4 max-w-2xl text-[12.5px] leading-relaxed text-faint">
                Any OpenAI-compatible endpoint works. The bundled bridge maps model ids
                onto an allow-list, injects upstream auth, translates{" "}
                <code className="font-mono text-dim">thinking</code> flags for qwen, passes
                tool calls and image content through natively, and streams SSE back
                untouched. It also has a local lane: point{" "}
                <code className="font-mono text-dim">BRIDGE_LOCAL_URL</code> at llama.cpp,
                Ollama or LM Studio and{" "}
                <code className="font-mono text-dim">local-*</code> ids route there keyless,
                so the background engine (note triage, failure mining, AutoDream) can run
                on a small local model while sessions stay on the remote one.{" "}
                <code className="font-mono text-dim">
                  node benchmarks/local-llm/runner.mjs serve
                </code>{" "}
                downloads llama.cpp and a GGUF on first use and serves the lane.
                Below that sits a zero-LLM tier, measured in{" "}
                <code className="font-mono text-dim">benchmarks/nonllm</code>:
                note dedup, input ranking and curation run fully local on CPU
                around the dream call — MinHash for structural near-dups, an
                optional 33M bge-small embedder for the paraphrase tier, LexRank
                for the compressed tail — and since H15 all three ship in the
                engine itself: opt-in flags, a{" "}
                <code className="font-mono text-dim">shadow</code> mode that
reports what they would change without touching the prompt,
                and the embedding model as an install-on-demand side package,
                so the LLM calls that remain are only the ones that genuinely
                generate. The third research bench,{" "}
                <code className="font-mono text-dim">benchmarks/complementary</code>,
                measured what a local engine can do around this endpoint:
                the local lane's shared-prefix calls prefill 54% faster
                (llama.cpp KV reuse), a small local model can cut the remote
                lane&apos;s input tokens 47% on mining jobs before the call is
                paid for, and a sub-1B local model answers image questions
                at $0 where the remote lane bills vision tokens. Those three
                ship; the kNN-triage and cross-encoder arms stay
                bench-verified, not wired in. Per-platform timings and the
                hypothesis verdicts are in that directory&apos;s{" "}
                <code className="font-mono text-dim">results/REPORT.md</code>,
                which is where the figures above are quoted from rather than
                restated independently. Or skip
                the bridge entirely with{" "}
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
            </div>
          </div>
        </FadeUp>
      </div>
    </section>
  );
}