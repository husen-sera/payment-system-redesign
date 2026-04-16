# Payment System Redesign - Slide Deck Content

> Use this as copy-paste content for PowerPoint / Google Slides / Gamma.app
> Each section = 1 slide. Key points are bullet-ready.
>
> **Visual diagrams:** Open [`payment-flow-diagram.html`](payment-flow-diagram.html) in a browser for interactive flow diagrams, state machine, sequence diagrams, and component architecture map.

---

## Slide 1: Title

**Payment System Redesign**

Solving duplicate orders, lost payments & unsafe cancellation

- Duplicate order prevention
- Konbini payment recovery
- Payment cancel & switch
- Auto-refresh payment status

Date: 2026-04-15
Status: Draft / Discussion
Team: Backend (Laravel) + Frontend (React)

---

## Slide 2: Current Problems

**6 issues in today's payment system**

1. **Duplicate orders** -- user can create multiple pending orders for the same item
2. **Lost konbini info** -- if user closes page, payment code is gone forever
3. **No resume flow** -- user cannot continue an unfinished payment
4. **Unsafe cancel** -- cancel only updates DB, does NOT call Stripe/PayPay API
5. **Manual refresh** -- UI does not auto-update after payment
6. **Race condition** -- payment can succeed after cancel, causing data inconsistency

---

## Slide 3: Before vs After -- Overview

| Area               | Before (Current)                 | After (Proposed)                             |
| ------------------ | -------------------------------- | -------------------------------------------- |
| Order creation     | Order + payment created together | Order first, payment separate                |
| Duplicate check    | None                             | Pending order check before every purchase    |
| Konbini page close | Payment code lost forever        | Voucher URL stored in DB, accessible anytime |
| Resume payment     | Not possible                     | Dialog shows resume option                   |
| Cancel payment     | DB update only                   | API call to Stripe/PayPay                    |
| Switch method      | Not possible                     | Cancel old + create new (same order)         |
| Payment status     | Manual refresh needed            | Auto-polling (5-30 sec)                      |
| PayPay modal       | Creates order on modal open      | Creates order only on button click           |

---

## Slide 4: Before vs After -- Order Flow

**BEFORE:**

```
User clicks "Buy"
  → Create order + payment session together
  → Redirect to provider
  → No check for existing orders
  → Opening payment modal = orphan PayPay order
```

**AFTER:**

```
User clicks "Buy"
  → Check: pending order for same item?
  → YES: show resume/cancel dialog
  → NO:  create order (PREPARED)
  → User picks method → create payment session (PENDING)
  → Payment only created when user clicks button
```

---

## Slide 5: Before vs After -- Cancel Flow

**BEFORE:**

```
User cancels → DB status updated to FAILED
             → Stripe/PayPay NOT notified
             → Provider may still collect money
             → No cleanup of coupon/lock
```

**AFTER:**

```
User cancels → Call provider cancel API first
            → If API succeeds → update DB status
            → If API fails → DON'T update DB (payment in progress)
            → Cleanup: coupon unlinked, Redis lock cleared
            → Webhook remains final authority
```

---

## Slide 6: Before vs After -- Konbini

**BEFORE:**

```
User picks konbini → sees payment code on Stripe page
                   → closes browser
                   → payment code LOST
                   → can't pay at store
                   → order stuck PENDING for 3 days
                   → expires → user must start over
```

**AFTER:**

```
User picks konbini → sees payment code on Stripe page
                   → webhook stores voucher URL in DB
                   → user closes browser
                   → comes back next day
                   → system shows: "Pending payment (expires Apr 18)"
                   → clicks "View Payment Instructions"
                   → sees payment code again
                   → pays at store → SUCCESS
```

---

## Slide 7: Core Design Principles

**6 rules that guide the redesign**

1. **Order = single source of truth** -- payment sessions are disposable, order persists
2. **One pending order per user per item** -- check before creating new
3. **Webhook = only trusted status source** -- frontend never writes status
4. **Payments are replaceable** -- cancel old session, create new one, same order ID
5. **Always cancel via provider API** -- never just update DB
6. **Store async payment details** -- so user can resume (konbini voucher URL, expiry)

---

## Slide 8: Visual Workflow Diagram

> **Insert screenshot from `payment-flow-diagram.html` → Diagram 1 (Main User Flow)**

**New payment flow at a glance**

```
Buy → Pending check → [No] → Create order → Pick method → Pay → Webhook → Success
                    → [Yes] → Resume / Cancel & Switch dialog
```

**Interactive diagrams available:**

1. Main User Flow (flowchart)
2. Order State Machine (state diagram)
3. Konbini Recovery Flow (sequence diagram)
4. Cancel & Switch Method (sequence diagram)
5. Pages & Components Architecture (component map)

