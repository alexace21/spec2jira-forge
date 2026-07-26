---
title: "DRAFT — Corrected pricing copy for spec2jira.com"
purpose: "Paste-ready replacement copy for the live pricing page (and every other page that repeats a price), correcting the flat-$67 claim to the portal-verified free-≤10 / per-user-declining-curve model."
visibility: internal (draft for founder review)
status: "⚠ SUPERSEDED 2026-07-25 — this draft has been APPLIED. The corrected copy is already in the site repo's working tree (pricing/, index.html, docs/, how-it-works/ — uncommitted, unpushed; the founder reviews `git diff` and pushes). THE APPLIED HTML IS NOW THE SOURCE OF TRUTH, NOT THIS FILE. Keep this document for its reasoning, the option analysis and the open questions — but do NOT paste from its code blocks: some of them still carry the fused '11–100' band label that the applied HTML corrects (a site enters the 1–100 band at its 11th user, but the rate is charged from the FIRST user, so 100 × $6.70 = $670; '11–100 → $670' is arithmetically false, 90 × $6.70 = $603). Two sources of the same copy is the drift this KB exists to prevent — the applied file wins."
model_source: "AUTHORITY — the Atlassian partner-portal 'Set pricing' screen, founder screenshot, 2026-07-24, PORTAL-VERIFIED. Supersedes src/usage.js, docs/MARKETPLACE-LISTING-v3.md, the live site, and every memory file."
supersedes: "The provisional model recorded earlier on 2026-07-24 ('101+ = $5.70/user'). That figure was WRONG — $5.70 is the multi-instance price of the 251–1000 band, misread across columns. The real single-instance rate above 100 users is $5.10."
target_files:
  - C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site/pricing/index.html  (primary)
  - .../index.html (landing — JSON-LD offers)
  - .../docs/index.html (pricing table + footnote)
sources_read:
  - Vendor-portal "Set pricing" screen, founder screenshot (2026-07-24) — the tier table in Section 0
  - spec2jira-site/pricing/index.html (read 2026-07-25)
  - spec2jira-site/index.html, docs/index.html, how-it-works/index.html, about/index.html, get-api-key/index.html, privacy/index.html (grepped 2026-07-25)
  - docs/marketing-kb/02-business-model-pricing.md §3a (already reconciled to the verified table) · 13-claims-register.md
last_updated: 2026-07-25
---

# Corrected pricing copy — spec2jira.com

> **Scope of this document.** Section 0 = the verified tier table this copy is built on. Section 1 = what
> is wrong on the live site today. Section 2 = the corrected copy, block by block, ready to paste.
> Section 3 = welcome-credit copy, written but **on HOLD**. Section 4 = every other page that repeats a
> price. Section 5 = the three things the founder still decides.
>
> **Two things to know before reading the paste blocks:**
>
> 1. **The tier table is now portal-verified, so there is ONE canonical copy set.** The earlier
>    Variant A / Variant B split existed only because the band boundary was a guess. The boundary is
>    confirmed (100 users) and so is every rate below it — the blocks in Section 2 are the copy, and the
>    only remaining choices are presentational (Section 5).
> 2. **The JSON-LD FAQ schema duplicates the visible FAQ text.** `pricing/index.html` carries the same
>    Q&As twice — once in `<script type="application/ld+json">` (lines 27–74) and once in the visible
>    `<details class="faq-item">` blocks (lines 189–217). **Every FAQ change must be made in BOTH places,
>    and the two must match word for word.** Google's FAQ structured-data policy requires the marked-up
>    answer to be the answer visible on the page; a mismatch is both a rich-result violation and — with a
>    price in it — a published price we are not actually charging. The landing page has the same trap in a
>    different shape: a `SoftwareApplication` → `offers` block (index.html lines 58–75) that hard-codes
>    `"price": "67"`.

---

## 0. The verified tier table — the authority for every number below

Source: the Atlassian partner-portal **"Set pricing"** screen, founder screenshot, **2026-07-24**.

**Single-instance pricing** — the normal case, one Confluence site. Every tier gets the same everything:
breakdown generation, review editor, push to Jira, Project Context, AI test-case generation, sprint
planning. No feature gates, no usage cap.

| User tier | Price per user / month | Max total for the band |
|---|---|---|
| **Up to 10 (flat)** | **FREE** | **$0** |
| **1–100** — entered at the **11th** user, charged from the **first** | **$6.70** | up to **$670** (= 100 × $6.70) |
| **101–250** | **$5.10** | up to **$1,435** |
| **251–1000** | **$3.80** | up to **$4,285** |
| **1001–2500** | **$3.50** | up to **$9,535** |
| 2501–7500 | $3.25 | up to $25,785 |
| 7501–10000 | $2.85 | up to $32,910 |
| 10001–15000 | $2.65 | up to $46,160 |
| 15001–20000 | $2.40 | — |
| 20001–25000 | $2.20 | — |
| 25001–30000 | $2.00 | — |
| 30001–35000 | $1.60 | — |
| 35001–40000 | $1.45 | — |
| 40001–45000 | $1.35 | — |
| 45001+ | $1.15 | — |

**Multi-instance pricing** (a customer licensing several Confluence sites) = **1.5× the single-instance
rate**: $10.05 (1–100) · $7.65 (101–250) · $5.70 (251–1000) · and so on down the same curve.

**Three reading notes that keep the copy honest:**

