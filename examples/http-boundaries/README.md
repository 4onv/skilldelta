# HTTP data boundaries

Run `skilldelta init http-evaluation --preset http-boundaries` to create an editable evaluation project. Set the model and endpoint in its generated config, then run `skilldelta run --dry-run` to validate the inputs and call count.

| Task | Executable checks |
| --- | --- |
| Retry-After | Delay seconds, IMF-fixdate validation, expired dates, safe integer limits |
| Byte ranges | Inclusive endpoints, suffix and open-ended requests, oversized numeric fields |
| NDJSON | Split UTF-8 and CRLF, byte limits, incremental iteration, malformed records |

The tasks and fixtures are original synthetic exercises released under this repository's MIT license. Their contracts define subsets and extensions for the exercises. They exercise behaviors inspired by HTTP field syntax and newline-delimited JSON. [RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html) · [NDJSON specification](https://github.com/ndjson/ndjson-spec)

The package ships prompts, editable starters, verification checks, and the sample skill. CI proves each set of checks accepts a reference implementation and rejects a shortcut that misses edge cases. The reference and failing variants live in the repository's test fixtures. No model comparison results are supplied for this preset.
