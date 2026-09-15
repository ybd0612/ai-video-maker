/** Extract and parse JSON returned by an LLM. */
export function extractJsonFromResponse(content: string): string | null {
  const fenced = content.match(/```(?:json)?\s*\n?([\s\S]*?)```/i);
  const candidate = fenced?.[1]?.trim() ?? content;
  const start = candidate.indexOf("{");
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = start; i < candidate.length; i++) {
    const char = candidate[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") depth++;
    else if (char === "}" && --depth === 0) return candidate.slice(start, i + 1);
  }

  const end = candidate.lastIndexOf("}");
  return end > start ? candidate.slice(start, end + 1) : null;
}

function repairJsonSyntax(json: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  for (let i = 0; i < json.length; i++) {
    const char = json[i];
    if (!inString) {
      if (char === '"') inString = true;
      result += char;
      continue;
    }
    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      const next = json[i + 1];
      if (next && /["\\/bfnrtu]/.test(next)) {
        result += char;
        escaped = true;
      } else {
        result += "\\\\";
      }
      continue;
    }
    if (char === '"') {
      let next = i + 1;
      while (/\s/.test(json[next] ?? "")) next++;
      if (![",", "]", "}", ":"].includes(json[next] ?? "")) {
        result += '\\"';
        continue;
      }
      inString = false;
      result += char;
      continue;
    }
    if (char === "\n") result += "\\n";
    else if (char === "\r") result += "\\r";
    else if (char === "\t") result += "\\t";
    else if (char.charCodeAt(0) < 0x20) result += `\\u${char.charCodeAt(0).toString(16).padStart(4, "0")}`;
    else result += char;
  }
  return result;
}

export function parseJsonFromResponse<T>(content: string): T | null {
  const json = extractJsonFromResponse(content);
  if (!json) return null;
  try {
    return JSON.parse(json) as T;
  } catch {
    try {
      return JSON.parse(repairJsonSyntax(json)) as T;
    } catch {
      return null;
    }
  }
}