- **Keep the threshold and the band label separate — fusing them is the defect.** The **"Up to 10" row is
  a FLAT-RATE OVERRIDE**: a site whose whole Confluence instance has 10 users or fewer pays **$0**. From
  the **11th** user the bands take over, and the first band is labelled **1–100** — the rate is charged
  from the **FIRST** user on the site, not the eleventh. So a 100-user site is **100 × $6.70 = $670**,
  exactly the portal's maximum for that band. ⛔ Never write "11–100 at $6.70 → up to $670": 90 × $6.70
  = $603, which contradicts the portal. Say **"from 11 users"** for the threshold and **"1–100"** for
  the band — never one phrase carrying both.
- **Never multiply a band rate by the full headcount above 100.** The "Max total" column reconciles as a
  **graduated** curve — each band's rate applies to the users *in that band*, cumulatively
  ($670 + 150 × $5.10 = $1,435; $1,435 + 750 × $3.80 = $4,285). A 250-user instance is **up to $1,435**,
  not 250 × $5.10. This is why every published figure in Section 2 is phrased as **"up to"** and every
  block ends with *"the Marketplace shows the exact price for your team size."*
- **"$5.70 for 101+ users" is never correct.** It was this morning's provisional figure, recorded before
  the portal was seen; $5.70 is the **multi-instance** rate of the **251–1000** band, misread across
  columns. The real single-instance rate above 100 users is **$5.10**. Correct it wherever it survives.

**The single most quotable consequence:** a 100-user instance is **up to $670/month — not "$67 flat."**

---

## 1. What is wrong today

The live pricing page tells prospects the price for an 11+ user instance is **a flat $67/month for the
whole site**. Under the verified model it is **per user above 10, on a declining curve**. These are the
exact sentences that must change:

| Where | Exact current wording |
|---|---|
| `pricing/index.html` L7 / L18 / L25 (meta, og, twitter descriptions) | "Spec2Tickets pricing: free for teams up to 10 users, **then a flat $67/month** via the Atlassian Marketplace." |
| `pricing/index.html` L45 (JSON-LD FAQ) | "Teams of up to 10 users pay nothing. **From 11 users the price is a flat $67/month for the whole site — not per user.**" |
| `pricing/index.html` L53 (JSON-LD FAQ) | "Larger teams get the Atlassian Marketplace's standard 30-day free trial **before the flat subscription starts**." |
| `pricing/index.html` L109 (H1) | "**Simple, flat pricing**" |
| `pricing/index.html` L110 (lead) | "Free for teams up to 10 users. **One flat price after that.**" |
| `pricing/index.html` L136–138 (plan card) | "BYOK Pro **&lt;span class="plan-pill"&gt;Flat price&lt;/span&gt;**" · "**$67** / month flat — teams of 11+" · "Everything, unlimited, for the whole site — **one flat price, no per-user math.**" |
| `pricing/index.html` L195 (visible FAQ) | identical duplicate of L45 |
| `pricing/index.html` L199 (visible FAQ) | identical duplicate of L53 |
| `index.html` L70–72 (landing JSON-LD offer) | `"price": "67"` · "**Flat price per month** for teams of 11+ users, billed via the Atlassian Marketplace." |
| `docs/index.html` L213 (pricing table row) | "BYOK Pro · **$67 / month flat** · teams of 11+*" |
| `docs/index.html` L217 (footnote) | "from 11 users it is a **flat $67/month for the whole site — not per user**" |

### Why this is dangerous, not just stale

**It understates a 100-user instance by roughly 10× — and the gap keeps widening above that.** Figures
below are from the verified portal table in Section 0, not arithmetic on a guess:

| Confluence instance size | What the site promises today | Portal-verified reality | Understated by |
|---|---|---|---|
| 10 users | $0 | **$0** — correct | — |
| 25 users | $67/month | up to **~$168**/month | ~2.5× |
| 50 users | $67/month | up to **~$335**/month | ~5× |
| **100 users** | **$67/month** | **up to $670/month** | **~10×** |
| 250 users | $67/month | up to **$1,435**/month | ~21× |
| 1,000 users | $67/month | up to **$4,285**/month | ~64× |

Three compounding problems:

1. **"Not per user" is the exact opposite of how we are billed.** "Paid via Atlassian" licenses the
   **whole Confluence instance** — every user on the site counts toward the tier, not only the people who
   open Spec2Tickets. So the sentence that reassures the buyer most ("flat, for the whole site") is
   precisely the sentence that will be contradicted at checkout, in the worst possible place: the moment
   they reach for a card.
2. **The gap is largest exactly where our best buyers live.** A 10-user shop sees $0 either way. The
   50–250-user product org — our ICP — is being quoted between a fifth and a twentieth of the real
   number. The flat claim is not "a bit off"; it is most wrong where it matters most.
3. **It is published as machine-readable structured data.** `"price": "67"` in the landing page's
   `SoftwareApplication` offer and the `$67` inside the FAQ schema are consumed by search engines and AI
   assistants and can be re-surfaced as "Spec2Tickets costs $67/month" long after the HTML is fixed.
   Correcting the visible copy alone leaves the wrong number machine-readable.

There is a second, quieter error in the same family: the pricing page's own comment block records the
pivot as "free ≤10 users / $67 month flat" (L160–162). Leaving it in place invites the next editor to
restore the wrong model. Replace the comment when you replace the copy.

**And do not swap in any of the retired numbers either.** Two traps:

