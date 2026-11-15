---
name: http-boundaries
description: Implement wire-format and incremental parsing contracts for HTTP application data.
---

# Parsing data at application boundaries

- Separate type checks, grammar checks, and interpretation. Validate entire
  input fields before calling conversion APIs with permissive parsers.
- Write down accepted whitespace, inclusivity, overflow behavior, and the
  outcome for empty inputs. Check the numeric boundary before narrowing types.
- For streaming input, identify physical record boundaries before decoding.
  Check the cost of buffering an unfinished record and when values can be
  yielded. Keep the error behavior and record order in the public contract.
- Check a normal case and a malformed case independently. Exercise boundaries
  where one byte, one character, or one unit changes the result.
