# Payment System Redesign - Designer Brief

> **Purpose:** Everything a designer needs to create UI for the new payment flow.
> **Technical doc:** See [`payment-system-redesign.md`](payment-system-redesign.md) for full engineering details.
> **Visual flow diagrams:** Open [`payment-flow-diagram.html`](payment-flow-diagram.html) in a browser.

---

## 1. What We're Building (Summary)

Users currently have 3 problems:
1. If they close the browser after choosing konbini payment, they lose the payment code forever
2. They can't switch payment methods (e.g. PayPay to card) without creating duplicate orders
3. Payment status doesn't update automatically — they have to refresh manually

We're adding **1 new modal** and **1 new page** to fix all of this.

---

## 2. Screens to Design

### Screen A: PendingOrderDialog (Modal)

**When it appears:** User clicks "Buy" on a product, but they already have an unfinished order for the same item.

**Purpose:** Let the user resume, view instructions, or cancel & switch method.

**2 variants needed:**

#### Variant A1: Konbini pending

The user chose konbini (convenience store) payment before but hasn't paid yet.

| Element | Detail |
|---------|--------|
| Title | お支払い待ちの注文があります |
| Payment method label | コンビニ支払い |
| Expiry info | 期限: {date} (e.g. 2026年4月18日) |
| Primary button | 支払い情報を表示する → opens external Stripe voucher page |
| Secondary button | お支払い状況を確認する → goes to Payment Page |
| Destructive/tertiary link | キャンセルして別の方法で支払う → cancels, opens method selector |

#### Variant A2: PayPay pending

The user started a PayPay payment but didn't complete it.

| Element | Detail |
|---------|--------|
| Title | お支払い待ちの注文があります |
| Payment method label | PayPay支払い |
| Primary button | PayPayで支払いを続ける → goes to Payment Page |
| Destructive/tertiary link | キャンセルして別の方法で支払う → cancels, opens method selector |

#### Variant A3: Card (Stripe) pending

Rare — user closed Stripe Checkout mid-payment.

| Element | Detail |
|---------|--------|
| Title | お支払い待ちの注文があります |
| Payment method label | カード支払い |
| Primary button | 支払いを続ける → goes to Payment Page |
| Destructive/tertiary link | キャンセルして別の方法で支払う |

---

### Screen B: Payment Page (`/payment/:orderId`)

A full page (not a modal). Users land here after creating a payment, and can bookmark it to come back later.

**This page has 6 states — each needs its own layout:**

#### State B1: PREPARED (no payment session yet)

User created an order but hasn't picked a payment method.

| Element | Detail |
|---------|--------|
| Header | 注文 #{orderId} |
| Status label | お支払い方法を選択してください |
| Action | Show payment method selector (PayPay / Stripe) |

#### State B2: PENDING — Konbini (waiting for store payment)

User chose konbini. Voucher has been issued. Waiting for them to pay at a store.

| Element | Detail |
|---------|--------|
| Header | 注文 #{orderId} |
| Status label | ステータス: お支払い待ち |
| Card/section | コンビニ支払い |
| Expiry | 期限: {date} {time} (countdown or date format) |
| Primary button | 支払い情報を表示する → opens external Stripe voucher page (new tab) |
| Secondary link | 支払い方法を変更する → cancels current, shows method selector |
| Destructive link | 注文をキャンセルする → full cancel, confirm dialog first |
| Footer indicator | ↻ お支払い確認後、自動的に更新されます (auto-polling active) |

**Designer notes:**
- The expiry countdown is important — make it visually prominent
- The voucher link opens an external Stripe-hosted page (not our UI)
- The page auto-refreshes every 30 seconds (no user action needed)

#### State B3: PENDING — Card/PayPay (waiting for confirmation)

User paid (or is paying) via card or PayPay. Webhook hasn't arrived yet.

| Element | Detail |
|---------|--------|
| Header | 注文 #{orderId} |
| Status label | お支払い処理中... |
| Visual | Loading spinner or animation |
| Subtext | お支払いが確認でき次第、自動的に更新されます |
| Secondary link | 支払い方法を変更する |
| Destructive link | 注文をキャンセルする |
| Footer indicator | ↻ (polling every 5 seconds) |

#### State B4: SUCCESS (payment confirmed)

Webhook confirmed the payment. Brief success screen before redirect.

| Element | Detail |
|---------|--------|
| Status | お支払い完了！ |
| Visual | Success icon / checkmark animation |
| Button | 結果を見る → redirects to /paid (gacha/success page) |

**Designer notes:**
- This screen is shown briefly (1-2 seconds) before auto-redirect
- Or can be a simple transition animation

#### State B5: FAILED (payment expired or rejected)

Payment didn't go through (e.g. konbini expired after 3 days, card declined).

| Element | Detail |
|---------|--------|
| Status | お支払いに失敗しました |
| Visual | Error icon |
| Explanation | お支払い期限が切れました / カードが拒否されました (context-dependent) |
| Primary button | もう一度購入する → goes back to product page to create new order |
| Secondary link | ホームに戻る |

#### State B6: CANCELLED (user cancelled)

User explicitly cancelled the order.

| Element | Detail |
|---------|--------|
| Status | 注文がキャンセルされました |
| Primary button | ホームに戻る |

---

### Screen C: Cancel Confirmation Dialog

