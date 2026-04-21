"use client";

import { useEffect, useMemo, useState } from "react";
import type { SdZoneJournalItem } from "@/lib/api";
import { deleteAllSdZoneAnnotations, deleteSdZoneAnnotation, getSdZoneJournal } from "@/lib/api";

type SortKey = "updated_at" | "r" | "duration_bars" | "entry_date";
type SortDir = "desc" | "asc";

function safeNum(x: unknown): number | null {
  const n = Number(x);
  return Number.isFinite(n) ? n : null;
}

function safeStr(x: unknown): string {
  return typeof x === "string" ? x : x == null ? "" : String(x);
}

function uniqSorted(xs: string[]): string[] {
  const set = new Set(xs.filter((x) => x.trim()));
  return Array.from(set).sort((a, b) => a.localeCompare(b));
}

export function SdZoneJournalView() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [items, setItems] = useState<SdZoneJournalItem[]>([]);
  const [busyDeleteAll, setBusyDeleteAll] = useState(false);
  const [busyDeleteKey, setBusyDeleteKey] = useState<string | null>(null);

  const [dataFileFilter, setDataFileFilter] = useState<string>("all");
  const [sourceTfFilter, setSourceTfFilter] = useState<string>("all");
  const [zoneNameFilter, setZoneNameFilter] = useState<string>("all");
  const [q, setQ] = useState("");

  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  // dynamic tag filters: tag -> required present
  const [tagFilters, setTagFilters] = useState<Record<string, boolean>>({});

  const load = useMemo(() => {
    return async () => {
      setLoading(true);
      setError(null);
      const res = await getSdZoneJournal();
      setItems(Array.isArray(res.items) ? res.items : []);
      setLoading(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        await load();
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [load]);

  const dataFileOptions = useMemo(() => {
    const xs = items.map((it) => safeStr(it.data_file)).filter(Boolean);
    return uniqSorted(xs);
  }, [items]);

  const sourceTfOptions = useMemo(() => {
    const xs = items.map((it) => safeStr(it.source_tf)).filter(Boolean);
    return uniqSorted(xs);
  }, [items]);

  const zoneNameOptions = useMemo(() => {
    const xs = items.map((it) => safeStr(it.zone_name)).filter(Boolean);
    return uniqSorted(xs);
  }, [items]);

  const tagOptions = useMemo(() => {
    const tags: string[] = [];
    for (const it of items) {
      const arr = Array.isArray((it as any).tags) ? ((it as any).tags as unknown[]) : [];
      for (const t of arr) {
        const s = safeStr(t).trim();
        if (s) tags.push(s);
      }
      // legacy fallback: checked checkbox labels
      const legacy = Array.isArray((it as any).items) ? ((it as any).items as any[]) : [];
      for (const row of legacy) {
        if (!row || typeof row !== "object") continue;
        if (!Boolean((row as any).checked)) continue;
        const lab = safeStr((row as any).label).trim();
        if (lab) tags.push(lab);
      }
    }
    return uniqSorted(tags);
  }, [items]);

  const filtered = useMemo(() => {
    const qq = q.trim().toLowerCase();
    return items.filter((it) => {
      if (dataFileFilter !== "all" && safeStr(it.data_file) !== dataFileFilter) return false;
      if (sourceTfFilter !== "all" && safeStr(it.source_tf) !== sourceTfFilter) return false;
      if (zoneNameFilter !== "all" && safeStr(it.zone_name) !== zoneNameFilter) return false;
      if (qq) {
        const blob = [
          safeStr(it.comment),
          safeStr(it.trade_id),
          safeStr(it.zone_id),
          safeStr(it.data_file),
        ]
          .join(" ")
          .toLowerCase();
        if (!blob.includes(qq)) return false;
      }
      // dynamic tags: tag must be present
      const need = Object.entries(tagFilters).filter(([, v]) => v).map(([k]) => k);
      if (need.length) {
        const tags = Array.isArray((it as any).tags) ? ((it as any).tags as unknown[]) : [];
        const tagSet = new Set(tags.map((t) => safeStr(t).trim()).filter((t) => t.length > 0));
        if (tagSet.size === 0) return false;
        for (const t of need) {
          if (!tagSet.has(t)) return false;
        }
      }
      return true;
    });
  }, [dataFileFilter, items, q, sourceTfFilter, tagFilters, zoneNameFilter]);

  const sorted = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    const score = (it: SdZoneJournalItem): { n: number | null; s: string } => {
      if (sortKey === "updated_at") return { n: null, s: safeStr(it.updated_at) };
      if (sortKey === "entry_date") return { n: null, s: safeStr(it.entry_date) };
      if (sortKey === "duration_bars") return { n: safeNum(it.duration_bars), s: "" };
      // r
      return { n: safeNum(it.r_for_sort ?? it.mfe_before_sl_R ?? it.mfe_R), s: "" };
    };
    const rows = [...filtered];
    rows.sort((a, b) => {
      const ka = score(a);
      const kb = score(b);
      if (ka.n != null || kb.n != null) {
        const an = ka.n ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        const bn = kb.n ?? (sortDir === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY);
        if (an !== bn) return (an - bn) * dir;
        // tie-breaker
        return safeStr(b.updated_at).localeCompare(safeStr(a.updated_at));
      }
      // string sort
      if (ka.s !== kb.s) return ka.s.localeCompare(kb.s) * dir;
      return safeStr(b.updated_at).localeCompare(safeStr(a.updated_at));
    });
    return rows;
  }, [filtered, sortDir, sortKey]);

  const [selected, setSelected] = useState<SdZoneJournalItem | null>(null);

  return (
    <div className="py-4 h-full overflow-auto">
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900/50 p-4 space-y-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[12rem]">
            <div className="text-[11px] text-zinc-500 mb-1">Instrument (data_file)</div>
            <select
              value={dataFileFilter}
              onChange={(e) => setDataFileFilter(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 text-sm"
            >
              <option value="all">Vše</option>
              {dataFileOptions.map((x) => (
                <option key={x} value={x}>
                  {x.split(/[/\\]/).pop() ?? x}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[8rem]">
            <div className="text-[11px] text-zinc-500 mb-1">TF zóny (source_tf)</div>
            <select
              value={sourceTfFilter}
              onChange={(e) => setSourceTfFilter(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 text-sm"
            >
              <option value="all">Vše</option>
              {sourceTfOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[8rem]">
            <div className="text-[11px] text-zinc-500 mb-1">Supply/Demand</div>
            <select
              value={zoneNameFilter}
              onChange={(e) => setZoneNameFilter(e.target.value)}
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 text-sm"
            >
              <option value="all">Vše</option>
              {zoneNameOptions.map((x) => (
                <option key={x} value={x}>
                  {x}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[12rem]">
            <div className="text-[11px] text-zinc-500 mb-1">Hledat (poznámka / id)</div>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="text…"
              className="w-full bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 text-sm"
            />
          </div>
          <div className="min-w-[10rem]">
            <div className="text-[11px] text-zinc-500 mb-1">Řazení</div>
            <div className="flex gap-2">
              <select
                value={sortKey}
                onChange={(e) => setSortKey(e.target.value as SortKey)}
                className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 text-sm"
              >
                <option value="updated_at">Updated</option>
                <option value="entry_date">Entry date</option>
                <option value="r">R (MFE)</option>
                <option value="duration_bars">Délka (bary)</option>
              </select>
              <select
                value={sortDir}
                onChange={(e) => setSortDir(e.target.value as SortDir)}
                className="bg-zinc-800 border border-zinc-600 rounded px-2 py-1.5 text-zinc-200 text-sm"
              >
                <option value="desc">↓</option>
                <option value="asc">↑</option>
              </select>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              disabled={busyDeleteAll || items.length === 0}
              onClick={() => {
                if (busyDeleteAll) return;
                const ok = confirm("Opravdu smazat VŠECHNY anotace ze všech uložených backtestů?");
                if (!ok) return;
                (async () => {
                  setBusyDeleteAll(true);
                  setError(null);
                  try {
                    await deleteAllSdZoneAnnotations();
                    setSelected(null);
                    await load();
                  } catch (e) {
                    setError(e instanceof Error ? e.message : String(e));
                  } finally {
                    setBusyDeleteAll(false);
                  }
                })();
              }}
              className="rounded-lg px-3 py-1.5 text-sm border border-rose-700/40 bg-rose-950/30 hover:bg-rose-900/30 text-rose-200 disabled:opacity-50"
              title="Smazat všechny anotace (globálně)"
            >
              {busyDeleteAll ? "Mažu…" : "Smazat vše"}
            </button>
          </div>
        </div>

        {tagOptions.length > 0 && (
          <div className="pt-2 border-t border-zinc-800/60">
            <div className="text-[11px] text-zinc-500 mb-1">Filtry (tagy)</div>
            <div className="flex flex-wrap gap-3">
              {tagOptions.map((label) => (
                <label key={label} className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={!!tagFilters[label]}
                    onChange={(e) => setTagFilters((p) => ({ ...p, [label]: e.target.checked }))}
                    className="accent-emerald-600"
                  />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-1 xl:grid-cols-2 gap-3">
        <div className="space-y-2">
          {loading ? (
            <div className="text-sm text-zinc-500">Načítám Journal…</div>
          ) : error ? (
            <div className="text-sm text-rose-300">{error}</div>
          ) : sorted.length === 0 ? (
            <div className="text-sm text-zinc-500">Žádné anotace.</div>
          ) : (
            <>
              <div className="text-xs text-zinc-500">Nalezeno: {sorted.length}</div>
              {sorted.map((it, idx) => {
                const title = [
                  safeStr(it.data_file).split(/[/\\]/).pop(),
                  safeStr(it.source_tf),
                  safeStr(it.zone_name),
                ]
                  .filter(Boolean)
                  .join(" · ");
                const r = safeNum(it.r_for_sort ?? it.mfe_before_sl_R ?? it.mfe_R);
                const dur = safeNum(it.duration_bars);
                const updated = safeStr(it.updated_at);
                const comment = safeStr(it.comment).trim();
                const runId = safeStr(it.run_id);
                const delKey = `${runId}:${safeStr(it.zone_id)}:${safeStr(it.source_tf)}:${safeStr(it.trade_id)}`;
                return (
                  <button
                    key={`${safeStr(it.run_id)}-${safeStr(it.trade_id)}-${idx}`}
                    type="button"
                    onClick={() => setSelected(it)}
                    className="w-full text-left rounded-xl border border-zinc-800 bg-zinc-950/80 hover:bg-zinc-950 px-3 py-2.5"
                  >
                    <div className="flex items-center gap-2">
                      <div className="text-sm font-semibold text-zinc-100 truncate">{title || "Anotace"}</div>
                      <button
                        type="button"
                        disabled={
                          busyDeleteAll ||
                          busyDeleteKey === delKey ||
                          !runId ||
                          !safeStr(it.zone_id) ||
                          !safeStr(it.source_tf) ||
                          !safeStr(it.trade_id)
                        }
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const ok = confirm("Smazat tuto anotaci?");
                          if (!ok) return;
                          (async () => {
                            setBusyDeleteKey(delKey);
                            setError(null);
                            try {
                              await deleteSdZoneAnnotation(runId, {
                                zone_id: safeStr(it.zone_id),
                                source_tf: safeStr(it.source_tf),
                                trade_id: safeStr(it.trade_id),
                              });
                              setSelected((prev) => {
                                if (!prev) return prev;
                                const same =
                                  safeStr(prev.run_id) === runId &&
                                  safeStr(prev.zone_id) === safeStr(it.zone_id) &&
                                  safeStr(prev.source_tf) === safeStr(it.source_tf) &&
                                  safeStr(prev.trade_id) === safeStr(it.trade_id);
                                return same ? null : prev;
                              });
                              await load();
                            } catch (e2) {
                              setError(e2 instanceof Error ? e2.message : String(e2));
                            } finally {
                              setBusyDeleteKey(null);
                            }
                          })();
                        }}
                        className="ml-auto rounded-md px-2 py-1 text-[11px] border border-rose-700/40 bg-rose-950/30 hover:bg-rose-900/30 text-rose-200 disabled:opacity-50"
                        title="Smazat anotaci"
                      >
                        {busyDeleteKey === delKey ? "…" : "Smazat"}
                      </button>
                      <div className="text-[11px] text-zinc-500 font-mono">{updated ? updated.slice(0, 19) : ""}</div>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-400">
                      {r != null && <span>R: <span className="font-mono text-emerald-200">{r.toFixed(2)}</span></span>}
                      {dur != null && <span>Dur: <span className="font-mono text-zinc-200">{dur}</span> bars</span>}
                      {it.entry_date && <span>Entry: <span className="font-mono text-zinc-200">{safeStr(it.entry_date).slice(0, 10)}</span></span>}
                      {safeStr(it.run_id) && <span>Run: <span className="font-mono">{safeStr(it.run_id).slice(0, 8)}…</span></span>}
                    </div>
                    {comment ? (
                      <div className="mt-2 text-xs text-zinc-200/90 line-clamp-3 whitespace-pre-wrap">{comment}</div>
                    ) : (
                      <div className="mt-2 text-xs text-zinc-600 italic">bez poznámky</div>
                    )}
                  </button>
                );
              })}
            </>
          )}
        </div>

        <div className="rounded-xl border border-zinc-800 bg-zinc-950/60 p-4 min-h-[240px]">
          {!selected ? (
            <div className="text-sm text-zinc-500">Klikni na kartu vlevo pro detail.</div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2">
                <div className="text-sm font-semibold text-zinc-100">Detail anotace</div>
                <div className="ml-auto text-[11px] text-zinc-500 font-mono">{safeStr(selected.updated_at).slice(0, 19)}</div>
              </div>
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">Instrument</div>
                  <div className="font-mono text-zinc-200 break-all">{safeStr(selected.data_file)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">Zone TF · Typ</div>
                  <div className="font-mono text-zinc-200">
                    {[safeStr(selected.source_tf), safeStr(selected.zone_name)].filter(Boolean).join(" · ") || "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">TradeID</div>
                  <div className="font-mono text-zinc-200 break-all">{safeStr(selected.trade_id)}</div>
                </div>
                <div>
                  <div className="text-[11px] text-zinc-500 mb-1">R / Dur</div>
                  <div className="font-mono text-zinc-200">
                    {safeNum(selected.r_for_sort ?? selected.mfe_before_sl_R ?? selected.mfe_R)?.toFixed(2) ?? "—"} ·{" "}
                    {safeNum(selected.duration_bars) ?? "—"} bars
                  </div>
                </div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Tagy</div>
                <div className="flex flex-wrap gap-2">
                  {(Array.isArray((selected as any).tags) ? ((selected as any).tags as unknown[]) : [])
                    .map((t: any) => safeStr(t).trim())
                    .filter((t: string) => t.length > 0)
                    .map((t: string) => (
                      <span
                        key={t}
                        className="px-2 py-1 rounded-full text-[11px] border border-emerald-600/40 bg-emerald-500/10 text-emerald-100"
                      >
                        {t}
                      </span>
                    ))}
                  {(!Array.isArray((selected as any).tags) || ((selected as any).tags as unknown[]).length === 0) && (
                    <span className="text-xs text-zinc-600 italic">žádné</span>
                  )}
                </div>
              </div>
              <div>
                <div className="text-[11px] text-zinc-500 mb-1">Poznámka</div>
                <div className="text-xs text-zinc-200 whitespace-pre-wrap">{safeStr(selected.comment) || "—"}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

