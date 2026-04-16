# Payment System Redesign - Technical Design Document

> **Date:** 2026-04-15
> **Status:** Draft / Discussion
> **Scope:** Duplicate order prevention, konbini recovery, payment cancel & switch
> **Designer handoff:** [`payment-system-designer-brief.md`](payment-system-designer-brief.md) — screens, states, copy, and deliverables checklist
> **Slide deck:** [`payment-system-redesign-ppt.md`](payment-system-redesign-ppt.md)
> **Visual diagrams:** [`payment-flow-diagram.html`](payment-flow-diagram.html)

---

## 1. Core Design Principles

**Principle 1: Order is the single source of truth**
The `purchase_histories` record is the master record. Payment sessions (Stripe/PayPay) are disposable -- they can be created, expired, and recreated. The order persists.

**Principle 2: One pending order per user per item**
Before creating a new order, check if the user already has an active order for the same `key_name`. If yes, reuse it (resume or cancel+recreate).

**Principle 3: Webhook is the only trusted status source**
Never trust frontend callbacks or redirect URLs to confirm payment. Only the webhook handler marks orders as SUCCESS. The frontend only reads status -- it never writes it.

**Principle 4: Payments are replaceable**
If a user wants to change from PayPay to Stripe, cancel the old payment session via provider API, then create a new session for the same order. The order ID stays the same.

**Principle 5: Always cancel via provider API**
Never just update the database status to FAILED without calling Stripe/PayPay cancel API. The provider must know the payment is canceled to avoid accepting money for a "canceled" order.

**Principle 6: Store async payment details**
For konbini (and any future async method), store enough information so the user can resume payment without creating a new session.

---

## 2. Improved Data Flow

> **Visual diagrams:** Open [`payment-flow-diagram.html`](payment-flow-diagram.html) in a browser for interactive Mermaid diagrams covering the main flow, state machine, konbini recovery, cancel & switch, and page architecture.

### Text Diagram

```
USER CLICKS "BUY"
       |
       v
 ┌─────────────────────────┐
 │  CHECK PENDING ORDER    │  GET /api/orders/pending?key_name=xxx
 │  (same user + same item)│
 └─────┬───────────┬───────┘
       |           |
    NO PENDING   HAS PENDING
       |           |
       v           v
  CREATE NEW    ┌──────────────────────────┐
  ORDER         │  SHOW PENDING ORDER      │
  (status=      │  DIALOG                  │
   PREPARED)    │                          │
       |        │  [Resume Payment]        │
       |        │  [Cancel & New Method]   │
       v        └──────┬──────────┬────────┘
 ┌──────────────┐      |          |
 │ PAYMENT      │   RESUME     CANCEL OLD
 │ METHOD       │      |       (API call)
 │ SELECTOR     │      |          |
 │              │      |       Mark CANCELLED
 │ [PayPay]     │      |          |
 │ [Stripe]     │      |       Back to
 └──┬───────┬───┘      |       METHOD SELECTOR
    |       |           |
 PAYPAY  STRIPE         |
    |       |           |
    v       v           v
 ┌──────────────────────────┐
 │  PAYMENT PAGE            │  /payment/:orderId
 │  (provider-specific)     │
 │                          │
 │  Shows: QR / Card form   │
 │  / Konbini instructions  │
 └──────────┬───────────────┘
            |
     USER PAYS (or closes page)
            |
            v
 ┌──────────────────────────┐
 │  WEBHOOK FROM PROVIDER   │  POST /stripe/webhook
 │                          │  POST /paypay/webhook
 │  Updates order status    │
 │  Creates Permission      │
 │  Cleans up coupon/lock   │
 └──────────────────────────┘
            |
            v
 ┌──────────────────────────┐
 │  FRONTEND DETECTS        │  Polling every 5s on /payment/:orderId
 │  STATUS CHANGE           │  OR push notification (optional)
 │                          │
 │  Redirects to success    │
 └──────────────────────────┘
```

---

## 3. Payment Flow (Unified)

Both Stripe and PayPay now fit into ONE consistent flow. The key insight: **separate "order creation" from "payment session creation"**.

### Current Problem
The `CheckoutSelectorModal` creates a PayPay order immediately when the modal opens (`useEffect` -> `fetchPayPayUrl`), before the user clicks anything. This creates orphan orders.

### New Unified Flow