- **"$6.70/user with a $57 flat charge for teams up to 10"** — the ≤10 tier is **free**, not $57.
- **"$5.70 per user from 101 users"** — this morning's provisional figure, and the more dangerous of the
  two because it *looks* like the new model. $5.70 is the **multi-instance** rate of the **251–1000**
  band. The single-instance rate above 100 users is **$5.10**.

---

## 2. Corrected copy — block by block

All blocks below are written for `pricing/index.html` unless stated. They reuse only CSS classes that
already exist in `assets/css/site.css` (`.plan`, `.plan-pill`, `.price`, `.per`, `.plan-desc`,
`.plan-features`, `.plan-foot`, `.grid-2`, `.table-wrap`, `.table`, `.measure`, `.muted`, `.faq-item`,
`.faq-body`) — **no stylesheet change is required.**

Two blocks are marked **[FOUNDER CHOICE]**: the optional full-curve `<details>` (Section 5, question **a**)
and the multi-instance line and FAQ (question **b**). Everything else is final.

---

### 2.1 Head — title, meta description, og:description, twitter:description

Replace the description string in **all three** places (L7, L18, L25). The `<title>` (L6) stays as is.
Search engines truncate around 155 characters, so the first sentence carries the message.

```html
<meta name="description" content="Spec2Tickets pricing: free for teams of up to 10 users — every feature, no time limit. From 11 users, $6.70 per user per month, with lower rates as your instance grows. Billed through the Atlassian Marketplace; AI usage runs on your own Anthropic key at cost.">
```

```html
<meta property="og:description" content="Spec2Tickets pricing: free for teams of up to 10 users — every feature, no time limit. From 11 users, $6.70 per user per month, with lower rates as your instance grows. Billed through the Atlassian Marketplace; AI usage runs on your own Anthropic key at cost.">
```

```html
<meta name="twitter:description" content="Spec2Tickets pricing: free for teams of up to 10 users — every feature, no time limit. From 11 users, $6.70 per user per month, with lower rates as your instance grows. Billed through the Atlassian Marketplace; AI usage runs on your own Anthropic key at cost.">
```

---

### 2.2 Page header — H1 + lead (L107–111)

```html
    <div class="section-head center">
      <span class="eyebrow">Pricing</span>
      <h1>Free for small teams. Per user as you grow.</h1>
      <p class="lead mt-3">Every feature, unlimited, free for teams of up to 10 users — no time limit, no feature gates. From 11 users it is priced per user through the Atlassian Marketplace, starting at $6.70 per user per month and falling as your instance grows. AI usage always runs on your own Anthropic key, billed by Anthropic at cost.</p>
    </div>
```

Alternate H1s in the same voice, if "Per user as you grow" reads too transactional:

- "Free up to 10 users. Honest pricing after that."
- "Start free. Pay only when your instance grows."

Retire "Simple, flat pricing" and **every other use of the word *flat*** on this page.

---

### 2.3 Plan cards (L118–176)

Keeps the existing `grid grid-2`.

```html
    <div class="grid grid-2">

      <!-- Free — up to 10 users -->
      <div class="plan reveal">
        <div class="plan-name">Free <span class="plan-pill">Teams up to 10</span></div>
        <div class="price">$0 <span class="per">/ month — up to 10 users</span></div>
        <p class="plan-desc">The <strong>complete product</strong>, free for small teams. No time limit, no feature gates, no credit card.</p>
        <ul class="plan-features">
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Unlimited breakdowns — generate, review, push to Jira</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>AI-generated acceptance test cases (BA-grade Gherkin / CSV)</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Sprint planning</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Your own Anthropic key — AI usage at cost, no markup</li>
        </ul>
        <p class="plan-foot">Provided through the Atlassian Marketplace.</p>
      </div>

      <!-- BYOK Pro — per user above 10, featured -->
      <div class="plan plan-featured reveal delay-1">
        <div class="plan-name">BYOK Pro <span class="plan-pill">Teams of 11+</span></div>
        <div class="price">$6.70 <span class="per">/ user / month — from 11 users</span></div>
        <p class="plan-desc"><strong>The same complete product, unlimited</strong> — priced per user on your Confluence site, on a declining curve: $6.70 per user up to 100 users, $5.10 above 100, $3.80 above 250, and lower again at larger sizes.</p>
        <ul class="plan-features">
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Unlimited breakdowns — generate, review, push to Jira</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>AI-generated acceptance test cases (BA-grade Gherkin / CSV)</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Sprint planning</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>Your own Anthropic key — AI usage at cost, no markup</li>
          <li><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>30-day free trial through the Atlassian Marketplace</li>
        </ul>
        <p class="plan-foot">Billed via the Atlassian Marketplace, in USD. The subscription covers your whole Confluence instance — the Marketplace shows your exact price before you subscribe.</p>
      </div>

    </div>
```

#### The band table — goes directly under the grid

This is the block that replaces the destroyed honesty of "$67 flat". It is scannable in three seconds and
it says the thing the current page hides: **a 100-user site is up to $670 a month.**

