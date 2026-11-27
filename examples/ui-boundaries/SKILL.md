---
name: ui-boundaries
description: Preserve request ownership and exact cell boundaries in UI logic.
---

When requests overlap, use a distinct identity for each invocation, including repeated inputs. Scope that identity to the owner of the UI state. Guard all settled state changes. Test by releasing held operations in the reverse order and asserting state after each settles.

For grid paste, preserve the distinction between an explicit empty field and absent data. Tokenize without broad trimming. Treat the terminal record separator according to the input contract, and check every destination before committing an atomic paste.
