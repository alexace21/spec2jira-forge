# E-Commerce Checkout & Payment Processing System

## Feature Overview

The Checkout & Payment Processing System handles the complete purchase flow from shopping cart through payment authorization, order confirmation, and post-purchase actions. The system integrates with multiple payment providers, supports regional tax calculation, handles inventory reservation during checkout, and provides a seamless user experience optimized for conversion.

## Business Value

Current checkout abandonment rate is 68%, with the top causes being unexpected shipping costs (shown too late), limited payment options, and a 5-step checkout process that loses users at each step. The new system targets a reduction to 45% abandonment through a streamlined single-page checkout, transparent pricing from cart onward, and support for 6+ payment methods including Buy Now Pay Later (BNPL).

Revenue impact: A 23% reduction in abandonment on current traffic (~50,000 monthly checkout initiations) translates to approximately €180,000 additional monthly revenue at €35 average order value.

## User Personas

| Persona | Description | Key Needs | Payment Preference |
|---------|-------------|-----------|-------------------|
| Quick Buyer | Returning customer, stored payment | One-click purchase, saved addresses | Stored credit card |
| New Customer | First-time buyer, price-sensitive | Guest checkout, no forced registration | Credit card, PayPal |
| B2B Purchaser | Business account, needs invoice | PO number field, VAT invoice, Net-30 | Bank transfer, invoice |
| Mobile Shopper | Browsing on phone, wants speed | Apple Pay / Google Pay, minimal typing | Mobile wallets |
| BNPL User | Younger demographic, budget-conscious | Split payment visibility, no interest | Klarna, Afterpay |

## Process Overview

### Cart Review & Pre-Checkout

When the user navigates to checkout, the system first validates the current cart state:

1. **Inventory Check:** Each item is verified against real-time stock levels. If an item has become unavailable or quantity reduced since being added to cart, the user is notified with options to adjust quantity, remove item, or join waitlist.

2. **Price Verification:** Current prices are confirmed. If any item price has changed since being added to cart, the user sees both the original and current price with a clear explanation.

3. **Shipping Estimation:** Based on the user's detected location (IP geolocation for anonymous users, saved address for logged-in users), shipping options and costs are calculated and displayed before entering checkout.

4. **Cart Summary:** Displays itemized list with product image thumbnails, unit prices, quantities, subtotal, estimated tax, shipping cost, and order total. Promo code input is visible at this stage.

### Single-Page Checkout

The checkout is presented as a single scrollable page with four sections that expand/collapse as the user progresses. All sections remain editable at any time.

**Section 1 — Contact Information:**
- Email address (pre-filled for logged-in users)
- Phone number (required for shipping notifications)
- Option to create account or continue as guest
- For returning users: "Welcome back" with pre-filled details

**Section 2 — Shipping Address:**
- Address autocomplete powered by Google Places API
- Saved addresses dropdown for returning users
- "Same as billing" checkbox (default: checked)
- Address validation against postal service database
- International address format adaptation per country

**Section 3 — Shipping Method:**
- Available methods based on destination and cart contents
- Standard (3-5 business days), Express (1-2 business days), Same-Day (if available in region)
- Real-time carrier rate calculation (DHL, FedEx, local providers)
- Free shipping threshold indicator ("Add €12 more for free shipping")
- Pickup from store option (if applicable)

**Section 4 — Payment:**
- Payment method selection with icons:
  - Credit/Debit Card (Visa, Mastercard, Amex)
  - PayPal
  - Apple Pay / Google Pay (detected automatically based on device)
  - Klarna / Afterpay (BNPL with installment preview)
  - Bank Transfer (B2B only)
  - Invoice / Net-30 (B2B approved accounts only)
- Card payment via Stripe Elements (PCI-compliant embedded form)
- "Save payment method for future purchases" checkbox
- Billing address (auto-filled from shipping if checkbox checked)

**Order Summary Sidebar (always visible):**
- Collapsible item list with thumbnails
- Promo/coupon code application with real-time total recalculation
- Subtotal, shipping, tax breakdown, discounts, and total
- Trust badges: SSL secure, money-back guarantee, supported payment icons

### Payment Processing Flow

When the user clicks "Place Order":

1. **Frontend Validation:** All required fields complete, email format valid, card details pass Luhn check
2. **Inventory Lock:** 10-minute reservation placed on all cart items to prevent overselling
3. **Fraud Check:** Order details sent to fraud detection service (Stripe Radar) for risk scoring
4. **Tax Calculation:** Final tax computed via TaxJar/Avalara based on confirmed shipping address
5. **Payment Authorization:** Payment intent created with payment provider
   - For cards: 3D Secure challenge if required by issuing bank
   - For PayPal: Redirect to PayPal, return with token
   - For BNPL: Redirect to Klarna/Afterpay, return with approval
   - For Apple Pay/Google Pay: Native payment sheet, token returned
6. **Order Creation:** If payment authorized:
   - Order record created with status "Confirmed"
   - Inventory decremented from stock
   - Payment captured (immediate for digital goods, delayed for physical until shipment)
7. **Post-Order Actions:**
   - Confirmation email sent with order details and tracking setup
   - Warehouse notified for fulfillment (via Kafka event)
   - Analytics event fired (conversion tracking, revenue attribution)
   - Loyalty points credited (if loyalty program member)

