"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DataInstrument } from "@shared/types";
import type { SdZoneSavedRunListItem } from "@/lib/api";
import { deleteAllSdZoneSavedRuns, deleteSdZoneSavedRun, listSdZoneSavedRuns } from "@/lib/api";

function safeNum(x: unknown): number | null {
  if (x == null) return null;
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function chartTfLabel(ct: string | null | undefined): string {
  const s = (ct ?? "").trim();
  if (!s) return "Native";
  return s;
}

function instrumentLabel(file: string, instruments: DataInstrument[]): string {
  const inv = instruments.find((i) => i.file === file);
  if (inv?.instrument?.trim()) return inv.instrument.trim();
  const norm = file.replace(/\\/g, "/");
  const base = norm.includes("/") ? norm.split("/").pop()! : norm;
  return base || file;
}

type LeaderRow = {
  data_file: string;
  chart: string;
  zone_tf: string | null;
  touch_count: number;
  win_rate: number | null;
  avg_mfe: number | null;
  score: number;
};

type Props = {
  instruments: DataInstrument[];
};

export function SdSavedRunsAnalyticsView({ instruments }: Props) {
  const [runs, setRuns] = useState<SdZoneSavedRunListItem[]>([]);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(true);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [chartFilter, setChartFilter] = useState<string | "__all__">("__all__");
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setBusy(true);
    setLoadError(null);
    setDeleteError(null);
    try {
      const rows = await listSdZoneSavedRuns();
      setRuns(rows);
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byInstrument = useMemo(() => {
    const files = new Set<string>();
    for (const r of runs) {
      const df = r.data_file?.trim();
      if (df) files.add(df);
    }
    return Array.from(files).sort((a, b) => a.localeCompare(b));
  }, [runs]);

  useEffect(() => {
    if (selectedFile && !byInstrument.includes(selectedFile)) {
      setSelectedFile(null);
      setChartFilter("__all__");
    }
  }, [byInstrument, selectedFile]);

  const chartOptionsForSelection = useMemo(() => {
    if (!selectedFile) return [] as string[];
    const s = new Set<string>();
    for (const r of runs) {
      if (r.data_file !== selectedFile) continue;
      const ct = r.chart_timeframe?.trim() ?? "";
      s.add(ct);
    }
    return Array.from(s).sort((a, b) => {
      if (a === "" && b !== "") return -1;
      if (b === "" && a !== "") return 1;
      return a.localeCompare(b);
    });
  }, [runs, selectedFile]);

  useEffect(() => {
    if (chartFilter === "__all__" || !selectedFile) return;
    const normalized = chartFilter === "__native__" ? "" : chartFilter;
    if (!chartOptionsForSelection.includes(normalized)) {
      setChartFilter("__all__");
    }
  }, [chartFilter, chartOptionsForSelection, selectedFile]);

  const filteredRuns = useMemo(() => {
    if (!selectedFile) return [];
    return runs.filter((r) => r.data_file === selectedFile).filter((r) => {
      if (chartFilter === "__all__") return true;
      const ct = r.chart_timeframe?.trim() ?? "";
      const want = chartFilter === "__native__" ? "" : chartFilter;
      return ct === want;
    });
  }, [runs, selectedFile, chartFilter]);

  const pooled = useMemo(() => {
    let touches = 0;
    let winSum = 0;
    let mfeSum = 0;
    let maeSum = 0;
    let mfeW = 0;
    let maeW = 0;
    for (const r of filteredRuns) {
      const s = r.aggregate_summary;
      if (!s) continue;
      const n = safeNum(s.touch_count) ?? 0;
      if (n <= 0) continue;
      const wr = safeNum(s.win_rate_by_rr);
      const amfe = safeNum(s.avg_mfe_R);
      const amae = safeNum(s.avg_mae_R);
      touches += n;
      if (wr != null) winSum += wr * n;
      if (amfe != null) {
        mfeSum += amfe * n;
        mfeW += n;
      }
      if (amae != null) {
        maeSum += amae * n;
        maeW += n;
      }
    }
    return {
      touch_count: touches,
      win_rate_by_rr: touches > 0 ? winSum / touches : null,
      avg_mfe_R: mfeW > 0 ? mfeSum / mfeW : null,
      avg_mae_R: maeW > 0 ? maeSum / maeW : null,
      run_count: filteredRuns.length,
    };
  }, [filteredRuns]);

  const leaderboardRows = useMemo((): LeaderRow[] => {
    const map = new Map<
      string,
      { touches: number; winSum: number; mfeSum: number; maeSum: number; mfeW: number; maeW: number; df: string; chart: string; zt: string }
    >();
    for (const r of runs) {
      const df = r.data_file?.trim();
      if (!df) continue;
      const ct = r.chart_timeframe?.trim() ?? "";
      const zt = r.zone_tf?.trim() ?? "";
      const key = `${df}\0${ct}\0${zt}`;
      const s = r.aggregate_summary;
      const n = safeNum(s?.touch_count) ?? 0;
      if (n <= 0) continue;
      const wr = safeNum(s?.win_rate_by_rr);
      const amfe = safeNum(s?.avg_mfe_R);
      const amae = safeNum(s?.avg_mae_R);
      let e = map.get(key);
      if (!e) {
        e = { touches: 0, winSum: 0, mfeSum: 0, maeSum: 0, mfeW: 0, maeW: 0, df, chart: ct, zt };
        map.set(key, e);
      }
      e.touches += n;
      if (wr != null) e.winSum += wr * n;
      if (amfe != null) {
        e.mfeSum += amfe * n;
        e.mfeW += n;
      }
      if (amae != null) {
        e.maeSum += amae * n;
        e.maeW += n;
      }
    }
    const rows: LeaderRow[] = [];
    for (const e of map.values()) {
      const wr = e.touches > 0 ? e.winSum / e.touches : null;
      const avgMfe = e.mfeW > 0 ? e.mfeSum / e.mfeW : null;
      const score = (wr ?? 0) * 100 + (avgMfe ?? 0) * 2;
      rows.push({
        data_file: e.df,
        chart: e.chart,
        zone_tf: e.zt || null,
        touch_count: e.touches,
        win_rate: wr,
        avg_mfe: avgMfe,
        score,
      });
    }
    rows.sort((a, b) => b.score - a.score);
    return rows;
  }, [runs]);

  const topBars = useMemo(() => leaderboardRows.slice(0, 10), [leaderboardRows]);
  const maxWin = useMemo(() => {
    let m = 0.01;
    for (const r of topBars) {
      if (r.win_rate != null) m = Math.max(m, r.win_rate);
    }
    return m;
  }, [topBars]);

  const statCard = (label: string, value: string) => (
    <div className="rounded-lg border border-zinc-700/80 bg-zinc-900/50 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="text-lg font-semibold text-zinc-100 font-mono">{value}</div>
    </div>
  );

  return (
    <div className="flex h-full min-h-0 bg-zinc-950 text-zinc-200">
      <aside className="w-56 shrink-0 border-r border-zinc-800 flex flex-col min-h-0">
        <div className="p-3 border-b border-zinc-800 text-xs font-medium text-zinc-400 uppercase tracking-wide">
          Instrument
        </div>
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {busy ? (
            <div className="text-xs text-zinc-500 px-2 py-2">Načítám…</div>
          ) : loadError ? (
            <div className="text-xs text-rose-400 px-2">{loadError}</div>
          ) : byInstrument.length === 0 ? (
            <div className="text-xs text-zinc-500 px-2 leading-relaxed">
              Zatím žádné uložené S/D běhy. Spusť test a pak použij „Uložit backtest“ v S/D výsledcích.
            </div>
          ) : (
            byInstrument.map((file) => (
              <button
                key={file}
                type="button"
                onClick={() => {
                  setSelectedFile(file);
                  setChartFilter("__all__");
                }}
                className={`w-full text-left rounded-md px-2 py-1.5 text-sm transition-colors ${
                  selectedFile === file ? "bg-emerald-900/40 text-emerald-100 border border-emerald-800/60" : "hover:bg-zinc-800/80 border border-transparent"
                }`}
              >
                <span className="font-medium">{instrumentLabel(file, instruments)}</span>
                <div className="text-[10px] text-zinc-500 truncate" title={file}>
                  {file.replace(/\\/g, "/").split("/").pop()}
                </div>
              </button>
            ))
          )}
        </div>
      </aside>

      <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden">
        <header className="shrink-0 border-b border-zinc-800 px-4 py-3 flex items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold text-zinc-100">Analytics — uložené S/D testy</h2>
            <p className="text-xs text-zinc-500 mt-0.5">
              Porovnání instrumentu a graf TF; žebříček kombinací podle výkonnosti (win rate + MFE).
            </p>
          </div>
          <div className="flex items-center gap-2">
            {!confirmDeleteAll ? (
              <button
                type="button"
                onClick={() => {
                  setConfirmDeleteAll(true);
                  setDeleteError(null);
                }}
                disabled={busy || runs.length === 0}
                className="shrink-0 rounded-md border border-rose-600/40 bg-rose-900/20 px-3 py-1.5 text-xs font-medium text-rose-100 hover:bg-rose-900/30 disabled:opacity-50"
                title="Smaže všechny uložené S/D běhy (hard-delete souborů)."
              >
                Smazat vše
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setConfirmDeleteAll(false)}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
                >
                  Zrušit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    void (async () => {
                      setBusy(true);
                      setDeleteError(null);
                      try {
                        await deleteAllSdZoneSavedRuns();
                        setConfirmDeleteAll(false);
                        setSelectedFile(null);
                        setChartFilter("__all__");
                        await load();
                      } catch (e) {
                        setDeleteError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setBusy(false);
                      }
                    })();
                  }}
                  disabled={busy}
                  className="shrink-0 rounded-md border border-rose-600/40 bg-rose-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-rose-600 disabled:opacity-50"
                >
                  Potvrdit smazání
                </button>
              </>
            )}
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="shrink-0 rounded-md border border-zinc-600 bg-zinc-800 px-3 py-1.5 text-xs font-medium hover:bg-zinc-700 disabled:opacity-50"
            >
              Obnovit
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 space-y-6">
          {deleteError ? (
            <div className="rounded border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-100">
              {deleteError}
            </div>
          ) : null}
          {!selectedFile ? (
            <div className="text-sm text-zinc-500">Vyber instrument vlevo.</div>
          ) : (
            <>
              <div>
                <div className="text-[10px] uppercase tracking-wide text-zinc-500 mb-2">Graf (OHLC) timeframe</div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setChartFilter("__all__")}
                    className={`rounded-full px-3 py-1 text-xs font-medium border ${
                      chartFilter === "__all__"
                        ? "border-emerald-600 bg-emerald-900/30 text-emerald-100"
                        : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
                    }`}
                  >
                    Všechny TF
                  </button>
                  {chartOptionsForSelection.map((ct) => {
                    const tfKey = ct === "" ? "__native__" : ct;
                    const active = chartFilter === tfKey;
                    return (
                      <button
                        key={tfKey}
                        type="button"
                        onClick={() => setChartFilter(tfKey)}
                        className={`rounded-full px-3 py-1 text-xs font-medium border ${
                          active
                            ? "border-emerald-600 bg-emerald-900/30 text-emerald-100"
                            : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-500"
                        }`}
                      >
                        {chartTfLabel(ct || null)}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 max-w-4xl">
                {statCard("Uložených běhů (filtr)", String(pooled.run_count))}
                {statCard("Dotyků (vážený součet)", String(pooled.touch_count))}
                {statCard(
                  "Win rate (vážený)",
                  pooled.win_rate_by_rr != null ? `${(pooled.win_rate_by_rr * 100).toFixed(1)} %` : "—",
                )}
                {statCard("Ø MFE (R)", pooled.avg_mfe_R != null ? pooled.avg_mfe_R.toFixed(2) : "—")}
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Win rate — top kombinace</h3>
                <div className="space-y-2 max-w-3xl">
                  {topBars.length === 0 ? (
                    <div className="text-xs text-zinc-500">Nedostatek dat pro graf.</div>
                  ) : (
                    topBars.map((row, i) => {
                      const wr = row.win_rate ?? 0;
                      const pct = Math.min(100, (wr / maxWin) * 100);
                      const lab = `${instrumentLabel(row.data_file, instruments)} · ${chartTfLabel(row.chart || null)} · Zóna ${row.zone_tf ?? "?"}`;
                      return (
                        <div key={`${row.data_file}-${row.chart}-${row.zone_tf}-${i}`} className="space-y-0.5">
                          <div className="flex justify-between text-[11px] text-zinc-400">
                            <span className="truncate pr-2" title={lab}>
                              {lab}
                            </span>
                            <span className="shrink-0 font-mono text-zinc-200">{(wr * 100).toFixed(1)}%</span>
                          </div>
                          <div className="h-2 rounded-full bg-zinc-800 overflow-hidden">
                            <div className="h-full rounded-full bg-emerald-600/80" style={{ width: `${pct}%` }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">
                  Žebříček — nejvýdělečnější kombinace (heuristika: win rate + MFE)
                </h3>
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-zinc-500">
                        <th className="px-3 py-2">#</th>
                        <th className="px-3 py-2">Instrument</th>
                        <th className="px-3 py-2">Graf TF</th>
                        <th className="px-3 py-2">Zone TF</th>
                        <th className="px-3 py-2 text-right">Dotyky</th>
                        <th className="px-3 py-2 text-right">Win %</th>
                        <th className="px-3 py-2 text-right">Ø MFE R</th>
                      </tr>
                    </thead>
                    <tbody>
                      {leaderboardRows.map((row, idx) => (
                        <tr key={`${row.data_file}-${row.chart}-${row.zone_tf}-${idx}`} className="border-b border-zinc-800/80 hover:bg-zinc-900/40">
                          <td className="px-3 py-1.5 text-zinc-500">{idx + 1}</td>
                          <td className="px-3 py-1.5 font-medium">{instrumentLabel(row.data_file, instruments)}</td>
                          <td className="px-3 py-1.5 font-mono text-zinc-300">{chartTfLabel(row.chart || null)}</td>
                          <td className="px-3 py-1.5 font-mono text-zinc-400">{row.zone_tf ?? "—"}</td>
                          <td className="px-3 py-1.5 text-right font-mono">{row.touch_count}</td>
                          <td className="px-3 py-1.5 text-right font-mono">
                            {row.win_rate != null ? `${(row.win_rate * 100).toFixed(1)}` : "—"}
                          </td>
                          <td className="px-3 py-1.5 text-right font-mono">{row.avg_mfe != null ? row.avg_mfe.toFixed(2) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {leaderboardRows.length === 0 && (
                    <div className="px-3 py-6 text-center text-zinc-500 text-xs">Žádné agregované metriky v uložených bězích.</div>
                  )}
                </div>
              </div>

              <div>
                <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wide mb-2">Uložené běhy (filtr)</h3>
                <div className="overflow-x-auto rounded-lg border border-zinc-800">
                  <table className="min-w-full text-xs">
                    <thead>
                      <tr className="border-b border-zinc-800 bg-zinc-900/80 text-left text-zinc-500">
                        <th className="px-3 py-2">Created</th>
                        <th className="px-3 py-2">Graf TF</th>
                        <th className="px-3 py-2">Zone TF</th>
                        <th className="px-3 py-2 text-right">Touches</th>
                        <th className="px-3 py-2 text-right">Win %</th>
                        <th className="px-3 py-2 text-right">Ø MFE R</th>
                        <th className="px-3 py-2 text-right">Akce</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredRuns.map((r) => {
                        const s = r.aggregate_summary;
                        const touches = safeNum(s?.touch_count) ?? null;
                        const wr = safeNum(s?.win_rate_by_rr);
                        const mfe = safeNum(s?.avg_mfe_R);
                        return (
                          <tr key={r.run_id} className="border-b border-zinc-800/80 hover:bg-zinc-900/40">
                            <td className="px-3 py-1.5 font-mono text-zinc-400">{(r.created_at ?? "").slice(0, 19) || "—"}</td>
                            <td className="px-3 py-1.5 font-mono text-zinc-300">{chartTfLabel(r.chart_timeframe || null)}</td>
                            <td className="px-3 py-1.5 font-mono text-zinc-400">{r.zone_tf ?? "—"}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{touches != null ? String(touches) : "—"}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{wr != null ? (wr * 100).toFixed(1) : "—"}</td>
                            <td className="px-3 py-1.5 text-right font-mono">{mfe != null ? mfe.toFixed(2) : "—"}</td>
                            <td className="px-3 py-1.5 text-right">
                              <button
                                type="button"
                                disabled={busy}
                                onClick={() => {
                                  void (async () => {
                                    setBusy(true);
                                    setDeleteError(null);
                                    try {
                                      await deleteSdZoneSavedRun(r.run_id);
                                      await load();
                                    } catch (e) {
                                      setDeleteError(e instanceof Error ? e.message : String(e));
                                    } finally {
                                      setBusy(false);
                                    }
                                  })();
                                }}
                                className="rounded-md border border-rose-600/40 bg-rose-900/20 px-2 py-1 text-[11px] font-medium text-rose-100 hover:bg-rose-900/30 disabled:opacity-50"
                                title={`Smazat uložený běh ${r.run_id}`}
                              >
                                Smazat
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
                <div className="mt-2 text-[11px] text-zinc-600 leading-snug">
                  Pozn.: Mazání je hard-delete uložených JSON souborů v <code className="text-zinc-400">.sd_zone_saved_runs/</code>.
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
