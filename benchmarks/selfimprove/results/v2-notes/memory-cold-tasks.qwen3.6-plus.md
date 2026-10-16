<!-- beer-song (379 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Use `result.extend(lines)` not `result.append(lines)` when building flat lists from verse lines — append nests lists, extend flattens.

## Known pitfalls
(empty)


---

<!-- book-store (583 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Book-store exercise: greedy grouping by largest groups first is the base approach

## Known pitfalls
- **Critical optimization for book-store**: always replace (5,3) group pairs with (4,4) pairs
  - Two groups of 4 at 20% discount = 5120 cents
  - One group of 5 at 25% + one group of 3 at 10% = 5160 cents
  - Without this swap, greedy approach fails some test cases


---

<!-- bottle-song (496 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Capitalize number-to-word in first line; lowercase in "There'll be" line
- Use "bottle" singular when count = 1; "bottles" plural otherwise
- Separate verses with empty string when take > 1

## Known pitfalls
- Singular/plural handling is easy to miss — test with n=1 explicitly


---

<!-- dominoes (579 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Dominoes Chain Algorithm
- Use backtracking with a `used[]` array to track consumed dominoes.
- At each step, try both orientations of each domino (original and flipped).
- Base case must verify: (1) all dominoes used AND (2) first domino's left end matches last domino's right end.

## Conventions
(empty — AutoDream fills this from session notes)

## Known pitfalls
(empty)


---

<!-- food-chain (486 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Food-chain cumulative song: fly verse has dual-purpose reaction line (initial + closing)
- For n==1 case: skip adding REACTIONS["fly"] before the chain

## Known pitfalls
- Duplicate reaction line bug: avoid adding fly's reaction twice when it's already the verse closer


---

<!-- grade-school (623 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Track all students in a single dict `{name: grade}` to enforce "student can only be added once" across all grades.
- `added()` method returns cumulative list of booleans tracking each add attempt's success.

## Known pitfalls
(empty)

## Task playbooks

### Roster sorting
- Use `sorted(students.items(), key=lambda x: (x[1], x[0]))` to sort by grade numerically, then name alphabetically within each grade.


---

<!-- phone-number (577 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Phone-number validation: check for letters and invalid punctuation before stripping non-digits

## Known pitfalls
- Validating after stripping loses context for specific error messages; validate raw input first
  - Letters → error "letters not permitted"
  - Invalid punctuation → error "punctuations not permitted"
  - Only then strip and check digit count


---

<!-- pig-latin (575 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
(empty — AutoDream fills this from session notes)

## Known pitfalls
(empty)

## Pig-Latin rules
- Treat 'qu' as a single consonant unit — advance past both letters together before checking for vowel boundary.
- 'y' is a consonant at word start but acts as a vowel when it appears after one or more consonants (e.g., "rhythm" -> "ythmrhay", "my" -> "ymay").


---

<!-- proverb (585 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Conventions
- Exercism Python solutions: use `*pieces` variadic positional args with `qualifier=None` keyword arg
- Zero pieces returns empty list `[]`
- Final line uses optional qualifier prefix: "For want of a {qualifier} {last_item} the {kingdom} was lost."
- Intermediate lines pair consecutive items: "For want of a {item} the {next_item} was lost."

## Known pitfalls
- (empty)


---

<!-- transpose (523 bytes) -->
# Tier 1 — Project Memory

## Workflow
- This file is maintained by Unown: terminal session notes are consolidated
  here by AutoDream. Edit freely — your edits are preserved as a new version.

## Task playbooks

### Transpose text
- Pad left with spaces only when a later row has a character at that column position.
- Do not pad right — no trailing spaces in output rows.
- Find the last row contributing to each output column; only include rows up to that point.

## Conventions
(empty)

## Known pitfalls
(empty)

