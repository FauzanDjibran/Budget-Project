# Multi-Currency Concept

An implementation specification for foreign-currency values: how they acquire base-currency value, how that value is carried, and how settlement resolves it.

The model is stated generically. It is written for AP, but nothing in it is specific to payables — receivables, advances, bank accounts and any future foreign-currency object use the same rules with no branching on object type.

---

## 1. Purpose

**A foreign amount and its base-currency value are two independent facts.** The base value is not re-derivable from the foreign amount by re-quoting a rate — it is a history of how the balance was built.

Everything below follows from that. A "rate" in this system is one of only two things:

- an **input** that creates base value where none existed, or
- an **output** computed as `base ÷ foreign` over a balance that already exists.

Confusing the two is the single failure mode this specification exists to prevent. A derived rate must never be stored, defaulted into a document, or treated as a market rate.

---

## 2. Core Model

### 2.1 Definitions

| Term | Definition |
|---|---|
| **Base currency** | The single currency in which all balances and journals are ultimately measured. |
| **Document currency** | The currency in which a document's amounts are natively expressed. |
| **Foreign amount** | The document-currency measure of a value. Never altered by any later rate. |
| **Base amount** | The base-currency measure of that same value. Stored independently. |
| **Origination rate** | An input rate that converts a foreign amount into base *at first recognition*. |
| **Carrying rate** | A derived output: `base_balance ÷ foreign_balance`. Effective, not quoted. |
| **Movement rate** | An input rate converting document currency into an account's currency for a cash movement. |
| **Closing rate** | An input rate at a reporting date, used to retranslate monetary balances. |
| **FX difference** | The residual when two base values for the same foreign amount disagree. |

### 2.2 The object model

Everything that holds foreign currency is a **balance**. A balance is not a stored pair of numbers but the accumulation of **ledger events**:

```
Event  = (object, event_type, foreign_delta, base_delta, date)

Balance(object) = ( Σ foreign_delta , Σ base_delta )
carrying_rate(object) = base_balance ÷ foreign_balance        # projected, never stored
```

Three kinds of object hold balances, and they behave identically:

| Object | Foreign balance means | Base balance means |
|---|---|---|
| **Obligation** (payable, receivable) | Currency owed / due | What that obligation cost to recognise |
| **Advance / prepayment** | Currency prepaid | What that currency cost to acquire |
| **Bank account** | Currency held | What that currency cost to acquire |

The uniformity is the point: a settlement is always *one balance releasing value to another*, and the rules never ask which kind either side is.

### 2.3 The four things that can happen to a value

| | Foreign | Base | Rate involved |
|---|---|---|---|
| **Originate** | created | created | Origination rate (input) |
| **Inherit** | carried forward | carried forward unchanged | none |
| **Relieve** | reduced | reduced proportionally | Carrying rate (derived) |
| **Retranslate** | unchanged | restated | Closing rate (input) |

No fifth operation exists. In particular, there is no operation that recomputes existing base value from a new rate — retranslation posts a *new event*, it does not edit history.

### 2.4 When a rate is meaningful

| Condition | Rate | Behaviour |
|---|---|---|
| Document currency ≠ base currency | Genuine rate | Foreign and base diverge; FX differences can arise. |
| Document currency = base currency | `1` | `base = foreign`; FX differences are structurally zero. |

Base-currency documents still carry a populated rate of `1` so that one conversion path serves both cases. Branch only on whether a difference is *recognised*, never on whether a conversion is *performed*.

---

## 3. Exchange Rate Rules

### 3.1 Origination

An origination rate exists to **create base value that did not previously exist**. It applies only to amounts *first recognised* on that document.

```
base_amount = foreign_amount × origination_rate
```

Every monetary component of a line converts at the same rate — gross, discount, unit discount, net and tax each get an independently stored base counterpart. Tax is computed on the already-converted base, not converted separately.

### 3.2 Inheritance

**A document that draws in amounts from an upstream document takes the upstream *base* values unchanged.** It does not re-multiply the foreign amounts by its own rate.

This is the rule that makes a document's header rate *not* a property of its total:

- A goods receipt inherits the order's rate — the rate travels with the commitment, it is not re-quoted at receipt date.
- An invoice matching prior receipts inherits their base values. The invoice's own rate touches only amounts the invoice *originates* — a billed variance, a charge no receipt recognised.

A single document can therefore hold amounts carried at several different historical rates. That is exactly why a stored header rate cannot describe the document as a whole, and why the carrying rate concept is required.

