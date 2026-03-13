/**
 * Strategy parameters - parse PARAMS dict from Python strategy code.
 * Supports: number, boolean, string.
 * Used for Parameter Panel - change params without editing code.
 */

export type StrategyParamValue = number | boolean | string;
export type StrategyParams = Record<string, StrategyParamValue>;

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

  let dictStr = code.slice(startIdx, endIdx + 1);

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
