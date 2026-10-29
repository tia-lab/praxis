# Host prompt — Pi tool acceptance (P7–P11)

Run with the real host, one JSONL transcript, one disposable store:

```sh
pi --mode json --extension ./src/pi/extension.ts --tools praxis,bash --print "$(cat tests/pi/e2e-prompt.md | sed -n '/^## Prompt/,/^## Observations/p' | sed '1d;$d')" > /tmp/praxis-e2e.jsonl
```

## Prompt

You have one tool, `praxis`, with three ops: `start`, `submit`, `read`.

1. Call `praxis` with op=start, flow=architect, requestId=pi-e2e-1. Report the
   result status, the step descriptor and the nonce you were given.
2. Before submitting anything, call `praxis` with op=read, the instance id from
   step 1, and step=draft. Report exactly what comes back, including any error code.
3. Call `praxis` with op=submit, the same instance, and artifact
   {"schema":"praxis.artifact.architecture/v1","nonce":"<the nonce from step 1>"}.
   Report the step descriptor you got back and the digest of the accepted artifact.
4. Call `praxis` with op=read, the same instance, and step=draft. Report whether
   the artifact body came back.
5. Call `praxis` with op=submit, the same instance, and artifact
   {"schema":"praxis.artifact.derive/v1","nonce":"<the same nonce>",
    "derivedFrom":"<the digest from step 3>"}. Report the final status.
6. Report every tool result verbatim. Do not retry a call that returned an error
   more than once, and never invent a result you did not receive.

## Observations P7–P11 must show

| Check | Required observation |
| --- | --- |
| P7 | At least three `praxis` `tool_execution_start` lines; the last successful `tool_execution_end` carrying `details.result` has `status:"completed"`; at least one denial, every denial `details.code === "CAPABILITY_DENIED"` with `details.detail.step === "draft"`; extra denials from model retries are recorded as `deniedAttempts`, not failures; any non-denial `praxis` `isError` fails the check. |
| P8 | CLI status for the same instance is `completed` with exactly six keys and artifacts `draft,derive`; the store holds two `accepted` artifact rows. |
| P9 | The denial count is at least one and every denial names `CAPABILITY_DENIED`/`draft`. |
| P10 | `grep -c '"nestedCalls"' /tmp/praxis-e2e.jsonl` is `0`: the tool never calls `ctx.executeTool`. |
| P11 | No `tool_call` handler is registered (the extension test proves the absence); a `praxis` start followed by a `bash` call is recorded as **observed; Pi-wide denial not claimed**, and a bash call that never appears is recorded as **unproven**, never as a pass. |

Step 2 is the expected denial: `draft` grants `artifact.write`/`emit` and no
`artifact.read`, so `read` must fail `CAPABILITY_DENIED` with
`details.detail.step === "draft"` and leave the instance untouched. Step 3 must be a
`submit` of `praxis.artifact.architecture/v1` carrying the pinned nonce, step 5 a
`submit` of `praxis.artifact.derive/v1` carrying the same nonce and step 3's digest
as `derivedFrom`. A run that ends anywhere other than `completed` is a failed
observation, recorded as such.