### 3.3 Rate roles by document

| Document | Rate behaviour |
|---|---|
| **Order** | Originates. Rate entered at order date. |
| **Receipt** | Inherits from the order. |
| **Invoice** | Originates for its own new amounts; inherits for matched amounts. |
| **Advance** | Originates nothing. Its base value is created entirely by cash movement. |
| **Cash/Bank** | Originates for incoming currency; relieves for outgoing (§5). |

---

## 4. Carrying Rate Rules

### 4.1 Why one fixed rate cannot work

A balance is an aggregation of amounts recognised at different rates. Any single stored rate would mis-state either its foreign or its base measure.

```
carrying_rate = Σ base ÷ Σ foreign
```

The result is an **effective** rate. It will generally equal no rate anyone quoted or transacted at. A balance built from a `16,000` payment and a `15,500` payment carries at `15,800` — a number that never appeared in any deal.

### 4.2 Derived, never stored

**Persist `foreign_balance` and `base_balance`. Compute the rate on read.**

- Never write a carrying rate to a rate table.
- Never default it into a new document or offer it as a rate suggestion.
- Never reconcile it against market rates — it is not a market observation.
- Never materialise and round it as an intermediate (§9.4).

### 4.3 The authoritative balance

**The ledger is the sole source of any carrying rate.** Documents do not own carrying rates; balances do. A document's displayed totals are a *presentation* of ledger events, never an independent computation.

Rationale: the ledger is the only structure recording every event that affects the balance — receipt, match, variance, allocation, settlement, retranslation. Any total computed elsewhere is a partial view and will diverge the first time an event is posted that the view does not model.

### 4.4 How the rate moves

| Event | Effect |
|---|---|
| Addition at a different rate | Moves toward the new rate, weighted by amount. |
| Addition at the same rate | Unchanged. |
| **Relief at the carrying rate** | **Unchanged** — the ratio is preserved by construction. |
| Relief at any other rate | Would corrupt the remainder. Never done; the gap becomes an FX difference instead. |
| Retranslation | Reset to the closing rate. |
| Foreign balance reaches zero | Undefined (§9.3). |

The third row is the load-bearing one. Because relief at the carrying rate leaves the rate untouched, a balance's rate is stable against settlement activity and moves only when new value is genuinely added or retranslated.

---

## 5. Cash/Bank Settlement Rules

### 5.1 The two sides

A settlement resolves **two independently determined base values for one foreign amount**:

| Side | Meaning | Determined by |
|---|---|---|
| **Settlement base** | Base value released from the *target* balance | The target's carrying rate |
| **Transaction base** | Base value moved through the *source* (bank, advance) | The source's own rate |
| **FX difference** | Residual | The balancing figure |

The difference is not an error or a rounding artefact. It is the unavoidable consequence of relieving a historically-valued obligation with currency acquired at a different price.

### 5.2 The transaction-base kernel

One formula covers every cash movement:

```
transaction_base = settlement_foreign
                 × movement_rate( document_currency → account_currency )
                 × carrying_rate( account )
```

Two factors, each with a distinct job: the **movement rate** crosses currencies; the **account carrying rate** values what leaves the account. This collapses correctly in all cases:

| Case | movement_rate | account carrying rate | Effect |
|---|---|---|---|
| Foreign document, same-currency foreign account | `1` (not entered) | account's derived rate | Account's own rate governs |
| Foreign document, base-currency account | **entered** — the actual bank rate | `1` | Entered rate governs |
| Base document, base account | `1` | `1` | Identity |
| Foreign document, third-currency account | **entered** — cross rate | account's derived rate | Both apply |

**Rules for the movement rate:**

- **Same currency ⇒ no rate may be entered.** It is `1`. Permitting an entry here would let a user override the account's carrying rate and silently corrupt the pool.
- **Different currency ⇒ the rate must be entered explicitly.** It is the actual rate the bank used. It is never inherited, never defaulted from a rate table, never taken from the document.
- **Incoming currency ⇒ the receiving rate must be stated.** It creates the base value joining the account's pool and re-weights the account's carrying rate for every subsequent outgoing settlement.

### 5.3 Settlement base: create or relieve

```
if target has no base value for the settled portion:      # CREATE
    settlement_base := transaction_base
    fx_difference   := none

elif settlement_foreign == target.foreign_balance:        # RELIEVE, in full
    settlement_base := target.base_balance                # exact release
    fx_difference   := settlement_base − transaction_base

else:                                                     # RELIEVE, partial
    settlement_base := round( settlement_foreign
                              × target.base_balance
                              ÷ target.foreign_balance )
    fx_difference   := settlement_base − transaction_base
```