---

## Slide 9: Unified Payment Flow

**Both Stripe and PayPay share ONE flow**

```
Step 1: POST /api/orders          → Create order (PREPARED)
Step 2: POST /api/orders/{id}/pay → Create payment session (PENDING)
Step 3: User pays                 → Stripe / PayPay / Konbini
Step 4: Webhook confirms          → SUCCESS or FAILED
Step 5: Frontend polls & updates  → Auto-redirect to success
```

**Key insight:** Order created ONCE, payment can be attempted multiple times

---

## Slide 9: Pending Order Check Flow

**What happens when user clicks "Buy"**

```
User clicks "Buy"
    |
    v
Check pending order (same user + same item)
    |
    +-- No pending → open payment method selector
    |
    +-- Has pending → show dialog:
        |
        +-- "Resume Payment" (open voucher / PayPay)
        +-- "View Status" (go to /payment/:orderId)
        +-- "Cancel & New Method" (cancel API → new payment)
```

**Prevents duplicate orders automatically**

---

## Slide 10: Cancel & Switch Payment Method

**User started PayPay, wants Stripe instead**

1. User clicks "Cancel & Choose New Method"
2. Backend calls PayPay `cancelPayment()` API
3. Order status → PREPARED (not FAILED -- order still valid)
4. User picks Stripe → new Stripe session created
5. Same order ID, different payment session

**Both providers support cancellation:**

- PayPay: `cancelPayment()` (already implemented in codebase)
- Stripe: `sessions->expire()` + `paymentIntents->cancel()`

---

## Slide 11: Race Condition Handling

**Most dangerous edge case: payment succeeds after cancel**

```
T=0  User gets konbini voucher
T=1  User goes to convenience store
T=2  Meanwhile, user cancels from phone
T=3  User pays at store (cancel was too late)
T=4  Webhook: payment succeeded
```

**Solution:**

- Cancel API call may fail → if it fails, DON'T update order status
- Webhook always takes priority over local status
- If CANCELLED order gets success webhook → still mark SUCCESS
- Log CRITICAL alert for manual review
- **Rule: If money was collected, always honor it**

---

## Slide 12: State Machine

**Order status transitions**

```
PREPARED → PENDING → SUCCESS (terminal)
              ↓
           FAILED (terminal)

PENDING → PREPARED (switch method -- same order)
PENDING → CANCELLED (user abandons)
CANCELLED → SUCCESS (race condition -- honor payment)
```

**Key rules:**

- FAILED = terminal (create new order to retry)
- CANCELLED → SUCCESS = rare but must be handled
- PENDING → PREPARED = "switch method" transition

---

## Slide 13: New API Endpoints

**5 new endpoints**

| Method | Path                              | Purpose                |
| ------ | --------------------------------- | ---------------------- |
| GET    | `/api/orders/pending`             | Check pending order    |
| POST   | `/api/orders`                     | Create order           |
| GET    | `/api/orders/{id}/status`         | Poll status            |
| POST   | `/api/orders/{id}/pay`            | Create payment session |
| POST   | `/api/orders/{id}/cancel-payment` | Cancel payment         |

**Old endpoints kept for backward compatibility, deprecated gradually**

---

## Slide 14: Frontend -- Two New Components

**1. PendingOrderDialog (Modal)**

- Appears before checkout when pending order found
- Shows: resume, view voucher, or cancel & switch
- Quick interceptor -- no page navigation needed

**2. /payment/:orderId (Page)**

- Dedicated payment status hub
- Auto-polls for payment confirmation
- Shows konbini voucher link + expiry
- Can be bookmarked and revisited
- Auto-redirects to success page when paid

---

## Slide 15: Pages & Components to Build

> **Insert screenshot from `payment-flow-diagram.html` → Diagram 5 (Pages & Components Architecture)**

**New pages (2)**

| Page | Route | Purpose |
|------|-------|---------|
| PaymentPage | `/payment/:orderId` | Payment status hub with auto-polling, voucher info, cancel/switch |
| PendingOrderDialog | (modal) | Intercept before checkout — resume, view voucher, or cancel & switch |

**Sub-components of PaymentPage (4)**

| Component | Shows when |
|-----------|-----------|
| PaymentMethodSelector | Order is PREPARED (no payment yet) |
| KonbiniPendingView | Pending konbini — voucher link + expiry countdown |
| WaitingForPayment | Pending card/PayPay — spinner + 5s polling |
| ErrorView | Failed or cancelled — retry option |

---

## Slide 16: Pages to Modify (Existing)

**CheckoutSelectorModal.tsx**