```html
    <div class="measure mx-auto mt-4">
      <div class="table-wrap">
        <table class="table">
          <thead>
            <tr>
              <th scope="col">Users on your Confluence site</th>
              <th scope="col">Per user / month</th>
              <th scope="col">Most you would pay</th>
            </tr>
          </thead>
          <tbody>
            <tr><td><strong>Up to 10</strong></td><td><strong>Free</strong> — every feature, no time limit</td><td><strong>$0</strong></td></tr>
            <tr><td>11–100</td><td>$6.70</td><td>up to $670 / month</td></tr>
            <tr><td>101–250</td><td>$5.10</td><td>up to $1,435 / month</td></tr>
            <tr><td>251–1,000</td><td>$3.80</td><td>up to $4,285 / month</td></tr>
            <tr><td>1,001 and above</td><td>$3.50, and lower again at larger sizes</td><td>shown before you subscribe</td></tr>
          </tbody>
        </table>
      </div>
      <p class="muted mt-3"><small>Prices in USD, billed through the Atlassian Marketplace. Each band's rate applies to the users in that band, so the totals above are the most you would pay at the top of each one. “Paid via Atlassian” licenses your whole Confluence instance, so the tier is set by the number of users on your Atlassian site — not only the people who use Spec2Tickets. The Marketplace shows the exact price for your team size before you subscribe.</small></p>
    </div>
```

#### [FOUNDER CHOICE a] Optional — the full curve, folded away

If you want the whole curve on the page without crowding it, add this immediately after the table. It
reuses the FAQ `<details>` pattern the page already uses, so it costs nothing visually until a large-instance
buyer opens it. **Omit the whole block if you prefer to show only the entry rate** — the four bands above
plus "lower again at larger sizes" is already honest without it.

```html
      <details class="faq-item mt-3">
        <summary>See the full price curve</summary>
        <div class="faq-body">
          <div class="table-wrap">
            <table class="table">
              <thead><tr><th scope="col">Users</th><th scope="col">Per user / month</th></tr></thead>
              <tbody>
                <tr><td>Up to 10</td><td>Free</td></tr>
                <tr><td>11–100</td><td>$6.70</td></tr>
                <tr><td>101–250</td><td>$5.10</td></tr>
                <tr><td>251–1,000</td><td>$3.80</td></tr>
                <tr><td>1,001–2,500</td><td>$3.50</td></tr>
                <tr><td>2,501–7,500</td><td>$3.25</td></tr>
                <tr><td>7,501–10,000</td><td>$2.85</td></tr>
                <tr><td>10,001–15,000</td><td>$2.65</td></tr>
                <tr><td>15,001–20,000</td><td>$2.40</td></tr>
                <tr><td>20,001–25,000</td><td>$2.20</td></tr>
                <tr><td>25,001–30,000</td><td>$2.00</td></tr>
                <tr><td>30,001–35,000</td><td>$1.60</td></tr>
                <tr><td>35,001–40,000</td><td>$1.45</td></tr>
                <tr><td>40,001–45,000</td><td>$1.35</td></tr>
                <tr><td>45,001 and above</td><td>$1.15</td></tr>
              </tbody>
            </table>
          </div>
          <p class="muted mt-3"><small>Set by Atlassian, in USD. The Marketplace shows the exact price for your team size before you subscribe.</small></p>
        </div>
      </details>
```

#### [FOUNDER CHOICE b] Optional — the multi-instance line

If the 1.5× rate is shown on the page, the lightest honest place is one clause in the table footnote
above. Insert it before the final sentence:

```html
Customers licensing Spec2Tickets across several Confluence instances pay Atlassian's standard multi-instance rate of 1.5× these prices.
```

The heavier option is a dedicated FAQ entry — drafted in §2.4 and §2.5, marked with the same tag. See
Section 5 for the recommendation.

#### Also in this section: replace the stale pivot comment (L160–162)

```html
      <!-- PRICING MODEL (portal-verified 2026-07-24): free for teams of 1-10 users (full product, no
       time limit); per-user pricing from 11 users on a declining curve — $6.70/user to 100 users,
       $5.10 above 100, $3.80 above 250, and lower again at larger sizes; 1.5x for multi-instance.
       The earlier "$67/month flat for the whole site" framing was WRONG — Paid via Atlassian bills
       per user across the whole Confluence instance — and was corrected on this date. A short-lived
       provisional "$5.70 above 100 users" figure was also wrong ($5.70 is the multi-instance rate of
       the 251-1000 band). Do not reintroduce a flat site price, and do not restore $5.70.
       The Advanced and Managed Pro cards remain preserved (commented) below. -->
```

*(The two existing commented-out cards — Managed Pro L152–158 and Advanced L163–174 — stay commented out
and untouched.)*

---

### 2.4 "How billing works" FAQ — visible copy (L188–220)

**Whatever you paste here must be mirrored word-for-word into the JSON-LD in §2.5.**

Unchanged: **"What does the subscription cover?"**, **"What does the AI cost?"**, **"What happened to the
Advanced edition?"**, **"How do I manage or cancel my subscription?"** — they carry no price claim.
Rewritten: the two price Q&As. New: one Q&A that explains whole-instance licensing before the buyer
discovers it at checkout, and one optional multi-instance Q&A.