**The discriminator is whether base value already exists — never the document type.** An advance paid in cash has no prior base value: the payment *is* the origin of its value, so settlement base is simply the transaction base and no difference can arise. An invoice already carries base value from the receipts behind it: the payment *relieves* it, and the two sides can disagree.

Implementing the branch on this condition rather than on `purpose = 'Advance'` means any future object originated by cash movement behaves correctly with no code change.

### 5.4 Sign of the FX difference

**The FX difference is the balancing figure of the entry.** Its side is never chosen independently.

```
fx_difference = settlement_base − transaction_base
     > 0  →  credit  →  gain
     < 0  →  debit   →  loss
     = 0  →  no line
```

Deriving the amount *from* the balance requirement rather than computing a magnitude and then asserting a side makes an unbalanced FX entry unrepresentable. It also generalises to receivables with no asset/liability branch, because it never refers to the balance's nature.

### 5.5 Allocation is settlement without cash

Applying an advance to an invoice uses the identical structure — only the source changes:

| Side | Rate source |
|---|---|
| Settlement base — obligation relieved | Obligation's carrying rate |
| Transaction base — advance released | Advance's carrying rate |
| FX difference | Balancing figure |

Both sides are carrying rates here because both balances already hold base value. Where cash is involved, the source side uses §5.2 instead. The invariant holds throughout: **each side releases base at its own rate; the residual is FX difference.**

### 5.6 Multi-line settlement

**FX difference is computed per settlement line, never per transaction.** Each line has its own target, carrying rate, settlement base and difference. The transaction is a container:

```
Σ transaction_base(lines) = total cash movement        # hard constraint
Σ fx_difference(lines)    = balancing figure of the entry
```

A transaction-level difference would require a blended carrying rate across targets that were valued independently — reintroducing the averaging error the model exists to prevent. Per-line differences may be *summarised* into one journal line for presentation; the stored analytic stays per-line.

### 5.7 Journal shape

| Event | Debit | Credit |
|---|---|---|
| Receipt | Inventory + Tax @ receipt base | Payable @ receipt base |
| Advance payment | Advance @ transaction base | Bank @ transaction base |
| Invoice-originated variance | Variance account @ invoice rate | Payable @ invoice rate |
| Allocation | Payable @ obligation carrying rate | Advance @ advance carrying rate |
| Payment | Payable @ obligation carrying rate | Bank @ transaction base |
| *(any relieving event)* | FX difference if negative | FX difference if positive |

Advance payment produces no difference line, per §5.3.

### 5.8 Transfers

A transfer between two accounts is two legs and **conserves base value** — transfers create no value.

- The out-leg values at the source account's carrying rate.
- The in-leg receives exactly that base value; its effective rate is derived, not entered.
- If the receiving leg carries a differently stated rate, the residual is an FX difference on the transfer — never a silent gain absorbed into the receiving pool.

---

## 6. Period-End Valuation

### 6.1 What is retranslated

| Balance | Treatment | Reason |
|---|---|---|
| Payables, receivables | **Retranslate** at closing rate | Monetary — a fixed number of currency units will change hands. |
| Foreign bank accounts | **Retranslate** | Monetary. |
| Inventory | **Never** | Non-monetary; held at its historical acquisition value. |
| Advances against orders for goods | **Do not retranslate** (policy — §10) | Non-monetary: a prepaid claim on goods, not on currency. |

### 6.2 Mechanism

Retranslation adjusts **base only**. The foreign balance is untouched.

```
unrealised_fx = ( foreign_balance × closing_rate ) − base_balance

post event: ( foreign_delta = 0 , base_delta = unrealised_fx )
```

Because this is an ordinary base-affecting event, the carrying rate — still `base ÷ foreign`, still derived — **resets to the closing rate automatically**. No new rate concept is introduced, nothing is stored, and §5 needs no modification.

### 6.3 Consequence for later settlement

After retranslation, a settlement's FX difference measures only movement **since the revaluation date**; the earlier movement was already recognised as unrealised. Relief is still at the carrying rate, which is now the closing rate. The realised/unrealised split is a reporting classification over difference events, not a change to how they are computed.

---

## 7. Relationship Between Rates

### 7.1 Selection rule

The rate is determined by **what the amount is doing**, never by the document it sits on:

