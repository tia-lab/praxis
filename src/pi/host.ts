/**
 * Local, type-only mirror of the Pi host tool surface (R1, R7, R8, R10).
 *
 * The host package is not resolvable from this project and R9 forbids a new
 * dependency or a tsconfig path, so the seam is declared here instead of
 * imported (plan, Host types). Nothing here survives compilation: there is no
 * value export and no import, so the tool cannot depend on host runtime code.
 * P14 checks this mirror against the installed host declarations; a drift in
 * `execute`'s arity or in the required `details` field is a failed check.
 */

/** One model-facing text part of a tool result. */
export interface PiTextPart {
  readonly type: "text";
  readonly text: string;
}

/**
 * What `execute` returns: content for the model, details for the renderer and
 * programmatic callers. `details` is required by the host, and `isError`
 * reports a failure without throwing.
 */
export interface PiToolResult {
  readonly content: PiTextPart[];
  readonly details: unknown;
  readonly isError?: boolean;
}

/**
 * The read-only slice of the session the tool may consult (R10). The session id
 * is a correlation label, not an identity; a context without one is a typed
 * failure with zero state, so the manager is optional here.
 */
export interface PiSessionContext {
  readonly cwd: string;
  readonly sessionManager?: { readonly getSessionId: () => string | undefined };
}

/**
 * One registered tool. `parameters` is the JSON Schema generated from the Zod
 * argument schema; it is typed as `unknown` because the host's schema type is
 * not importable under R9.
 */
export interface PiToolDefinition {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly executionMode?: "sequential" | "parallel";
  execute(
    toolCallId: string,
    params: unknown,
    signal: AbortSignal | undefined,
    onUpdate: ((partial: PiToolResult) => void) | undefined,
    ctx: PiSessionContext,
  ): Promise<PiToolResult>;
}

/** The registration surface the extension receives. */
export interface PiHost {
  registerTool(tool: PiToolDefinition): void;
}