```
Step 1: CREATE ORDER (provider-agnostic)
   POST /api/orders
   Body: { key_name, group_key_name, discount?, gacha_result_id? }
   Returns: { order_id, has_pending_order, pending_order? }
   
   - Checks for existing pending order first
   - If no pending: creates new PurchaseHistory (status=PREPARED)
   - If pending: returns the pending order info

Step 2: CREATE PAYMENT SESSION (provider-specific)
   POST /api/orders/{orderId}/pay
   Body: { payment_method: "stripe" | "paypay" }
   Returns: { redirect_url, payment_data }
   
   - If order already has a different active payment: cancel it first
   - Creates Stripe session OR PayPay QR
   - Updates order: payment_channel, invoice_id, status=PENDING

Step 3: USER PAYS
   - Stripe: redirect to hosted checkout (card or konbini selection happens there)
   - PayPay: redirect to PayPay app/page
   - Konbini: user sees voucher, pays at store within 3 days

Step 4: WEBHOOK CONFIRMS
   - Provider calls webhook endpoint
   - Handler updates order to SUCCESS or FAILED
   - Observer creates Permission automatically
   - Cleanup: Redis lock, coupon linking

Step 5: FRONTEND UPDATES
   - Payment page polls order status
   - On SUCCESS: redirect to success/gacha page
   - On FAILED: show error, allow retry
```

### Why This Is Better
- Order is created ONCE, payment can be attempted multiple times
- No orphan PayPay orders from modal opening
- Cancel is explicit (API call to provider)
- Same flow for both providers

---

## 4. Edge Cases Handling

### Case 1: User closes page (Konbini)

**What happens now:** User loses the payment code. They can't pay. Order stays PENDING forever until Stripe expires it (3 days).

**New behavior:**
1. When `checkout.session.completed` fires with `payment_status=unpaid` (konbini voucher issued):
   - Retrieve PaymentIntent from session
   - Store `hosted_voucher_url` and `expires_at` in order's `payment_metadata` column
2. When user returns to app:
   - Pending order check finds the konbini order
   - Shows: "You have a pending konbini payment expiring on [date]"
   - Button: "View Payment Instructions" -> opens the `hosted_voucher_url`
   - The Stripe-hosted voucher page shows payment code, confirmation number, store list

### Case 2: User changes payment method

**Example:** User started with PayPay, now wants Stripe card.

**Flow:**
1. User clicks "Buy" -> pending order check finds PayPay order
2. Dialog shows: "You have a pending PayPay payment"
3. User clicks "Cancel & Choose New Method"
4. Backend: `POST /api/orders/{orderId}/cancel-payment`
   - Calls PayPay `cancelPayment()` API (already exists)
   - Clears `invoice_id`, resets `payment_channel`
   - Status back to PREPARED (not FAILED -- order is still valid)
5. Frontend shows payment method selector
6. User picks Stripe -> `POST /api/orders/{orderId}/pay` with `payment_method=stripe`
7. New Stripe session created for the SAME order

### Case 3: User explicitly cancels payment

**Flow:**
1. User is on payment page, clicks "Cancel"
2. Frontend: `POST /api/orders/{orderId}/cancel-payment`
3. Backend calls provider cancel API
4. Order status -> CANCELLED
5. Coupon unlinked, Redis lock cleared
6. User redirected to home

### Case 4: Webhook arrives after cancel (Race Condition)

**This is the most dangerous edge case.**

**Scenario:**
```
T=0:  User creates konbini order, gets voucher
T=1:  User decides to cancel, clicks "Cancel & New Method"
T=2:  Backend calls Stripe paymentIntents->cancel()
T=3:  BUT user already paid at convenience store at T=1.5
T=4:  Stripe webhook: async_payment_succeeded arrives
```

**Solution: Webhook handler checks BEFORE updating**
```
In webhook handler (async_payment_succeeded):
1. Find order by invoice_id
2. If order.status == CANCELLED:
   - This means we cancelled but payment went through
   - Log as CRITICAL alert
   - Still mark as SUCCESS (money was collected)
   - Still create Permission (user paid)
   - Flag for manual review / refund decision
3. If order.status == PENDING:
   - Normal flow: mark SUCCESS
```

**Key rule: If money was collected, always honor it.** Never silently eat a payment. The webhook handler should be the final authority.

### Case 5: Duplicate order attempt

**Flow:**
1. User clicks "Buy" for item gl-3
2. `GET /api/orders/pending?key_name=gl-3` returns existing pending order
3. Frontend shows dialog (not a new order)
4. User must resolve the pending order before creating a new one

**Cross-item:** User has pending order for gl-3, wants to buy sm-5.
- **Decision: Allow it.** Different items = different orders. Only block same item.
- (If business wants only 1 pending order total, change the query to not filter by `key_name`)

---

## 5. Timeline Scenarios

