/**
 * Strategy parameters - parse PARAMS dict from Python strategy code.
 * Supports: number, boolean, string.
 * Used for Parameter Panel - change params without editing code.
 */

export type StrategyParamValue = number | boolean | string;
export type StrategyParams = Record<string, StrategyParamValue>;
export interface StrategyParamMeta {
  title?: string;
  whatItMeans?: string;
  whyItMatters?: string;
  howToUse?: string[];
  recommendedDefault?: string;
  withoutIt?: string;
  bestPractices?: string[];
  /**
   * Select options. In Python use either a JSON array (if your parser supports it) or a pipe-separated string:
   * `"|a|b"` → values "", "a", "b" (leading `|` = empty string option).
   */
  options?: string[];
  /** Human labels for each option (same length as options). Pipe-separated string in Python: `option_labels`. */
  optionLabels?: string[];
  /** When true, render numeric 0/1 as checkbox (legacy PARAMS). Prefer True/False in PARAMS. */
  booleanWidget?: boolean;
  /** Override default select-with-options: multiselect stores comma-separated values. */
  widget?: "select" | "multiselect";
  /** Section title (Python: `group`, `tv_group`, `input_group`). */
  group?: string;
  /** Sort order within section (Python: `order`). Lower = earlier. */
  order?: number;
  /** Show field only when current[dependsOnParam] is one of dependsOnValues. */
  dependsOnParam?: string;
  dependsOnValues?: string[];
  /** Optional second gate (AND). */
  dependsOnParam2?: string;
  dependsOnValues2?: string[];
}
export type StrategyParamsMeta = Record<string, StrategyParamMeta>;

/**
 * Strip Python # comments from string, preserving # inside quoted strings.
 */
function stripPythonComments(s: string): string {
  let result = "";
  let inString: string | null = null;
  let escape = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (escape) {
      result += c;
      escape = false;
      continue;
    }
    if (inString) {
      if (c === "\\") escape = true;
      else if (c === inString) inString = null;
      result += c;
      continue;
    }
    if (c === '"' || c === "'") {
      inString = c;
      result += c;
      continue;
    }
    if (c === "#") {
      result = result.replace(/,\s*$/, "");
      while (i < s.length && s[i] !== "\n") i++;
      i--;
      continue;
    }
    result += c;
  }
  return result;
}

function extractDictBlock(code: string, variableName: string): string | null {
  if (!code || typeof code !== "string") return null;

  const escaped = variableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = code.match(new RegExp(`${escaped}\\s*=\\s*(\\{)`));
  if (!match) return null;

  const startIdx = match.index! + match[0].length - 1; // position of {
  let depth = 0;
  let endIdx = -1;

  for (let i = startIdx; i < code.length; i++) {
    const c = code[i];
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        endIdx = i;
        break;
      }
    }
  }

  if (endIdx < 0) return null;

  return stripPythonComments(code.slice(startIdx, endIdx + 1));
}

function toJsonDict(dictStr: string): string {
  let s = dictStr
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_, inner) => `${JSON.stringify(inner)}:`)
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, (_, before, key, after) => `${before}"${key}"${after}`)
    .replace(/([:,])\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, punct, inner) => `${punct} ${JSON.stringify(inner)}`)
    .replace(/,(\s*})/g, "$1");
  /** Python PEP 515 underscores in numeric literals — invalid in JSON */
  s = s.replace(
    /(:\s*)(-?\d[\d_]*(?:\.\d[\d_]*)?(?:[eE][+-]?\d[\d_]*)?)(?=\s*[,}])/g,
    (_, prefix, num) => String(prefix) + String(num).replace(/_/g, "")
  );
  return s;
}

