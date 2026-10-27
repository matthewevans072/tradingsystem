# HXR engine notes (outside the pre-registered set)

Notes about HXR's mechanics written **after the development results were seen** (2026-10-23). This file is not
in `service.js` `PREREG_FILES`, so editing it never changes the pre-registration manifest. `ENGINE-SPEC.md` is
not edited again under hxr-prereg-3a (EXPERIMENT-LOG entry 22).

## Changes made after results were seen (code)

- **Tech/AI tags reach backtests** (`409c353`, EXPERIMENT-LOG entry 18). `data.js` `buildInputs` returns each
  symbol with `techAi`. The data hash covers market data and listings only, not universe classifications.
  Every stored run records `details.codeRevision` and `details.symbolsHash`; runs without `codeRevision`
  (including the development pick, runs 1-22) ran with the tags dropped.
- **Binding caps below zero are recorded** (`e495870`, entries 19 and 20). Reporting only: no decision, size or
  fill changed.

## Known issues (not changed)

- **The pre-registration manifest depends on line endings.** `preregManifest` hashes the bytes of the working
  tree. With `core.autocrlf=true` (the owner's PC), `PREREGISTRATION.md` and `configs/hxr-hold-0.1.0.json` are
  checked out with CRLF line endings, so the same commit gives a different manifest hash on a checkout with LF
  endings. Values are in EXPERIMENT-LOG entry 22. A fix would be a new pre-registration version (for example
  hashing the text with line endings normalised), and it would change the recorded hash.
- **The account-decline pause can lock in a mostly-cash account**, and the open-risk budget measured from
  current value lets rising holdings block new buys. Both are what the pre-registered rules produce
  (diagnosis, supplements d and e); neither is a code defect.