### Scenario 1: Normal Card Payment (Happy Path)

```
T=0    User clicks "Buy gl-3"
T=1    GET /api/orders/pending?key_name=gl-3 → no pending
T=2    POST /api/orders → order #500 created (PREPARED)
T=3    User picks "Stripe" → POST /api/orders/500/pay {method: stripe}
T=4    Stripe session created, order → PENDING
T=5    User redirected to Stripe Checkout, pays with card
T=6    Stripe webhook: checkout.session.completed (payment_status=paid)
T=7    Webhook handler: order #500 → SUCCESS, Permission created
T=8    Frontend polls status, sees SUCCESS
T=9    Redirect to success/gacha page
```

### Scenario 2: Konbini Payment + Resume

```
T=0    User clicks "Buy gl-3"
T=1    POST /api/orders → order #501 (PREPARED)
T=2    POST /api/orders/501/pay {method: stripe}
T=3    User redirected to Stripe Checkout, picks Konbini
T=4    Stripe shows voucher (payment code: 12345, confirmation: 67890)
T=5    Webhook: checkout.session.completed (payment_status=unpaid)
T=6    Handler: stores hosted_voucher_url in payment_metadata
T=7    User redirected to /paid → sees "Pay at convenience store" message
T=8    --- USER CLOSES BROWSER, FORGETS PAYMENT CODE ---
T=9    Next day: user opens app, clicks "Buy gl-3"
T=10   GET /api/orders/pending?key_name=gl-3 → finds order #501
T=11   Dialog: "Pending konbini payment (expires Apr 18)"
T=12   User clicks "View Payment Instructions"
T=13   Opens hosted_voucher_url → sees payment code again
T=14   User goes to convenience store, pays
T=15   Webhook: checkout.session.async_payment_succeeded
T=16   Handler: order #501 → SUCCESS, Permission created
```

### Scenario 3: Cancel PayPay & Switch to Stripe

```
T=0    User clicks "Buy gl-3"
T=1    POST /api/orders → order #502 (PREPARED)
T=2    POST /api/orders/502/pay {method: paypay}
T=3    PayPay QR created, order → PENDING (payment_channel=paypay)
T=4    User sees QR but decides they want card instead
T=5    User clicks "Cancel & Choose New Method"
T=6    POST /api/orders/502/cancel-payment
T=7    Backend: PayPay cancelPayment() API called
T=8    Order: invoice_id cleared, status → PREPARED, payment_channel → null
T=9    Frontend shows payment method selector
T=10   User picks "Stripe" → POST /api/orders/502/pay {method: stripe}
T=11   New Stripe session, order → PENDING (payment_channel=stripe)
T=12   User pays with card via Stripe Checkout
T=13   Webhook confirms → SUCCESS
```

### Scenario 4: Race Condition - Pay After Cancel

```
T=0    User creates konbini order #503
T=1    Konbini voucher issued (payment code: 99999)
T=2    User goes to convenience store
T=3    --- Meanwhile, user opens app on phone ---
T=4    User clicks "Cancel & New Method" from phone
T=5    POST /api/orders/503/cancel-payment
T=6    Backend: stripe->paymentIntents->cancel()
       ⚠️ But Stripe may return error: "payment intent cannot be 
          canceled because it is in state requires_action or succeeded"
T=7    Two sub-scenarios:

       7a: Cancel succeeds (user hadn't paid yet at store)
           → Order status → PREPARED, safe to create new payment
           → Voucher becomes invalid, store will reject payment

       7b: Cancel fails (user already paid, or payment in processing)
           → Backend receives error from Stripe API
           → DO NOT mark as cancelled
           → Return error to frontend: "Payment is being processed"
           → Wait for webhook to confirm final status
           → Log for manual review

T=8    If 7b: Webhook arrives (async_payment_succeeded)
       → Order #503 → SUCCESS (honor the payment)
       → Permission created
       → Frontend updates via polling
```

**Critical implementation detail:** Always try/catch the cancel API call. If it fails, do NOT update the order status. Return an appropriate error to the frontend.

---

## 6. Backend Responsibilities (Laravel)

### 6.1 Order Creation Logic

**New endpoint: `POST /api/orders`**

