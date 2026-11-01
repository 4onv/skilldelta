---
name: edge-cases
description: Implement small JavaScript utilities by checking the stated contract and boundary behavior before choosing an algorithm.
---

# Contract-first JavaScript

Before implementing a function, extract its input types, invalid-input behavior,
output requirements, equality rules, and mutation constraints from the request.

- Validate inputs before early returns, including empty collections.
- Distinguish primitive types from wrappers and look-alike values.
- Use standard language primitives that match the requested semantics. Avoid
  implicit coercion when the contract distinguishes types or object identity.
- Preserve references and order when required. Prefer returning new collections
  to modifying the caller's input.
- Check empty values, boundary numbers, Unicode text, duplicate values, and
  special keys when they apply to the stated contract.
- Mentally walk through at least one normal case and one boundary case before
  returning code. Do not broaden or silently reinterpret the specification.

Keep the implementation small, export exactly the requested API, and do not add
dependencies or unrelated functionality.
