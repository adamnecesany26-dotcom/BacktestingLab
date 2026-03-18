/**
 * Firestore service - strategies, indicators, modules.
 * Structure: /strategies, /indicators, /modules - each doc has subcollection "files"
 */

import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  deleteDoc,
  serverTimestamp,
  type CollectionReference,
} from "firebase/firestore";
import { getFirebaseApp } from "./firebase";

export type ItemType = "strategies" | "indicators" | "modules";

export type ResultsItemType = "results";

export interface FirestoreItem {
  id: string;
  name: string;
  tag?: string;
  createdAt: ReturnType<typeof serverTimestamp>;
}

export interface FirestoreFile {
  fileName: string;
  content: string;
}

const DEFAULT_STRATEGY_CONTENT = `import backtrader as bt

PARAMS = {
    "sma_fast": 20,
    "sma_slow": 50,
    "risk_per_trade": 0.01,
    "use_trailing_stop": True,
}

class Strategy(bt.Strategy):
    """Strategy template - implement your logic in next()."""

    params = (
        ("sma_fast", 20),
        ("sma_slow", 50),
        ("risk_per_trade", 0.01),
        ("use_trailing_stop", True),
    )

    def __init__(self):
        pass

    def next(self):
        if not self.position:
            self.buy(size=1)
`;

const DEFAULT_INDICATOR_CONTENT = `"""
Indikátor – používá se ve strategii (backtrader) i ve View (vizualizace).

=== NÁVOD PRO VÝVOJÁŘE ===

1. VIEW – zobrazení v záložce View (bez backtestu):
   Definuj funkce get_line, get_zones a/nebo detect – backend je automaticky volá.
   • get_line(ohlc, params=None) – čáry (EMA, RSI, …)
     Vrací: {"EMA20": [{"date":"YYYY-MM-DD","value":float}, ...]}
     nebo {"EMA20": {"data": [...], "color": "#3b82f6"}}
   • get_zones(ohlc, params=None) – zóny/boxy
     Vrací: [{"date_start","date_end","value_low","value_high","fillcolor"?, "name"?}]
   • detect(ohlc, params=None) – bodové markery
     Vrací: [{"date":"YYYY-MM-DD","type":"high"|"low"|"signal","value":float}]

2. VIEW_PARAMS – dynamické parametry ve View:
   VIEW_PARAMS = {"period": 20}  → ve View lze měnit bez úpravy kódu

3. STRATEGIE – import v strategii:
   from indicators.{Název} import MyIndicator
   (Název = název indikátoru bez mezer, např. EMA_20 → from indicators.EMA_20 import MyIndicator)

4. VÝSLEDKY – po Run backtestu se get_line/detect modulů zobrazí v záložce Moduly.
"""

import backtrader as bt

VIEW_PARAMS = {"period": 20}


class MyIndicator(bt.Indicator):
    """Indikátor pro backtrader – použití ve strategii."""

    lines = ("value",)
    params = (("period", 14),)

    def __init__(self):
        self.addminperiod(self.params.period)

    def next(self):
        self.lines.value[0] = sum(self.data.close.get(0, self.params.period)) / self.params.period


def get_line(ohlc, params=None):
    """Čáry pro View – zobrazí se v záložce View i v Results po Run."""
    import pandas as pd

    params = params or {}
    period = int(params.get("period", VIEW_PARAMS.get("period", 20)))
    close = ohlc["close"] if "close" in ohlc.columns else ohlc["Close"]
    ema = close.ewm(span=period, adjust=False).mean()
    data = [
        {"date": ohlc.index[i].strftime("%Y-%m-%d"), "value": float(ema.iloc[i])}
        for i in range(len(ohlc))
    ]
    return {f"EMA{period}": {"data": data, "color": "#3b82f6"}}
`;

