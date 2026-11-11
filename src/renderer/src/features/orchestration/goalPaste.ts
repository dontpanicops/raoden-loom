// A multi-line paste into a goal row (requirements or shell commands) becomes one row per line: a pasted line break
// must never glue two commands into one input. Row i keeps the text before the selection plus the first pasted line;
// what followed the selection stays after the last pasted line.
export function pasteIntoRows(rows: string[], i: number, selStart: number, selEnd: number, pasted: string): { rows: string[]; focus: number } | null {
  if (!/[\r\n]/.test(pasted)) return null;
  const lines = pasted.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length === 0) return null;
  const cur = rows[i] ?? "";
  const head = cur.slice(0, selStart).trim();
  const tail = cur.slice(selEnd).trim();
  if (head) lines[0] = `${head} ${lines[0]}`;
  if (tail) lines[lines.length - 1] = `${lines[lines.length - 1]} ${tail}`;
  return { rows: [...rows.slice(0, i), ...lines, ...rows.slice(i + 1)], focus: i + lines.length - 1 };
}
