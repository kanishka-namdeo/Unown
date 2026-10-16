<!-- beer-song (521 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Return flat list of strings with empty string "" separating verses, not nested lists or newlines within strings.

## Known pitfalls
- Handle n==2 as special case: second line uses "1 bottle" (singular), not "1 bottles".
- n>=3 uses "{n-1} bottles" (plural); n==0 and n==1 already require special handling.


---

<!-- book-store (493 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Use integer cents for all monetary calculations to avoid floating-point issues.

## Known pitfalls
- Greedy largest-group-first for book-store discount optimization requires post-processing: replace (5,3) pairs with (4,4) pairs since 2×4@20% (5120¢) < 5@25% + 3@10% (5160¢).


---

<!-- bottle-song (639 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Use a NUMBERS list indexed by count for spelled-out number lookup.
- Capitalize only the first occurrence of the number word (hanging lines); keep lowercase for "There'll be" line.
- Use "no" instead of a number word when count reaches 0.
- Handle singular/plural "bottle"/"bottles" based on count.
- Separate multiple verses with an empty string "" in the returned list, not a newline character.

## Known pitfalls
(empty)


---

<!-- dominoes (458 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Return `[]` for empty input in domino chain problems; never return `None`.

## Known pitfalls
- Circular domino chains: verify first domino's left value equals last domino's
  right value only in the backtrack base case (all dominoes placed).


---

<!-- food-chain (486 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Build cumulative verses algorithmically by iterating downward through the chain.
- Handle special cases (spider clause, horse termination) with targeted conditionals.

## Known pitfalls
- Hardcoding verses in cumulative song exercises creates unmaintainable duplication.


---

<!-- grade-school (665 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Track students globally (not per-grade); a student can only belong to one grade.
- First successful add_student wins; subsequent adds of same name return False.

## Known pitfalls
- Roster sorting requires two-level sort: primary by grade ascending, secondary by name alphabetically. Use `sorted(items(), key=lambda x: (x[1], x[0]))`.
- `added()` must return cumulative list of booleans for every add_student call in order, not just the last result.


---

<!-- phone-number (496 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Strip non-digit characters first, then validate length and structure on the clean digits — not on the raw input with punctuation.

## Known pitfalls
- NANP area code and exchange code must start with digit 2-9 (not 0 or 1); validate these after removing any country code prefix.


---

<!-- pig-latin (524 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- "xr" and "yt" prefixes are vowel sounds — check before consonant-cluster logic.
- "qu" is a single consonant unit — skip both letters when scanning for vowel boundary.

## Known pitfalls
- 'y' is consonant at word start but becomes vowel after consonants (e.g., "rhythm" → "ythmrhay", "my" → "ymay").


---

<!-- proverb (627 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- For proverb-style chain generation, iterate over consecutive pairs using `range(len(items)-1)` and access `items[i]` and `items[i+1]`, then append a final summary line referencing the first item.

## Known pitfalls
- When implementing Exercism exercises, always read the test file first to discover function signatures (e.g., `*args` and optional kwargs like `qualifier=None`) that aren't obvious from the stub.


---

<!-- transpose (427 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Variable-length row transpose: pad left with spaces only up to the last row
  that has a character at each column position; skip padding for rows after
  that point (no right-padding).

## Known pitfalls
(empty)