### Error Handling & Edge Cases

| Scenario | System Behavior | User Experience |
|----------|----------------|-----------------|
| Payment declined | Release inventory lock, log failure reason | "Payment was declined. Please try another method." with option to retry |
| 3D Secure failed | Transaction cancelled, no charge | "Authentication failed. Please contact your bank or try another card." |
| Item out of stock during checkout | Remove item, recalculate total | "Sorry, [item] sold out while you were checking out." with option to continue without it |
| Session timeout (30 min) | Cart preserved, checkout state saved | "Your session expired. We saved your cart." with one-click restore |
| Duplicate submission | Idempotency key prevents double charge | Loading spinner, redirect to confirmation if order exists |
| Network error during payment | Pending transaction check on retry | "We're checking your payment status..." with auto-retry |
| Price changed during checkout | Show notification, require acceptance | "Price updated for [item]. New total: €X. Continue?" |
| Promo code expired | Remove discount, recalculate | "This promo code has expired. Updated total: €X" |

### Post-Purchase Experience

**Order Confirmation Page:**
- Order number with copy button
- Itemized receipt
- Expected delivery date
- Track order button (links to carrier tracking when available)
- "Continue shopping" and "Download receipt" actions
- Cross-sell recommendations based on purchase

**Confirmation Email:**
- Branded HTML email with order details
- Delivery timeline
- Return policy summary
- Customer support contact
- Tracking link (sent separately when shipment created)

## Functional Requirements

### Tax Calculation

Tax is calculated dynamically based on:
- Shipping destination (country, state/province, city for US)
- Product tax category (standard goods, digital goods, food, exempt)
- Customer tax status (B2C standard, B2B with valid VAT = reverse charge)
- Marketplace rules (e.g., EU OSS thresholds for cross-border B2C)

Tax breakdown is displayed transparently: subtotal → shipping → tax (with rate and jurisdiction) → total.

For EU B2B transactions: customer enters VAT number, system validates via VIES API, and applies reverse charge mechanism (0% VAT with note on invoice).

### Promo Code System

- Single-use and multi-use codes supported
- Discount types: percentage (e.g., 15% off), fixed amount (e.g., €10 off), free shipping
- Conditions: minimum order value, specific products/categories, first-time buyers only, date range validity
- Stacking rules: configurable whether multiple codes can be combined (default: no)
- Real-time validation and total recalculation on code entry
- Usage tracking: who used which code, when, order value

### Guest Checkout

Guest users can complete purchase without creating an account. After purchase, they receive a post-purchase email offering account creation with their order automatically linked. Guest order lookup available via email + order number combination.

### B2B Checkout Extensions

For authenticated B2B accounts:
- Purchase order number field (optional or required per account setting)
- Payment terms display (e.g., Net-30, Net-60)
- VAT invoice generation with company details
- Approval workflow: orders above account spending limit require manager approval before processing
- Credit limit check: order total validated against remaining credit

## Acceptance Criteria

1. User can complete checkout from cart to confirmation in under 60 seconds (returning customer with saved details)
2. Guest checkout requires no account creation and captures only email, shipping address, and payment
3. Inventory is reserved for 10 minutes from checkout initiation; reservation released if not completed
4. All payment methods display correct icons and only show available options based on device, region, and account type
5. 3D Secure challenge is handled without leaving the checkout page (iframe/modal)
6. Tax calculation displays correct rates based on destination before final submission
7. Failed payment does not create an order; user can retry without re-entering details
8. Confirmation email is sent within 2 minutes of successful order placement
9. Promo code validation returns result within 500ms with clear success/error messaging
10. B2B customers see PO number field and Net-30 option only when their account is approved for these features
11. Cart is preserved for 30 days for logged-in users and 7 days for guest sessions (cookie-based)
12. Checkout page loads in under 2 seconds on 4G mobile connection
13. All payment transactions are PCI DSS compliant with no card data touching our servers

## Dependencies

- Stripe API (card payments, Apple Pay, Google Pay)
- PayPal Commerce Platform API
- Klarna Payments API / Afterpay API
- TaxJar or Avalara (tax calculation)
- Google Places API (address autocomplete)
- VIES API (EU VAT validation)
- DHL / FedEx shipping rate APIs
- Kafka (event publishing for fulfillment, analytics)
- Redis (cart sessions, inventory locks)
- PostgreSQL (orders, payments, customers)

## Out of Scope

- Cryptocurrency payments (Phase 3)
- Subscription/recurring billing (separate feature)
- Marketplace multi-vendor split payments (Phase 2)
- Gift cards and store credit (Phase 2)
- Localized checkout for non-English languages (Phase 2)

## Technical Considerations

Payment integration must use Stripe Elements for PCI compliance — card data never touches our servers. Implement idempotency keys on all payment endpoints to prevent double charges. Inventory locks should use Redis with TTL for automatic expiration. Checkout state should be persisted server-side (not just in browser) to survive page refreshes. Consider implementing checkout session tokens that allow resuming interrupted checkouts. WebSocket connection for real-time price/stock updates during checkout. All amounts stored and calculated in smallest currency unit (cents) to avoid floating point errors. Multi-currency: prices stored in base currency (EUR), converted at display time using daily ECB exchange rates.