```html
    <div class="measure mx-auto">
      <details class="faq-item">
        <summary>What does the subscription cover?</summary>
        <div class="faq-body">Everything the app does — breakdown generation, the review editor, the push to Jira, <strong>AI-generated acceptance test cases</strong>, and <strong>sprint planning</strong>. Every feature is included for every team size, unlimited. The AI compute is paid separately, directly to Anthropic, using your own API key (typically a few cents per breakdown). There is no vendor markup on AI.</div>
      </details>
      <details class="faq-item">
        <summary>How is the price calculated?</summary>
        <div class="faq-body">Spec2Tickets is sold as “Paid via Atlassian,” billed through the Atlassian Marketplace, in USD. Teams of up to 10 users pay <strong>nothing</strong> — the full product, with no time limit. From 11 users it is priced <strong>per user, per month</strong>, on a declining curve: $6.70 per user up to 100 users, $5.10 above 100, $3.80 above 250, and lower again at larger sizes. It is <strong>not a flat site price</strong> — a 100-user Confluence site is up to $670 a month. The Marketplace always shows the exact price for your team size before you subscribe.</div>
      </details>
      <details class="faq-item">
        <summary>Why is my price based on my whole Confluence site?</summary>
        <div class="faq-body">Because that is how Atlassian licenses cloud apps. “Paid via Atlassian” covers your <strong>entire Confluence instance</strong> — the price tier is set by the number of users on your Atlassian site, not by how many of them open Spec2Tickets. It is Atlassian's model rather than ours, and it cuts both ways: everyone on your site can use the app, at no extra charge per person added to the tool. The exact figure for your site size is shown in the Marketplace before you subscribe.</div>
      </details>
      <details class="faq-item">
        <summary>Is there a free plan?</summary>
        <div class="faq-body">Yes — Spec2Tickets is <strong>free for teams of up to 10 users</strong>, with every feature included and no time limit. It is a real free plan, not a trial: unlimited breakdowns, test-case generation, and sprint planning, on your own Anthropic key. Teams of 11 or more get the Atlassian Marketplace's standard 30-day free trial before the subscription starts.</div>
      </details>
      <!-- [FOUNDER CHOICE b] include this entry and its JSON-LD twin together, or omit both -->
      <details class="faq-item">
        <summary>What if we run more than one Confluence site?</summary>
        <div class="faq-body">The prices above are for a single Confluence instance. If you license Spec2Tickets across several instances, Atlassian applies its standard <strong>multi-instance rate of 1.5×</strong> the single-instance price. The Marketplace shows the exact figure for your setup before you subscribe.</div>
      </details>
      <details class="faq-item">
        <summary>What does the AI cost?</summary>
        <div class="faq-body">Whatever Anthropic charges you — nothing more. Every plan is Bring Your Own Key: you add your own Anthropic API key, so AI usage is billed to your Anthropic account directly, typically a few cents per breakdown, with <strong>no vendor markup</strong>. The Marketplace subscription covers the app itself.</div>
      </details>
      <details class="faq-item">
        <summary>What happened to the Advanced edition?</summary>
        <div class="faq-body">It has been folded into BYOK Pro. <strong>AI-generated acceptance test cases</strong> — BA-grade Gherkin and CSV, ready to import into your test tools — were previously planned as a separate Advanced edition and are now part of the standard product, along with sprint planning, at no extra cost. Everything runs on <strong>your own Anthropic key</strong>, so your content stays under your own Anthropic agreement.</div>
      </details>
      <details class="faq-item">
        <summary>How do I manage or cancel my subscription?</summary>
        <div class="faq-body">Subscriptions are handled through the Atlassian Marketplace and your Atlassian site administration, alongside your other Atlassian apps.</div>
      </details>

      <p class="muted text-center mt-4"><small>Prices are in USD and set through the Atlassian Marketplace, which shows the exact price for your team size before you subscribe. Every plan is BYOK — AI usage runs on your own Anthropic key and is billed by Anthropic at cost. Early-access pricing — we grandfather early adopters as the product grows.</small></p>
    </div>
```

*Keep the "Marketplace always shows the exact price" sentence in every block that names a number. It is
the one line that stays true whatever the portal is configured to charge tomorrow.*

---

### 2.5 JSON-LD FAQ schema (L27–74) — must mirror §2.4 exactly

Replace the whole `mainEntity` array. Note the two new entries and the removed word *flat*. Text is
byte-identical to the visible answers above, minus the HTML tags. **If you omit the multi-instance entry
in §2.4, omit it here too** — the two must stay identical.

```html
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "FAQPage",
  "mainEntity": [
    {
      "@type": "Question",
      "name": "What does the subscription cover?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Everything the app does — breakdown generation, the review editor, the push to Jira, AI-generated acceptance test cases, and sprint planning. Every feature is included for every team size, unlimited. The AI compute is paid separately, directly to Anthropic, using your own API key (typically a few cents per breakdown). There is no vendor markup on AI."
      }
    },
    {
      "@type": "Question",
      "name": "How is the price calculated?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Spec2Tickets is sold as “Paid via Atlassian,” billed through the Atlassian Marketplace, in USD. Teams of up to 10 users pay nothing — the full product, with no time limit. From 11 users it is priced per user, per month, on a declining curve: $6.70 per user up to 100 users, $5.10 above 100, $3.80 above 250, and lower again at larger sizes. It is not a flat site price — a 100-user Confluence site is up to $670 a month. The Marketplace always shows the exact price for your team size before you subscribe."
      }
    },
    {
      "@type": "Question",
      "name": "Why is my price based on my whole Confluence site?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Because that is how Atlassian licenses cloud apps. “Paid via Atlassian” covers your entire Confluence instance — the price tier is set by the number of users on your Atlassian site, not by how many of them open Spec2Tickets. It is Atlassian's model rather than ours, and it cuts both ways: everyone on your site can use the app, at no extra charge per person added to the tool. The exact figure for your site size is shown in the Marketplace before you subscribe."
      }
    },
    {
      "@type": "Question",
      "name": "Is there a free plan?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Yes — Spec2Tickets is free for teams of up to 10 users, with every feature included and no time limit. It is a real free plan, not a trial: unlimited breakdowns, test-case generation, and sprint planning, on your own Anthropic key. Teams of 11 or more get the Atlassian Marketplace's standard 30-day free trial before the subscription starts."
      }
    },
    {
      "@type": "Question",
      "name": "What if we run more than one Confluence site?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "The prices above are for a single Confluence instance. If you license Spec2Tickets across several instances, Atlassian applies its standard multi-instance rate of 1.5× the single-instance price. The Marketplace shows the exact figure for your setup before you subscribe."
      }
    },
    {
      "@type": "Question",
      "name": "What does the AI cost?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Whatever Anthropic charges you — nothing more. Every plan is Bring Your Own Key: you add your own Anthropic API key, so AI usage is billed to your Anthropic account directly, typically a few cents per breakdown, with no vendor markup. The Marketplace subscription covers the app itself."
      }
    },
    {
      "@type": "Question",
      "name": "What happened to the Advanced edition?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "It has been folded into BYOK Pro. AI-generated acceptance test cases — BA-grade Gherkin and CSV, ready to import into your test tools — were previously planned as a separate Advanced edition and are now part of the standard product, along with sprint planning, at no extra cost. Everything runs on your own Anthropic key, so your content stays under your own Anthropic agreement."
      }
    },
    {
      "@type": "Question",
      "name": "How do I manage or cancel my subscription?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "Subscriptions are handled through the Atlassian Marketplace and your Atlassian site administration, alongside your other Atlassian apps."
      }
    }
  ]
}
</script>
```