| The amount is… | Use |
|---|---|
| Newly originated (order line, invoice-originated charge, incoming receipt) | **Origination rate** of that document |
| Carried forward from upstream (receipt from order, invoice from receipt) | **Upstream base value**, inherited unchanged — no rate applied |
| Reducing an outstanding balance (payment, allocation, match) | **Carrying rate** of that balance, from the ledger |
| Crossing currencies in a cash movement | **Movement rate**, explicitly entered |
| Leaving an account | **That account's carrying rate** |
| An unsettled monetary balance at a reporting date | **Closing rate** |

### 7.2 Lifecycle

```
Order rate ──inherit──▶ Receipt ──accumulate──▶  LEDGER BALANCE (foreign, base)
                                                        │
Invoice rate ──(originated amounts only)──────────────▶ ┤
                                                        │
Closing rate ──(period end, monetary only)────────────▶ ┤
                                                        │
                                    carrying rate = base ÷ foreign
                                       (projected, never stored)
                                                        │
                      ┌─────────────────────────────────┴──────────────────┐
                      ▼                                                    ▼
          Allocation (source = advance,                        Payment (source = bank,
          at advance carrying rate)                     at movement rate × bank carrying rate)
                      │                                                    │
                      └───────────▶ FX difference = balancing figure ◀─────┘
```

Exactly one rate governs each amount. The handovers:

1. **Order → Receipt** — no new rate; the rate travels with the commitment.
2. **Receipt → Invoice** — no new rate for matched amounts. Here the obligation stops having *a* rate and starts having a *carrying* rate.
3. **Period end** — the only point at which existing base value is legitimately restated, and only for monetary balances.
4. **Obligation → Settlement** — carrying rate governs relief; the source's rate governs what is given up. The gap is recognised.

---

## 8. Invariants

1. Foreign and base amounts are **both persisted** for every value. Base is never re-derived at query time.
2. Recognised base value is **immutable**, except through an explicit retranslation event that posts new history rather than editing old.
3. A header rate applies **only to amounts originated on that document**.
4. Carrying rate is **computed from ledger balances, never stored**.
5. A carrying rate is **never treated as a market rate** — not defaulted, not suggested, not written to a rate table.
6. Relief of a balance is valued at **that balance's carrying rate**.
7. A cash movement crossing currencies requires an **explicitly entered movement rate**; it is never defaulted.
8. A cash movement within one currency uses the **account's carrying rate**, and **no rate may be entered**.
9. Incoming foreign currency requires a **stated receiving rate**, which joins the account's pool.
10. FX difference is the **balancing figure** of the entry; its sign is never computed independently.
11. **Creating** a balance produces no FX difference: `settlement_base := transaction_base`.
12. Base-currency documents carry rate `1` and use identical logic, producing structurally zero differences.
13. All components of a line convert at **one and the same rate**.
14. **Settlement foreign ≤ outstanding foreign.** Over-settlement is rejected, not absorbed.
15. **Full settlement releases the remaining base exactly**, not a recomputed product.
16. A balance with **zero foreign must have zero base**; any residue is flushed to FX difference at full settlement.
17. Settlement base is computed in **one expression** — never by materialising and rounding a rate first.
18. A transfer between accounts **conserves base value**.

---

## 9. Edge Cases

### 9.1 Over-settlement

Rejected at validation (invariant 14), not absorbed into an FX difference. Outstanding is read from the ledger balance, not from a document total — a document total can lag events the document does not model.

### 9.2 Final settlement and accumulated rounding

Partial reliefs each round to the base currency's minor unit, so a sequence of them leaves a residue. Releasing the remaining base **exactly** on full settlement (§5.3) absorbs the entire accumulated residue into that last FX difference, where it belongs. Computing the final relief as `foreign × rate` instead would leave a balance of zero foreign against non-zero base — an unrepresentable state made unreachable by this rule.

### 9.3 Zero or negative foreign balance

- `foreign_balance = 0` ⇒ carrying rate is **undefined**. Return null. Not zero, not the last known rate.
- A bank account whose foreign balance would go negative rejects the movement on the same grounds as invariant 14.

### 9.4 Rounding and precision

| Quantity | Rule |
|---|---|
| Foreign amounts | Round to the currency's minor unit at line level, on storage. |
| Base amounts | Round to the base currency's minor unit at line level, on storage. |
| Entered rates | High fixed precision (≥ 10 dp), stored as decimal — never float. |
| Carrying rates | Not stored. Displayed rounded; **never used rounded**. |
| Settlement base | One expression, one rounding: `round(foreign × base_balance ÷ foreign_balance)`. |

