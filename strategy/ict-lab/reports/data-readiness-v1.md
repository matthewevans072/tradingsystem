# ICT Lab data readiness, data version 1 (development)

Counts only (PROTOCOL.md section 3); no bar, price or per-session list is in this file. Window 2018-06-01 to 2022-12-30; bound 2022-12-30; latest stored date 2022-12-30; bars after the bound: 0 five-minute, 0 daily; data hash cca16f11d1634982041ec4589700b009e61555937c981e637563c34bc08489ef; status complete.

| Figure (measured) | QQQ |
|---|---|
| sessions expected (NYSE calendar) | 1155 |
| of which early closes | 10 |
| sessions stored | 1155 |
| complete sessions (every slot) | 1151 |
| incomplete sessions (a slot missing) | 4 |
| sessions entirely missing | 0 |
| slots missing in total | 8 |
| unexpected sessions (not in the calendar) | 0 |
| 5-minute bars stored | 89722 |
| stored bars with bad OHLC | 0 |
| stored bars with a slot out of range | 0 |
| zero-range bars | 0 |
| odd-range bars (range over 5% of close) | 0 |
| odd-jump bars (close-to-close over 3% in a session) | 0 |
| daily bars stored | 1155 |
| daily bars missing | 0 |
| daily bars with bad OHLC | 0 |
| daily high/low vs 5-minute session high/low beyond 0.01 (complete sessions) | 57 |
| bars returned by the source (5-minute, all hours) | 210828 |
| dropped: outside the regular session | 121106 |
| dropped: misaligned timestamp | 0 |
| dropped: duplicate slot | 0 |
| dropped: invalid OHLC | 0 |
| dropped by the client (non-trading day, incomplete session, invalid, duplicate, unreadable) | 0 |

## Incomplete sessions by year (count)

- QQQ: 2020: 4

## Comparison with sweep-bos data version (PROTOCOL.md section 3; read-only, counts and dates only)

sweep-bos file sweep-bos-sim.sqlite, data version 1 (hash e7a619d2824847b8b94930b11ab433d414fabf2ed72afe1763d5b2990482752d, 2018-06-01 to 2022-12-30); lab data version 1 (hash cca16f11d1634982041ec4589700b009e61555937c981e637563c34bc08489ef); compared 2018-06-01 to 2022-12-30; identical: yes.

| Figure (measured) | 5-minute bars | daily bars |
|---|---|---|
| lab | 89722 | 1155 |
| sweepBos | 89722 | 1155 |
| common | 89722 | 1155 |
| onlyInLab | 0 | 0 |
| onlyInSweepBos | 0 | 0 |
| differing | 0 | 0 |
| differing by field | ts 0, o 0, h 0, l 0, c 0, v 0 | o 0, h 0, l 0, c 0, v 0 |

- 5-minute bars, dates only in the lab: none
- 5-minute bars, dates only in sweep-bos: none
- 5-minute bars, dates with a differing bar: none
- daily bars, dates only in the lab: none
- daily bars, dates only in sweep-bos: none
- daily bars, dates with a differing bar: none
