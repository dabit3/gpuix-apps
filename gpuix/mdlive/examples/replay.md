# Merge replay

We replayed 30 days of production writes (2.1M mutations from 48k devices) through the v2 merge engine and compared the result with what the server stored. [Back to the design doc](notes.md#merge-rules).

## Method

1. Export the write log for March, grouped by device and ordered by client clock
2. Shuffle delivery order within each device's offline window
3. Merge on a fresh replica and diff it against production

## Results

| Entity  | Mutations | Matched | Needed a counter |
|---------|-----------|---------|------------------|
| Expense | 1,412,880 | 100%    | No               |
| Budget  | 318,204   | 96.9%   | Yes              |
| Receipt | 286,551   | 100%    | No               |
| Comment | 91,317    | 100%    | No               |

> Every mismatch was a budget total edited on two devices inside the same minute.

## Next

- [ ] Re-run with April traffic after the counter ships
- [ ] Add the replay to CI as a nightly job
