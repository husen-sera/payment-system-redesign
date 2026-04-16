import React, { useState } from 'react';

export default function PaymentRedesignSPA() {
  const [currentSlide, setCurrentSlide] = useState(0);

  const slides = [
    {
      id: "title",
      title: "Payment System Redesign",
      subtitle: "Solving duplicate orders, lost payments & unsafe cancellation",
      type: "title",
      details: ["Duplicate order prevention", "Konbini payment recovery", "Payment cancel & switch", "Auto-refresh payment status"]
    },
    {
      id: "problems",
      title: "Current Problems",
      type: "list",
      intro: "6 issues in today's payment system",
      items: [
        { num: "1", title: "Duplicate orders", desc: "User can create multiple pending orders for same item" },
        { num: "2", title: "Lost konbini info", desc: "If user closes page, payment code is gone forever" },
        { num: "3", title: "No resume flow", desc: "User cannot continue an unfinished payment" },
        { num: "4", title: "Unsafe cancel", desc: "Cancel only updates DB, does NOT call Stripe/PayPay API" },
        { num: "5", title: "Manual refresh", desc: "UI does not auto-update after payment" },
        { num: "6", title: "Race condition", desc: "Payment can succeed after cancel, causing inconsistency" }
      ]
    },
    {
      id: "overview",
      title: "Before vs After Overview",
      type: "table",
      rows: [
        ["Order creation", "Order + payment together", "Order first, payment separate"],
        ["Duplicate check", "None", "Pending order check before purchase"],
        ["Konbini close", "Code lost forever", "Voucher URL stored in DB"],
        ["Resume payment", "Not possible", "Dialog shows resume option"],
        ["Cancel payment", "DB update only", "API call to Stripe/PayPay"],
        ["Switch method", "Not possible", "Cancel old + create new"],
        ["Payment status", "Manual refresh needed", "Auto-polling (5-30 sec)"]
      ]
    },
    {
      id: "order-flow",
      title: "Order Flow Comparison",
      type: "two-col",
      left: { title: "BEFORE", items: ["User clicks Buy", "Create order + payment together", "Redirect to provider", "No check for existing orders", "Opening modal = orphan order"] },
      right: { title: "AFTER", items: ["User clicks Buy", "Check: pending order?", "YES: show dialog | NO: create order", "User picks method", "Create payment session only then"] }
    },
    {
      id: "cancel-flow",
      title: "Cancel Flow Comparison",
      type: "two-col",
      left: { title: "BEFORE", items: ["User cancels", "DB status → FAILED", "Stripe/PayPay NOT notified", "Provider may still collect money", "No cleanup"] },
      right: { title: "AFTER", items: ["User cancels", "Call provider API first", "If success → update DB", "If fail → DON'T update", "Cleanup coupon & lock"] }
    },
    {
      id: "konbini",
      title: "Konbini Payment Recovery",
      type: "two-col",
      left: { title: "THE PROBLEM", items: ["User picks konbini", "Sees payment code", "Closes browser", "Code is LOST", "Can't pay at store", "Order stuck 3 days"] },
      right: { title: "THE SOLUTION", items: ["Webhook stores URL in DB", "User closes browser", "Comes back next day", "System shows pending", "View payment instructions", "Sees code again → Pays ✓"] }
    },
    {
      id: "principles",
      title: "Core Design Principles",
      type: "principles",
      items: [
        { num: "1", title: "Order = Single Truth", desc: "Payment sessions are disposable, order persists" },
        { num: "2", title: "One Pending Order", desc: "Check before creating new orders" },
        { num: "3", title: "Webhook Authority", desc: "Frontend never writes status" },
        { num: "4", title: "Payments Replaceable", desc: "Cancel old, create new, same order ID" },
        { num: "5", title: "Always Cancel Via API", desc: "Never just update database" },
        { num: "6", title: "Store Async Details", desc: "So user can resume (voucher URL, expiry)" }
      ]
    },
    {
      id: "unified-flow",
      title: "Unified Payment Flow",
      type: "flow",
      steps: [
        "POST /api/orders → Create order (PREPARED)",
        "POST /api/orders/{id}/pay → Create payment session (PENDING)",
        "User pays → Stripe / PayPay / Konbini",
        "Webhook confirms → SUCCESS or FAILED",
        "Frontend polls & updates → Auto-redirect"
      ]
    },
    {
      id: "cancel-switch",
      title: "Cancel & Switch Payment Method",
      type: "two-col",
      left: { title: "USER SCENARIO", items: ["User starts PayPay", "Decides wants Stripe", "Clicks Cancel & Choose", "Backend calls PayPay API", "Order → PREPARED", "New Stripe session created"] },
      right: { title: "PROVIDER SUPPORT", items: ["PayPay: cancelPayment()", "Already implemented", "", "Stripe: sessions→expire()", "paymentIntents→cancel()", "Both ready to use"] }
    },
    {
      id: "race-condition",
      title: "Race Condition Handling",
      type: "text",
      content: "Most dangerous edge case: payment succeeds after cancel\n\nT=0: User gets konbini voucher\nT=1: User goes to store\nT=2: User cancels from phone\nT=3: User pays at store\nT=4: Webhook: payment succeeded\n\nSOLUTION: Cancel API may fail → if it fails, DON'T update status. Webhook always takes priority. Rule: If money was collected, always honor it."
    },
    {
      id: "state-machine",
      title: "State Machine",
      type: "text",
      content: "Order Status Transitions:\n\nPREPARED → PENDING → SUCCESS (terminal)\n              ↓\n           FAILED (terminal)\n\nSpecial transitions:\n• PENDING → PREPARED (switch method, same order)\n• PENDING → CANCELLED (user abandons)\n• CANCELLED → SUCCESS (race condition, honor payment)\n\nKey Rules:\n• FAILED = terminal (create new order to retry)\n• CANCELLED → SUCCESS = rare but must be handled\n• PENDING → PREPARED = \"switch method\" transition"
    },
    {
      id: "api-endpoints",
      title: "New API Endpoints",
      type: "endpoints",
      items: [
        { method: "GET", path: "/api/orders/pending", desc: "Check pending order" },
        { method: "POST", path: "/api/orders", desc: "Create order" },
        { method: "GET", path: "/api/orders/{id}/status", desc: "Poll status" },
        { method: "POST", path: "/api/orders/{id}/pay", desc: "Create payment session" },
        { method: "POST", path: "/api/orders/{id}/cancel-payment", desc: "Cancel payment" }
      ]
    },
    {
      id: "frontend",
      title: "Two New Frontend Components",
      type: "two-col",
      left: { title: "PendingOrderDialog", items: ["Shown when user clicks Buy", "If pending order exists:", "  • Resume Payment option", "  • View Status option", "  • Cancel & New Method", "Prevents duplicate creation"] },
      right: { title: "/payment/:orderId Page", items: ["Dedicated status hub", "Auto-polls for confirmation", "Shows konbini voucher link", "Shows expiry countdown", "Can be bookmarked", "Auto-redirects on success"] }
    },
    {
      id: "refresh",
      title: "Auto-Refresh Strategy",
      type: "refresh-table",
      items: [
        { context: "Card / PayPay", interval: "5 sec", duration: "10 min" },
        { context: "Konbini", interval: "30 sec", duration: "Until close" },
        { context: "Payment page", interval: "10 sec", duration: "Until close" }
      ]
    },
    {
      id: "benefits",
      title: "Benefits of Proposed Solution",
      type: "benefits",
      sections: [
        { title: "For Users", items: ["Never lose konbini code", "Switch payment method", "Auto-updating status", "Clear feedback on orders"] },
        { title: "For Business", items: ["No duplicate orders", "No lost payments", "Safe cancellations", "Proper race handling"] },
        { title: "For Developers", items: ["One unified flow", "Clear state machine", "Idempotent webhooks", "Code reused"] }
      ]
    },
    {
      id: "pros-cons",
      title: "Pros & Cons",
      type: "pros-cons",
      pros: ["Solves all 6 problems", "Backward compatible", "No new infrastructure", "Stripe page for Konbini", "PayPay cancel ready", "Simple polling", "No Permission changes"],
      cons: ["5 new API endpoints", "New /payment/:orderId page", "Polling overhead", "Migration period complexity", "Race condition review", "State machine training needed"]
    },
    {
      id: "timeline",
      title: "Implementation Timeline",
      type: "timeline",
      phases: [
        { name: "Phase 1: Foundation", weeks: "Week 1-2", items: "DB migration, OrderService, endpoints, tests" },
        { name: "Phase 2: Konbini Recovery", weeks: "Week 3", items: "Webhook, pending check, testing" },
        { name: "Phase 3: Frontend", weeks: "Week 4-5", items: "Dialog, page, modal fix, flows" },
        { name: "Phase 4: Polish & Launch", weeks: "Week 6", items: "Polling, QA, staging, monitoring" },
        { name: "Phase 5: Cleanup", weeks: "Week 7+", items: "Deprecate, remove flag" }
      ]
    },
    {
      id: "risks",
      title: "Risks & Mitigation",
      type: "risks",
      items: [
        { risk: "Race condition", mit: "Cancel first, webhook priority, log alert" },
        { risk: "Duplicate payments", mit: "Cancel existing before new" },
        { risk: "Konbini expires", mit: "Webhook marks FAILED, show countdown" },
        { risk: "Webhook fails", mit: "3-day retry + safety net" },
        { risk: "Coupon double-use", mit: "Unlink on cancel" },
        { risk: "Migration break", mit: "Keep old endpoints, feature flag" }
      ]
    },
    {
      id: "summary",
      title: "Summary",
      type: "summary",
      problems: [
        "Duplicate orders → pending check blocks",
        "Lost konbini → URL in DB",
        "Unsafe cancel → always via API"
      ],
      philosophy: [
        "Order is permanent, payments disposable",
        "Webhook is the only truth",
        "If money collected, always honor it"
      ],
      closing: "Timeline: ~6 weeks  •  Risk: Low"
    }
  ];

  const slide = slides[currentSlide];

  const SlideContent = () => {
    if (slide.type === 'title') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h1 style={{ fontSize: '48px', fontWeight: '500', margin: '0 0 1rem 0', color: '#1E2761' }}>{slide.title}</h1>
          <p style={{ fontSize: '24px', color: '#666666', margin: '0 0 3rem 0' }}>{slide.subtitle}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {slide.details.map((d, i) => (
              <div key={i} style={{ padding: '0.75rem', background: '#F5F5F5', border: '0.5px solid #E0E0E0', borderRadius: '8px', fontSize: '14px' }}>
                ✓ {d}
              </div>
            ))}
          </div>
        </div>
      );
    } else if (slide.type === 'list') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 0.5rem 0' }}>{slide.title}</h2>
          <p style={{ fontSize: '16px', color: '#666666', margin: '0 0 2rem 0' }}>{slide.intro}</p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
            {slide.items.map((item, i) => (
              <div key={i} style={{ padding: '1.5rem', background: '#F5F5F5', borderRadius: '12px', border: '0.5px solid #E0E0E0' }}>
                <div style={{ fontSize: '28px', fontWeight: '500', color: '#0A7BA7', marginBottom: '0.5rem' }}>{item.num}</div>
                <h3 style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 0.5rem 0' }}>{item.title}</h3>
                <p style={{ fontSize: '13px', color: '#666666', margin: '0' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      );
    } else if (slide.type === 'table') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid #E0E0E0' }}>
                <th style={{ textAlign: 'left', padding: '12px 0', fontWeight: '500', color: '#1E2761' }}>Area</th>
                <th style={{ textAlign: 'left', padding: '12px 0', fontWeight: '500', color: '#1E2761' }}>Before</th>
                <th style={{ textAlign: 'left', padding: '12px 0', fontWeight: '500', color: '#1E2761' }}>After</th>
              </tr>
            </thead>
            <tbody>
              {slide.rows.map((row, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid #E0E0E0', background: i % 2 === 0 ? '#F5F5F5' : 'transparent' }}>
                  <td style={{ padding: '12px 0', color: '#1E2761' }}>{row[0]}</td>
                  <td style={{ padding: '12px 0', color: '#666666' }}>{row[1]}</td>
                  <td style={{ padding: '12px 0', color: '#666666' }}>{row[2]}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    } else if (slide.type === 'two-col') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            <div style={{ padding: '1.5rem', background: '#F5F5F5', borderRadius: '12px', border: '0.5px solid #E0E0E0' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 1rem 0', color: '#0A7BA7' }}>{slide.left.title}</h3>
              <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
                {slide.left.items.map((item, i) => (
                  <li key={i} style={{ padding: '0.5rem 0', color: '#666666', fontSize: '13px' }}>• {item}</li>
                ))}
              </ul>
            </div>
            <div style={{ padding: '1.5rem', background: '#F5F5F5', borderRadius: '12px', border: '0.5px solid #E0E0E0' }}>
              <h3 style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 1rem 0', color: '#0A7BA7' }}>{slide.right.title}</h3>
              <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
                {slide.right.items.map((item, i) => (
                  <li key={i} style={{ padding: '0.5rem 0', color: '#666666', fontSize: '13px' }}>• {item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      );
    } else if (slide.type === 'principles') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
            {slide.items.map((item, i) => (
              <div key={i} style={{ padding: '1.25rem', background: '#F5F5F5', borderRadius: '12px', border: '0.5px solid #E0E0E0', borderLeft: '3px solid #0A7BA7' }}>
                <div style={{ fontSize: '14px', fontWeight: '500', color: '#0A7BA7', marginBottom: '0.5rem' }}>{item.num}. {item.title}</div>
                <p style={{ fontSize: '13px', color: '#666666', margin: '0' }}>{item.desc}</p>
              </div>
            ))}
          </div>
        </div>
      );
    } else if (slide.type === 'flow') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
            {slide.steps.map((step, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '1rem', animation: `slideIn ${0.4 + i * 0.1}s ease-out` }}>
                <div style={{ width: '32px', height: '32px', borderRadius: '50%', background: '#0A7BA7', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: '500', flexShrink: 0 }}>{i + 1}</div>
                <div style={{ padding: '1rem', background: '#F5F5F5', borderRadius: '8px', border: '0.5px solid #E0E0E0', flex: '1', fontSize: '14px', color: '#1E2761' }}>{step}</div>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '13px', color: '#666666', marginTop: '2rem', fontStyle: 'italic' }}>Key insight: Order created ONCE, payment can be attempted multiple times</p>
        </div>
      );
    } else if (slide.type === 'endpoints') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            {slide.items.map((item, i) => (
              <div key={i} style={{ padding: '1rem', background: '#F5F5F5', borderRadius: '8px', border: '0.5px solid #E0E0E0', display: 'grid', gridTemplateColumns: '80px 1fr 250px', gap: '1rem', alignItems: 'center' }}>
                <code style={{ fontSize: '12px', fontWeight: '500', color: '#27AE60', background: 'white', padding: '0.5rem', borderRadius: '4px', textAlign: 'center' }}>{item.method}</code>
                <code style={{ fontSize: '12px', color: '#1E2761', fontFamily: 'monospace' }}>{item.path}</code>
                <p style={{ fontSize: '13px', color: '#666666', margin: '0', textAlign: 'right' }}>{item.desc}</p>
              </div>
            ))}
          </div>
          <p style={{ fontSize: '12px', color: '#666666', marginTop: '1.5rem', fontStyle: 'italic' }}>Old endpoints kept for backward compatibility, deprecated gradually</p>
        </div>
      );
    } else if (slide.type === 'refresh-table') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <table style={{ width: '100%', fontSize: '13px', borderCollapse: 'collapse', marginBottom: '1.5rem' }}>
            <thead>
              <tr style={{ borderBottom: '0.5px solid #E0E0E0' }}>
                <th style={{ textAlign: 'left', padding: '12px 0', fontWeight: '500' }}>Context</th>
                <th style={{ textAlign: 'left', padding: '12px 0', fontWeight: '500' }}>Poll Interval</th>
                <th style={{ textAlign: 'left', padding: '12px 0', fontWeight: '500' }}>Max Duration</th>
              </tr>
            </thead>
            <tbody>
              {slide.items.map((item, i) => (
                <tr key={i} style={{ borderBottom: '0.5px solid #E0E0E0', background: i % 2 === 0 ? '#F5F5F5' : 'transparent' }}>
                  <td style={{ padding: '12px 0' }}>{item.context}</td>
                  <td style={{ padding: '12px 0', color: '#0A7BA7' }}>{item.interval}</td>
                  <td style={{ padding: '12px 0', color: '#666666' }}>{item.duration}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ fontSize: '13px', color: '#666666' }}>On status change: SUCCESS → redirect | FAILED → show error | CANCELLED → home</p>
        </div>
      );
    } else if (slide.type === 'benefits') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.5rem' }}>
            {slide.sections.map((section, i) => (
              <div key={i} style={{ padding: '1.5rem', background: '#F5F5F5', borderRadius: '12px', border: '0.5px solid #E0E0E0' }}>
                <h3 style={{ fontSize: '14px', fontWeight: '500', margin: '0 0 1rem 0', color: '#0A7BA7' }}>{section.title}</h3>
                <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
                  {section.items.map((item, j) => (
                    <li key={j} style={{ padding: '0.5rem 0', color: '#666666', fontSize: '12px' }}>✓ {item}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      );
    } else if (slide.type === 'pros-cons') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '2rem' }}>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 1rem 0', color: '#27AE60' }}>Pros</h3>
              <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
                {slide.pros.map((p, i) => (
                  <li key={i} style={{ padding: '0.5rem 0', color: '#666666', fontSize: '13px' }}>+ {p}</li>
                ))}
              </ul>
            </div>
            <div>
              <h3 style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 1rem 0', color: '#0A7BA7' }}>Cons</h3>
              <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
                {slide.cons.map((c, i) => (
                  <li key={i} style={{ padding: '0.5rem 0', color: '#666666', fontSize: '13px' }}>- {c}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      );
    } else if (slide.type === 'timeline') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1.25rem' }}>
            {slide.phases.map((phase, i) => (
              <div key={i} style={{ padding: '1.25rem', background: '#F5F5F5', borderRadius: '8px', borderLeft: '4px solid #0A7BA7', display: 'grid', gridTemplateColumns: '150px 100px 1fr', gap: '1rem', alignItems: 'start' }}>
                <h4 style={{ margin: '0', fontSize: '13px', fontWeight: '500', color: '#1E2761' }}>{phase.name}</h4>
                <span style={{ fontSize: '12px', color: '#0A7BA7', fontWeight: '500' }}>{phase.weeks}</span>
                <p style={{ margin: '0', fontSize: '13px', color: '#666666' }}>{phase.items}</p>
              </div>
            ))}
          </div>
        </div>
      );
    } else if (slide.type === 'risks') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h2>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '1rem' }}>
            {slide.items.map((item, i) => (
              <div key={i} style={{ padding: '1rem', background: '#F5F5F5', borderRadius: '8px', border: '0.5px solid #E0E0E0', display: 'grid', gridTemplateColumns: '200px 1fr', gap: '1rem' }}>
                <div style={{ fontWeight: '500', color: '#E24B4A', fontSize: '13px' }}>{item.risk}</div>
                <div style={{ color: '#666666', fontSize: '13px' }}>{item.mit}</div>
              </div>
            ))}
          </div>
        </div>
      );
    } else if (slide.type === 'summary') {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h1 style={{ fontSize: '48px', fontWeight: '500', margin: '0 0 2rem 0' }}>{slide.title}</h1>
          <div style={{ marginBottom: '2.5rem' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 1rem 0', color: '#1E2761' }}>3 Problems Solved</h3>
            <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
              {slide.problems.map((p, i) => (
                <li key={i} style={{ padding: '0.5rem 0', color: '#666666', fontSize: '14px' }}>✓ {p}</li>
              ))}
            </ul>
          </div>
          <div style={{ marginBottom: '2.5rem' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '500', margin: '0 0 1rem 0', color: '#1E2761' }}>Design Philosophy</h3>
            <ul style={{ listStyle: 'none', padding: '0', margin: '0' }}>
              {slide.philosophy.map((p, i) => (
                <li key={i} style={{ padding: '0.5rem 0', color: '#666666', fontSize: '14px' }}>• {p}</li>
              ))}
            </ul>
          </div>
          <div style={{ padding: '2rem', background: '#F5F5F5', borderRadius: '12px', border: '0.5px solid #E0E0E0', textAlign: 'center' }}>
            <p style={{ fontSize: '16px', fontWeight: '500', color: '#0A7BA7', margin: '0' }}>{slide.closing}</p>
          </div>
        </div>
      );
    } else {
      return (
        <div style={{ animation: 'slideIn 0.8s ease-out' }}>
          <h2 style={{ fontSize: '32px', fontWeight: '500', margin: '0 0 1.5rem 0' }}>{slide.title}</h2>
          <div style={{ padding: '1.5rem', background: '#F5F5F5', borderRadius: '12px', border: '0.5px solid #E0E0E0', fontSize: '14px', color: '#666666', whiteSpace: 'pre-wrap', lineHeight: '1.8' }}>{slide.content}</div>
        </div>
      );
    }
  };

  return (
    <div style={{ display: 'flex', height: '100vh', background: 'white', fontFamily: 'system-ui, -apple-system, sans-serif' }}>
      <style>{`
        @keyframes slideIn {
          from {
            opacity: 0;
            transform: translateY(10px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }
      `}</style>
      
      {/* Sidebar */}
      <div style={{ width: '280px', background: '#F5F5F5', borderRight: '0.5px solid #E0E0E0', padding: '2rem 0', overflowY: 'auto', position: 'fixed', height: '100vh', left: '0', top: '0' }}>
        <div style={{ padding: '0 1.5rem', marginBottom: '2rem' }}>
          <h1 style={{ fontSize: '20px', fontWeight: '500', margin: '0', color: '#1E2761' }}>Payment System</h1>
          <p style={{ fontSize: '12px', color: '#999', margin: '0.5rem 0 0 0' }}>Redesign 2026</p>
        </div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {slides.map((s, i) => (
            <button
              key={i}
              onClick={() => setCurrentSlide(i)}
              style={{
                padding: '0.75rem 1.5rem',
                background: i === currentSlide ? 'white' : 'none',
                border: 'none',
                textAlign: 'left',
                cursor: 'pointer',
                fontSize: '13px',
                color: i === currentSlide ? '#0A7BA7' : '#999',
                borderRadius: '4px',
                transition: 'all 0.2s',
                fontWeight: i === currentSlide ? '500' : '400'
              }}
            >
              {s.title}
            </button>
          ))}
        </nav>
      </div>

      {/* Main Content */}
      <div style={{ marginLeft: '280px', flex: '1', overflowY: 'auto', padding: '3rem 4rem' }}>
        <div style={{ maxWidth: '900px' }}>
          <SlideContent />
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: '4rem', paddingTop: '2rem', borderTop: '0.5px solid #E0E0E0' }}>
            <button onClick={() => setCurrentSlide(Math.max(0, currentSlide - 1))} style={{ padding: '0.75rem 1.5rem', background: 'white', border: '0.5px solid #E0E0E0', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', color: '#1E2761' }}>← Previous</button>
            <span style={{ fontSize: '13px', color: '#999' }}>{currentSlide + 1} / {slides.length}</span>
            <button onClick={() => setCurrentSlide(Math.min(slides.length - 1, currentSlide + 1))} style={{ padding: '0.75rem 1.5rem', background: '#0A7BA7', border: 'none', borderRadius: '8px', cursor: 'pointer', fontSize: '14px', fontWeight: '500', color: 'white' }}>Next →</button>
          </div>
        </div>
      </div>
    </div>
  );
}
