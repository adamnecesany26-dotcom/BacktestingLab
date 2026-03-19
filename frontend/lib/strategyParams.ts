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
  return dictStr
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_, s) => `${JSON.stringify(s)}:`)
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, (_, before, key, after) => `${before}"${key}"${after}`)
    .replace(/([:,])\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, punct, s) => `${punct} ${JSON.stringify(s)}`)
    .replace(/,(\s*})/g, "$1");
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

function normalizeMetaEntry(value: unknown): StrategyParamMeta | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const readString = (v: unknown): string | undefined => (typeof v === "string" && v.trim() ? v.trim() : undefined);
  const readStringArray = (v: unknown): string[] | undefined =>
    Array.isArray(v) ? v.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : undefined;

  const help: StrategyParamMeta = {
    title: readString(source.title),
    whatItMeans: readString(source.whatItMeans ?? source.what_it_means),
    whyItMatters: readString(source.whyItMatters ?? source.why_it_matters),
    howToUse: readStringArray(source.howToUse ?? source.how_to_use),
    recommendedDefault: readString(source.recommendedDefault ?? source.recommended_default),
    withoutIt: readString(source.withoutIt ?? source.without_it),
    bestPractices: readStringArray(source.bestPractices ?? source.best_practices),
  };
  const hasSomeContent = Object.values(help).some((v) => (Array.isArray(v) ? v.length > 0 : !!v));
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

  const fromRegex = /^\s*from\s+(indicators|modules)\.([a-zA-Z_][a-zA-Z0-9_]*)\s+import\s+/gm;
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
 * Parse VIEW_PARAMS = {...} from Python code for View mode.
 * Same format as PARAMS - used when building modules/indicators/strategies
 * to expose tunable params in the View params panel.
 */
export function parseViewParams(code: string): StrategyParams {
  if (!code || typeof code !== "string") return {};
  const parsed = parsePythonDict(code, "VIEW_PARAMS");
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
  return parseParamsMeta(code, "VIEW_PARAMS_META");
}

export function parseViewParamBundle(code: string): { params: StrategyParams; meta: StrategyParamsMeta } {
  return {
    params: parseViewParams(code),
    meta: parseViewParamMeta(code),
  };
}