function parsePythonDict(code: string, variableName: string): Record<string, unknown> {
  const dictBlock = extractDictBlock(code, variableName);
  if (!dictBlock) return {};
  const dictStr = toJsonDict(dictBlock);
  try {
    const parsed = JSON.parse(dictStr) as Record<string, unknown>;
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function readPipeDelimitedOptions(v: unknown): string[] | undefined {
  if (typeof v !== "string") return undefined;
  return v.split("|");
}

function normalizeMetaEntry(value: unknown): StrategyParamMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const readString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const readStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;
  const readBool = (v: unknown): boolean | undefined => {
    if (typeof v === "boolean") return v;
    if (v === 1 || v === "1") return true;
    if (v === 0 || v === "0") return false;
    if (typeof v === "string") {
      const s = v.toLowerCase();
      if (s === "true") return true;
      if (s === "false") return false;
    }
    return undefined;
  };

  const optArray = readStringArray(source.options);
  const optPipe = readPipeDelimitedOptions(source.options);
  const options = optArray && optArray.length > 0 ? optArray : optPipe;

  const lblArray = readStringArray(source.optionLabels ?? source.option_labels);
  const lblPipe = readPipeDelimitedOptions(source.option_labels ?? source.optionLabels);
  const optionLabels =
    lblArray && lblArray.length > 0 ? lblArray : lblPipe && lblPipe.length > 0 ? lblPipe : undefined;

  const dep1 = readPipeDelimitedOptions(source.depends_on_values ?? source.dependsOnValues);
  const dep2 = readPipeDelimitedOptions(source.depends_on_values2 ?? source.dependsOnValues2);
  const w = readString(source.widget)?.toLowerCase();
  const widget: StrategyParamMeta["widget"] =
    w === "multiselect" ? "multiselect" : w === "select" ? "select" : undefined;

  const readOrder = (v: unknown): number | undefined => {
    if (typeof v === "number" && Number.isFinite(v)) return Math.trunc(v);
    if (typeof v === "string" && v.trim()) {
      const n = parseInt(v.trim(), 10);
      return Number.isFinite(n) ? n : undefined;
    }
    return undefined;
  };

  const help: StrategyParamMeta = {
    title: readString(source.title),
    group: readString(source.group ?? source.tv_group ?? source.input_group),
    order: readOrder(source.order ?? source.display_order),
    whatItMeans: readString(source.whatItMeans ?? source.what_it_means),
    whyItMatters: readString(source.whyItMatters ?? source.why_it_matters),
    howToUse: readStringArray(source.howToUse ?? source.how_to_use),
    recommendedDefault: readString(source.recommendedDefault ?? source.recommended_default),
    withoutIt: readString(source.withoutIt ?? source.without_it),
    bestPractices: readStringArray(source.bestPractices ?? source.best_practices),
    options: options && options.length > 0 ? options : undefined,
    optionLabels,
    booleanWidget: readBool(source.booleanWidget ?? source.boolean_widget),
    widget,
    dependsOnParam: readString(source.depends_on_param ?? source.dependsOnParam),
    dependsOnValues: dep1 && dep1.length > 0 ? dep1 : undefined,
    dependsOnParam2: readString(source.depends_on_param2 ?? source.dependsOnParam2),
    dependsOnValues2: dep2 && dep2.length > 0 ? dep2 : undefined,
  };
  const hasSomeContent =
    !!help.title ||
    !!help.group ||
    !!help.whatItMeans ||
    !!help.whyItMatters ||
    (help.howToUse && help.howToUse.length > 0) ||
    (help.options && help.options.length > 0) ||
    help.booleanWidget === true ||
    !!help.widget ||
    !!help.dependsOnParam ||
    !!help.dependsOnParam2 ||
    (help.bestPractices && help.bestPractices.length > 0) ||
    !!help.recommendedDefault ||
    !!help.withoutIt ||
    help.order != null;
  return hasSomeContent ? help : null;
}

function parseParamsMeta(code: string, variableName: string): StrategyParamsMeta {
  const parsed = parsePythonDict(code, variableName);
  const out: StrategyParamsMeta = {};
  for (const [k, v] of Object.entries(parsed)) {
    const normalized = normalizeMetaEntry(v);
    if (normalized) out[k] = normalized;
  }
  return out;
}

/**
 * Parse PARAMS = {...} from Python strategy code.
 * Returns empty object if not found or parsing fails.
 */
export function parseStrategyParams(code: string): StrategyParams {
  if (!code || typeof code !== "string") return {};

  const parsed = parsePythonDict(code, "PARAMS");
  const result: StrategyParams = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
      result[k] = v;
    }
  }
  return result;
}

export function parseStrategyParamMeta(code: string): StrategyParamsMeta {
  if (!code || typeof code !== "string") return {};
  return parseParamsMeta(code, "PARAMS_META");
}

export function parseStrategyParamBundle(code: string): { params: StrategyParams; meta: StrategyParamsMeta } {
  return {
    params: parseStrategyParams(code),
    meta: parseStrategyParamMeta(code),
  };
}