const DEFAULT_MODULE_CONTENT = `"""
Modul – pomocné funkce pro strategie (detekce swingů, zón, …) + vizualizace ve View.

=== NÁVOD PRO VÝVOJÁŘE ===

1. VIEW – zobrazení v záložce View (bez backtestu):
   Definuj funkce detect, get_line a/nebo get_zones – backend je automaticky volá.
   • detect(ohlc, params=None) – bodové markery (swing H/L, signály)
     Vrací: [{"date":"YYYY-MM-DD","type":"high"|"low"|"signal","value":float}]
     type: "high"=zelené, "low"=červené, "signal"=modré
   • get_line(ohlc, params=None) – čáry
     Vrací: {"název": [{"date","value"}, ...]} nebo {"název": {"data":[...], "color":"#hex"}}
   • get_zones(ohlc, params=None) – zóny/boxy (support, resistance)
     Vrací: [{"date_start","date_end","value_low","value_high","fillcolor"?, "name"?}]

2. VIEW_PARAMS – dynamické parametry ve View:
   VIEW_PARAMS = {"period": 10}  → ve View lze měnit bez úpravy kódu

3. STRATEGIE – import v strategii:
   from modules.{Název} import detect, get_swings  (Název = název modulu bez mezer)

4. VÝSLEDKY – po Run backtestu (modul vybrán a potvrzen) se detect/get_line/get_zones
   zobrazí v záložce Moduly u každého vybraného modulu.
"""

VIEW_PARAMS = {"period": 5}


def detect(ohlc, params=None):
    """Markery pro View – jednoduchý příklad: lokální high/low (3-bar pivot)."""
    import pandas as pd

    params = params or {}
    results = []
    if ohlc is None or len(ohlc) < 3:
        return results
    high = ohlc["high"] if "high" in ohlc.columns else ohlc["High"]
    low = ohlc["low"] if "low" in ohlc.columns else ohlc["Low"]
    idx = ohlc.index
    for i in range(1, len(ohlc) - 1):
        if high.iloc[i] > high.iloc[i - 1] and high.iloc[i] > high.iloc[i + 1]:
            results.append({
                "date": idx[i].strftime("%Y-%m-%d") if hasattr(idx[i], "strftime") else str(idx[i])[:10],
                "type": "high",
                "value": float(high.iloc[i]),
            })
        if low.iloc[i] < low.iloc[i - 1] and low.iloc[i] < low.iloc[i + 1]:
            results.append({
                "date": idx[i].strftime("%Y-%m-%d") if hasattr(idx[i], "strftime") else str(idx[i])[:10],
                "type": "low",
                "value": float(low.iloc[i]),
            })
    return results


def get_line(ohlc, params=None):
    """Čáry pro View – volitelně; zde prázdný příklad."""
    return {}
`;

function getDb() {
  return getFirestore(getFirebaseApp());
}

function getCollection(type: ItemType): CollectionReference {
  return collection(getDb(), type);
}

export async function listItems(type: ItemType): Promise<FirestoreItem[]> {
  const snap = await getDocs(getCollection(type));
  const items = snap.docs.map((d) => ({ id: d.id, ...d.data() } as FirestoreItem));
  return items.sort((a, b) => {
    const aT = (a.createdAt as any)?.seconds ?? 0;
    const bT = (b.createdAt as any)?.seconds ?? 0;
    return bT - aT;
  });
}

export async function getItem(type: ItemType, id: string): Promise<FirestoreItem | null> {
  const ref = doc(getDb(), type, id);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as FirestoreItem;
}

export async function createItem(
  type: ItemType,
  name: string,
  tag?: string
): Promise<{ id: string }> {
  const col = getCollection(type);
  const docRef = await addDoc(col, {
    name,
    tag: tag ?? "",
    createdAt: serverTimestamp(),
  });

  const defaultContent =
    type === "strategies"
      ? DEFAULT_STRATEGY_CONTENT
      : type === "indicators"
      ? DEFAULT_INDICATOR_CONTENT
      : DEFAULT_MODULE_CONTENT;

  await setDoc(doc(getDb(), type, docRef.id, "files", "main.py"), {
    fileName: "main.py",
    content: defaultContent,
  });

  return { id: docRef.id };
}

export async function getFiles(type: ItemType, itemId: string): Promise<FirestoreFile[]> {
  const filesRef = collection(getDb(), type, itemId, "files");
  const snap = await getDocs(filesRef);
  return snap.docs.map((d) => d.data() as FirestoreFile);
}