**After pasting, run the page through Google's Rich Results Test** — it catches both a broken FAQ block and
a visible/marked-up mismatch, which is exactly the failure mode that let "$67" become machine-readable.

---

### 2.6 Closing CTA (L224–236)

The CTA needs only one strengthening edit — "Free up to 10 users" is true and stays. Making the free
tier's *permanence* explicit is the highest-value change on the whole page, because it is our real
differentiator against rivals whose free tiers are trials.

```html
<section class="section cta-final">
  <div class="container">
    <span class="eyebrow">Get started</span>
    <h2>Start free today</h2>
    <p class="lead">Every feature, free for teams of up to 10 users — no time limit. Bring your own Anthropic key and go.</p>
    <div class="hero-cta">
      <a class="btn btn-primary btn-lg" href="https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira" target="_blank" rel="noopener">Get it on Marketplace</a>
      <a class="btn btn-ghost btn-lg on-dark" href="/how-it-works">See how it works</a>
    </div>
    <p class="cta-note">Free up to 10 users &middot; Bring your own Anthropic API key &middot; Managed through the Atlassian Marketplace.</p>
  </div>
</section>
```

---

## 3. Welcome-credit copy — HOLD, DO NOT PUBLISH

**Status: BLOCKED.** Unchanged by the portal verification — the tier table says nothing about the welcome
credit. Written here so it is ready the day it clears, and for no other purpose.

**Why it is blocked (three independent gates, all must clear):**

1. **The model is a decision, not a capability.** Per-user welcome credit is the founder's decision of
   2026-07-24. The shipped code grants the credit **per install**, and only to a **30-day-trial licence** —
   a free-tier (1–10 user) install gets nothing today. Publishing the copy below before the code ships
   would advertise a capability that does not exist for the exact audience it targets.
2. **The claims register blocks the figure.** `13-claims-register.md` row **B16** forbids the "$5" figure
   in new public copy; the previously approved trial-scoped form (**A2.7**) has since been **withdrawn**
   into B16, so there is currently *no* approved public form of this claim. This draft does not lift
   that gate.
3. **Operational truth.** The credit only works while the production managed Anthropic key is funded and
   configured; it was last recorded as an open prod-ops item. If it is unset, trial users get a graceful
   "managed unavailable" state and the promise is false in practice.

**Also required before publishing (do not skip):** the privacy page scopes managed processing to *"During
your free trial"* (privacy L81, L99–103, L130, L144). Extending the credit to free-tier users puts managed
processing outside that scope, so the privacy page and DPA would need to be updated first. That copy is
lawyer-approved — **flag it for the founder and the lawyer; do not re-draft it here** (source of truth =
the site repo).

### 3.1 HOLD — plan-card line (Free card, after the feature list)

```html
        <p class="plan-foot"><strong>No API key needed to start.</strong> Every user gets a one-time welcome credit of AI usage on our key — generate your first backlogs immediately, then add your own Anthropic key when it runs out. Provided through the Atlassian Marketplace.</p>
```

### 3.2 HOLD — FAQ entry (visible + JSON-LD, both)

```html
      <details class="faq-item">
        <summary>Do I need an Anthropic API key to start?</summary>
        <div class="faq-body">No. Every user gets a one-time <strong>welcome credit</strong> of AI usage on our own Anthropic key, so you can generate real backlogs from your real pages on day one — on the free plan and during the 30-day trial alike. The credit is per person, so a small team can keep evaluating through a colleague's credit after yours is spent. When your credit runs out you continue with <strong>your own Anthropic key</strong>, paying Anthropic directly at cost, with no markup from us.</div>
      </details>
```

```json
    {
      "@type": "Question",
      "name": "Do I need an Anthropic API key to start?",
      "acceptedAnswer": {
        "@type": "Answer",
        "text": "No. Every user gets a one-time welcome credit of AI usage on our own Anthropic key, so you can generate real backlogs from your real pages on day one — on the free plan and during the 30-day trial alike. The credit is per person, so a small team can keep evaluating through a colleague's credit after yours is spent. When your credit runs out you continue with your own Anthropic key, paying Anthropic directly at cost, with no markup from us."
      }
    }
```

