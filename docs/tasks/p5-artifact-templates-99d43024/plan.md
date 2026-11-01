# P5 — artifact templates (unit E, hash8 99d43024)

**Goal.** Let a task define exactly what an artifact must contain (fields + types + guidance),
and let a consuming step pass on first submit by carrying provenance in the brief. JSON is the
only canonical form; no registry, no new gate value, no dependency, no rendering.

## Decisions (frozen)
- Templates are the task's existing `requires` vocabulary, extended — not a second store.
- `section-requirements` gate is strengthened in place; checks are opt-in, so untyped clauses
  behave exactly as before.
- Semantic quality stays with the `review` node; the submit gate is deterministic only.

## Slice 1 — provenance in the brief
- `engine.ts`: `HandoffRef` type + `currentHandoffs(flow, instance, accepted)` deriving the
  current step's accepted source refs from refs already read; `inspect`/`advance` return them.
- `tool.ts`: `stepDescriptor(flow, instance, handoffs)` adds `consumes`, `derivedFrom`
  (single source), `subject` (bindsSubject + single) to the brief; 2 callers pass handoffs.
- `types/pi.ts`: brief schema gains optional `consumes`/`derivedFrom`/`subject`.

## Slice 2 — typed field contract
- `schema.ts`: `FieldTypeSchema`, `FieldSpecSchema` (string | {field,type,note,minLength,
  maxLength,pattern,enum,references}); `RequirementSchema` gains `note`, `strict`, and
  `required`/`each` become `FieldSpec[]`.
- `requirements.ts`: `missingFor` honours types, length, pattern, enum, cross-section
  `references`, and `strict` (no extra keys). Existing output strings preserved.
- `.pi/praxis/tasks/design/spec.json`: upgraded to the typed form as the worked example.

## Acceptance checks
- `tsc` clean; full suite green (incl. unchanged `requirements.test.ts`).
- New `template.test.ts`: type mismatch, minLength, pattern, enum, references, strict all
  reject with path-addressable gaps; untyped clause unchanged.
- New brief-provenance assertion: a consuming step's descriptor carries the predecessor digest.