**Why invariant 17 matters.** Computing `rate = base ÷ foreign`, rounding it, then multiplying pushes drift into the *remaining* balance, where it compounds. Computing in a single expression confines rounding to the amount being posted. Document totals must be the sum of stored line values, never a re-rounded computation of the total.

### 9.5 Balances built entirely at one rate

The carrying rate equals that rate, and settlement against a matching source produces a zero difference — no line is posted. The general path handles this; no special case is needed.

### 9.6 Currency of the difference

FX differences are always and only in base currency. They have no foreign component, and post as `foreign_delta = 0`.

---

## 10. Policy Parameters

Decisions the model exposes deliberately. Each must be set before implementation; none affects the rules above.

| Parameter | Options | Default |
|---|---|---|
| **Advance monetary treatment** | Retranslate at period end / hold at historical carrying rate | Hold — a prepaid claim on goods is non-monetary, and holding preserves a meaningful carrying rate through to allocation. A pure cash advance with no goods claim may warrant retranslation. |
| **Variance classification** | Share the FX difference account / separate account | **Separate.** A billed price or quantity variance is a difference in *foreign amount*; an FX difference is a difference in *rate*. They may post to the same GL account if desired, but must never share an analytic classification — merging them destroys the only figure that answers "what did currency movement cost us?" |
| **Tax conversion rate** | Document rate / statutory rate for the invoice date | Document rate (invariant 13). Some jurisdictions require the VAT base on a foreign-currency invoice to use a published statutory rate instead. If so, add a `tax_rate_fx` on the header applied solely to tax components; nothing else changes. Confirm against the applicable tax position. |
| **Closing rate source** | Rate table keyed by `(currency, date, rate_type)` | Required. Carrying rates are never written back to it. |
| **Rounding precision** | Per currency minor unit | Base currency precision governs all base amounts. |

---

## Appendix — Worked Illustration

An obligation of `880 USD` carried at `13,217,600 IDR` — carrying rate `15,020` — settled three ways. An advance of `200 USD` was built from a `16,000` payment and a `15,500` payment, giving it a carrying rate of `15,800`.

| # | Event | Foreign Δ | Base Δ | Balance | Carrying rate |
|---|---|---|---|---|---|
| 0 | Obligation recognised | `+880.000` | `+13,217,600` | `880.000 / 13,217,600` | `15,020` |
| 1 | Allocate advance `200` | `−200.000` | `−3,004,000` | `680.000 / 10,213,600` | `15,020` |
| 2 | Pay `250` from USD account | `−250.000` | `−3,755,000` | `430.000 / 6,458,600` | `15,020` |
| 3 | Pay `430` from IDR account, full | `−430.000` | `−6,458,600` | `0 / 0` | *undefined* |

Note the carrying rate is unmoved by every relief — that is §4.4 in action.

**1 — Allocation.** Source is the advance, releasing at its own `15,800`:

```
Dr  Payable            3,004,000     200 × 15,020
Dr  FX Difference        156,000     balancing → loss
    Cr  Advance                     3,160,000     200 × 15,800
```

A real loss: currency was prepaid at an effective `15,800` against an obligation carried at `15,020`.

**2 — Payment from a USD account** whose carrying rate is `15,300`. Same currency, so no movement rate is entered:

```
transaction_base = 250 × 1 × 15,300 = 3,825,000

Dr  Payable            3,755,000     250 × 15,020
Dr  FX Difference         70,000     balancing → loss
    Cr  Bank USD                    3,825,000
```

**3 — Final payment from an IDR account** at a stated bank rate of `14,700`. Cross-currency, so the movement rate is entered; the account's carrying rate is `1`. Being a full settlement, the remaining base is released exactly:

```
transaction_base = 430 × 14,700 × 1 = 6,321,000

Dr  Payable            6,458,600     exact release, not 430 × rate
    Cr  Bank IDR                    6,321,000
    Cr  FX Difference                 137,600     balancing → gain
```

A gain: the final tranche of currency was obtained at `14,700` against an obligation carried at `15,020`.

**Net across the obligation:** `156,000 + 70,000` loss less `137,600` gain = **`88,400` net loss**, entirely explained by the spread between the `15,020` at which the obligation was carried and the `15,800` / `15,300` / `14,700` at which currency was actually obtained. The balance closes at `0 / 0` with no residue.
