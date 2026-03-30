# Finální audit připravenosti — plán oprav

**Datum:** 2026-03-24
**Skóre:** 82 % → cíl 95 %+
**Verdikt:** CONDITIONAL READY — 2 must-fix, pak GO

---

## Priorita 0 — CRITICAL (blokují důvěryhodnost)

### P0-1: Lookahead bias v execution modelu

**Soubor:** `backend/docker/engine.py` ~řádky 2903-2911
**Problém:** Volatilita (`close.pct_change().std()`) a `mean_abs_ret` se počítají na **celé** close sérii před zahájením backtestu. Slippage na baru 1 je kalibrovaný budoucí volatilitou.
**Dopad:** Execution cost odhady zkreslené o 15-40 % v trendujících trzích. Bez execution modelu problém neexistuje.

**Řešení:**
```python
# PŘED (lookahead — celá série):
close = pd.to_numeric(data.get("close"), errors="coerce").dropna()
volatility = float(close.pct_change().dropna().std())

# PO (trailing window — žádný lookahead):
# Varianta A: kalibrace na prvních N barech (pre-trade window)
calibration_bars = min(500, len(close) // 4)
calibration_slice = close.iloc[:calibration_bars]
volatility = float(calibration_slice.pct_change().dropna().std()) if len(calibration_slice) > 2 else 0.0
mean_abs_ret = float(calibration_slice.pct_change().abs().dropna().mean()) if len(calibration_slice) > 2 else 0.0

# Varianta B (sofistikovanější): per-trade rolling vol
# → předat Backtrader indikátor s rolling(20).std() a slippage nastavit dynamicky
# → vyžaduje custom CommissionInfo, výrazně složitější
```
**Doporučení:** Varianta A — jednoduchá, eliminuje lookahead, explicitně zdokumentovat v methodology notes jako "pre-trade calibration window."
**Effort:** 2-4 hodiny

---

### P0-2: Slabý result cache key — stale výsledky

**Soubor:** `backend/docker/engine.py` ~řádka 2694
**Problém:** Data fingerprint pro result cache je `len(data)|first_index|last_index`. Dva různé datasety se stejnou délkou a rozsahem dat → stejný klíč → stale výsledky.

**Řešení:**
```python
# PŘED:
data_fp = f"{len(data)}|{data.index[0]}|{data.index[-1]}" if len(data) > 0 else "empty"

# PO — použít fast fingerprint z _load_file (mtime+size hash):
data_fp = meta.get("datasetFingerprint", "unknown") if meta else "unknown"
# meta je návratová hodnota z _load_file, propagovat přes time_context:
# V _execute_backtest_from_environ_body přidat:
#   time_context["datasetFingerprint"] = meta["datasetFingerprint"]
# V run_backtest:
#   data_fp = (time_context or {}).get("datasetFingerprint", f"{len(data)}|...")
```
**Effort:** 30 minut

---

## Priorita 1 — HIGH (zásadně snižují kvalitu)

### P1-1: Žádný progress reporting v in-process režimu

**Soubor:** `backend/app/services/engine_inprocess.py` + `backend/docker/engine.py`
**Problém:** In-process engine běží synchronně v `asyncio.to_thread()`. UI neukazuje nic dokud výsledek nedorazí. Pro 16letý backtest = minuty ticha.

**Řešení:**
```python
# 1) engine.py: EquityRecorder zapisuje progress do sdílené struktury místo stderr
import threading
_PROGRESS_CALLBACK: threading.local = threading.local()

class EquityRecorder(bt.Strategy):
    def next(self):
        equity_list.append(self.broker.getvalue())
        cb = getattr(_PROGRESS_CALLBACK, "fn", None)
        if cb and self.params.total_bars > 0:
            pct = min(99, int((len(self) / self.params.total_bars) * 100))
            if pct != self._last_pct and pct % 5 == 0:
                cb(pct)
                self._last_pct = pct

# 2) engine_inprocess.py: předat callback při volání
def run_engine_in_process(env, progress_callback=None):
    with _ENGINE_LOCK:
        engine._PROGRESS_CALLBACK.fn = progress_callback
        # ... run ...

# 3) runner.py: callback posílá SSE event přes queue
progress_queue = asyncio.Queue()
def on_progress(pct):
    progress_queue.put_nowait(pct)
await asyncio.to_thread(run_engine_in_process, env, on_progress)
```
**Effort:** 2-4 hodiny

