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


class Strategy(bt.Strategy):
    """Strategy template - implement your logic in next()."""

    def __init__(self):
        pass

    def next(self):
        if not self.position:
            self.buy(size=1)
`;

const DEFAULT_INDICATOR_CONTENT = `import backtrader as bt


class MyIndicator(bt.Indicator):
    """Custom indicator - add your logic."""

    lines = ("value",)

    params = (("period", 14),)

    def __init__(self):
        self.addminperiod(self.params.period)

    def next(self):
        # Your indicator logic
        self.lines.value[0] = sum(self.data.close.get(0, self.params.period)) / self.params.period
`;

const DEFAULT_MODULE_CONTENT = `"""
Utility module - import helpers, calculations, etc.
"""


def example_helper(x: float, y: float) -> float:
    return x + y
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

/** Save backtest result under strategy. Path: /strategies/{strategyId}/results/{backtestId} */
export async function saveBacktestResult(
  strategyId: string,
  strategyName: string,
  result: Record<string, unknown>
): Promise<string> {
  const id = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const ref = doc(getDb(), "strategies", strategyId, "results", id);
  await setDoc(ref, {
    strategyName,
    savedAt: serverTimestamp(),
    ...result,
  });
  return id;
}
