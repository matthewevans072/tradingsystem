# sweep-bos data readiness, data version 1 (warmup-development)

Counts only (PRE-REGISTRATION.md 1.2-1.4); no bar, price or per-session list is in this file. Window 2018-06-01 to 2022-12-30; bound 2022-12-30; latest stored date 2022-12-30; bars after the bound: 0 five-minute, 0 daily; data hash e7a619d2824847b8b94930b11ab433d414fabf2ed72afe1763d5b2990482752d; status complete.

| Figure (measured) | QQQ | SPY |
|---|---|---|
| sessions expected (NYSE calendar) | 1155 | 1155 |
| of which early closes | 10 | 10 |
| sessions stored | 1155 | 1155 |
| complete sessions (every slot) | 1151 | 1150 |
| incomplete sessions (a slot missing) | 4 | 5 |
| sessions entirely missing | 0 | 0 |
| slots missing in total | 8 | 13 |
| unexpected sessions (not in the calendar) | 0 | 0 |
| 5-minute bars stored | 89722 | 89717 |
| stored bars with bad OHLC | 0 | 0 |
| stored bars with a slot out of range | 0 | 0 |
| zero-range bars | 0 | 0 |
| odd-range bars (range over 5% of close) | 0 | 0 |
| odd-jump bars (close-to-close over 3% in a session) | 0 | 0 |
| daily bars stored | 1155 | 1155 |
| daily bars missing | 0 | 0 |
| daily bars with bad OHLC | 0 | 0 |
| daily high/low vs 5-minute session high/low beyond 0.01 (complete sessions) | 57 | 124 |
| bars returned by the source (5-minute, all hours) | 210828 | 212081 |
| dropped: outside the regular session | 121106 | 122364 |
| dropped: misaligned timestamp | 0 | 0 |
| dropped: duplicate slot | 0 | 0 |
| dropped: invalid OHLC | 0 | 0 |
| dropped by the client (non-trading day, incomplete session, invalid, duplicate, unreadable) | 0 | 0 |

## Incomplete sessions by year (count)

- QQQ: 2020: 4
- SPY: 2019: 1, 2020: 4

## Sessions listed in periods-hxr-v3.json excludedSessions (reported; excluded only by the incomplete-session rule)

| Date | QQQ bars stored / full | SPY bars stored / full | Reason listed |
|---|---|---|---|
| 2021-10-25 | 78 / 78 | 78 / 78 | Alpaca has almost no NYSE-listed (Tape A) trades this session; affects VST |
| 2022-01-24 | 78 / 78 | 78 / 78 | Alpaca NYSE trade gap 10:45-15:45 ET for several NYSE names |
| 2022-01-26 | 78 / 78 | 78 / 78 | Alpaca NYSE trade gap 15:00-15:45 ET for some NYSE names |
| 2022-03-08 | 78 / 78 | 78 / 78 | Alpaca has almost no NYSE-listed trades this session; affects VST |