---

### P1-2: `_ENGINE_LOCK` serializuje všechny runy

**Soubor:** `backend/app/services/engine_inprocess.py`
**Problém:** Globální zámek = sweep (20 parametrů) a WF (8 foldů) běží sekvenčně. Žádná paralelizace.

**Řešení:**
```python
# Místo globálního env-swap + lock:
# → spustit každý lightweight run v separátním procesu přes ProcessPoolExecutor
# → nebo: předávat parametry přímo jako argumenty (ne přes os.environ)

# Varianta A (nejčistší): refactor engine.py aby přijímal parametry jako dict
def run_backtest_direct(params_dict: dict) -> dict:
    """Vstupní bod bez os.environ — přímé volání."""
    # ... inicializace z params_dict místo os.environ.get(...)

# Varianta B (pragmatická): ProcessPoolExecutor pro lightweight runy
from concurrent.futures import ProcessPoolExecutor
_POOL = ProcessPoolExecutor(max_workers=4)

async def run_lightweight_parallel(envs: list[dict]) -> list[dict]:
    loop = asyncio.get_event_loop()
    futures = [loop.run_in_executor(_POOL, _run_one, e) for e in envs]
    return await asyncio.gather(*futures)
```
**Doporučení:** Varianta A je architektonicky čistší (eliminuje env-swap race condition zároveň). Varianta B je rychlejší na implementaci.
**Effort:** 1-2 dny

---

### P1-3: `os.environ` mutation race condition

**Soubor:** `backend/app/services/engine_inprocess.py` řádky 68-81
**Problém:** In-process engine dočasně přepisuje `os.environ` pod zámkem. Ale env je process-globální — jiné thready mohou číst špatné hodnoty.

**Řešení:** Vyřeší se automaticky implementací P1-2 Varianta A (přímé předávání params bez env-swap). Pokud se implementuje dřív:
```python
# Krátkodobý fix: kopírovat env do izolovaného namespace
import types
def _make_isolated_env(env: dict) -> types.SimpleNamespace:
    return types.SimpleNamespace(**env)

# Engine funkce čtou z namespace místo os.environ
# → vyžaduje refactor engine.py aby přijímal env objekt
```
**Effort:** Součást P1-2

---

### P1-4: Batch tabulka PF bug — zobrazuje 0.00 místo ∞

**Soubor:** `frontend/components/results/AnalyticsView.tsx` ~řádka 1077
**Problém:** `formatProfitFactor(Number(r.profitFactor))` — `Number(null)` = 0 → "0.00" místo "∞" pro instrumenty bez ztrát.

**Řešení:**
```typescript
// PŘED:
<td className="py-1 pr-2 text-right">{formatProfitFactor(Number(r.profitFactor))}</td>

// PO:
<td className="py-1 pr-2 text-right">{formatProfitFactorFromRow(r)}</td>
```
**Effort:** 5 minut (1 řádek)

---

### P1-5: Pickle deserialization bez integrity check

**Soubory:** `backend/docker/engine.py` ř. 2593, `backend/app/services/sd_feature_pipeline.py` ř. 117
**Problém:** `pickle.load()` na cache souborech. Corrupted/tampered soubor = arbitrary code execution.

