# SIBA Multi-Currency Concept — Layered Bank Balances

A project-specific specification for SIBA. It **extends** `Multi Currency Concept.md` and replaces only what is named here. Every rule in the core concept not listed in §2.2 applies unchanged.

---

## 1. Purpose and Scope

### 1.1 What SIBA changes

In the core model a bank account is **one balance** with one derived carrying rate, and an outgoing movement is valued at that rate automatically. SIBA replaces this: a foreign-currency bank account is a **stack of rate layers**, and on every outgoing movement the user chooses not only which account to pay from, but **which layer's rate to consume**.

### 1.2 Naming

The layers are ordered first-in-first-out, but consumption is **not** FIFO — it is **specific identification**: the user elects which layers to consume. FIFO describes the *ordering and display* of layers, never the selection.

This distinction is normative. An implementation that consumes oldest-first automatically has not built this feature.

### 1.3 Why this is consistent with the core concept

The core concept holds that base value is **history**, and that a rate is either an origination input or a derived output. Pooled averaging works against that principle — it blends distinct acquisition rates into a figure nobody transacted at. Layering preserves it: every layer's rate is a genuine historical origination rate.

The structural restatement that makes everything else follow:

> **A layer is a balance.** A bank account is a *collection* of balances rather than a single one.

The whole core model then applies unchanged at layer granularity, and the pooled-average account of the core concept is the degenerate case of an account with exactly one layer.

The core prohibition on inventing rates is preserved in substance. The user cannot type a rate; the user selects among rates **the account actually holds**, each of which entered the system through a documented receipt.

---

## 2. Relationship to the Core Concept

### 2.1 Unaffected

Confirmed section by section, and guaranteed by SIBA invariant 13:

- Origination and inheritance of rates (core §3) — orders, receipts, invoices, matching.
- Obligation and advance carrying rates (core §4).
- **Settlement-base determination** (core §5.3) — how much base an obligation releases.
- FX difference as the balancing figure, and its sign (core §5.4).
- Create-vs-relieve branching (core §5.3).
- Per-line FX difference on multi-line settlements (core §5.6).
- Allocation of advances to obligations (core §5.5) — no bank account is involved.
- Base-currency documents and accounts.
- Rounding and precision rules (core §9.4), now applied at layer level.

### 2.2 Replaced or restated