Responsibilities:
- Validate input (key_name, group_key_name, discount, gacha_result_id)
- Check ownership (already purchased?)
- Check for existing pending order (same user + same key_name)
- If pending exists: return it (don't create new)
- If no pending: create PurchaseHistory with status PREPARED
- Link coupon if applicable (TICKET_SERA_2614)
- Set Redis lock if applicable (TICKET_SERA_3766)

### 6.2 Pending Order Check

**New endpoint: `GET /api/orders/pending`**

Query params: `key_name` (optional)

Logic:
```sql
SELECT * FROM purchase_histories 
WHERE user_id = :currentUser
AND status IN ('PREPARED', 'PENDING')
AND key_name = :keyName  -- if provided
ORDER BY created_at DESC
LIMIT 1
```

Response includes:
- Order details (id, amount, status, payment_channel)
- For konbini: `payment_metadata.hosted_voucher_url` and expiry
- For PayPay: whether QR is still valid

### 6.3 Payment Session Creation

**New endpoint: `POST /api/orders/{orderId}/pay`**

Body: `{ payment_method: "stripe" | "paypay" }`

Logic:
1. Verify order belongs to current user
2. Verify order status is PREPARED or PENDING
3. If order already has active payment with DIFFERENT provider:
   - Cancel existing payment via provider API
4. Create new payment session:
   - Stripe: create checkout session (same as current `createPurchase`)
   - PayPay: create QR code (same as current `createPayment`)
5. Update order: `invoice_id`, `payment_channel`, status -> PENDING

### 6.4 Cancel Payment Service

**New endpoint: `POST /api/orders/{orderId}/cancel-payment`**

Logic:
1. Verify order belongs to current user
2. Verify order status is PENDING
3. Call provider cancel API:
   - **Stripe:** First retrieve checkout session, get payment_intent ID, then:
     - Try `$stripe->checkout->sessions->expire($sessionId)` 
     - If payment_intent exists: try `$stripe->paymentIntents->cancel($piId)`
     - If cancel fails (payment already succeeded): return error, don't update order
   - **PayPay:** Call `$client->payment->cancelPayment($merchantPaymentId)` (already exists)
4. If cancel succeeds:
   - Query param `?full_cancel=true`: status -> CANCELLED (user wants to abandon)
   - Query param `?full_cancel=false`: status -> PREPARED (user wants different method)
   - Clear Redis lock (TICKET_SERA_3766)
   - Unlink coupon (TICKET_SERA_2614)
5. If cancel fails:
   - Return 409 Conflict: "Payment is being processed, please wait"
   - Don't update order status

### 6.5 Webhook Handler (Idempotent)

Existing webhook handlers are mostly correct. Key improvements:

**Idempotency rule:** If `order.status == SUCCESS`, return 200 immediately (already processed).

**Race condition rule:** If `order.status == CANCELLED` but webhook says payment succeeded:
- Still mark as SUCCESS (money was collected)
- Log CRITICAL alert for manual review
- Create Permission as normal

**Konbini voucher rule:** On `checkout.session.completed` with `payment_status=unpaid`:
- Retrieve PaymentIntent: `$stripe->paymentIntents->retrieve($session->payment_intent)`
- Store `hosted_voucher_url` from `$pi->next_action->konbini_display_details->hosted_voucher_url`
- Store `expires_at` from `$pi->next_action->konbini_display_details->expires_at`
- Save to order's `payment_metadata` column

### 6.6 Konbini Data Storage

**New migration:** Add `payment_metadata` column to `purchase_histories`

Type: `JSON` (nullable)

Example stored data:
```json
{
  "hosted_voucher_url": "https://payments.stripe.com/...",
  "expires_at": 1713484800,
  "konbini_stores": { ... }
}
```

This column is also useful for storing any future provider-specific metadata (PayPay receipt URL, etc.)

---

## 7. Frontend Responsibilities (React)

**Approach: Modal + Page (both)**
- **PendingOrderDialog (modal):** Quick check before checkout. Appears when user clicks "Buy" and has a pending order. Offers resume or cancel.
- **`/payment/:orderId` (page):** Dedicated page users can bookmark or return to. Shows full payment status, voucher info, auto-polls for updates.

### 7.1 PendingOrderDialog (Modal -- before checkout)

Triggered when user clicks "Buy" and `GET /api/orders/pending` returns an existing order.

**For Konbini:**
```
┌─────────────────────────────────────┐
│  お支払い待ちの注文があります          │
│                                     │
│  コンビニ支払い                       │
│  期限: 2026年4月18日                  │
│                                     │
│  [支払い情報を表示する]               │  ← opens hosted_voucher_url
│  [お支払い状況を確認する]             │  ← navigates to /payment/:orderId
│                                     │
│  [キャンセルして別の方法で支払う]       │  ← cancel + open CheckoutSelectorModal
└─────────────────────────────────────┘
```

**For PayPay:**
```
┌─────────────────────────────────────┐
│  お支払い待ちの注文があります          │
│                                     │
│  PayPay支払い                        │
│                                     │
│  [PayPayで支払いを続ける]             │  ← re-check or navigate to /payment/:orderId
│                                     │
│  [キャンセルして別の方法で支払う]       │  ← cancel + open CheckoutSelectorModal
└─────────────────────────────────────┘
```

### 7.2 Payment Page: `/payment/:orderId`

A dedicated page that serves as the payment status hub. Users can bookmark it or be redirected here after creating a payment.

**States it handles:**
- `PREPARED` -> show payment method selector (or redirect to home)
- `PENDING` + `payment_channel=stripe` (card) -> "Waiting for payment..." + polling
- `PENDING` + konbini data -> show voucher link + expiry + polling (30s interval)
- `PENDING` + `payment_channel=paypay` -> "Waiting for PayPay..." + polling
- `SUCCESS` -> redirect to success/gacha page (`/paid`)
- `CANCELLED`/`FAILED` -> show error + "Try Again" button

**Page layout:**
```
┌──────────────────────────────────────────┐
│  注文 #502                                │
│  ステータス: お支払い待ち                   │
│                                          │
│  ┌──────────────────────────────────┐    │
│  │  コンビニ支払い                     │    │
│  │  期限: 2026年4月18日 23:59         │    │
│  │                                    │    │
│  │  [支払い情報を表示する]             │    │  ← opens hosted_voucher_url
│  └──────────────────────────────────┘    │
│                                          │
│  [支払い方法を変更する]                    │  ← cancel + method selector
│  [注文をキャンセルする]                    │  ← full cancel
│                                          │
│  ↻ お支払い確認後、自動的に更新されます      │  ← polling indicator
└──────────────────────────────────────────┘
```

**After payment succeeds (auto-detected via polling):**
```
┌──────────────────────────────────────────┐
│  お支払い完了！                            │
│                                          │
│  [結果を見る]                              │  ← redirect to /paid (gacha)
└──────────────────────────────────────────┘
```

### 7.3 Change Method Flow

1. User clicks "Cancel & Choose New Method" (from either modal or page)
2. Frontend calls `POST /api/orders/{orderId}/cancel-payment?full_cancel=false`
3. On success: show CheckoutSelectorModal (for the same existing order)
4. On 409 error: show "Payment is being processed, please wait"
5. User picks new method -> `POST /api/orders/{orderId}/pay`

### 7.4 Cancel Flow

1. User clicks "Cancel Payment"
2. Confirmation dialog: "この注文をキャンセルしますか？"
3. `POST /api/orders/{orderId}/cancel-payment?full_cancel=true`
4. On success: redirect to home
5. On error: show appropriate message

### 7.5 Auto-Refresh (Polling)

**Simple polling** (not WebSocket -- simpler for small team)

```
GET /api/orders/{orderId}/status
Response: { status, payment_channel, payment_metadata }
```

| Context | Interval | Max Duration |
|---------|----------|--------------|
| Card payment (Stripe/PayPay) | 5 seconds | 10 minutes |
| Konbini (async) | 30 seconds | Until page close |
| `/payment/:orderId` page | 10 seconds | Until page close |

**On status change:**
- `SUCCESS` -> redirect to `/paid` (gacha page)
- `FAILED` -> show error, allow retry
- `CANCELLED` -> redirect to home
- `PENDING` -> keep polling

### 7.6 Navigation Flow

```
User clicks "Buy"
    |
    v
Check pending order (API)
    |
    +-- No pending
    |   └─> Open CheckoutSelectorModal
    |       └─> User picks method
    |           └─> POST /api/orders (create)
    |               └─> POST /api/orders/{id}/pay
    |                   └─> Redirect to provider OR /payment/:orderId
    |
    +-- Has pending
        └─> Show PendingOrderDialog (modal)
            |
            +-- "Resume" → navigate to /payment/:orderId
            +-- "View voucher" → open hosted_voucher_url
            +-- "Cancel & New Method" → cancel API → CheckoutSelectorModal
```

### 7.7 Fix: CheckoutSelectorModal

**Current bug:** PayPay order is created on modal open (useEffect at line 207).
**Fix:** Remove `fetchPayPayUrl` from useEffect. Only create payment when user clicks a button.

---

## 8. State Machine

### Order Status Transitions

```
                    ┌──────────────────┐
                    │                  │
                    v                  │
  ┌──────────┐   ┌──────────┐   ┌─────┴────┐   ┌──────────┐
  │ PREPARED │──>│ PENDING  │──>│ SUCCESS  │   │CANCELLED │
  │          │   │          │   │          │   │          │
  │ Order    │   │ Payment  │   │ Paid &   │   │ User     │
  │ created, │   │ session  │   │ verified │   │ cancelled│
  │ no pay   │   │ active   │   │ by       │   │          │
  │ session  │   │          │   │ webhook  │   │          │
  └──────────┘   └────┬─────┘   └──────────┘   └──────────┘
       ^              │              ^
       │              │              │
       │   ┌──────────v──────────┐   │
       │   │                     │   │
       │   │  Cancel payment     │   │
       │   │  (switch method)    │   │
       │   │                     │   │
       └───┘  ┌──────────┐      │
              │ FAILED   │──────┘ (race condition:
              │          │         webhook says SUCCESS
              │ Payment  │         after cancel)
              │ expired/ │
              │ rejected │
              └──────────┘
```

### Valid Transitions

| From | To | Trigger |
|------|----|---------|
| PREPARED | PENDING | Payment session created |
| PREPARED | CANCELLED | User cancels before paying |
| PENDING | SUCCESS | Webhook confirms payment |
| PENDING | FAILED | Webhook: payment failed/expired |
| PENDING | PREPARED | User cancels payment to switch method |
| PENDING | CANCELLED | User fully cancels order |
| CANCELLED | SUCCESS | Race condition: webhook after cancel (honor it) |
| FAILED | -- | Terminal state (user creates new order) |
| SUCCESS | -- | Terminal state |

### Important Rules
- `FAILED` is terminal. If user wants to retry, create a NEW order (new order ID). This keeps audit trail clean.
- `CANCELLED -> SUCCESS` is rare but must be handled. It means money was collected.
- `PENDING -> PREPARED` is the "switch method" transition. Same order, new payment.

---

## 9. Risks & Mitigation

### Risk 1: Race Condition (Cancel vs. Payment)

**Risk:** User cancels while payment is being processed.

**Mitigation:**
- Always call provider cancel API first, check response
- If cancel API returns error -> don't update order status
- Webhook handler always takes priority over local status
- If `CANCELLED` order receives success webhook -> honor it, log alert

### Risk 2: Duplicate Payments

**Risk:** Two payment sessions active for the same order.

**Mitigation:**
- Before creating new payment session, cancel existing one
- Use `invoice_id` to track active session
- Stripe checkout sessions auto-expire after 24 hours
- PayPay QR codes expire (configurable)

### Risk 3: Expired Payments (Konbini)

**Risk:** User doesn't pay within 3 days. Order stays PENDING.

**Mitigation:**
- Stripe fires `checkout.session.expired` webhook -> handler marks FAILED
- Store `expires_at` in `payment_metadata` -> frontend shows countdown
- Optional: Laravel scheduled job to clean up old PENDING orders (safety net)

### Risk 4: Webhook Reliability

**Risk:** Webhook doesn't arrive (network issue, server down).

**Mitigation:**
- Stripe retries webhooks for up to 3 days
- PayPay retries as well (per their docs)
- Safety net: `successCallback` endpoint checks payment status via API call to provider
- Optional: scheduled job that checks PENDING orders > 24h old against provider API

### Risk 5: Coupon Double-Use

**Risk:** User uses coupon on order A, cancels, uses same coupon on order B.

**Mitigation:**
- Already handled by `TICKET_SERA_2614` and `TICKET_SERA_3766`
- On cancel: unlink coupon (`used_for_purchase_id = null`, `status = 'obtained'`)
- On cancel: clear Redis lock
- Same cleanup logic as `handlePaymentFailed()` -- reuse that code

---

## 10. Suggested API Endpoints

### New Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/orders/pending` | Check for pending order (query: `key_name`) |
| `POST` | `/api/orders` | Create new order (or return existing pending) |
| `GET` | `/api/orders/{id}/status` | Get order status (for polling) |
| `POST` | `/api/orders/{id}/pay` | Create payment session for order |
| `POST` | `/api/orders/{id}/cancel-payment` | Cancel active payment (query: `full_cancel`) |

### Existing Endpoints (Keep As-Is)

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/stripe/webhook` | Stripe webhook handler |
| `POST` | `/paypay/webhook` | PayPay webhook handler |
| `GET` | `/paid` | Success callback page |
| `GET` | `/paypay/success` | PayPay success callback |

### Endpoints to Deprecate (Gradually)

| Method | Path | Replaced By |
|--------|------|-------------|
| `POST` | `/create-purchase` | `/api/orders` + `/api/orders/{id}/pay` |
| `POST` | `/paypay/create` | `/api/orders` + `/api/orders/{id}/pay` |
| `POST` | `/paypay/update` | No longer needed (webhook handles) |
| `POST` | `/paypay/cancel/{id}` | `/api/orders/{id}/cancel-payment` |

**Migration strategy:** Keep old endpoints working. Add new endpoints. Frontend gradually switches. Remove old endpoints after all frontend is migrated.

---

## 11. Code Examples

### 11.1 Laravel: Order Service (Conceptual)

**OrderService.php** -- New service encapsulating all order logic:

Key methods:
- `findPendingOrder($userId, $keyName)` -- queries purchase_histories for PREPARED/PENDING
- `createOrder($userId, $keyName, $groupKeyName, $amount, $discount, $gachaResultId)` -- creates PurchaseHistory
- `createPaymentSession($order, $paymentMethod)` -- calls Stripe or PayPay, updates order
- `cancelPayment($order, $fullCancel)` -- calls provider API, updates order, cleans up coupon/lock
- `handleWebhookSuccess($order)` -- marks SUCCESS, creates permission, cleans up
- `handleWebhookFailed($order)` -- marks FAILED, cleans up

The service reuses existing logic from `PurchaseService`, `PurchaseController`, and `PayPayController` -- just reorganized.

### 11.2 Laravel: Webhook Handler (Idempotent Pattern)

Key improvement in webhook handlers:

```
1. Find order by invoice_id
2. If not found → 404
3. If order.status == SUCCESS → return 200 (already processed, idempotent)
4. If order.status == CANCELLED and webhook says SUCCESS:
   → Log CRITICAL alert
   → Still process as SUCCESS (honor the payment)
5. Process normally
6. Save inside DB transaction
```

### 11.3 React: Payment Page Flow (Conceptual)

The payment page (`/payment/:orderId`):

```
1. On mount: GET /api/orders/{orderId}/status
2. Render based on status:
   - PREPARED → PaymentMethodSelector component
   - PENDING + konbini → KonbiniPendingView (voucher link + expiry)
   - PENDING + other → WaitingForPayment (spinner + polling)
   - SUCCESS → redirect to success page
   - FAILED/CANCELLED → ErrorView with retry option
3. Start polling interval (5s for active payment, 30s for konbini)
4. On status change → update UI automatically
```

### 11.4 React: Pre-Checkout Check (Conceptual)

Before opening CheckoutSelectorModal:

```
1. Call GET /api/orders/pending?key_name={categoryKeyName}
2. If has_pending:
   - Show PendingOrderDialog instead of CheckoutSelectorModal
   - PendingOrderDialog has: Resume / Cancel buttons
3. If no pending:
   - Show CheckoutSelectorModal as normal
   - But DON'T create PayPay order on modal open (current bug)
   - Only create payment when user clicks a payment method button
```

---

## 12. Pages & Components to Build

### New Frontend Pages

| File | Route | Description |
|------|-------|-------------|
| `resources/assets/js/pages/PaymentPage.tsx` | `/payment/:orderId` | Dedicated payment status page. Shows provider-specific UI based on order state. Auto-polls for updates. Users can bookmark and return to it. |
| `resources/assets/js/components/PendingOrderDialog.tsx` | (modal, no route) | Intercept modal shown when user clicks "Buy" but already has a pending order. Offers Resume / View Voucher / Cancel & Switch options. |

### Sub-components of PaymentPage

| Component | Renders when | Responsibility |
|-----------|-------------|----------------|
| `PaymentMethodSelector` | `status = PREPARED` | Let user pick Stripe or PayPay. Calls `POST /api/orders/{id}/pay`. |
| `KonbiniPendingView` | `status = PENDING` + konbini metadata exists | Show voucher link, expiry countdown, "View Payment Instructions" button. Polls every 30s. |
| `WaitingForPayment` | `status = PENDING` (card/PayPay) | Spinner + "waiting for confirmation" message. Polls every 5s for up to 10 min. |
| `ErrorView` | `status = FAILED` or `CANCELLED` | Error message + "Try Again" button (creates new order) or redirect home. |

### Existing Pages to Modify

| File | Change |
|------|--------|
| `resources/assets/js/components/CheckoutSelectorModal.tsx` | Remove `fetchPayPayUrl` from `useEffect`. Only create payment session on explicit button click. |
| Product / Category page (wherever the Buy button lives) | Add pending order check (`GET /api/orders/pending?key_name=xxx`) before opening CheckoutSelectorModal. Show `PendingOrderDialog` if pending order found. |

### New Backend Files

| File | Description |
|------|-------------|
| `app/Services/OrderService.php` | Unified order service: `findPendingOrder()`, `createOrder()`, `createPaymentSession()`, `cancelPayment()`, `handleWebhookSuccess()`, `handleWebhookFailed()` |
| `app/Http/Controllers/OrderController.php` | REST controller for the 5 new API endpoints |
| `database/migrations/xxxx_add_payment_metadata_to_purchase_histories.php` | Add `payment_metadata` JSON column (nullable) |
| `database/migrations/xxxx_add_cancelled_status_to_purchase_histories.php` | Add `CANCELLED` to status enum |

### Page Navigation Map

```
Product Page (Buy button)
    │
    ├── No pending order
    │   └── CheckoutSelectorModal (existing, modified)
    │       └── User picks method
    │           └── POST /api/orders → POST /api/orders/{id}/pay
    │               ├── Stripe → Stripe Checkout → /payment/:orderId (polling)
    │               └── PayPay → PayPay page → /payment/:orderId (polling)
    │
    └── Has pending order
        └── PendingOrderDialog (new modal)
            ├── "Resume" → /payment/:orderId
            ├── "View Voucher" → hosted_voucher_url (external)
            └── "Cancel & Switch" → cancel API → CheckoutSelectorModal
                                                        │
/payment/:orderId                                       │
    ├── PREPARED → PaymentMethodSelector ←──────────────┘
    ├── PENDING (konbini) → KonbiniPendingView (polling 30s)
    ├── PENDING (card/paypay) → WaitingForPayment (polling 5s)
    ├── SUCCESS → redirect to /paid (gacha/success page)
    └── FAILED/CANCELLED → ErrorView
```

---

## Summary: What Changes, What Stays

### What Changes
1. **New `payment_metadata` column** on `purchase_histories` (JSON, nullable)
2. **New CANCELLED status** added to enum (distinguish from FAILED)
3. **5 new API endpoints** (pending check, create order, status, pay, cancel)
4. **New `OrderService`** consolidating payment logic
5. **Frontend: PendingOrderDialog** -- new modal shown when pending order detected
6. **Frontend: `/payment/:orderId` page** -- new dedicated payment status page with polling
7. **Konbini webhook handler** stores voucher URL
8. **CheckoutSelectorModal** no longer creates PayPay on open (bug fix)

### What Stays the Same
- `PurchaseHistoryObserver` (Permission creation on SUCCESS)
- Stripe webhook endpoint and signature verification
- PayPay webhook endpoint and IP validation  
- Coupon/gacha/lock logic (TICKET_SERA_*)
- All existing routes (kept for backward compatibility)
- Success page (`/paid`) and its gacha animation flow
- Admin pages (paypay-history, etc.)

### Implementation Order (Suggested)

**Phase 1: Foundation (No UI change)**
1. Add `payment_metadata` column migration
2. Add `CANCELLED` status to enum
3. Create `OrderService` (extract logic from existing controllers)
4. Add new API endpoints (behind feature flag)

**Phase 2: Konbini Recovery**
5. Update konbini webhook handler to store voucher URL
6. Add pending order check endpoint
7. Test with existing konbini flow

**Phase 3: Frontend Integration**
8. Add pending order check before checkout
9. Add PendingOrderDialog component
10. Create `/payment/:orderId` page
11. Fix PayPay order creation timing in CheckoutSelectorModal
12. Add cancel-and-switch flow

**Phase 4: Polish**
13. Add polling/auto-refresh on payment page
14. Deprecate old endpoints
15. Add scheduled job for stale order cleanup (optional)

---

## Key Files Reference

### Backend (existing, to be modified)
- `app/Http/Controllers/PurchaseController.php` -- Stripe flow
- `app/Http/Controllers/PayPayController.php` -- PayPay flow
- `app/Services/PurchaseService.php` -- Order/session creation
- `app/Observers/PurchaseHistoryObserver.php` -- Permission automation
- `app/PurchaseHistory.php` -- Order model

### Backend (new)
- `app/Services/OrderService.php` -- New unified order service
- `app/Http/Controllers/OrderController.php` -- New API controller
- `database/migrations/xxxx_add_payment_metadata_to_purchase_histories.php`
- `database/migrations/xxxx_add_cancelled_status_to_purchase_histories.php`

### Frontend (existing, to be modified)
- `resources/assets/js/components/CheckoutSelectorModal.tsx` -- Fix PayPay timing

### Frontend (new)
- `resources/assets/js/components/PendingOrderDialog.tsx` -- Pending order modal
- `resources/assets/js/pages/PaymentPage.tsx` -- `/payment/:orderId` page

### Routes
- `routes/web.php` -- Add new API routes