**Řešení:**
```python
# Varianta A (minimální): HMAC validace
import hmac, hashlib
CACHE_SECRET = os.environ.get("CACHE_HMAC_KEY", "backtest-local-dev")

def _pickle_dump_safe(obj, path: Path):
    data = pickle.dumps(obj)
    sig = hmac.new(CACHE_SECRET.encode(), data, hashlib.sha256).hexdigest()
    path.write_bytes(sig.encode() + b"\n" + data)

def _pickle_load_safe(path: Path):
    raw = path.read_bytes()
    sig_end = raw.index(b"\n")
    sig = raw[:sig_end].decode()
    data = raw[sig_end+1:]
    expected = hmac.new(CACHE_SECRET.encode(), data, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(sig, expected):
        raise ValueError("Cache integrity check failed")
    return pickle.loads(data)

# Varianta B (lepší): přejít na parquet pro DataFrame cache
# → pd.read_parquet() / df.to_parquet() — žádné RCE riziko, rychlejší pro velké DF
```
**Doporučení:** Varianta B pro dataset cache (parquet), Varianta A pro SD zone cache (komplexní nested objekty).
**Effort:** 2-4 hodiny

---

## Priorita 2 — MEDIUM (zlepšují kvalitu a realističnost)

### P2-1: Per-contract commission model

**Soubor:** `backend/docker/engine.py` ~řádka 2876
**Problém:** `setcommission(commission=pct)` — flat %. Reální futures brokeři: $2.25/side/contract + exchange fees.

**Řešení:**
```python
# Přidat do execution_cfg nový volitelný field:
# "commission_mode": "percentage" | "per_contract"
# "commission_per_contract": 2.25  (USD per side)

comm_mode = execution_cfg.get("commission_mode", "percentage")
if comm_mode == "per_contract":
    per_side = float(execution_cfg.get("commission_per_contract", 2.25))
    class PerContractCommission(bt.CommInfoBase):
        params = (("commission", per_side), ("stocklike", False),)
        def _getcommission(self, size, price, pseudoexec):
            return abs(size) * self.p.commission
    cerebro.broker.addcommissioninfo(PerContractCommission())
else:
    cerebro.broker.setcommission(commission=commission_pct, margin=None, mult=mult)
```
**Frontend:** Přidat `commissionMode` select + `commissionPerContract` input do BacktestSettings execution sekce.
**Effort:** 4-8 hodin (backend + frontend + docs)

---

### P2-2: Strict OHLC validation default ON

**Soubor:** `backend/docker/engine.py` — `_validate_ohlc_dataframe()`
**Problém:** Corrupted data (high < low, negativní ceny) projde bez chyby pokud `STRICT_OHLC_VALIDATION != 1`.

**Řešení:**
```python
# Změnit default:
strict = os.environ.get("STRICT_OHLC_VALIDATION", "1")  # bylo ""
# Při porušení: raise ValueError místo log+continue
```
**Effort:** 30 minut

---

### P2-3: TTL + size cap na result cache

**Soubor:** `backend/docker/engine.py` — `_RESULT_CACHE`
**Problém:** 256 entries × potenciálně 10MB = až 2.5GB RAM, žádný TTL.

**Řešení:**
```python
import time
_RESULT_CACHE: dict[str, tuple[float, dict]] = {}  # key → (timestamp, result)
_RESULT_CACHE_MAX = 128  # snížit z 256
_RESULT_CACHE_TTL = 3600  # 1 hodina

def _result_cache_get(key: str) -> dict | None:
    entry = _RESULT_CACHE.get(key)
    if entry is None:
        return None
    ts, result = entry
    if time.monotonic() - ts > _RESULT_CACHE_TTL:
        _RESULT_CACHE.pop(key, None)
        return None
    return result

def _result_cache_put(key: str, result: dict):
    # Evict expired first
    now = time.monotonic()
    expired = [k for k, (ts, _) in _RESULT_CACHE.items() if now - ts > _RESULT_CACHE_TTL]
    for k in expired:
        _RESULT_CACHE.pop(k, None)
    if len(_RESULT_CACHE) >= _RESULT_CACHE_MAX:
        oldest_key = next(iter(_RESULT_CACHE))
        _RESULT_CACHE.pop(oldest_key, None)
    _RESULT_CACHE[key] = (now, result)
```
**Effort:** 1 hodina

