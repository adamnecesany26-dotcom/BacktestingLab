"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FieldHelpPopover } from "@/components/FieldHelpPopover";
import { backtestFieldHelp } from "@/components/backtestFieldMeta";
import { runSdZoneTestOrCached } from "@/lib/api";
import type { SdZoneTestResponse, SdZoneTestRunBody } from "@/lib/api";
import { MIN_BACKTEST_YEARS, QUICK_RANGE_MONTHS_YEARS } from "@/lib/dataRange";
import type { DataInstrument } from "@shared/types";

const CHART_TF_OPTIONS = [
  { value: "native", label: "Native" },
  { value: "30m", label: "30m" },
  { value: "1h", label: "1h" },
  { value: "4h", label: "4h" },
  { value: "1D", label: "1D" },
];

type Props = {
  instruments: DataInstrument[];
  instrumentsLoaded: boolean;
  dataLoadError: string | null;
  dataFile: string | null;
  onDataFileChange: (file: string) => void;
  years: number;
  onYearsChange: (y: number) => void;
  busy: boolean;
  onBusy: (busy: boolean) => void;
  onRequest?: (body: SdZoneTestRunBody) => void;
  onResult: (res: SdZoneTestResponse) => void;
  /** Nastaví se při načtení z uloženého běhu (cache) nebo null po čerstvém přepočtu. */
  onSavedRunId?: (id: string | null) => void;
  /** Count of currently loaded saved runs (Run history). */
  savedRunsCount?: number;
  /** Soft-delete all saved runs for current strategy (Run history). */
  onDeleteSavedBacktests?: () => void;
};

const inputClass =
  "w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm text-zinc-200";