Small confirmation modal triggered from the Payment Page or PendingOrderDialog.

| Element | Detail |
|---------|--------|
| Title | この注文をキャンセルしますか？ |
| Body text | キャンセルすると、お支払い情報は無効になります |
| Confirm button (destructive) | キャンセルする |
| Dismiss button | 戻る |

---

### Screen D: Error State — Payment Being Processed (409)

Shown when user tries to cancel but the payment is already being processed (race condition).

| Element | Detail |
|---------|--------|
| Type | Inline alert / toast / small modal |
| Message | お支払いが処理中です。しばらくお待ちください。 |
| Action | Auto-dismiss after a few seconds, or "OK" button |

---

## 3. Existing Screen to Modify

### CheckoutSelectorModal (existing)

**No visual change needed.** The only change is behavioral:
- Currently: PayPay order is created automatically when the modal opens
- After: PayPay order is created only when the user clicks the PayPay button

If the designer wants to add a subtle loading state on the PayPay button after click, that would be a nice touch.

---

## 4. User Flow Map (All Screens Connected)

```
Product Page
    │
    │ [Buy button click]
    │
    ├── No pending order
    │   └── CheckoutSelectorModal (existing)
    │       ├── User picks Stripe → redirect to Stripe Checkout (external)
    │       └── User picks PayPay → redirect to PayPay (external)
    │           │
    │           └── After redirect → /payment/:orderId [Screen B]
    │
    └── Has pending order
        └── PendingOrderDialog [Screen A]
            │
            ├── "Resume / View voucher"
            │   └── /payment/:orderId [Screen B]
            │
            └── "Cancel & New Method"
                └── Cancel Confirmation [Screen C]
                    ├── Confirmed → CheckoutSelectorModal
                    └── Dismissed → back to dialog

/payment/:orderId [Screen B]
    │
    ├── Polling detects SUCCESS
    │   └── Success state [B4] → auto-redirect to /paid
    │
    ├── "Change method" clicked
    │   └── Cancel Confirmation [Screen C]
    │       └── CheckoutSelectorModal (same order)
    │
    └── "Cancel order" clicked
        └── Cancel Confirmation [Screen C]
            └── Redirect to home
```

---

## 5. Dynamic Data the UI Displays

| Data | Where it appears | Example |
|------|-----------------|---------|
| Order ID | Payment Page header | #502 |
| Payment method | PendingOrderDialog, Payment Page | コンビニ / PayPay / カード |
| Amount | Payment Page | ¥3,000 |
| Expiry date (konbini) | PendingOrderDialog, Payment Page | 2026年4月18日 23:59 |
| Item name | PendingOrderDialog (optional) | GL-3 検索権 |
| Order status | Payment Page | お支払い待ち / 処理中 / 完了 / 失敗 / キャンセル |
| Discount/coupon | Payment Page (if applicable) | ¥500 割引適用済み |

---

## 6. Design Considerations

### Mobile first
- Both the modal and the payment page must work on mobile
- PendingOrderDialog is a bottom sheet on mobile, centered modal on desktop
- Payment Page is a standard full-width page

### Urgency & clarity
- Konbini expiry should feel urgent but not alarming (countdown or clear date)
- The voucher button should be the most prominent element when konbini is pending
- Users may not understand "konbini" technically — use clear language like "コンビニ支払い"

### Loading & transition states
- After clicking "Cancel & New Method": brief loading state while API call runs
- After clicking payment method button: loading state until redirect
- Polling indicator should be subtle (small spinner or text, not a full-page loader)
- SUCCESS state can auto-redirect after 2 seconds, or let user click

### Error handling
- 409 (payment being processed) — non-blocking alert, not a page error
- Network error during cancel — retry button or "try again later" message
- Keep error messages simple and actionable

### Consistency with existing app
- The existing success page (`/paid`) and gacha animation are unchanged
- The existing CheckoutSelectorModal keeps its current look
- New components should match the existing design system

---

## 7. Deliverables Checklist

| # | Screen | Variants | Priority |
|---|--------|----------|----------|
| 1 | PendingOrderDialog (Modal) | Konbini, PayPay, Card (3 variants) | High |
| 2 | Payment Page — Konbini pending | Desktop + Mobile | High |
| 3 | Payment Page — Card/PayPay waiting | Desktop + Mobile | High |
| 4 | Payment Page — Success | Desktop + Mobile | Medium |
| 5 | Payment Page — Failed | Desktop + Mobile | Medium |
| 6 | Payment Page — Cancelled | Desktop + Mobile | Low |
| 7 | Payment Page — Method selector | Desktop + Mobile | Medium |
| 8 | Cancel Confirmation Dialog | 1 variant | Medium |
| 9 | Error toast (409 processing) | 1 variant | Low |

**Total: 9 screens / variants to design**

---

## 8. Reference: Status ↔ UI Mapping

```
Order Status     → UI State
─────────────────────────────────
PREPARED         → Payment method selector (pick Stripe or PayPay)
PENDING+konbini  → Voucher link + expiry + "change method" + polling
PENDING+card     → "Processing..." spinner + polling
PENDING+paypay   → "Waiting for PayPay..." spinner + polling
SUCCESS          → Checkmark + "View result" button → redirect
FAILED           → Error + "Try again" button
CANCELLED        → "Order cancelled" + "Go home" button
```