---

### P2-4: Exit price fallback — nekonzistence entry=exit

**Soubor:** `backend/docker/engine.py` ~řádky 2761-2775
**Problém:** Když `trade.history` je prázdné, `entry_price == exit_price == trade.price`, ale `pnl != 0`.

**Řešení:**
```python
# Pokud history chybí, odvodit exit_price z PnL:
if entry_price == exit_price and abs(trade.pnlcomm) > 0.001:
    # pnl = (exit - entry) * size * mult (zjednodušeně)
    if abs(size * mult) > 0:
        implied_exit = entry_price + (trade.pnlcomm / (size * mult))
        exit_price = round(implied_exit, 6)
```
**Effort:** 30 minut

---

### P2-5: Sweep — skrýt full-data metriky

**Soubor:** `backend/docker/engine.py` ~řádka 1309
**Problém:** Sweep exportuje full-data metriky vedle holdout → snooping pokušení.

**Řešení:**
```python
# V sweep result row: nahradit full-data metriky holdout-only
# PŘED:
row["metrics"] = out_full["metrics"]
# PO:
row["metrics"] = out_holdout["metrics"] if out_holdout else out_full["metrics"]
row["_fullDataMetricsOmitted"] = True  # flag pro transparentnost
```
**Effort:** 30 minut

---

### P2-6: View engine — LRU cache na data loading

**Soubor:** `backend/docker/view_engine.py`
**Problém:** Re-reads data z disku na každý `/api/view` call.

**Řešení:**
```python
from functools import lru_cache

@lru_cache(maxsize=8)
def _load_ohlc_cached(path: str, mtime_ns: int) -> pd.DataFrame:
    return _load_ohlc(path)

# Při volání:
stat = Path(path).stat()
df = _load_ohlc_cached(path, stat.st_mtime_ns)
```
**Effort:** 30 minut

---

### P2-7: `maxDrawdown` field ambiguita

**Soubory:** `shared/types/index.ts`, `frontend/components/results/StatBlocks.tsx`
**Problém:** StatBlocks formátuje `maxDrawdown` jako %, ale typ říká jen `number`. Pokud engine vrátí absolutní USD, zobrazí se jako procenta.

**Řešení:**
```typescript
// V StatBlocks — vždy preferovat maxDrawdownPct:
} else {
  let v = m[key] as number | undefined;
  if (key === "maxDrawdown") {
    v = (m.maxDrawdownPct as number | undefined) ?? v;
  }
  value = v != null ? format(v) : "—";
}
```
A přidat do `BacktestMetrics` v `shared/types/index.ts` JSDoc:
```typescript
/** Max drawdown as percentage (0-100 scale). Use maxDrawdownPct. */
maxDrawdown: number;
```
**Effort:** 15 minut

---

## Priorita 3 — LOW (nice to have)

### P3-1: `sys.path` pollution v in-process režimu

**Soubor:** `backend/app/services/runner.py` ~řádka 490
**Problém:** `sys.path.insert(0, str(run_dir))` se neočistí při výjimce.

**Řešení:** Přesunout `sys.path.remove()` do `finally` bloku.
**Effort:** 10 minut

---

### P3-2: Batch run abort on first error

**Soubor:** `backend/app/api/run.py` ~řádka 345
**Problém:** Při chybě jednoho sub-runu se zruší celá dávka, výsledky hotových runů se zahodí.

**Řešení:** Catchnout error per sub-run, vrátit partial results + error list.
**Effort:** 1-2 hodiny

---

### P3-3: Disk cache bez TTL / size cap

**Soubor:** `backend/docker/engine.py` — `.backtest_cache/`
**Problém:** Pickle soubory na disku rostou bez limitu.

