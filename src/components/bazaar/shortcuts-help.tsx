"use client";

import { useDialogDismiss } from "./primitives";
import { useBazaar } from "@/lib/bazaar/store";
import { useRef } from "react";

const SHORTCUTS: Array<[string, string]> = [
  ["/", "Focus search"],
  ["c", "Toggle cart"],
  ["t", "Toggle theme"],
  ["d", "Open dashboard"],
  ["?", "Toggle this help"],
];

export function ShortcutsHelp({ onClose }: { onClose: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  useDialogDismiss(onClose, panelRef);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
      <button
        aria-label="Close shortcuts help"
        onClick={onClose}
        className="absolute inset-0 h-full w-full cursor-default bg-black/60"
        tabIndex={-1}
      />
      <div ref={panelRef} tabIndex={-1} className="relative z-10 w-full max-w-sm rounded-2xl border border-line bg-surface p-5 shadow-2xl animate-pop">
        <h2 className="text-lg font-bold">Keyboard shortcuts</h2>
        <ul className="mt-4 space-y-2 text-sm">
          {SHORTCUTS.map(([key, desc]) => (
            <li key={key} className="flex items-center justify-between">
              <kbd className="rounded-md border border-line bg-surface-2 px-2 py-1 font-mono text-xs">{key}</kbd>
              <span className="text-muted">{desc}</span>
            </li>
          ))}
        </ul>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-accent-strong px-4 py-2 text-sm font-semibold text-white hover:bg-accent"
        >
          Close
        </button>
      </div>
    </div>
  );
}