### 3.3 HOLD — the one-line promise (for hero notes, CTAs, social)

> **Start generating immediately — no API key needed. Bring your own key when your welcome credit runs out.**

**Notes for the day this ships:** (a) the dollar amount is deliberately absent from every line above —
adding "$5" is a separate founder call under B16; (b) "one-time" and "per person" are load-bearing — drop
either and the copy implies a recurring or pooled allowance; (c) never pair the welcome credit with the
word *unlimited*.

---

## 4. Every other page that repeats a price

Searched the whole site directory for `$`, "per user", "flat", "10 users", "price", "free". Findings,
exact lines:

### Must change (carries the wrong model)

| File | Line | Current text | Action |
|---|---|---|---|
| `pricing/index.html` | 7, 18, 25, 45, 53, 109, 110, 136, 137, 138, 160–162, 195, 199 | see Section 1 table | Replace per Section 2 |
| `index.html` (landing) | 70 | `"price": "67",` | Replace the offers block — below |
| `index.html` (landing) | 72 | `"description": "Flat price per month for teams of 11+ users, billed via the Atlassian Marketplace."` | Replace the offers block — below |
| `docs/index.html` | 213 | `<tr><td><strong>BYOK Pro</strong></td><td>$67<small> / month flat</small> &middot; teams of 11+*</td><td>Unlimited — every feature included</td></tr>` | Replace — below |
| `docs/index.html` | 217 | "…from 11 users it is a flat **$67/month** for the whole site — **not per user** — and the Marketplace shows the exact price for your team size." | Replace — below |

**Landing page — replace the `offers` array (index.html L58–75).** Schema.org has no clean "free below N
seats, then a declining per-seat curve" primitive, so the honest encoding is a $0 offer plus a per-user
offer whose `description` carries the curve.

```json
  "offers": [
    {
      "@type": "Offer",
      "name": "Free — teams of up to 10 users",
      "price": "0",
      "priceCurrency": "USD",
      "description": "Every feature included, unlimited, free for teams of up to 10 users. No time limit.",
      "url": "https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira"
    },
    {
      "@type": "Offer",
      "name": "BYOK Pro — teams of 11+",
      "price": "6.70",
      "priceCurrency": "USD",
      "unitText": "user per month",
      "description": "Per user, per month, for teams of 11 or more, billed via the Atlassian Marketplace. The rate declines as the instance grows — $6.70 per user up to 100 users, $5.10 above 100, $3.80 above 250, and lower again at larger sizes. The Marketplace shows the exact price for your team size.",
      "url": "https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira"
    }
  ]
```

*Optional refinement, only if you want the band encoded machine-readably: replace the paid offer's flat
`price` with a `priceSpecification` of type `UnitPriceSpecification` carrying
`"eligibleQuantity": {"@type": "QuantitativeValue", "minValue": 11, "maxValue": 100, "unitText": "user"}`.
More precise, more to get wrong — validate with the Rich Results Test either way.*

**Docs page — replace the table row (L213) and the footnote (L217).**

```html
              <tr><td><strong>BYOK Pro</strong></td><td>$6.70<small> / user / month from 11 users — less at scale</small></td><td>Unlimited — every feature included</td></tr>
```

```html
        <p>*Billed through the Atlassian Marketplace (Paid via Atlassian), in USD. Teams of up to 10 users pay <strong>nothing</strong>, with every feature included and no time limit; from 11 users it is priced <strong>per user, per month</strong>, on a declining curve — $6.70 per user up to 100 users, $5.10 above 100, $3.80 above 250, and lower again at larger sizes — so a 100-user site is up to $670 a month rather than a flat fee. “Paid via Atlassian” licenses your whole Confluence instance, so the tier is set by the number of users on your Atlassian site rather than by how many of them use the app, and customers licensing several instances pay a 1.5× multi-instance rate. The Marketplace shows the exact price for your team size before you subscribe. Every plan is Bring Your Own Key — you add your own Anthropic API key, so AI usage is billed to your Anthropic account separately, and the subscription covers only the app itself. All features — breakdowns, AI-generated acceptance test cases, and sprint planning — are included in every plan.</p>
```

### Correct as-is — verify, do not change

| File | Line | Text | Why it is fine |
|---|---|---|---|
| `index.html` | 118 | "Free for teams up to 10 users &middot; Bring your own Anthropic API key…" (hero note) | True under the verified model |
| `index.html` | 405 | "Free up to 10 users &middot; …" (CTA note) | True |
| `index.html` | 61–64 | Free offer, `"price": "0"` | True (still replace the block wholesale so both offers stay in sync) |
| `how-it-works/index.html` | 175 | "Free up to 10 users &middot; Bring your own Anthropic API key &middot; Runs on Atlassian Forge." | True |
| `docs/index.html` | 212 | Free row: "$0 &middot; teams up to 10 users" | True |
| `docs/index.html` | 229 | "Your team has grown beyond 10 users without an active subscription…" | Consistent with the verified model |
| `get-api-key/index.html` | 93, 122 | "≈ $5–10" / "~$5 of credits" on the customer's **Anthropic** account | Not our price — an Anthropic funding tip. Note the coincidence: if welcome-credit copy ever ships, "$5" will appear on this page meaning something different. Keep the two distinct. |
| `get-api-key/index.html` | 162 | "The Spec2Tickets subscription itself … is separate and covers the app; see Pricing." | True and useful |
| `about/index.html`, `privacy/index.html`, `dpa/index.html`, `subprocessors/index.html`, `404.html` | — | No price claims (nav/footer links only) | Nothing to change |