| Core rule | SIBA treatment | § |
|---|---|---|
| §5.2 transaction-base kernel (`× carrying_rate(account)`) | Replaced by layer consumption | 4.2 |
| §5.8 transfers | Refined — layers propagate one-for-one | 6 |
| §6 period-end revaluation | Replaced — collapses layers | 7 |
| Invariant 6 (relief at the balance's carrying rate) | Applies at **layer** level | 4.3 |
| Invariant 8 (no rate entered for same-currency movement) | Restated — no rate may be *entered*, but a layer must be *selected* | 4.4 |
| Invariant 5 (carrying rate never a market rate) | Unchanged; the account-level carrying rate becomes reporting-only | 3.4 |

No other core rule is affected.

### 2.3 Accepted consequences

Two follow directly from the design and are accepted, not mitigated:

1. **The FX difference on a payment becomes a user decision.** Under averaging it is deterministic; here the user's layer choice sets the gain or loss. This is the feature working as intended, and it makes selection an auditable control point (§9).
2. **Layers can go stale.** Nothing forces the oldest layer to be consumed, so unselected layers persist until a period close absorbs them (§7).

---

## 3. The Layer Model

### 3.1 Structure

```
Layer = (
    layer_id,
    account_id,
    acquisition_date,        # drives FIFO ordering
    acquisition_seq,         # tiebreaker within a date
    source_event,            # the transaction that created this layer
    origin_date,             # original acquisition date if propagated by transfer
    rate,                    # origination rate; immutable for the layer's life
    foreign_original,
    base_original,
    foreign_remaining,
    base_remaining,
    status                   # open | exhausted | closed_by_revaluation
)
```

```
account.foreign_balance = Σ foreign_remaining  over open layers
account.base_balance    = Σ base_remaining     over open layers
```

### 3.2 Layer identity

**A layer is identified by the acquisition event that created it, never by its rate.** Two receipts at an identical rate produce two distinct layers and are never joined.

This is why the user selects a *layer*, not a *rate*. With three layers holding `15,000`, "use the 15,000" is ambiguous; "use the layer from the 28 Jan receipt" is not. Selection interfaces must therefore identify layers by date and source document, with the rate as an attribute — never list rates as the selectable unit.

### 3.3 Ordering

FIFO ordering is by `(acquisition_date, acquisition_seq)` — **chronological, never by rate value**. Because selection is always explicit (§4.4), ordering governs display and reporting only; it never determines what is consumed.

### 3.4 A layer's rate is constant

Consumption always releases base in proportion to the layer's own rate, so `base_remaining ÷ foreign_remaining` equals `rate` throughout the layer's life. Core invariant 6 — relief at the balance's own carrying rate leaves that rate undisturbed — therefore holds exactly, at layer granularity.

The **account-level** carrying rate (`base_balance ÷ foreign_balance`) still exists as the weighted average of open layers. It is **reporting-only**: it values nothing and is never an input to any transaction. Core invariant 5 applies to it unchanged — it is never stored, defaulted, or treated as a market rate.

### 3.5 Which accounts are layered

| Account | Layered |
|---|---|
| Foreign-currency account | **Yes** |
| Base-currency account | **No** — a single implicit layer at rate `1`, with no selection and no revaluation |

A foreign-currency obligation paid from a base-currency account is therefore unchanged from the core model: the movement rate is entered, no layer is involved.

---

## 4. Layer Lifecycle

### 4.1 Creation — incoming currency

Every incoming foreign amount creates **exactly one new layer**, at the stated receiving rate:

```
new Layer(
    rate             = stated_receiving_rate,
    foreign_original = received_amount,
    base_original    = round(received_amount × stated_receiving_rate),
    acquisition_date = value_date,
    source_event     = the receipt
)
```

The receiving rate remains mandatory and explicit (core §5.2). A receipt **never merges into an existing layer**, regardless of rate, source, or same-day timing.

### 4.2 The revised kernel

Replacing core §5.2:

```
account_amount   = settlement_foreign × movement_rate( document_ccy → account_ccy )

selection        = [ (layer, amount), … ]        # user-chosen, Σ amount = account_amount

transaction_base = Σ consume( layer, amount )
```

The movement rate is unchanged from the core concept: `1` and not enterable when document and account currency match; explicitly entered when they differ. It crosses currencies. **Layers value what leaves the account.** The core formula's `× carrying_rate(account)` factor is what the consumption sum replaces.

Collapse behaviour is preserved in every case:

| Case | movement_rate | Account side |
|---|---|---|
| Foreign document, same-currency foreign account | `1`, not entered | Layer selection |
| Foreign document, base-currency account | entered (actual bank rate) | Unlayered, rate `1` |
| Base document, base account | `1` | Unlayered, rate `1` |
| Foreign document, third-currency foreign account | entered (cross rate) | Layer selection in the account's currency |

### 4.3 Consumption

```
consume( layer, amount ):
    if amount == layer.foreign_remaining:            # full consumption
        base = layer.base_remaining                  # exact release
    else:                                            # partial
        base = round( amount × layer.base_remaining ÷ layer.foreign_remaining )

    layer.foreign_remaining -= amount
    layer.base_remaining    -= base
    if layer.foreign_remaining == 0: layer.status = exhausted
    return base
```

Core invariants 15 and 17 applied per layer: full consumption releases the layer's remaining base **exactly**, never as a recomputed product; partial consumption computes in one expression without materialising a rate. Exhausted layers are retained for audit and excluded from selection.

### 4.4 Selection rules

1. **Every outgoing movement requires explicit layer selection.** The system never auto-selects, including for bank charges, interest and other system-originated entries.
2. **Selection is constrained to open layers of the paying account.** No rate may be typed, and no layer outside the account may be chosen.
3. **`Σ selected amounts` must equal `account_amount` exactly.** A short or over selection is rejected, not adjusted.
4. **No selected amount may exceed its layer's `foreign_remaining`.**
5. A single settlement line may consume **any number of layers**.

**Interface guidance (non-normative).** Explicit selection plus never-merge means layer counts grow with every receipt. Offer a "fill from oldest" helper that pre-populates a FIFO selection which the user must still confirm or amend — this satisfies rule 1 without making a small bank fee a treasury decision.

### 4.5 FX difference

Unchanged in form (core §5.4), and still **one difference per settlement line**, not per layer:

```
fx_difference = settlement_base − transaction_base
     > 0 → credit → gain      < 0 → debit → loss      = 0 → no line
```

`settlement_base` comes from the obligation's carrying rate and is entirely unaffected by layer selection. `transaction_base` is the sum across consumed layers. The difference remains the balancing figure of the entry.

### 4.6 Creation case

Where a settlement *creates* base value rather than relieving it — a cash advance (core §5.3) — the rule is unchanged: `settlement_base := transaction_base`, no FX difference. The advance's resulting carrying rate is therefore determined by which layers the user selected. This is correct and expected.

---

## 5. Reversal

**Reversing a payment restores the exact layers consumed** — the same layers, the same amounts, the same base. It never re-acquires currency at a current rate, and never creates a new layer. An exhausted layer returns to `open`.

**Reversing a receipt closes the layer it created.** If that layer has been partially or fully consumed, the reversal is rejected until the consuming transactions are themselves reversed. A receipt's layer may not be removed while its currency has been spent.

---

## 6. Transfers Between Accounts

Base value is conserved (core invariant 18), and **layers propagate one-for-one**.

```
out-leg:  user selects layers on the source account (§4.4)
in-leg:   each consumed layer creates its own new layer on the destination account
              foreign = amount consumed, converted to destination currency
              base    = base released from that source layer      # conserved
              rate    = base ÷ foreign
              acquisition_date = transfer date
              origin_date      = source layer's origin_date
              lineage          = source layer_id
```

For a same-currency transfer each destination layer carries its source layer's rate exactly. For a cross-currency transfer each destination layer's rate is derived per layer, and the total base is still conserved.

Consuming three layers therefore creates three layers on the receiving account — never one blended layer. Blending on transfer would let a user launder an unwanted rate into a fresh average, defeating the entire design.

`origin_date` is carried for traceability and may be offered as an alternative sort; `acquisition_date` remains the transfer date and governs FIFO ordering on the receiving account.

---

## 7. Period-End Revaluation

### 7.1 Mechanism — collapse

At each period close, for every **foreign-currency** account:

```
revalued_base = foreign_balance × closing_rate
unrealised_fx = revalued_base − base_balance

close all open layers          ( status = closed_by_revaluation, remaining → 0 )

create exactly one new layer:
    acquisition_date = period end date
    rate             = closing_rate
    foreign_original = foreign_balance
    base_original    = revalued_base
    source_event     = the period close

post unrealised_fx to the unrealised FX difference account
```

Base-currency accounts are not revalued. Closed layers are retained for audit and excluded from selection.

### 7.2 Scope of the never-merge rule

The rule in §3.2 governs **acquisition**: a receipt never joins an existing layer. **Period-end revaluation is the single sanctioned consolidation of layers in the system.** No other process may merge, group, or combine layers — not transfers, not settlements, not reversals, not reporting.

### 7.3 Accepted consequence

After each close, every pre-existing layer is replaced by one layer at the closing rate. **Rate selection therefore has effect only across receipts acquired within the current period, plus the single carried-forward layer.** A payment late in a period chooses among that period's receipts and one uniform block representing everything older.

This is a deliberate decision for SIBA. It is recorded here so it is not rediscovered as a defect.

### 7.4 Re-running a close

A period close is reversible only by reversing the close itself, which restores the layers it collapsed and removes the layer it created. Individual layers closed by revaluation may never be reopened in isolation.

---

## 8. Opening Balances

Treasury enters layers manually per foreign-currency account at go-live. Each seeded layer requires an acquisition date (for ordering), a rate, and a foreign amount.

Hard validation before the account may transact:

```
Σ layer.foreign_original = account.foreign_balance     # exact
Σ layer.base_original    = account.base_balance        # exact
```

A seeding that does not reconcile on both measures is rejected. Seeded layers carry `source_event = opening` and are otherwise ordinary layers.

---

## 9. Governance and Audit

Because layer selection determines the recognised FX gain or loss, the selection is an accounting decision and must be treated as one.

Every outgoing movement records, immutably:

- each `layer_id` consumed, the foreign amount taken, and the base released;
- the resulting `transaction_base`, `settlement_base` and FX difference;
- the user who made the selection and the timestamp.

The selection must be **visible on the approval view** of the payment, not buried in a sub-screen — an approver cannot assess a payment whose FX outcome they cannot see.

### Policy parameters (SIBA)

| Parameter | Default |
|---|---|
| Restrict selectable layers (e.g. by maximum age) | None — all open layers selectable |
| Require justification when the oldest layer is not selected | Off |
| "Fill from oldest" helper enabled | On |

All core-concept policy parameters (core §10) carry over unchanged.

---

## 10. SIBA Invariants

1. A foreign-currency account's balance **is** the sum of its open layers, on both measures.
2. **Layer identity is per acquisition event.** Receipts never join an existing layer, even at an identical rate, from the same source, on the same day.
3. A layer's rate is **immutable** for its lifetime. Only revaluation changes an account's rates, and only by closing layers.
4. Layer ordering is **chronological**, never by rate value.
5. **Every outgoing movement requires explicit layer selection.** The system never auto-selects.
6. Selection is constrained to **open layers of the paying account**. No rate may be entered.
7. `Σ selected amounts = account_amount` exactly; no selected amount exceeds its layer's remaining.
8. **Full consumption of a layer releases its remaining base exactly.**
9. Transfers **conserve base value** and propagate layers one-for-one.
10. **Revaluation is the only sanctioned consolidation of layers.**
11. Reversal **restores the exact layers consumed**; it never re-acquires at a current rate.
12. Base-currency accounts are **unlayered**.
13. **Layer selection never affects the settlement-base side of any transaction.** — the containment guarantee for §2.1.

---

## Appendix — Worked Illustration

A USD account, base currency IDR:

| Layer | Acquired | Rate | Foreign | Base |
|---|---|---|---|---|
| L1 | 15 Jan | `15,000` | `$200` | `3,000,000` |
| L2 | 22 Jan | `15,500` | `$300` | `4,650,000` |
| L3 | 28 Jan | `15,000` | `$200` | `3,000,000` |
| | | *(15,214.29 eff.)* | `$700` | `10,650,000` |

L1 and L3 hold the same rate and remain separate layers (§3.2). The `15,214.29` is reporting-only and values nothing.

### Payment of a `$400` obligation carried at `15,020`

`settlement_base = 400 × 15,020 = 6,008,000` — fixed by the obligation, identical under every selection below. Same currency, so `movement_rate = 1` and `account_amount = $400`.

**Selection A — L2 in full (`$300`) plus L3 partial (`$100`):**

```
transaction_base = 4,650,000 + 1,500,000 = 6,150,000

Dr  Payable            6,008,000
Dr  FX Difference        142,000     balancing → loss
    Cr  Bank USD                    6,150,000
```

**Selection B — L1 in full (`$200`) plus L3 in full (`$200`):**

```
transaction_base = 3,000,000 + 3,000,000 = 6,000,000

Dr  Payable            6,008,000
    Cr  Bank USD                    6,000,000
    Cr  FX Difference                   8,000     balancing → gain
```

The same payment against the same obligation yields a `142,000` loss or an `8,000` gain depending on selection. Both are correct; the difference is the user's decision, which is why §9 requires it to be recorded and visible to the approver.

### After Selection A

L2 is exhausted. Open layers: L1 `$200 / 3,000,000`, L3 `$100 / 1,500,000` — balance `$300 / 4,500,000`.

### Month-end close at a closing rate of `16,200`

```
revalued_base  = 300 × 16,200 = 4,860,000
unrealised_fx  = 4,860,000 − 4,500,000 = 360,000        gain

close L1, L3
create L4:  31 Jan, rate 16,200, $300 / 4,860,000
```

February payments may select only L4 and any February receipts — §7.3 in effect.
