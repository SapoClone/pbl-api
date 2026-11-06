# Decision log

Answers of the business owner to the decisions in [the review](README.md#5-decisions-for-you). A decision is
**answered** once the owner has said so; the rest stay open and keep their recommended default as a proposal only.

## Answered (6 November 2026)

| Decision | Answer | Where it goes |
|---|---|---|
| D1 A new branch gets a default warehouse | **Yes** | Inventory creates one default `BRANCH` warehouse per branch from the branch event, and backfills the branches that have none |
| D3 A sale always uses its own branch's warehouse | **Yes** | The sale resolves the warehouse from its branch; the client no longer chooses it; never central or quarantine |
| D22 Every POS sale belongs to an open shift | **Yes.** There must be a place to manage shifts. There is no default cashier (access is by permission): the cashier picks from the shifts that are open and available | [Cash shift design](../specs/2026-11-06-cash-shift-design.md); whether a colleague's shift may be picked is its open question 1 |
| D31 A paid plan past its end date | **7 days of grace, then `free` limits** (data kept, new adds blocked) | An expiry job in platform |
| D4 Deleting or deactivating a branch | **Blocked while it has stock, an open shift or a pending transfer; the refusal lists every reason** | A branch guard in platform that asks the other services; delete only after deactivate |
| D23 to D27 Cash drawer rules | **Specified by the owner**: every cash movement is an entry; expected = opening + sales - refunds + pay-ins - pay-outs; variance = counted - expected; tolerance and manager approval; shortage as its own entry; closed shifts locked; refunds come out of the current drawer; a refund of an earlier shift's order; split payments count cash only; offline sync before close; flag shifts open too long; shortage reports | [Cash shift design](../specs/2026-11-06-cash-shift-design.md) |

## Still open

D2, D5 to D21, D28 to D30, D32 to D38 of the review. Until the owner answers, the recommended default is only a proposal.