- **Bug fix:** Remove `fetchPayPayUrl` from `useEffect` (line ~207)
- PayPay order only created when user clicks the PayPay button
- Prevents orphan orders on modal open

**Product / Category page (Buy button)**

- Add `GET /api/orders/pending?key_name=xxx` before opening modal
- If pending order found → show PendingOrderDialog instead
- If no pending → open CheckoutSelectorModal as normal

---

## Slide 17: Page Navigation Map

```
Product Page (Buy button)
    │
    ├── No pending → CheckoutSelectorModal (modified)
    │   └── Pick method → Create order → Pay
    │       └── /payment/:orderId (polling)
    │
    └── Has pending → PendingOrderDialog (new)
        ├── Resume → /payment/:orderId
        ├── View Voucher → hosted_voucher_url
        └── Cancel & Switch → CheckoutSelectorModal

/payment/:orderId
    ├── PREPARED → PaymentMethodSelector
    ├── PENDING (konbini) → KonbiniPendingView
    ├── PENDING (card/paypay) → WaitingForPayment
    ├── SUCCESS → /paid (gacha page)
    └── FAILED/CANCELLED → ErrorView
```

---

## Slide 18: New Backend Files

| File | Purpose |
|------|---------|
| `app/Services/OrderService.php` | Unified order logic (find pending, create, pay, cancel, webhook handling) |
| `app/Http/Controllers/OrderController.php` | REST controller for 5 new endpoints |
| `migration: add_payment_metadata` | JSON column for konbini voucher URL, expiry, provider metadata |
| `migration: add_cancelled_status` | New CANCELLED status in purchase_histories enum |

**Reuses existing logic from:**
- `PurchaseService.php` → session creation
- `PurchaseController.php` → Stripe flow
- `PayPayController.php` → PayPay flow
- `PurchaseHistoryObserver.php` → Permission creation (unchanged)

---

## Slide 19: Auto-Refresh Strategy

**Simple polling (not WebSocket)**

| Context       | Poll Interval | Max Duration     |
| ------------- | ------------- | ---------------- |
| Card / PayPay | 5 seconds     | 10 minutes       |
| Konbini       | 30 seconds    | Until page close |
| Payment page  | 10 seconds    | Until page close |

**On status change:**

- SUCCESS → redirect to gacha/success page
- FAILED → show error + retry
- CANCELLED → redirect to home

---

## Slide 20: Bug Fix -- Orphan PayPay Orders

**Current bug in CheckoutSelectorModal**

```
BEFORE:
  Modal opens → useEffect → PayPay order created immediately
  User closes modal → orphan order in DB
  Every "just looking" = wasted order

AFTER:
  Modal opens → NO order created
  User clicks PayPay button → THEN order created
  No orphan orders
```

---

## Slide 21: Benefits of Proposed Solution

**For Users:**

- Never lose konbini payment code again
- Can switch payment method without starting over
- Payment status updates automatically (no manual refresh)
- Clear feedback: "you have a pending order" instead of confusion

**For Business:**

- No duplicate orders cluttering the database
- No "lost" payments (money collected but order not fulfilled)
- Cancel is safe (provider always notified)
- Race conditions handled properly

**For Developers:**

- One unified flow for all payment providers
- Clear state machine (predictable transitions)
- Idempotent webhooks (safe to replay)
- Existing code reused, not rewritten

---

## Slide 22: Pros & Cons

**Pros:**

- Eliminates all 6 current problems
- Backward compatible (old endpoints still work during migration)
- No infrastructure change (no new services, no WebSocket server)
- Konbini recovery uses Stripe's hosted page (no custom UI needed)
- PayPay cancel already implemented (just needs wiring)
- Polling is simple and reliable for small-mid team
- Observer pattern (Permission creation) unchanged

**Cons:**

- 5 new API endpoints to build and maintain
- New `/payment/:orderId` page needs frontend development
- Polling uses network requests (small overhead, acceptable for this scale)
- Migration period: old + new endpoints coexist temporarily
- Race condition (CANCELLED → SUCCESS) requires manual review process
- Team needs to understand new state machine (PREPARED → PENDING → SUCCESS)

---

## Slide 23: Risks & Mitigation

| Risk                               | Impact                              | Mitigation                                          |
| ---------------------------------- | ----------------------------------- | --------------------------------------------------- |
| Race condition (cancel vs payment) | Money collected but order cancelled | Cancel API first, webhook takes priority, log alert |
| Duplicate payments                 | User charged twice                  | Cancel existing session before creating new         |
| Konbini expires (3 days)           | User can't pay                      | Webhook marks FAILED, show expiry countdown         |
| Webhook doesn't arrive             | Order stuck PENDING                 | Stripe retries 3 days + scheduled job safety net    |
| Coupon double-use                  | Discount applied twice              | Unlink coupon on cancel (existing logic)            |
| Migration break                    | Current payment stops working       | Keep old endpoints, feature flag new ones           |

