# Research — <task name>

Task: <slug> · Hash: <hash8> · Gate: G1 · Status: draft | reviewed | passed · Date: <YYYY-MM-DD>

## 0. Contract

<!-- One physical line per key: this block is the hash input. Never reflow it. -->

task: <owner goal, verbatim, one line>
scope: <comma-separated paths, one line>
acceptance: <acceptance checks, one line>

Recompute:

```sh
canonical() { printf 'task: %s\nscope: %s\nacceptance: %s\n' "$1" "$2" "$3" \
  | sed -E 's/[[:space:]]+$//'; }
canonical "<goal>" "<paths>" "<checks>" | sha256sum | cut -c1-8
```

## 1. Question and boundary

What must be established, and what is explicitly not being researched.

## 2. Sources inspected

| Source | Location | Establishes | Freshness |
| --- | --- | --- | --- |
| | `path:line` | | |

## 3. Competing explanations

| Explanation | Supporting evidence | Distinguishing observation | Status |
| --- | --- | --- | --- |
| | | | leading / eliminated |

## 4. Findings

Label each `documented`, `source-inspected`, `executed`, `untested` or `proposed`.

- F1 [<label>] <finding> — <evidence> — <limitation>

## 5. Affected owners and callers

| Path | Declaration | Callers | Effect |
| --- | --- | --- | --- |
| | | | |

## 6. Uncertainty and open questions

- Q1 <question> — resolved by: <check or source>

## 7. Handoff

Decisions this research forces on the spec; what stays unknown.
