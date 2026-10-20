"use client";

// providers-tab.tsx — the multi-provider registry surface (M5): provider
// cards (endpoint, key status, health dot, default badge, models), the Add
// Provider form (preset dropdown + key + model, same verification the CLI
// runs), per-provider actions (test / refresh / rotate key / set default /
// remove with confirm), and the engine's own env-driven model note.
//
// Mutations go through the engine's /api/providers — the SAME providers.ts
// code path `unown providers *` uses, so this tab and the CLI can never
// disagree. provider:changed SSE events invalidate the query (providers.tsx
// owns the map).

import * as React from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check,
  KeyRound,
  Loader2,
  PlugZap,
  Plus,
  RefreshCw,
  Server,
  Sparkles,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, mutations, qk } from "@/lib/agent-api";
import type { ProviderInfo, ProviderPresetInfo, ProvidersResponse } from "@/lib/agent-types";

function HealthDot({ ok, problem }: { ok: boolean; problem?: string | null }) {
  return (
    <span
      role="img"
      title={ok ? "endpoint reachable" : problem === "auth" ? "credentials rejected" : "endpoint unreachable"}
      aria-label={ok ? "healthy" : problem === "auth" ? "credentials rejected" : "unreachable"}
      className={`inline-block size-2 shrink-0 rounded-full ${ok ? "bg-emerald-400" : problem === "auth" ? "bg-amber-400" : "bg-rose-500"}`}
    />
  );
}

function probeToast(provider: string, probe: { ok?: boolean; status?: number; problem?: string } | null | undefined) {
  if (!probe) return;
  if (probe.ok) toast.success(`${provider}: endpoint reachable`);
  else if (probe.problem === "auth") toast.error(`${provider}: credentials rejected (HTTP ${probe.status ?? "?"}) — rotate the key`);
  else toast.error(`${provider}: endpoint unreachable`);
}

