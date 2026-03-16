/**
 * Strategy parameters - parse PARAMS dict from Python strategy code.
 * Supports: number, boolean, string.
 * Used for Parameter Panel - change params without editing code.
 */

export type StrategyParamValue = number | boolean | string;
export type StrategyParams = Record<string, StrategyParamValue>;

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

/**
 * Parse PARAMS = {...} from Python strategy code.
 * Returns empty object if not found or parsing fails.
 */
export function parseStrategyParams(code: string): StrategyParams {
  if (!code || typeof code !== "string") return {};

  // Find PARAMS = {...} block - match balanced braces
  const match = code.match(/PARAMS\s*=\s*(\{)/);
  if (!match) return {};

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

  if (endIdx < 0) return {};

  let dictStr = stripPythonComments(code.slice(startIdx, endIdx + 1));

  // Convert Python dict to JSON-compatible format
  dictStr = dictStr
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    // Single-quoted keys: 'key': -> "key":
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_, s) => `${JSON.stringify(s)}:`)
    // Unquoted keys: , key: or { key: -> , "key": or { "key":
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, (_, before, key, after) => `${before}"${key}"${after}`)
    // Single-quoted string values (not keys): , 'val' or : 'val'
    .replace(/([:,])\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, punct, s) => `${punct} ${JSON.stringify(s)}`)
    // Python trailing comma
    .replace(/,(\s*})/g, "$1");

  try {
    const parsed = JSON.parse(dictStr) as Record<string, unknown>;
    const result: StrategyParams = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
        result[k] = v;
      }
      // Skip complex types (objects, arrays)
    }
    return result;
  } catch {
    return {};
  }
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

/**
 * Parse VIEW_PARAMS = {...} from Python code for View mode.
 * Same format as PARAMS - used when building modules/indicators/strategies
 * to expose tunable params in the View params panel.
 */
export function parseViewParams(code: string): StrategyParams {
  if (!code || typeof code !== "string") return {};

  const match = code.match(/VIEW_PARAMS\s*=\s*(\{)/);
  if (!match) return {};

  const startIdx = match.index! + match[0].length - 1;
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

  if (endIdx < 0) return {};

  let dictStr = stripPythonComments(code.slice(startIdx, endIdx + 1));
  dictStr = dictStr
    .replace(/\bTrue\b/g, "true")
    .replace(/\bFalse\b/g, "false")
    .replace(/\bNone\b/g, "null")
    .replace(/'([^'\\]*(?:\\.[^'\\]*)*)'\s*:/g, (_, s) => `${JSON.stringify(s)}:`)
    .replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)(\s*:)/g, (_, before, key, after) => `${before}"${key}"${after}`)
    .replace(/([:,])\s*'([^'\\]*(?:\\.[^'\\]*)*)'/g, (_, punct, s) => `${punct} ${JSON.stringify(s)}`)
    .replace(/,(\s*})/g, "$1");

  try {
    const parsed = JSON.parse(dictStr) as Record<string, unknown>;
    const result: StrategyParams = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" || typeof v === "boolean" || typeof v === "string") {
        result[k] = v;
      }
    }
    return result;
  } catch {
    return {};
  }
}
