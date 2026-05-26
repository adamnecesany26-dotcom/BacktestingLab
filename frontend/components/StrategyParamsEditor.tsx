"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import type { BacktestFieldHelp } from "@/components/backtestFieldMeta";
import {
  orderParamEntriesForNestedDisplay,
  paramFieldVisible,
  type StrategyParamValue,
  type StrategyParams,
  type StrategyParamsMeta,
} from "@/lib/strategyParams";

function groupParamEntriesInOrder(
  entries: [string, StrategyParamValue][],
  metaMap: StrategyParamsMeta,
): { group: string; entries: [string, StrategyParamValue][] }[] {
  const out: { group: string; entries: [string, StrategyParamValue][] }[] = [];
  const indexByGroup = new Map<string, number>();
  for (const ent of entries) {
    const [k] = ent;
    const raw = metaMap[k]?.group?.trim();
    const g = raw && raw.length > 0 ? raw : "General";
    let idx = indexByGroup.get(g);
    if (idx === undefined) {
      idx = out.length;
      indexByGroup.set(g, idx);
      out.push({ group: g, entries: [] });
    }
    out[idx]!.entries.push(ent);
  }
  for (const block of out) {
    block.entries.sort((a, b) => {
      const oa = metaMap[a[0]]?.order ?? 99999;
      const ob = metaMap[b[0]]?.order ?? 99999;
      if (oa !== ob) return oa - ob;
      return a[0].localeCompare(b[0]);
    });
  }
  const minOrder = (block: { entries: [string, StrategyParamValue][] }) => {
    const xs = block.entries.map(([k]) => metaMap[k]?.order ?? 99999);
    return xs.length > 0 ? Math.min(...xs) : 99999;
  };
  out.sort((a, b) => {
    const ma = minOrder(a);
    const mb = minOrder(b);
    if (ma !== mb) return ma - mb;
    return a.group.localeCompare(b.group);
  });
  return out;
}

