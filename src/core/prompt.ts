/**
 * Prompt markers that may ride on the end of a chrome token. `$` is the
 * canonical one; `❯` is the only other character that is unambiguously a prompt
 * in that position. `#` and `%` are deliberately excluded — they collide with
 * comments and percentages, which appear in real command *output* far more
 * often than in prompts. `>` is a prompt too, but only in the much narrower
 * column-0 shape below.
 */
const MARKERS = "$❯";

/**
 * Two shapes of prompt, and nothing else:
 *
 * 1. one unbroken token ending in the marker — `$ `, `colin@mac:~/code$ `
 * 2. one token, a space, then a *bare* marker — `~/code ❯ `, `~ $ `
 *
 * The asymmetry is what keeps false positives out. `cost is 5$ each` fails
 * shape 1 (the lead-in cannot cross a space) and fails shape 2 (the marker is
 * not bare), while both genuine prompt styles still match.
 */
const PROMPT_RE = new RegExp(
  `^[ \\t]*(?:\\S{0,80}?[${MARKERS}]|\\S{1,80}[ \\t]+[${MARKERS}])(?:[ \\t]+|$)`,
);

/**
 * oh-my-zsh's robbyrussell prompt leads with `➜`, but so does a whole genre of
 * CLI *output* — vite, pnpm and friends print `➜` as a bullet. Column tells them
 * apart: a prompt owns the start of its line, while a decorative arrow is
 * indented under the thing it belongs to. So `➜` counts only at column 0, with
 * no leading whitespace allowed.
 *
 * Unlike `$` and `❯`, this marker comes *first* — the directory and git status
 * follow it (`➜  fray git:(main) ✗ nub test`) rather than preceding it. There is
 * no reliable way to find where that chrome ends, so only the arrow itself is
 * treated as chrome. In a real paste the rest carries oh-my-zsh's own colors,
 * and an explicit color already outranks the role styling.
 */
const OMZ_PROMPT_RE = /^➜(?:[ \t]+|$)/;

/**
 * `>` — sh's continuation prompt, the Node and Python REPLs, and the shape
 * people reach for when writing a command down by hand. It gets its own rule
 * because it cannot go in `MARKERS`: shape 1 lets the marker ride on the end of
 * a token, which would turn every `-> installed 4 packages` and `=> Done in
 * 1.2s` bullet — docker, npm, esbuild — into a prompt. Requiring the `>` to be
 * bare *and* at column 0 leaves all of those alone, along with `cat foo >
 * bar.txt` and `if x > 3`.
 *
 * What it does cost is a quoted line: `> quoted output` pasted out of mail or
 * Markdown now reads as a command. That is the deliberate trade — in something
 * copied from a terminal, a line opening with `> ` is a prompt far more often
 * than it is a quote.
 */
const CHEVRON_PROMPT_RE = /^>(?:[ \t]+|$)/;

export type LineKind = "command" | "output";

export interface LineClassification {
  kind: LineKind;
  /**
   * For a command line, the offset where the command begins — everything
   * before it is prompt chrome. Always 0 for an output line, and 0 for a
   * command line that is a `\`-continuation of the previous one.
   */
  commandStart: number;
}

/**
 * Where the command starts on this line, or -1 if it is not a prompt line.
 *
 * Requiring whitespace after the marker is what keeps `$HOME`, `$(date)` and
 * `${FOO}` out — a variable is never followed by a space at that position.
 */
export function matchPrompt(text: string): number {
  const match = PROMPT_RE.exec(text) ?? OMZ_PROMPT_RE.exec(text) ?? CHEVRON_PROMPT_RE.exec(text);
  return match ? match[0].length : -1;
}

/**
 * Classify a whole document at once. Two things need cross-line context: a
 * trailing `\` continues the command onto the next line, and a document with no
 * commands at all should not have every line dimmed as "output".
 */
export function classifyDocument(texts: readonly string[]): LineClassification[] {
  const result: LineClassification[] = [];
  let continuing = false;

  for (const text of texts) {
    if (continuing) {
      result.push({ kind: "command", commandStart: 0 });
      continuing = text.trimEnd().endsWith("\\");
      continue;
    }
    const commandStart = matchPrompt(text);
    if (commandStart >= 0) {
      result.push({ kind: "command", commandStart });
      continuing = text.trimEnd().endsWith("\\");
    } else {
      result.push({ kind: "output", commandStart: 0 });
    }
  }
  return result;
}

/** True when at least one line is a command, so output should be dimmed. */
export function hasCommands(classifications: readonly LineClassification[]): boolean {
  return classifications.some((line) => line.kind === "command");
}