export async function getFileContent(
  type: ItemType,
  itemId: string,
  fileName: string
): Promise<string | null> {
  const fileRef = doc(getDb(), type, itemId, "files", fileName);
  const snap = await getDoc(fileRef);
  if (!snap.exists()) return null;
  return (snap.data() as FirestoreFile).content;
}

export async function saveFile(
  type: ItemType,
  itemId: string,
  fileName: string,
  content: string
): Promise<void> {
  const fileRef = doc(getDb(), type, itemId, "files", fileName);
  await setDoc(fileRef, { fileName, content });
}

/** Create a new file in an item (strategy, indicator, module). */
export async function createFile(
  type: ItemType,
  itemId: string,
  fileName: string,
  initialContent: string = ""
): Promise<void> {
  const fileRef = doc(getDb(), type, itemId, "files", fileName);
  await setDoc(fileRef, { fileName, content: initialContent });
}

/** Delete a file from an item. */
export async function deleteFile(
  type: ItemType,
  itemId: string,
  fileName: string
): Promise<void> {
  const fileRef = doc(getDb(), type, itemId, "files", fileName);
  await deleteDoc(fileRef);
}

export async function getMainStrategyCode(type: ItemType, itemId: string): Promise<string | null> {
  return getFileContent(type, itemId, "main.py");
}

/** Saved backtest run - minimal shape for run history */
export interface SavedBacktestRun {
  id: string;
  runId?: string | null;
  manifest?: Record<string, unknown> | null;
  strategyName: string;
  savedAt: { seconds: number; nanoseconds: number } | null;
  equityCurve?: { date: string; value: number }[];
  metrics: {
    finalEquity?: number;
    maxDrawdown?: number;
    maxDrawdownPct?: number;
    sharpeRatio?: number;
    totalReturnUsd?: number;
    profitFactor?: number;
    expectancyUsd?: number;
    winRate?: number;
    rMultiple?: number;
    sortinoRatio?: number;
    calmarRatio?: number;
    tradeCount?: number;
    [key: string]: unknown;
  };
  trades: unknown[];
  validation?: Record<string, unknown> | null;
  robustness?: Record<string, unknown> | null;
  monteCarlo?: Record<string, unknown> | null;
  regimeAnalysis?: Record<string, unknown> | null;
  portfolio?: Record<string, unknown> | null;
  executionSummary?: Record<string, unknown> | null;
  qualityGate?: Record<string, unknown> | null;
  experiment?: Record<string, unknown> | null;
}

/** Save backtest result under strategy. Path: /strategies/{strategyId}/results/{backtestId} */
export async function saveBacktestResult(
  strategyId: string,
  strategyName: string,
  result: Record<string, unknown>
): Promise<string> {
  const randomPart =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 12)}`;
  const id = `run-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomPart}`;
  const ref = doc(getDb(), "strategies", strategyId, "results", id);
  await setDoc(ref, {
    strategyName,
    savedAt: serverTimestamp(),
    ...result,
  });
  return id;
}

/** List all backtest results for a strategy, newest first */
export async function listBacktestResults(strategyId: string): Promise<SavedBacktestRun[]> {
  const resultsRef = collection(getDb(), "strategies", strategyId, "results");
  const snap = await getDocs(resultsRef);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() } as SavedBacktestRun))
    .sort((a, b) => {
      const aT = (a.savedAt as { seconds: number })?.seconds ?? 0;
      const bT = (b.savedAt as { seconds: number })?.seconds ?? 0;
      return bT - aT;
    });
}

/** Delete a single backtest result */
export async function deleteBacktestResult(strategyId: string, resultId: string): Promise<void> {
  const ref = doc(getDb(), "strategies", strategyId, "results", resultId);
  await deleteDoc(ref);
}

/** Delete all backtest results for a strategy */
export async function deleteAllBacktestResults(strategyId: string): Promise<void> {
  const resultsRef = collection(getDb(), "strategies", strategyId, "results");
  const snap = await getDocs(resultsRef);
  await Promise.all(snap.docs.map((d) => deleteDoc(d.ref)));
}