/**
 * Check if value is valid strategy param type.
 */
export function isValidParamValue(v: unknown): v is StrategyParamValue {
  return typeof v === "number" || typeof v === "boolean" || typeof v === "string";
}

/** Respect depends_on_param / depends_on_param2 gates from PARAMS_META. */
export function paramFieldVisible(meta: StrategyParamMeta | undefined, current: StrategyParams): boolean {
  const m = meta ?? {};
  if (m.dependsOnParam && m.dependsOnValues?.length) {
    if (!m.dependsOnValues.includes(String(current[m.dependsOnParam] ?? ""))) return false;
  }
  if (m.dependsOnParam2 && m.dependsOnValues2?.length) {
    if (!m.dependsOnValues2.includes(String(current[m.dependsOnParam2] ?? ""))) return false;
  }
  return true;
}

/**
 * Put dependent fields directly under their parent in the same group (master toggle → sub-settings).
 * Uses `dependsOnParam` when that key exists in the list; otherwise `dependsOnParam2`.
 */
export function orderParamEntriesForNestedDisplay(
  entries: [string, StrategyParamValue][],
  metaMap: StrategyParamsMeta,
): [string, StrategyParamValue][] {
  if (entries.length <= 1) return entries;

  const entryMap = new Map<string, [string, StrategyParamValue]>();
  for (const e of entries) {
    entryMap.set(e[0], e);
  }
  const keys = entries.map(([k]) => k);
  const keySet = new Set(keys);

  const childrenByParent = new Map<string, string[]>();
  for (const k of keys) {
    const m = metaMap[k] ?? {};
    const par = m.dependsOnParam?.trim();
    const par2 = m.dependsOnParam2?.trim();
    const parentKey = par && keySet.has(par) ? par : par2 && keySet.has(par2) ? par2 : null;
    if (!parentKey) continue;
    const arr = childrenByParent.get(parentKey);
    if (arr) arr.push(k);
    else childrenByParent.set(parentKey, [k]);
  }

  const isChild = new Set<string>();
  for (const arr of Array.from(childrenByParent.values())) {
    for (const c of arr) isChild.add(c);
  }

  const sortKeys = (a: string, b: string) => {
    const oa = metaMap[a]?.order ?? 99999;
    const ob = metaMap[b]?.order ?? 99999;
    if (oa !== ob) return oa - ob;
    return a.localeCompare(b);
  };

  const roots = keys.filter((k) => !isChild.has(k)).sort(sortKeys);

  const outList: [string, StrategyParamValue][] = [];
  const visited = new Set<string>();

  function visit(k: string) {
    if (visited.has(k)) return;
    visited.add(k);
    const row = entryMap.get(k);
    if (row) outList.push(row);
    const ch = childrenByParent.get(k);
    if (ch?.length) {
      for (const c of [...ch].sort(sortKeys)) visit(c);
    }
  }

  for (const r of roots) visit(r);
  for (const k of keys) {
    if (!visited.has(k)) visit(k);
  }

  return outList;
}

/**
 * Normalize module name to param prefix (e.g. "Swing HL" -> "swing_hl").
 */
export function toModuleParamPrefix(name: string): string {
  return (name || "module")
    .replace(/\s+/g, "_")
    .replace(/[^a-zA-Z0-9_]/g, "")
    .toLowerCase() || "module";
}