export function StrategyConfigModal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  size = "xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  size?: "lg" | "xl";
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open || !mounted) return null;

  const maxW = size === "xl" ? "max-w-xl" : "max-w-lg";

  return createPortal(
    <div className="fixed inset-0 z-[9500] flex items-start justify-center p-4 sm:items-center sm:p-6">
      <div
        className="absolute inset-0 bg-black/55 backdrop-blur-[1px]"
        onClick={onClose}
        aria-hidden
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="strategy-config-modal-title"
        className={`relative z-[9501] w-full ${maxW} max-h-[min(90vh,920px)] flex flex-col rounded-xl border border-zinc-600/80 bg-zinc-900 shadow-2xl shadow-black/50`}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-zinc-800/80 shrink-0">
          <div className="min-w-0 pr-2">
            <h2 id="strategy-config-modal-title" className="text-[15px] font-semibold text-zinc-100 tracking-tight">
              {title}
            </h2>
            {subtitle ? (
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{subtitle}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="shrink-0 rounded-lg p-2 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100"
            aria-label="Zavřít"
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-3 min-h-0">{children}</div>
        {footer ? (
          <div className="shrink-0 px-5 py-3 border-t border-zinc-800 bg-zinc-950/60 rounded-b-xl">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}

export function StrategyParamsFieldList({
  entries,
  current,
  onPatch,
  metaMap,
  getHelp,
  inputClass,
  labelClassName = "text-sm text-zinc-300 font-medium",
  showTechnicalKey = true,
}: {
  entries: [string, StrategyParamValue][];
  current: StrategyParams;
  onPatch: (next: StrategyParams) => void;
  metaMap: StrategyParamsMeta;
  getHelp: (paramKey: string) => BacktestFieldHelp;
  inputClass: string;
  labelClassName?: string;
  /** When title exists, still show snake_case key under the label. */
  showTechnicalKey?: boolean;
}) {
  const visibleEntries = useMemo(
    () => entries.filter(([key]) => paramFieldVisible(metaMap[key], current)),
    [entries, metaMap, current],
  );

  const grouped = useMemo(
    () => groupParamEntriesInOrder(visibleEntries, metaMap),
    [visibleEntries, metaMap],
  );

  const showGroupHeaders =
    grouped.length > 1 ||
    (grouped[0] != null && grouped[0].group !== "General" && grouped[0].group !== "Obecné");

  const rows: ReactNode[] = [];
  for (const block of grouped) {
    if (showGroupHeaders) {
      rows.push(
        <div key={`g-${block.group}`} className="pt-2 first:pt-0">
          <h3 className="text-[11px] font-semibold uppercase tracking-wider text-zinc-500 mb-3 border-b border-zinc-800 pb-1.5">
            {block.group}
          </h3>
        </div>,
      );
    }
    for (const [key, value] of block.entries) {
      const meta = metaMap[key] ?? {};
      const displayLabel = meta.title?.trim() || key;
      const opts = meta.options;
      const useSelect = Array.isArray(opts) && opts.length > 0;
      const isMultiselect = meta.widget === "multiselect" && useSelect;
      const legacyBoolNumber =
        meta.booleanWidget && typeof value === "number" && (value === 0 || value === 1);
      const asBoolCheckbox = typeof value === "boolean" || legacyBoolNumber;
      const boolVal =
        typeof value === "boolean" ? value : legacyBoolNumber ? value === 1 : Boolean(value);
      const help = getHelp(key);
      const nested =
        Boolean(meta.dependsOnParam?.trim()) || Boolean(meta.dependsOnParam2?.trim());

      rows.push(
        <div
          key={key}
          className={`rounded-lg border border-zinc-800/90 bg-zinc-950/35 px-3 py-2.5 space-y-2 ${
            nested ? "ml-2 border-l-2 border-l-zinc-600/55 pl-3" : ""
          }`}
        >
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={labelClassName}>{displayLabel}</span>
                <FieldHelpPopover help={help} />
              </div>
              {showTechnicalKey && meta.title?.trim() ? (
                <span className="text-[10px] text-zinc-600 font-mono block mt-0.5">{key}</span>
              ) : null}
            </div>
          </div>
          {isMultiselect ? (
            <div className="flex flex-wrap gap-x-3 gap-y-2">
              {opts!.map((opt, i) => {
                const selected = new Set(
                  String(value ?? "")
                    .split(",")
                    .map((s) => s.trim())
                    .filter(Boolean),
                );
                const on = selected.has(opt);
                return (
                  <label key={`${key}-${opt}`} className="flex items-center gap-2 cursor-pointer text-sm text-zinc-300">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const nextSel = new Set(selected);
                        if (nextSel.has(opt)) nextSel.delete(opt);
                        else nextSel.add(opt);
                        const ordered = opts!.filter((o) => nextSel.has(o));
                        onPatch({ ...current, [key]: ordered.join(",") });
                      }}
                      className="rounded border-zinc-600"
                    />
                    <span>{meta.optionLabels?.[i] ?? opt}</span>
                  </label>
                );
              })}
            </div>
          ) : useSelect ? (
            <select
              value={String(value)}
              onChange={(e) => {
                onPatch({ ...current, [key]: e.target.value });
              }}
              className={inputClass}
            >
              {opts!.map((opt, i) => (
                <option key={`${i}-${opt || "__empty"}`} value={opt}>
                  {meta.optionLabels?.[i] ?? (opt === "" ? "(výchozí / prázdné)" : opt)}
                </option>
              ))}
            </select>
          ) : asBoolCheckbox ? (
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={boolVal}
                onChange={(e) => {
                  const on = e.target.checked;
                  onPatch({
                    ...current,
                    [key]: legacyBoolNumber ? (on ? 1 : 0) : on,
                  });
                }}
                className="rounded border-zinc-600"
              />
              <span className="text-sm text-zinc-300">
                {legacyBoolNumber ? (boolVal ? "Zapnuto (1)" : "Vypnuto (0)") : boolVal ? "Ano" : "Ne"}
              </span>
            </label>
          ) : typeof value === "number" ? (
            <input
              type="number"
              value={value}
              onChange={(e) => {
                const v = parseFloat(e.target.value);
                if (!Number.isNaN(v)) {
                  onPatch({ ...current, [key]: v });
                }
              }}
              step={Number.isInteger(value) ? 1 : 0.01}
              className={inputClass}
            />
          ) : (
            <input
              type="text"
              value={String(value)}
              onChange={(e) => onPatch({ ...current, [key]: e.target.value })}
              className={inputClass}
            />
          )}
        </div>,
      );
    }
  }

  if (rows.length === 0) {
    return <p className="text-sm text-zinc-500">Žádná viditelná pole pro aktuální kombinaci parametrů.</p>;
  }

  return <div className="space-y-2">{rows}</div>;
}