---

## Slide 24: What Changes vs What Stays

**Changes (8 items):**

1. New `payment_metadata` column (JSON)
2. New `CANCELLED` status in enum
3. 5 new API endpoints
4. New `OrderService` class
5. PendingOrderDialog component
6. `/payment/:orderId` page
7. Konbini webhook stores voucher URL
8. CheckoutSelectorModal bug fix

**Stays the same:**

- PurchaseHistoryObserver (auto Permission creation)
- Stripe/PayPay webhook endpoints & signature verification
- Coupon/gacha/lock logic (all TICKET*SERA*\* features)
- Success page (`/paid`) and gacha animation
- Admin pages (paypay-history, etc.)
- All existing routes (backward compatible)

---

## Slide 25: Implementation Timeline

**Phase 1: Foundation -- Week 1-2 (backend only, no UI change)**

- Add `payment_metadata` column migration
- Add `CANCELLED` status to enum
- Create `OrderService` (extract from existing controllers)
- Add 5 new API endpoints (behind feature flag)
- Unit tests for OrderService

**Phase 2: Konbini Recovery -- Week 3**

- Update `handleKonbiniVoucherIssued()` to store voucher URL
- Add pending order check endpoint
- Test: create konbini order → close page → reopen → see voucher
- Test: konbini expiry → webhook marks FAILED

**Phase 3: Frontend Integration -- Week 4-5**

- Build PendingOrderDialog component
- Build `/payment/:orderId` page
- Fix CheckoutSelectorModal (remove PayPay useEffect)
- Wire cancel & switch flow
- Integration test: full flow with Stripe test mode

**Phase 4: Polish & Launch -- Week 6**

- Add auto-polling on payment page
- QA: test all 4 timeline scenarios
- QA: test race condition scenario
- Enable feature flag on staging
- Monitor for 1 week → enable on production

**Phase 5: Cleanup -- Week 7+ (after production stable)**

- Deprecate old endpoints
- Remove feature flag
- Add scheduled job for stale order cleanup (optional)

---

## Slide 26: Gantt Chart (Text)

```
Week:    1     2     3     4     5     6     7+
         |     |     |     |     |     |     |
Phase 1  ████████████                              Foundation
         DB migration                              (Backend)
         OrderService
         New endpoints

Phase 2              ██████                        Konbini
                     Webhook update                Recovery
                     Pending check

Phase 3                    ████████████            Frontend
                           PendingOrderDialog
                           Payment page
                           Modal fix
                           Cancel flow

Phase 4                                ██████      Polish
                                       Polling     & Launch
                                       QA
                                       Staging

Phase 5                                      ████  Cleanup
                                             Deprecate
                                             old endpoints
```

---

## Slide 27: Timeline Scenario -- Konbini Resume

**User forgets payment code, comes back next day**

```
Day 1: Buy → Stripe Checkout → pick Konbini → get voucher
        Webhook stores voucher URL in DB
        User closes browser (forgets code!)

Day 2: User opens app → clicks "Buy" same item
        System finds pending order
        Dialog: "Pending konbini payment (expires Apr 18)"
        User clicks "View Payment Instructions"
        Opens Stripe voucher page → sees code again
        Goes to store → pays
        Webhook: SUCCESS → Permission granted
```

---

## Slide 28: Timeline Scenario -- Cancel & Switch

**User changes mind about payment method**

```
T=0   User clicks "Buy gl-3"
T=1   Creates order #502 (PREPARED)
T=2   Picks PayPay → QR code created (PENDING)
T=3   User decides they want card instead
T=4   Clicks "Cancel & Choose New Method"
T=5   Backend calls PayPay cancel API
T=6   Order → PREPARED (same order, no payment)
T=7   User picks Stripe → new session created
T=8   Pays with card
T=9   Webhook: SUCCESS → Permission granted

Result: 1 order, 2 payment attempts, 0 duplicates
```

---

## Slide 29: Summary

**3 problems solved:**

1. **Duplicate orders** → pending order check blocks same-item duplicates
2. **Lost konbini info** → voucher URL stored in DB, accessible anytime
3. **Unsafe cancel** → always cancel via provider API, webhook is final authority

**Design philosophy:**

- Order is permanent, payments are disposable
- Webhook is the only truth
- If money was collected, always honor it

**Timeline:** ~6 weeks to full production (phased rollout)
**Risk:** Low -- backward compatible, feature-flagged, no infrastructure change