export function SdTestingSettings({
  instruments,
  instrumentsLoaded,
  dataLoadError,
  dataFile,
  onDataFileChange,
  years,
  onYearsChange,
  busy,
  onBusy,
  onRequest,
  onResult,
  onSavedRunId,
  savedRunsCount = 0,
  onDeleteSavedBacktests,
}: Props) {
  const [chartTf, setChartTf] = useState("native");
  const ZONE_TF_OPTIONS = ["1Mo", "1W", "1D", "4h", "1h"] as const;
  const [zoneTfs, setZoneTfs] = useState<string[]>([]);
  const [entryMode, setEntryMode] = useState<"touch_price" | "zone_edge" | "zone_mid">("touch_price");
  const [slMult, setSlMult] = useState(1.25);
  const [useSlSweep, setUseSlSweep] = useState(false);
  const [slSweepMin, setSlSweepMin] = useState(0.5);
  const [slSweepMax, setSlSweepMax] = useState(1.1);
  const [maxMfeR, setMaxMfeR] = useState(10);
  const [winnerRr, setWinnerRr] = useState(1.5);
  /** Prázdný řetězec = neposílat breakeven_move_r (vypnuto). */
  const [breakevenMoveR, setBreakevenMoveR] = useState("");
  const [riskDisplay, setRiskDisplay] = useState<"r" | "usd">("r");
  const [equity, setEquity] = useState(100_000);
  const [riskPct, setRiskPct] = useState(0.01);
  const [riskMin, setRiskMin] = useState(0.005);
  const [riskMax, setRiskMax] = useState(0.02);
  const [riskSeed, setRiskSeed] = useState(42);
  const [useRiskRange, setUseRiskRange] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteSaved, setConfirmDeleteSaved] = useState(false);

  // Default candle TF based on chosen zone TF (only when exactly 1 TF is selected).
  useEffect(() => {
    if (zoneTfs.length !== 1) return;
    const z = String(zoneTfs[0] ?? "").trim();
    if (!z) return;
    const low = z.toLowerCase();
    if (low === "1h" || low === "4h") {
      setChartTf(low);
      return;
    }
    if (low === "1d") {
      setChartTf("1D");
      return;
    }
    if (low === "1w") {
      setChartTf("1W");
      return;
    }
    if (z === "1M" || low === "1m") {
      setChartTf("1Mo");
      return;
    }
  }, [zoneTfs]);

  const selectedInv = useMemo(
    () => instruments.find((i) => i.file === dataFile) ?? null,
    [instruments, dataFile],
  );

  const maxYears = useMemo(() => {
    if (selectedInv && selectedInv.yearsAvailable > 0) return selectedInv.yearsAvailable;
    return 100;
  }, [selectedInv]);

  const clampYears = useCallback(
    (y: number) => Math.max(MIN_BACKTEST_YEARS, Math.min(y, maxYears)),
    [maxYears],
  );

  const handleRun = useCallback(async () => {
    setError(null);
    if (!dataFile?.trim()) {
      setError("Vyberte instrument (datový soubor).");
      return;
    }
    onBusy(true);
    try {
      const beTrim = breakevenMoveR.trim();
      let breakeven_move_r: number | undefined;
      if (beTrim !== "") {
        const v = Number(beTrim.replace(",", "."));
        if (Number.isFinite(v) && v > 0) {
          breakeven_move_r = Math.min(50, v);
        }
      }
      const body: SdZoneTestRunBody = {
        data_file: dataFile,
        years,
        chart_timeframe: chartTf === "native" ? null : chartTf,
        zone_timeframe: null,
        zone_timeframes: zoneTfs.length ? zoneTfs : null,
        entry_price_mode: entryMode,
        sl_zone_height_mult: useSlSweep ? slSweepMin : slMult,
        sl_zone_height_mult_range: useSlSweep ? { min: slSweepMin, max: slSweepMax } : null,
        max_mfe_R: maxMfeR,
        winner_rr: winnerRr,
        ...(breakeven_move_r != null ? { breakeven_move_r } : {}),
        risk_display: riskDisplay,
        equity,
        risk_pct: riskPct,
        risk_pct_range: useRiskRange ? { min: riskMin, max: riskMax } : null,
        risk_seed: useRiskRange ? riskSeed : null,
      };
      onRequest?.(body);
      const { result: res, savedRunId } = await runSdZoneTestOrCached(body);
      onSavedRunId?.(savedRunId);
      onResult(res);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      onBusy(false);
    }
  }, [
    dataFile,
    years,
    chartTf,
    zoneTfs,
    entryMode,
    slMult,
    useSlSweep,
    slSweepMin,
    slSweepMax,
    maxMfeR,
    winnerRr,
    breakevenMoveR,
    riskDisplay,
    equity,
    riskPct,
    riskMin,
    riskMax,
    riskSeed,
    useRiskRange,
    onBusy,
    onRequest,
    onResult,
  ]);

  return (
    <div className="space-y-4 text-sm text-zinc-200">
      <div className="rounded-lg border border-zinc-700/90 bg-zinc-900/60 px-2.5 py-2 text-xs space-y-2">
        <div className="text-zinc-500 font-medium uppercase tracking-wide">Data pro S/D test</div>
        {!instrumentsLoaded ? (
          <div className="text-zinc-500">Načítám seznam dat…</div>
        ) : dataLoadError ? (
          <div className="text-rose-400">{dataLoadError}</div>
        ) : instruments.length === 0 ? (
          <div className="text-amber-500">Žádné instrumenty pro zvolený typ — změň typ v záložce Backtest.</div>
        ) : (
          <>
            <div>
              <label className="block text-zinc-500 mb-1" htmlFor="sd-test-instrument">
                Instrument
              </label>
              <select
                id="sd-test-instrument"
                value={dataFile ?? ""}
                onChange={(e) => onDataFileChange(e.target.value)}
                className={inputClass}
              >
                {instruments.map((inv) => (
                  <option key={inv.file} value={inv.file}>
                    {inv.displayName ? `${inv.instrument} — ${inv.displayName}` : inv.instrument} ({inv.timeframe}
                    {inv.yearsAvailable > 0 ? `, max ${inv.yearsAvailable} r.` : ""})
                  </option>
                ))}
              </select>
            </div>
            {selectedInv && (
              <div className="font-mono text-zinc-500 break-all text-[11px]" title={dataFile ?? undefined}>
                {dataFile}
              </div>
            )}
            <div>
              <div className="text-zinc-500 mb-1">
                {`Délka okna (roky; min ${MIN_BACKTEST_YEARS.toFixed(3)} ≈ 1 měsíc, max ${
                  selectedInv && selectedInv.yearsAvailable > 0
                    ? `${maxYears} = celý dostupný rozsah souboru`
                    : `${maxYears}, horní limit UI (v metadatech chybí yearsAvailable)`
                })`}
              </div>
              <div className="flex flex-wrap gap-1.5 mb-2">
                {(
                  [
                    [1, "1 měsíc"],
                    [3, "3 měsíce"],
                    [6, "6 měsíců"],
                  ] as const
                ).map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => onYearsChange(clampYears(QUICK_RANGE_MONTHS_YEARS[m]))}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-600 text-zinc-200 hover:bg-zinc-700 hover:border-zinc-500"
                  >
                    {label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => onYearsChange(clampYears(1))}
                  className="px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 border border-zinc-600 text-zinc-200 hover:bg-zinc-700 hover:border-zinc-500"
                >
                  1 rok
                </button>
                {selectedInv && selectedInv.yearsAvailable > 0 && (
                  <button
                    type="button"
                    onClick={() => onYearsChange(maxYears)}
                    className="px-2.5 py-1 rounded text-xs font-medium bg-zinc-800 border border-emerald-900/60 text-emerald-200/95 hover:bg-zinc-700 hover:border-emerald-700/50"
                  >
                    Max. data
                  </button>
                )}
              </div>
              <input
                type="number"
                min={MIN_BACKTEST_YEARS}
                max={maxYears}
                step={1 / 12}
                lang="en"
                value={years}
                onChange={(e) => onYearsChange(clampYears(parseFloat(e.target.value) || MIN_BACKTEST_YEARS))}
                className={inputClass + " font-mono"}
              />
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-zinc-500 leading-relaxed">
        Analytický běh mimo engine: vstupy z <code className="text-zinc-400">touch_events</code> v S/D Parquet, BOS z H/L
        artefaktu. Vyžaduje dokončený Build (H/L + S/D), kde S/D krok opravdu zapíše zóny do{" "}
        <code className="text-zinc-400">zones.parquet</code> (alespoň jeden řádek). Pokud manifest hlásí{" "}
        <code className="text-zinc-400">rows=0</code>, modul <code className="text-zinc-400">get_zones</code> při buildu
        nic nenašel — uprav TF zón / délku dat / parametry S/D a znovu Build. Pole „Zone TF“ jen filtruje už uložené
        řádky.
      </p>

      <div>
        <div className="rounded-lg border border-zinc-700/90 bg-zinc-900/60 px-2.5 py-2 text-xs space-y-2">
          <div className="text-zinc-500 font-medium uppercase tracking-wide">Vyhodnocení winner / loser</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-2 items-end">
            <label className="block">
              <span className="block text-zinc-500 mb-1">
                Winner threshold (R)
              </span>
              <input
                type="number"
                step={0.1}
                min={0.1}
                max={50}
                value={winnerRr}
                onChange={(e) => setWinnerRr(Math.max(0.1, Math.min(50, Number(e.target.value) || 1.5)))}
                className={inputClass + " font-mono"}
              />
            </label>
            <div className="text-[11px] text-zinc-500 leading-relaxed">
              Winner = dosaženo alespoň <span className="font-mono text-zinc-300">{winnerRr.toFixed(2)}R</span>{" "}
              <span className="text-zinc-600">před</span> zásahem SL. Jinak loser.
              {breakevenMoveR.trim() !== "" ? (
                <>
                  {" "}
                  S nastaveným BE se po armování počítá výhra jen od BE baru (viz nápověda u pole BE).
                </>
              ) : null}
            </div>
            <label className="block md:col-span-2">
              <span className="block text-zinc-500 mb-1 flex items-center gap-1">
                Breakeven — přesun SL na entry od (R)
                <FieldHelpPopover help={backtestFieldHelp.sdZoneTestBreakevenMoveR} />
              </span>
              <input
                type="text"
                inputMode="decimal"
                placeholder="vypnuto"
                value={breakevenMoveR}
                onChange={(e) => setBreakevenMoveR(e.target.value)}
                className={inputClass + " font-mono"}
              />
            </label>
          </div>
        </div>
      </div>

      <div className="rounded-lg border border-zinc-700/90 bg-zinc-900/60 px-2.5 py-2 text-xs space-y-2">
        <div className="flex items-center justify-between gap-2">
          <div className="text-zinc-500 font-medium uppercase tracking-wide">Stop loss</div>
          <label className="flex items-center gap-2 text-[11px] text-zinc-300 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={useSlSweep}
              onChange={(e) => setUseSlSweep(e.target.checked)}
              className="rounded border-zinc-600 bg-zinc-800"
            />
            SL sweep
          </label>
        </div>

        {!useSlSweep ? (
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 shrink-0 flex items-center gap-1">
              SL mult
              <FieldHelpPopover help={backtestFieldHelp.sdZoneTestSlMult} />
            </label>
            <input
              type="number"
              step={0.05}
              min={0.05}
              lang="en"
              value={slMult}
              onChange={(e) => setSlMult(Number(e.target.value))}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
            />
          </div>
        ) : (
          <>
            <div className="text-[11px] text-zinc-500 leading-relaxed">
              Krok je fixně <span className="font-mono text-zinc-300">0.05</span> (5%). Sweep proběhne pro všechny hodnoty včetně min a max.
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="block text-zinc-500 mb-1">Min (mult)</span>
                <input
                  type="number"
                  step={0.05}
                  min={0.05}
                  max={10}
                  value={slSweepMin}
                  onChange={(e) => setSlSweepMin(Math.max(0.05, Math.min(10, Number(e.target.value) || 0.5)))}
                  className={inputClass + " font-mono"}
                />
              </label>
              <label className="block">
                <span className="block text-zinc-500 mb-1">Max (mult)</span>
                <input
                  type="number"
                  step={0.05}
                  min={0.05}
                  max={10}
                  value={slSweepMax}
                  onChange={(e) => setSlSweepMax(Math.max(0.05, Math.min(10, Number(e.target.value) || 1.1)))}
                  className={inputClass + " font-mono"}
                />
              </label>
            </div>
          </>
        )}
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Časový rámec grafu (OHLC)</label>
        <select
          value={chartTf}
          onChange={(e) => setChartTf(e.target.value)}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
        >
          {CHART_TF_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Zone TF (multi-select)</label>
        <div className="flex flex-wrap gap-2">
          {ZONE_TF_OPTIONS.map((tf) => {
            const on = zoneTfs.includes(tf);
            return (
              <button
                key={tf}
                type="button"
                onClick={() => setZoneTfs((prev) => (prev.includes(tf) ? prev.filter((x) => x !== tf) : [...prev, tf]))}
                className={`px-2.5 py-1 rounded border text-xs font-mono ${
                  on
                    ? "border-emerald-700/60 bg-emerald-950/35 text-emerald-200"
                    : "border-zinc-700 bg-zinc-950/40 text-zinc-300 hover:bg-zinc-900/50"
                }`}
              >
                {tf}
              </button>
            );
          })}
          <button
            type="button"
            onClick={() => setZoneTfs([])}
            className="px-2.5 py-1 rounded border border-zinc-800 bg-zinc-950/20 text-xs text-zinc-500 hover:text-zinc-300"
            title="Vymazat výběr (auto)"
          >
            auto
          </button>
        </div>
        <div className="mt-1 text-[11px] text-zinc-600">Prázdné = auto jako View (všechny TF z buildu).</div>
      </div>

      <div>
        <label className="block text-xs text-zinc-500 mb-1">Entry cena (z touch eventu vs. zóna)</label>
        <select
          value={entryMode}
          onChange={(e) => setEntryMode(e.target.value as typeof entryMode)}
          className="w-full rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-sm"
        >
          <option value="touch_price">Touch price (validace + clamp do svíčky)</option>
          <option value="zone_edge">Hrana zóny (Demand=high, Supply=low)</option>
          <option value="zone_mid">Střed zóny ((low+high)/2)</option>
        </select>
        <p className="mt-1 text-[11px] text-zinc-500 leading-snug">
          Touch vždy určuje <strong>čas</strong> (bar). Tento přepínač určuje pouze cenu vstupu.
        </p>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs text-zinc-500 shrink-0 flex items-center gap-1">
          Cap MFE (R)
          <FieldHelpPopover help={backtestFieldHelp.sdZoneTestMaxMfeR} />
        </label>
        <input
          type="number"
          step={0.5}
          min={0.5}
          lang="en"
          value={maxMfeR}
          onChange={(e) => setMaxMfeR(Number(e.target.value))}
          className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
        />
      </div>

      <div>
        <span className="text-xs text-zinc-500 flex items-center gap-1 mb-1">
          Jednotky rizika
          <FieldHelpPopover help={backtestFieldHelp.sdZoneTestRiskUsd} />
        </span>
        <div className="flex gap-3 text-xs">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={riskDisplay === "r"}
              onChange={() => setRiskDisplay("r")}
              className="accent-emerald-600"
            />
            R
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              checked={riskDisplay === "usd"}
              onChange={() => setRiskDisplay("usd")}
              className="accent-emerald-600"
            />
            USD (notional)
          </label>
        </div>
      </div>

      {riskDisplay === "usd" && (
        <div className="space-y-2 pl-1 border-l border-zinc-800">
          <div className="flex items-center gap-2">
            <label className="text-xs text-zinc-500 w-24">Equity</label>
            <input
              type="number"
              min={1000}
              step={1000}
              value={equity}
              onChange={(e) => setEquity(Number(e.target.value))}
              className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
            />
          </div>
          {!useRiskRange && (
            <div className="flex items-center gap-2">
              <label className="text-xs text-zinc-500 w-24">risk %</label>
              <input
                type="number"
                step={0.001}
                min={0}
                max={1}
                value={riskPct}
                onChange={(e) => setRiskPct(Number(e.target.value))}
                className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
              />
            </div>
          )}
          <label className="flex items-center gap-2 text-xs text-zinc-400 cursor-pointer">
            <input
              type="checkbox"
              checked={useRiskRange}
              onChange={(e) => setUseRiskRange(e.target.checked)}
              className="accent-emerald-600"
            />
            Náhodné risk % v rozmezí (seed)
          </label>
          {useRiskRange && (
            <>
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500 w-24">min</label>
                <input
                  type="number"
                  step={0.001}
                  value={riskMin}
                  onChange={(e) => setRiskMin(Number(e.target.value))}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500 w-24">max</label>
                <input
                  type="number"
                  step={0.001}
                  value={riskMax}
                  onChange={(e) => setRiskMax(Number(e.target.value))}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                />
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-zinc-500 w-24">seed</label>
                <input
                  type="number"
                  step={1}
                  value={riskSeed}
                  onChange={(e) => setRiskSeed(Number(e.target.value))}
                  className="flex-1 rounded border border-zinc-700 bg-zinc-950 px-2 py-1 font-mono text-sm"
                />
              </div>
            </>
          )}
        </div>
      )}

      {error && <div className="text-rose-400 text-xs rounded bg-rose-500/10 px-2 py-1.5">{error}</div>}

      <button
        type="button"
        disabled={!dataFile || busy}
        onClick={() => void handleRun()}
        className="w-full rounded-lg py-2.5 text-sm font-medium bg-emerald-700 hover:bg-emerald-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        Spustit S/D test
      </button>

      {onDeleteSavedBacktests ? (
        <div className="pt-3 mt-3 border-t border-zinc-800 space-y-2">
          <div className="text-xs text-zinc-500">
            Uložené backtesty (Run history):{" "}
            <span className="text-zinc-300 tabular-nums">{savedRunsCount}</span>
          </div>
          {!confirmDeleteSaved ? (
            <button
              type="button"
              onClick={() => setConfirmDeleteSaved(true)}
              disabled={busy}
              className="w-full py-2 rounded-lg bg-rose-600/20 hover:bg-rose-600/25 border border-rose-500/30 text-rose-200 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
              title="Soft-delete všech uložených runů pro tuto strategii"
            >
              🗑️ Smazat uložené backtesty
            </button>
          ) : (
            <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 p-3 space-y-2">
              <div className="text-xs text-rose-100">
                Opravdu smazat <span className="font-medium">{savedRunsCount}</span> uložených backtestů? (soft-delete)
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setConfirmDeleteSaved(false)}
                  className="flex-1 py-2 rounded-lg bg-zinc-700 hover:bg-zinc-600 text-sm"
                >
                  Zrušit
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfirmDeleteSaved(false);
                    onDeleteSavedBacktests();
                  }}
                  disabled={busy}
                  className="flex-1 py-2 rounded-lg bg-rose-600 hover:bg-rose-500 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Smazat vše
                </button>
              </div>
            </div>
          )}
          <div className="text-[11px] text-zinc-600 leading-snug">
            Tip: smaže pouze historii uložených runů ve Firestore (neovlivní strategii ani kód).
          </div>
        </div>
      ) : null}
    </div>
  );
}
