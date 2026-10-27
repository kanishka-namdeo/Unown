"use client";

import { useEffect, useState } from "react";
import type { TaskDraft } from "@/lib/sigil/types";

interface Template {
  id: string;
  name: string;
  description: string;
  tasks: TaskDraft[];
}

interface TemplatesPanelProps {
  onApply: (templateId: string, drafts: TaskDraft[]) => void;
}

export function TemplatesPanel({ onApply }: TemplatesPanelProps) {
  const [templates, setTemplates] = useState<Template[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    // Load from the API; fall back to the bundled copy when offline.
    import("@/lib/sigil/templates").then(({ STARTER_TEMPLATES }) => {
      setTemplates(STARTER_TEMPLATES);
    });
    fetch("/api/templates")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data && Array.isArray(data.templates)) setTemplates(data.templates);
      })
      .catch(() => {
        /* offline — bundled copy already applied */
      });
  }, []);

  return (
    <div className="fixed bottom-4 right-4 z-30">
      {open && (
        <div
          role="dialog"
          aria-label="Starter templates"
          className="mb-2 w-72 rounded-2xl border border-sf-border bg-sf-surface p-4 shadow-2xl"
        >
          <h2 className="mb-2 text-sm font-semibold">Starter templates</h2>
          <p className="mb-3 text-xs text-sf-dim">
            Applies replace your current board.
          </p>
          <ul role="list" className="space-y-2">
            {templates.map((t) => (
              <li key={t.id}>
                <button
                  type="button"
                  onClick={() => {
                    onApply(t.id, t.tasks);
                    setOpen(false);
                  }}
                  className="w-full rounded-lg border border-sf-border bg-sf-surface-2 p-2.5 text-left text-sm transition-colors hover:border-sf-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
                >
                  <span className="font-medium">{t.name}</span>
                  <span className="mt-0.5 block text-xs text-sf-dim">{t.description}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label="Toggle starter templates"
        className="rounded-full border border-sf-border bg-sf-surface px-4 py-2 text-sm font-medium shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-sf-accent"
      >
        {open ? "✕" : "◈ Templates"}
      </button>
    </div>
  );
}
