"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DataInstrument } from "@shared/types";
import type { SdZoneSavedRunDocument, SdZoneSavedRunListItem } from "@/lib/api";
import { getSdZoneSavedRunDocument, listSdZoneSavedRuns } from "@/lib/api";

function instrumentLabel(file: string, instruments: DataInstrument[]): string {
  const inv = instruments.find((i) => i.file === file);
  if (inv?.instrument?.trim()) return inv.instrument.trim();
  const norm = file.replace(/\\/g, "/");
  const base = norm.includes("/") ? norm.split("/").pop()! : norm;
  return base || file;
}

function chartTfLabel(ct: string | null | undefined): string {
  const s = (ct ?? "").trim();
  return s ? s : "Native";
}

type Props = {
  instruments: DataInstrument[];
  onOpen: (doc: SdZoneSavedRunDocument) => void;
};

export function SdSavedRunsPicker({ instruments, onOpen }: Props) {
  const [runs, setRuns] = useState<SdZoneSavedRunListItem[]>([]);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [openBusyId, setOpenBusyId] = useState<string | null>(null);

  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [chartFilter, setChartFilter] = useState<string | "__all__">("__all__");

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const rows = await listSdZoneSavedRuns();
      setRuns(rows);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const instrumentFiles = useMemo(() => {
    const s = new Set<string>();
    for (const r of runs) {
      const df = r.data_file?.trim();
      if (df) s.add(df);
    }
    return Array.from(s).sort((a, b) => a.localeCompare(b));
  }, [runs]);

  useEffect(() => {
    if (selectedFile && !instrumentFiles.includes(selectedFile)) {
      setSelectedFile(null);
      setChartFilter("__all__");
    }
  }, [instrumentFiles, selectedFile]);

  const chartOptionsForSelection = useMemo(() => {
    if (!selectedFile) return [] as string[];
    const s = new Set<string>();
    for (const r of runs) {
      if (r.data_file !== selectedFile) continue;
      s.add((r.chart_timeframe ?? "").trim());
    }
    return Array.from(s).sort((a, b) => {
      if (a === "" && b !== "") return -1;
      if (b === "" && a !== "") return 1;
      return a.localeCompare(b);
    });
  }, [runs, selectedFile]);

  const filteredRuns = useMemo(() => {
    if (!selectedFile) return [] as SdZoneSavedRunListItem[];
    return runs
      .filter((r) => r.data_file === selectedFile)
      .filter((r) => {
        if (chartFilter === "__all__") return true;
        const want = chartFilter === "__native__" ? "" : chartFilter;
        return ((r.chart_timeframe ?? "").trim()) === want;
      });
  }, [runs, selectedFile, chartFilter]);

  const openRun = useCallback(
    async (runId: string) => {
      setError(null);
      setOpenBusyId(runId);
      try {
        const doc = await getSdZoneSavedRunDocument(runId);
        onOpen(doc);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setOpenBusyId(null);
      }
    },
    [onOpen],
  );

  return (
    <div className="space-y-3 text-sm text-zinc-200">
      <div className="flex items-center justify-between gap-2">
        <div>
          <div className="text-xs font-medium text-zinc-400 uppercase tracking-wider">Saved S/D runs</div>
          <div className="text-[11px] text-zinc-500">Otevři uložený run do Results bez spouštění nového testu.</div>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          disabled={busy}
          className="rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
        >
          Obnovit
        </button>
      </div>

      {error ? (
        <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
          {error}
        </div>
      ) : null}

      <div className="rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 space-y-2">
        <div className="text-[11px] text-zinc-500">Instrument</div>
        {busy ? (
          <div className="text-xs text-zinc-500">Načítám…</div>
        ) : instrumentFiles.length === 0 ? (
          <div className="text-xs text-zinc-500 leading-relaxed">
            Žádné uložené S/D běhy. Spusť S/D test a pak klikni „Uložit backtest“ ve výsledcích.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {instrumentFiles.map((file) => {
              const active = selectedFile === file;
              return (
                <button
                  key={file}
                  type="button"
                  onClick={() => {
                    setSelectedFile(file);
                    setChartFilter("__all__");
                  }}
                  className={`rounded-full px-3 py-1 text-xs font-medium border ${
                    active
                      ? "border-emerald-600 bg-emerald-900/30 text-emerald-100"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                  }`}
                  title={file}
                >
                  {instrumentLabel(file, instruments)}
                </button>
              );
            })}
          </div>
        )}

        {selectedFile ? (
          <>
            <div className="pt-2 border-t border-zinc-800">
              <div className="text-[11px] text-zinc-500 mb-1">Graf TF</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setChartFilter("__all__")}
                  className={`rounded-full px-3 py-1 text-xs font-medium border ${
                    chartFilter === "__all__"
                      ? "border-emerald-600 bg-emerald-900/30 text-emerald-100"
                      : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                  }`}
                >
                  Vše
                </button>
                {chartOptionsForSelection.map((ct) => {
                  const key = ct === "" ? "__native__" : ct;
                  const active = chartFilter === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setChartFilter(key)}
                      className={`rounded-full px-3 py-1 text-xs font-medium border ${
                        active
                          ? "border-emerald-600 bg-emerald-900/30 text-emerald-100"
                          : "border-zinc-700 bg-zinc-900 text-zinc-300 hover:border-zinc-500"
                      }`}
                    >
                      {chartTfLabel(ct || null)}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-2 border-t border-zinc-800">
              <div className="text-[11px] text-zinc-500 mb-2">Runs</div>
              <div className="overflow-x-auto rounded border border-zinc-800">
                <table className="min-w-full text-xs">
                  <thead>
                    <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-zinc-500">
                      <th className="px-3 py-2">Created</th>
                      <th className="px-3 py-2">Years</th>
                      <th className="px-3 py-2">Chart TF</th>
                      <th className="px-3 py-2">Zone TF</th>
                      <th className="px-3 py-2 text-right">Touches</th>
                      <th className="px-3 py-2 text-right">Win %</th>
                      <th className="px-3 py-2 text-right">Akce</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredRuns.map((r) => {
                      const s = r.aggregate_summary ?? {};
                      const touches = s.touch_count ?? null;
                      const wr = s.win_rate_by_rr ?? null;
                      const created = (r.created_at ?? "").slice(0, 19) || "—";
                      return (
                        <tr key={r.run_id} className="border-b border-zinc-800/80 hover:bg-zinc-900/40">
                          <td className="px-3 py-1.5 font-mono text-zinc-400">{created}</td>
                          <td className="px-3 py-1.5 font-mono text-zinc-300">
                            {r.years != null && Number.isFinite(Number(r.years)) ? Number(r.years).toFixed(2) : "—"}
                          </td>
                          <td className="px-3 py-1.5 font-mono text-zinc-300">{chartTfLabel(r.chart_timeframe || null)}</td>
                          <td className="px-3 py-1.5 font-mono text-zinc-400">{r.zone_tf ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {touches != null && Number.isFinite(Number(touches)) ? String(touches) : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {wr != null && Number.isFinite(Number(wr)) ? `${(Number(wr) * 100).toFixed(1)}` : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right">
                            <button
                              type="button"
                              disabled={openBusyId === r.run_id}
                              onClick={() => void openRun(r.run_id)}
                              className="rounded-md border border-emerald-700/50 bg-emerald-950/30 px-2 py-1 text-[11px] font-medium text-emerald-100 hover:bg-emerald-900/30 disabled:opacity-50"
                            >
                              {openBusyId === r.run_id ? "Otevírám…" : "Otevřít"}
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {filteredRuns.length === 0 ? (
                  <div className="px-3 py-6 text-center text-zinc-500 text-xs">Žádné uložené běhy pro tento filtr.</div>
                ) : null}
              </div>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}