/** Normalize Python module token to comparable format. */
export function normalizePythonModuleToken(name: string): string {
  return (name || "")
    .trim()
    .replace(/\.py$/i, "")
    .replace(/[^a-zA-Z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .toLowerCase();
}

/**
 * Strategy declares extra modules (library display names) whose VIEW_PARAMS appear in the Module tab
 * and whose main.py is bundled on run even if the user only "applied" the S/D module.
 *
 * Python (main.py), pipe-separated names as in Moduly:
 *   PARAM_MODULE_CHAIN = "HL_identificator"
 *   PARAM_MODULE_CHAIN = "HL_identificator|S/D Zones"
 */
export function parseParamModuleChain(code: string): string[] {
  if (!code || typeof code !== "string") return [];
  const re = /PARAM_MODULE_CHAIN\s*=\s*(["'])((?:\\.|(?!\1)[\s\S])*)\1/;
  const m = code.match(re);
  if (!m) return [];
  const inner = m[2].replace(/\\(.)/g, "$1");
  if (!inner.trim()) return [];
  return inner
    .split("|")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface ResolvedParamModuleChain {
  ids: string[];
  /** Tokens from PARAM_MODULE_CHAIN that did not match any module in the library */
  unresolved: string[];
}

export function resolveModuleIdsForParamChain(
  chainTokens: string[],
  libraryModules: { id: string; name: string }[],
): ResolvedParamModuleChain {
  const ids: string[] = [];
  const unresolved: string[] = [];
  const seen = new Set<string>();
  for (const token of chainTokens) {
    const t = normalizePythonModuleToken(token);
    const hit = libraryModules.find((m) => normalizePythonModuleToken(m.name) === t);
    if (!hit) {
      unresolved.push(token);
      continue;
    }
    if (!seen.has(hit.id)) {
      seen.add(hit.id);
      ids.push(hit.id);
    }
  }
  return { ids, unresolved };
}

export interface StrategyImportDependencies {
  indicators: string[];
  modules: string[];
}

/**
 * Parse indicator/module imports from strategy code.
 * Examples:
 *  - from indicators.EMA_20 import ...
 *  - import modules.Swing_HL as sh
 */
export function parseStrategyImportDependencies(code: string): StrategyImportDependencies {
  if (!code || typeof code !== "string") {
    return { indicators: [], modules: [] };
  }

  const indicators = new Set<string>();
  const modules = new Set<string>();

  // `import name` on same line, or `import (` multi-line import list
  const fromRegex =
    /^\s*from\s+(indicators|modules)\.([a-zA-Z_][a-zA-Z0-9_]*)\s+import\s*(?:\(|\s+\S)/gm;
  const importRegex = /^\s*import\s+(indicators|modules)\.([a-zA-Z_][a-zA-Z0-9_]*)(?:\s+as\s+[a-zA-Z_][a-zA-Z0-9_]*)?/gm;

  let match: RegExpExecArray | null;
  while ((match = fromRegex.exec(code)) !== null) {
    const group = match[1];
    const token = normalizePythonModuleToken(match[2]);
    if (!token) continue;
    if (group === "indicators") indicators.add(token);
    if (group === "modules") modules.add(token);
  }

  while ((match = importRegex.exec(code)) !== null) {
    const group = match[1];
    const token = normalizePythonModuleToken(match[2]);
    if (!token) continue;
    if (group === "indicators") indicators.add(token);
    if (group === "modules") modules.add(token);
  }

  return {
    indicators: Array.from(indicators),
    modules: Array.from(modules),
  };
}

/**
 * Dynamic loads used by strategies: importlib.import_module("modules.Foo").
 * Only string literals — not f-strings or variables.
 */
export function parseImportlibPackageLiterals(code: string): StrategyImportDependencies {
  if (!code || typeof code !== "string") {
    return { indicators: [], modules: [] };
  }
  const indicators = new Set<string>();
  const modules = new Set<string>();
  const re =
    /importlib\.import_module\s*\(\s*["'](indicators|modules)\.([a-zA-Z_][a-zA-Z0-9_]*)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(code)) !== null) {
    const pkg = m[1];
    const token = normalizePythonModuleToken(m[2]);
    if (!token) continue;
    if (pkg === "indicators") indicators.add(token);
    else modules.add(token);
  }
  return {
    indicators: Array.from(indicators),
    modules: Array.from(modules),
  };
}

/** Static imports + importlib string-literal loads (same tokens as knihovna Moduly/Indikátory). */
export function mergeStrategyImportDependencyTokens(code: string): StrategyImportDependencies {
  const a = parseStrategyImportDependencies(code);
  const b = parseImportlibPackageLiterals(code);
  const indicators = new Set([...a.indicators, ...b.indicators]);
  const modules = new Set([...a.modules, ...b.modules]);
  return {
    indicators: Array.from(indicators),
    modules: Array.from(modules),
  };
}

/**
 * Parse VIEW_PARAMS = {...} from Python code for View mode.
 * Same format as PARAMS - used when building modules/indicators/strategies
 * to expose tunable params in the View params panel.
 */
function parseZoneTimeframesFromParamsDict(params: Record<string, unknown>): string[] {
  const ts = params.zone_timeframes;
  if (Array.isArray(ts)) {
    return ts.map((x) => String(x).trim()).filter(Boolean);
  }
  if (typeof ts === "string" && ts.trim()) {
    const s = ts.trim();
    if (s.startsWith("[") && s.endsWith("]")) {
      try {
        const j = JSON.parse(s.replace(/'/g, '"')) as unknown;
        if (Array.isArray(j)) {
          return j.map((x) => String(x).trim()).filter(Boolean);
        }
      } catch {
        /* fall through */
      }
    }
    return s.split(",").map((p) => p.trim()).filter(Boolean);
  }
  const zt = params.zone_timeframe;
  if (zt != null && String(zt).trim()) {
    return [String(zt).trim()];
  }
  return [];
}

function zoneTfToMinutesForChart(tf: string): number {
  const t = tf.trim().toLowerCase();
  const mNum = /^(\d+)m$/.exec(t);
  if (mNum) return Math.max(1, parseInt(mNum[1], 10));
  if (t === "1h" || t === "60m") return 60;
  if (t === "4h") return 240;
  if (t === "1d" || t === "daily") return 1440;
  if (t === "1w" || t === "weekly") return 10080;
  if (t === "1m" || t === "1mo" || t === "1me") return 43200;
  return 0;
}

function normalizeZoneTfToken(tf: string): string {
  const l = tf.trim().toLowerCase();
  if (l === "weekly") return "1w";
  if (l === "daily") return "1d";
  return l;
}

/**
 * Coarsest TF from strategy `PARAMS.zone_timeframes` (same rule as engine coarsest chart TF).
 * Seed S/D module `timeframe` in View when `strategyZoneSyncCode` is set.
 */
export function coarsestZoneTfFromStrategyCode(code: string): string | null {
  if (!code || typeof code !== "string") return null;
  const params = parsePythonDict(code, "PARAMS");
  const parts = parseZoneTimeframesFromParamsDict(params);
  if (parts.length === 0) return null;
  let best = parts[0];
  let bestM = zoneTfToMinutesForChart(best);
  for (let i = 1; i < parts.length; i++) {
    const m = zoneTfToMinutesForChart(parts[i]);
    if (m > bestM) {
      bestM = m;
      best = parts[i];
    }
  }
  return normalizeZoneTfToken(best);
}

/** Seznam `zone_timeframes` ze strategie (PARAMS) — pro S/D precompute build. */
export function zoneTimeframesFromStrategyCode(code: string | null | undefined): string[] {
  if (!code || typeof code !== "string") return [];
  const params = parsePythonDict(code, "PARAMS");
  return parseZoneTimeframesFromParamsDict(params);
}

export function parseViewParams(code: string): StrategyParams {
  if (!code || typeof code !== "string") return {};
  const viewBlock = extractDictBlock(code, "VIEW_PARAMS");
  let parsed = parsePythonDict(code, "VIEW_PARAMS");
  if (Object.keys(parsed).length === 0 && viewBlock && /\bfor\b/.test(viewBlock)) {
    const fromParams = parsePythonDict(code, "PARAMS");
    parsed = Object.fromEntries(
      Object.entries(fromParams).filter(([k]) => k !== "process_orders_on_close"),
    ) as Record<string, unknown>;
  }
  const result: StrategyParams = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
      result[k] = v;
    }
  }
  return result;
}

export function parseViewParamMeta(code: string): StrategyParamsMeta {
  if (!code || typeof code !== "string") return {};
  const metaBlock = extractDictBlock(code, "VIEW_PARAMS_META");
  let parsed = parsePythonDict(code, "VIEW_PARAMS_META");
  if (Object.keys(parsed).length === 0 && metaBlock && /\bfor\b/.test(metaBlock)) {
    const fromMeta = parsePythonDict(code, "PARAMS_META");
    parsed = Object.fromEntries(
      Object.entries(fromMeta).filter(([k]) => k !== "process_orders_on_close"),
    ) as Record<string, unknown>;
  }
  const out: StrategyParamsMeta = {};
  for (const [k, v] of Object.entries(parsed)) {
    const normalized = normalizeMetaEntry(v);
    if (normalized) out[k] = normalized;
  }
  return out;
}

export function parseViewParamBundle(code: string): { params: StrategyParams; meta: StrategyParamsMeta } {
  return {
    params: parseViewParams(code),
    meta: parseViewParamMeta(code),
  };
}