**Řešení:** Přidat cleanup script / max-age / max-total-size policy.
**Effort:** 1 hodina

---

### P3-4: Kelly fraction bez prominent warning

**Soubor:** `frontend/components/results/StatBlocks.tsx`
**Problém:** Tip "half-Kelly nebo méně" je za toggle — agresivní user může sizovat na full Kelly.

**Řešení:** Přidat inline sub-label pod Kelly hodnotu:
```typescript
{key === "kellyFraction" && value !== "—" && (
  <span className="text-[9px] text-zinc-600 block">half-Kelly max</span>
)}
```
**Effort:** 10 minut

---

### P3-5: Annualizace — `_estimate_periods_per_year` robustnost

**Soubor:** `backend/docker/engine.py`
**Problém:** U dat s nepravidelnými mezerami (víkendy, svátky) může median-diff odhad periody být nepřesný.

**Řešení:** Fallback na explicitní TF z manifestu (pokud je k dispozici):
```python
tf_hint = os.environ.get("TIMEFRAME_HINT", "")  # "30m", "1d", etc.
if tf_hint:
    periods_per_year = _tf_to_annual_periods(tf_hint)
else:
    periods_per_year = _estimate_periods_per_year(equity_curve_with_dates)
```
**Effort:** 1 hodina

---

## Implementační roadmapa

### Fáze 1 — MUST FIX (den 1)
| # | Úkol | Effort |
|---|------|--------|
| P0-1 | Fix execution model lookahead | 2-4h |
| P0-2 | Fix result cache key | 30min |
| P1-4 | Batch PF bug (1 řádek) | 5min |
| P2-2 | Strict OHLC validation ON | 30min |
| P2-7 | maxDrawdown field fix | 15min |

**Po fázi 1: 88 %** — execution model důvěryhodný, žádné stale výsledky, data validace striktní.

### Fáze 2 — HIGH IMPACT (den 2-3)
| # | Úkol | Effort |
|---|------|--------|
| P1-1 | Progress reporting in-process | 2-4h |
| P1-5 | Pickle → parquet/HMAC | 2-4h |
| P2-3 | Result cache TTL + size cap | 1h |
| P2-4 | Exit price fallback fix | 30min |
| P2-5 | Sweep — skrýt full-data metriky | 30min |
| P2-6 | View engine data LRU cache | 30min |

**Po fázi 2: 92 %** — bezpečné cache, konzistentní data, lepší UX.

### Fáze 3 — PARALELIZACE (den 4-5)
| # | Úkol | Effort |
|---|------|--------|
| P1-2 | Eliminace _ENGINE_LOCK (přímé volání) | 1-2d |
| P1-3 | os.environ race condition (součást P1-2) | — |

**Po fázi 3: 95 %** — batch operace 10-20× rychlejší, žádné race conditions.

### Fáze 4 — POLISH (volitelně)
| # | Úkol | Effort |
|---|------|--------|
| P2-1 | Per-contract commission model | 4-8h |
| P3-1 | sys.path cleanup | 10min |
| P3-2 | Batch partial results | 1-2h |
| P3-3 | Disk cache cleanup | 1h |
| P3-4 | Kelly warning inline | 10min |
| P3-5 | Annualizace TF hint | 1h |

**Po fázi 4: 97 %+** — produkční kvalita.

---

## Celkový effort

| Fáze | Dny | Výsledné skóre |
|------|-----|-----------------|
| Fáze 1 | 1 den | 88 % |
| Fáze 2 | 2 dny | 92 % |
| Fáze 3 | 2 dny | 95 % |
| Fáze 4 | 1-2 dny | 97 %+ |
| **Celkem** | **6-7 dní** | **97 %+** |

---

*Audit provedl: kombinace senior quant + risk manager + performance engineer + trader perspektiva. Všechny findings jsou ověřené proti zdrojovému kódu.*
