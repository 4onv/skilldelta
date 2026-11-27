# UI boundaries benchmark

Two small JavaScript tasks isolate mistakes that can survive an ordinary UI smoke test.

- **Latest search** uses held promises to test stale results and errors, repeated query strings, synchronous fetch errors, and independent search instances.
- **Grid paste** plans one all-or-nothing paste from unquoted TSV. It distinguishes explicit blanks, omitted trailing fields, record terminators, and edge overflow.

```sh
skilldelta init ui-evaluation --preset ui-boundaries
cd ui-evaluation
skilldelta run --dry-run --model validation-only --endpoint https://example.com/v1/chat/completions
```

The default plan has 12 requests. Dry run validates the setup without contacting the endpoint or running Docker. With a real configured model and evaluation environment, the paired run compares the same tasks with and without the included short guidance. Each prompt describes its own contract. Verifier source is withheld from provider input. The repository tests run hand-written references and deliberately flawed variants. These variants demonstrate the verifier and do not represent model output.

The benchmark measures JavaScript state and cell mapping. Browser layout, native clipboard behavior, and framework scheduling need separate integration tests. For browser-level examples, see [Latest Response Check](https://github.com/4onv/latest-response-check) and [Grid Paste Check](https://github.com/4onv/grid-paste-check).