### Not a page, but must be updated in the same pass

- **`docs/marketing-kb/13-claims-register.md`** — rows **A2.2** and **A2.2b** still carry the boundary
  caveat ("the band's upper boundary is unconfirmed") and **A2.2b still states "$5.70 from 101 users."**
  Both are now resolved by the portal: A2.2 becomes "$6.70/user at 11–100, portal-verified"; **A2.2b must
  be rewritten to $5.10 (101–250) and $3.80 (251–1000)** or retired into Table B. Row **A2.3** already
  drops the word *flat*. The publication gate on the figures ("not yet reflected on the live site") clears
  **the moment the site fix lands** — release it in the same pass, or the next piece of content will keep
  deflecting on numbers we have published.
- **`docs/marketing-kb/02-business-model-pricing.md`** — §3a is **already reconciled** to the verified
  table; the two `[GAP]` lines in §10/§12 that ask whether the declining curve and the 1.5× multiplier
  "survive" are now answered (they do) and should be closed.
- **Other KB files still carrying the retired "$5.70 for 101+"** — `README.md` L54,
  `03-audience-icp-personas.md` (L46, L49, L52, L211, L218), `11-faq-objections.md` (L34, L148–149),
  `14-gaps-for-partner.md` L30, plus the front-matter authority lines of `06`, `07`, `10`, `12`. Correct
  to $5.10 / $3.80 in the same sweep, and close the `[GAP]` items that asked for portal verification.
- **`src/usage.js`** (forge repo) — the in-app price string still reads `$6.70/user/mo` with a `$57` flat
  ≤10 framing. The per-user figure is correct; **the "$57 flat for ≤10" is not** (that tier is free). Not a
  site file, but it is customer-visible in the in-app Account panel and will contradict the corrected page.

---

## 5. Open questions — what the founder still decides

The tier table is **portal-verified**, so nothing about the *numbers* is open any more. Three questions
remain, and all three are about publishing, not about pricing.

| # | Question | Options | Recommendation |
|---|---|---|---|
| **a** | **Show the full curve, or just the entry rate?** | **(1)** The four-band table only (Section 2.3) — free / 11–100 / 101–250 / 251–1,000 plus "lower again at larger sizes". **(2)** Same table plus the folded `<details>` with all 15 bands. **(3)** Entry rate only ("from $6.70 per user"), no table. | **(2).** The four-band table is the honesty fix and must stay — option (3) reproduces the sin we are correcting, just more quietly. The `<details>` costs nothing visually and answers the large-instance buyer before they have to ask, which is exactly where "$67 flat" burned us. |
| **b** | **How do we present the 1.5× multi-instance rate?** | **(1)** One clause in the table footnote. **(2)** A dedicated FAQ entry (+ its JSON-LD twin). **(3)** Both. **(4)** Omit — let the Marketplace surface it. | **(3), or (1) at minimum.** Omitting it recreates the flat-$67 failure shape in miniature: a multi-instance buyer is quoted 33% low and discovers it at checkout. Both blocks are drafted and tagged **[FOUNDER CHOICE b]** in §2.3, §2.4 and §2.5. If (1), delete the FAQ entry from **both** §2.4 and §2.5. |
| **c** | **When does the site push happen?** | Founder pastes Sections 2 + 4 into the site repo and pushes. | **Soon, and as one commit.** The live page is materially wrong right now, and the KB's figure-publication gate is explicitly waiting on this push — the verified rates stay unpublishable in every channel until the site itself stops saying "$67 flat". |

### Closed by the verified portal table — do not reopen

- Where the $6.70 band ends → **100 users** (the portal's "1–100" row; effective paid entry 11–100).
- What the portal actually bills → the full curve in Section 0, including the **$0 "Up to 10 (flat)"** row,
  so "free for teams of up to 10 users" is a configured tier, not an intention.
- Whether the declining curve and the 1.5× multi-instance multiplier survive → **both confirmed.**
- "$5.70 above 100 users" → **retired as an error**, not a pending question. $5.10 is the real rate.

### Carried, not blocking this correction

- **Plan naming** — the site says "BYOK Pro", the portal edition is "Standard". Cosmetic, but two names
  for one plan is friction at checkout. Cheap to align whenever the founder chooses.
- **Grandfathering** — "Early-access pricing — we grandfather early adopters" stays on the page. Anyone
  who read "$67 flat" while it was published may believe they hold it. Worth a stated position before it
  arrives as a support ticket.
- **Welcome credit** — Section 3 stays sealed until all four gates clear (per-user credit ships in code ·
  production managed Anthropic key funded and set · founder signs off on wording · privacy page and DPA
  extended beyond "during your free trial" by the lawyer).

### Recommended sequence

1. Answer **(a)** and **(b)** — both are five-minute calls, and both blocks are already written.
2. Paste **Section 2** into `pricing/index.html` and **Section 4** into `index.html` + `docs/index.html`,
   as **one commit**. Do not fix the visible copy without the JSON-LD; that is how "$67" survived into
   structured data in the first place.
3. Run the pricing and landing pages through Google's Rich Results Test before pushing.
4. In the same pass, correct `13-claims-register.md` (A2.2 / A2.2b) and the KB files still carrying
   "$5.70 for 101+" listed in Section 4, and release the figure-publication gate.
5. Fix the `$57`-flat framing in `src/usage.js` (forge repo) so the in-app Account panel agrees with the
   page.
6. Leave Section 3 sealed until its four gates clear.
