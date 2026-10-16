import { FadeUp } from "./shell";
import { ProviderMark, type ProviderSlug } from "./provider-marks";

/**
 * Lock-in neutraliser. Research on dev-tool landing pages is unambiguous that
 * "works with whatever you already pay for" is a first-class section, not a
 * footnote — it removes the switching-cost objection before anyone forms it.
 *
 * Marks are CC0 Simple Icons, vendored (see `provider-marks.tsx`). OpenAI and
 * DashScope are deliberately text-only: one mark was retired at its owner's
 * request, the other has no slug — and saying so is more honest than a logo
 * wall of nine things that all look the same.
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
    <section className="border-y border-line py-12">
      <div className="mx-auto max-w-6xl px-5 sm:px-6">
        <FadeUp>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:gap-12">
            <div className="shrink-0 lg:w-60">
              <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-glow">
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
                    className="lift flex h-11 items-center gap-2.5 rounded border border-line bg-panel/60 px-3 hover:border-line-bright"
                  >
                    {t.slug ? (
                      <ProviderMark slug={t.slug} className="size-4 shrink-0 text-dim" />
                    ) : (
                      <span
                        aria-hidden="true"
                        className="size-4 shrink-0 rounded-[3px] border border-line-bright"
                      />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate font-mono text-[11.5px] leading-tight text-ink">
                        {t.label}
                      </span>
                      {t.note ? (
                        <span className="block truncate font-mono text-[9px] leading-tight text-faint/70">
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
                untouched — or skip the bridge entirely with{" "}
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