/** One provider card: identity, health, key status, models, actions. */
function ProviderCard({
  p,
  defaultModel,
  onInvalidate,
}: {
  p: ProviderInfo;
  defaultModel: string | null;
  onInvalidate: () => void;
}) {
  const queryClient = useQueryClient();
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.providers });
    onInvalidate();
  };

  const test = useMutation({
    mutationFn: () => mutations.providerTest(p.id),
    onSuccess: (res) => {
      probeToast(p.id, res.probe);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const refresh = useMutation({
    mutationFn: () => mutations.providerRefresh(p.id),
    onSuccess: (res) => {
      if (res.problem) toast.info(`${p.id}: ${res.problem}`);
      else if ((res.added ?? []).length > 0) toast.success(`${p.id}: imported ${(res.added ?? []).join(", ")}`);
      else toast.info(`${p.id}: already in sync`);
      if ((res.missing ?? []).length > 0) toast.warning(`${p.id}: no longer served (kept): ${(res.missing ?? []).join(", ")}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const setDefault = useMutation({
    mutationFn: (model?: string) => mutations.providerDefault(p.id, model),
    onSuccess: () => {
      toast.success(`default → ${p.id}`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });
  const remove = useMutation({
    mutationFn: () => mutations.providerRemove(p.id),
    onSuccess: () => {
      toast.success(`removed ${p.id} (its stored key went with it)`);
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const [confirmRemove, setConfirmRemove] = React.useState(false);
  const [keyOpen, setKeyOpen] = React.useState(false);
  const [newKey, setNewKey] = React.useState("");
  const rotate = useMutation({
    mutationFn: () => mutations.providerKey(p.id, newKey),
    onSuccess: (res) => {
      probeToast(p.id, res.probe);
      setKeyOpen(false);
      setNewKey("");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const busy = test.isPending || refresh.isPending || setDefault.isPending || remove.isPending || rotate.isPending;

  return (
    <Card className="border-zinc-800 bg-zinc-900/60">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2">
          <HealthDot ok={p.health.ok} problem={p.health.problem} />
          <CardTitle className="font-mono text-sm text-zinc-100">{p.id}</CardTitle>
          {p.isDefault && <Badge className="border-emerald-800 bg-emerald-950 text-emerald-400">default</Badge>}
          {p.api && <Badge variant="outline" className="border-zinc-700 text-[10px] text-zinc-400">{p.api}</Badge>}
          <span className="ml-auto text-[11px] text-zinc-400">{p.keyLabel}</span>
        </div>
        {p.baseUrl && <CardDescription className="truncate font-mono text-[11px] text-zinc-400">{p.baseUrl}</CardDescription>}
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {p.modelIds.slice(0, 8).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => (p.isDefault && m === defaultModel ? undefined : setDefault.mutate(m))}
              title={p.isDefault && m === defaultModel ? "current default model" : `make ${p.id}/${m} the default`}
              className={`rounded-full border px-2 py-0.5 font-mono text-[10px] transition-colors ${
                p.isDefault && m === defaultModel
                  ? "border-emerald-800 bg-emerald-950/60 text-emerald-400"
                  : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
              }`}
            >
              {m}
              {p.isDefault && m === defaultModel ? " ✓" : ""}
            </button>
          ))}
          {p.modelIds.length > 8 && <span className="text-[10px] text-zinc-400">+{p.modelIds.length - 8} more</span>}
          {p.modelIds.length === 0 && <span className="text-[11px] text-zinc-400">no models registered</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => test.mutate()} disabled={busy}>
            {test.isPending ? <Loader2 className="size-3 animate-spin" /> : <PlugZap className="size-3" />} Test
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => refresh.mutate()} disabled={busy}>
            {refresh.isPending ? <Loader2 className="size-3 animate-spin" /> : <RefreshCw className="size-3" />} Refresh models
          </Button>
          <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => setKeyOpen(true)} disabled={busy}>
            <KeyRound className="size-3" /> Rotate key
          </Button>
          {!p.isDefault && (
            <Button size="sm" variant="outline" className="h-7 gap-1.5 text-[11px]" onClick={() => setDefault.mutate()} disabled={busy}>
              {setDefault.isPending ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3" />} Set default
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            className="h-7 gap-1.5 border-zinc-700 bg-zinc-900 text-[11px] text-rose-400 hover:bg-rose-950/40 hover:text-rose-300"
            onClick={() => setConfirmRemove(true)}
            disabled={busy}
          >
            <Trash2 className="size-3" aria-hidden="true" /> Remove
          </Button>
        </div>

        <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
          <DialogContent className="border-zinc-800 bg-zinc-950">
            <DialogHeader>
              <DialogTitle className="font-mono text-sm">Rotate key — {p.id}</DialogTitle>
              <DialogDescription className="text-xs">
                Stored in ~/.unown/agent/auth.json (0600) on the engine&apos;s host. Verified against the endpoint immediately.
              </DialogDescription>
            </DialogHeader>
            <Input
              type="password"
              placeholder="new API key"
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              autoComplete="off"
            />
            <DialogFooter>
              <Button variant="outline" onClick={() => setKeyOpen(false)} disabled={rotate.isPending}>
                Cancel
              </Button>
              <Button onClick={() => rotate.mutate()} disabled={!newKey || rotate.isPending}>
                {rotate.isPending && <Loader2 className="mr-1 size-3 animate-spin" />} Rotate &amp; verify
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={confirmRemove} onOpenChange={setConfirmRemove}>
          <DialogContent className="border-zinc-800 bg-zinc-950">
            <DialogHeader>
              <DialogTitle className="text-sm">Remove {p.id}?</DialogTitle>
              <DialogDescription className="text-xs">
                Drops the provider and its stored key from ~/.unown/agent. Existing providers are kept. This is the same
                action as <span className="font-mono">unown providers remove {p.id}</span>.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setConfirmRemove(false)} disabled={remove.isPending}>
                Cancel
              </Button>
              <Button onClick={() => remove.mutate()} disabled={remove.isPending} className="bg-rose-500 text-zinc-950 hover:bg-rose-400">
                {remove.isPending && <Loader2 className="mr-1 size-3 animate-spin" />} Remove
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardContent>
    </Card>
  );
}

/** The Add Provider form — preset dropdown + model + key, verified on submit. */
function AddProviderCard({ presets, onInvalidate }: { presets: ProviderPresetInfo[]; onInvalidate: () => void }) {
  const queryClient = useQueryClient();
  const [presetId, setPresetId] = React.useState<string>("");
  const [model, setModel] = React.useState("");
  const [apiKey, setApiKey] = React.useState("");
  const [keyEnv, setKeyEnv] = React.useState("");
  const [baseUrl, setBaseUrl] = React.useState("");
  const [customId, setCustomId] = React.useState("");
  const [allModels, setAllModels] = React.useState(false);
  const [setDefault, setSetDefault] = React.useState(false);
  const preset = presets.find((p) => p.id === presetId);
  const isCustom = presetId === "custom";

  const add = useMutation({
    mutationFn: () =>
      mutations.providerAdd({
        preset: presetId,
        model: model || preset?.defaultModel || undefined,
        apiKey: apiKey || undefined,
        keyEnv: keyEnv || undefined,
        baseUrl: baseUrl || undefined,
        id: isCustom && customId ? customId : undefined,
        allModels,
        setDefault,
      }),
    onSuccess: (res) => {
      if (res.probe?.ok) toast.success(`added ${res.provider}${res.model ? ` (${res.model})` : ""} — endpoint reachable`);
      else if (res.probe?.problem === "auth") toast.error(`added ${res.provider}, but the key was rejected — rotate it`);
      else toast.warning(`added ${res.provider}, but the endpoint is unreachable — check the URL`);
      setPresetId("");
      setModel("");
      setApiKey("");
      setKeyEnv("");
      setBaseUrl("");
      setCustomId("");
      setAllModels(false);
      setSetDefault(false);
      queryClient.invalidateQueries({ queryKey: qk.providers });
      onInvalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const keyEnvHint = preset?.keyEnvHint ?? "";

  return (
    <Card className="border-dashed border-zinc-800 bg-zinc-900/40">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-1.5 text-sm text-zinc-200">
          <Plus className="size-4 text-emerald-400" /> Add a provider
        </CardTitle>
        <CardDescription className="text-xs text-zinc-400">
          Existing providers are kept — the registry accumulates. Verified live before the card appears.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400" htmlFor="provider-preset-select">Preset</Label>
            <Select value={presetId} onValueChange={setPresetId}>
              <SelectTrigger id="provider-preset-select" aria-label="provider preset" className="h-9 text-xs text-zinc-200 [&_[data-slot=select-value]]:text-zinc-300 [&_[data-slot=select-value][data-placeholder]]:text-zinc-400">
                <SelectValue placeholder="pick a provider" />
              </SelectTrigger>
              <SelectContent className="border-zinc-800 bg-zinc-950">
                {presets.map((p) => (
                  <SelectItem key={p.id} value={p.id} className="text-xs">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {preset && (
              <p className="font-mono text-[10px] text-zinc-400">
                {baseUrl || preset.baseUrl} {preset.note ? `· ${preset.note}` : ""}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">Model</Label>
            <Input
              className="h-9 font-mono text-xs"
              placeholder={preset?.defaultModel || "model id"}
              value={model}
              onChange={(e) => setModel(e.target.value)}
            />
          </div>
        </div>
        {isCustom && (
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Endpoint base URL</Label>
              <Input
                className="h-9 font-mono text-xs"
                placeholder="http://127.0.0.1:11434/v1"
                value={baseUrl}
                onChange={(e) => setBaseUrl(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-400">Registry id</Label>
              <Input
                className="h-9 font-mono text-xs"
                placeholder="ollama"
                value={customId}
                onChange={(e) => setCustomId(e.target.value)}
              />
            </div>
          </div>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">API key {keyEnvHint && <span className="text-zinc-400">({keyEnvHint})</span>}</Label>
            <Input
              type="password"
              className="h-9 font-mono text-xs"
              placeholder={presetId === "bridge" ? "handled by the bridge" : "sk-… / cpk-… (blank for local servers)"}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              autoComplete="off"
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-zinc-400">…or env-var name (no secret stored)</Label>
            <Input
              className="h-9 font-mono text-xs"
              placeholder="AGNES_API_KEY"
              value={keyEnv}
              onChange={(e) => setKeyEnv(e.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={allModels} onChange={(e) => setAllModels(e.target.checked)} className="accent-emerald-500" />
            import every served chat model
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={setDefault} onChange={(e) => setSetDefault(e.target.checked)} className="accent-emerald-500" />
            make it the default
          </label>
        </div>
        <Button
          className="h-9 gap-1.5 text-xs"
          onClick={() => add.mutate()}
          disabled={!presetId || add.isPending || (!apiKey && !keyEnv && presetId !== "bridge" && presetId !== "custom" && !preset?.keyEnvHint.startsWith("BRIDGE"))}
        >
          {add.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />} Add &amp; verify
        </Button>
      </CardContent>
    </Card>
  );
}

export function ProvidersTab() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError, error } = useQuery({
    queryKey: qk.providers,
    queryFn: api.providers,
  });
  // Registry writes change the overview's provider line when the default
  // moved; cheap enough to always refresh alongside the providers query.
  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: qk.overview });
  };

  if (isLoading) {
    return (
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Card key={i} className="border-zinc-800 bg-zinc-900/60">
            <CardHeader className="pb-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="mt-1 h-3 w-56" />
            </CardHeader>
            <CardContent className="space-y-3">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-7 w-48" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="py-8 text-center text-sm text-zinc-400">
          The provider registry is unavailable — the engine is down or unreachable.
          <p className="mt-1 font-mono text-[11px] text-zinc-400">{String((error as Error)?.message ?? "")}</p>
        </CardContent>
      </Card>
    );
  }

  const resp = (data ?? { providers: [], presets: [], defaultProvider: null, defaultModel: null, engine: { provider: "", model: "" } }) as ProvidersResponse;

  return (
    <div className="space-y-4">
      <Card className="border-zinc-800 bg-zinc-900/60">
        <CardContent className="flex flex-wrap items-center gap-x-6 gap-y-2 py-3 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <Server className="size-3.5 text-zinc-500" aria-hidden="true" />
            engine model: <span className="font-mono text-zinc-200">{resp.engine.provider}/{resp.engine.model}</span>
          </span>
          <span>
            session default:{" "}
            <span className="font-mono text-zinc-200">
              {resp.defaultProvider ? `${resp.defaultProvider}/${resp.defaultModel ?? ""}` : "none"}
            </span>
          </span>
          <span className="text-zinc-400">
            the engine&apos;s model is env-driven (.env) — registry writes change session defaults, not engine routing
          </span>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {resp.providers.map((p) => (
          <ProviderCard key={p.id} p={p} defaultModel={resp.defaultModel} onInvalidate={invalidate} />
        ))}
        <AddProviderCard presets={resp.presets} onInvalidate={invalidate} />
      </div>
    </div>
  );
}
