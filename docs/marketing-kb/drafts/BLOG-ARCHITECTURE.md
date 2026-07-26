---
title: "Blog architecture for spec2jira.com — draft plan"
purpose: "The concrete, paste-ready build plan for a blog on the existing static GitHub Pages site: URL layout, post + index templates built from the real site skeleton, nav/footer integration, sitemap/robots/RSS, a11y + performance rules, and the PR publishing workflow."
visibility: internal (the plan); the templates inside it are public-safe once filled per the checklist in §6
status: DRAFT — founder decisions required (see §7). Nothing here has been written to the site repo.
sources:
  - "Site repo (READ ONLY, not modified): C:/Software Engineer/Success/AI-delivery/ai-delivery-platform/MVP-roll-out/spec2jira-site/spec2jira-site — index.html, docs/index.html, how-it-works/index.html, about/index.html, pricing/index.html, 404.html, sitemap.xml, robots.txt, favicon.svg, og-image.png, assets/css/site.css (1425 lines), assets/js/site.js (73 lines)"
  - "Live verification 2026-07-25 (curl): https://spec2jira.com/docs -> 301 https://spec2jira.com/docs/ ; https://spec2jira.com/docs/ -> 200 ; https://spec2jira.com/_redesign-docs/03-design-concept.md -> 404 ; https://spec2jira.com/og-image.png -> 200 (verified 1200x630)"
  - "Repo verification 2026-07-25: 10 HTML files; the nav block is byte-identical in all 10 (md5 0879cd00); the footer block is byte-identical in all 10 (md5 a21fbfd6); zero <img> elements anywhere on the site; no .github/ directory; no _config.yml; no .nojekyll"
  - "docs/marketing-kb/13-claims-register.md (the honesty firewall — governs every sentence in a post)"
  - "docs/marketing-kb/README.md (the 11 binding rules)"
  - "docs/marketing-kb/12-marketing-strategy-channels.md §5 pillars, §7 blog proposal, §8 repurposing (INTERNAL)"
  - "docs/marketing-kb/08-brand-voice-visual.md §1.4 spelling, §2.3 signature phrases, §2.4 CTA conventions, §6 asset inventory"
last_verified: 2026-07-25
---

# Blog architecture — spec2jira.com

> **Scope.** This is a **draft plan**, not a change. The site repo is public and auto-deploys on push;
> nothing in it was touched — and **nothing in it is to be touched by an agent**. Everything below is
> paste-ready so that **the founder** can create the files in one sitting. Every command in §3 and §6 is
> written to be **run by the founder**, on the founder's machine, against the founder's checkout: no
> agent creates files in, commits to, pushes a branch to, or opens a PR against the live site repo. This
> engine writes to `docs/marketing-kb/drafts/` only; the site repo is founder-operated, full stop.
>
> **Two rules that shape every decision here:** (1) `assets/css/site.css` is treated as **frozen** — its
> own header says later pages "are styled against this file and must NOT edit it", and the three pages
> that needed extra CSS (docs, how-it-works, 404) each added a small **page-scoped `<style>` block with a
> comment explaining why**. The blog follows that pattern. (2) The nav and footer are **byte-identical
> components copied into every page** — verified, not assumed (md5 of the nav block is `0879cd00` in all
> 10 HTML files; the footer is `a21fbfd6` in all 10).

**Contents**
1. [URL + file layout](#1-url--file-layout)
2. [Templates](#2-templates-paste-ready) — [post](#22-post-template) · [index](#23-blog-index-template) · [new CSS](#21-the-only-new-css)
3. [Nav / footer integration](#3-nav--footer-integration)
4. [sitemap.xml, robots.txt, RSS](#4-sitemapxml-robotstxt-and-a-feed)
5. [Accessibility + performance rules](#5-accessibility--performance-rules-do-not-regress-these)
6. [Publishing workflow + pre-publish checklist](#6-publishing-workflow)
7. [What is still missing / blocks a first post](#7-what-blocks-a-first-post)

---

## 0. What I verified first (so the plan rests on facts, not assumptions)

| Question | Answer (verified 2026-07-25) | Consequence for the blog |
|---|---|---|
| Is there a site generator? | **No.** No `_config.yml`, no `Gemfile`, no `.github/`, no build step. 10 hand-written HTML files. | Posts are hand-written HTML. No front matter. No CI to catch a broken file — **the PR review is the only gate**. |
| Does GitHub Pages run Jekyll anyway? | **Yes, the default build** — proven by `/_redesign-docs/03-design-concept.md` returning **404** while the file is committed. Jekyll excludes `_`-prefixed directories. | ⚠ **Never add `.nojekyll`** to "speed up" the build: it would disable Jekyll and start serving `/_redesign-docs/*` — the internal design docs — publicly. Files without YAML front matter are copied verbatim, so `{{ }}` and `{% %}` inside code samples are safe. |
| Extensionless URL or trailing slash? | `/docs` returns **301 → `/docs/`**; `/docs/` returns **200**. Every existing page's `<link rel="canonical">` points at the **301 form**. | New blog URLs use the **trailing-slash form** (the 200) in canonical, `og:url`, sitemap and internal links. The existing pages' mismatch is a separate small cleanup — noted in §7, not fixed here. |
| Is `og-image.png` still missing? | **No — resolved.** Present in the repo (140 KB, 2026-07-15), live `200`, verified **1200×630**. | Posts can ship today with the site-wide OG image. Per-post images are an upgrade, not a blocker. |
| Are there any images on the site? | **Zero `<img>` elements site-wide.** Every visual is CSS or inline SVG. | There is **no existing image convention to follow** — §2.4 invents one, and says so. |
| What CSS exists to build on? | 23 components incl. `.prose` (72ch article scope, styled h2/h3/lists/blockquote/hr/code/pre), `.callout` (+`.warn`/`.ok`), `.table-wrap`/`.table`, `.card`/`.card-hover`, `.usecase-card` (`.tag`/`.arrow`), `.grid-2`/`-3`, `.cta-final`, `.section-link`, `.eyebrow`, `.lead`, `.muted`, `.mx-auto`, `.mt-*`, `.reveal`. | A blog post needs **four new selectors**, total (§2.1). Everything else is existing site.css. |

---

## 1. URL + file layout

### 1.1 The layout

```
blog/
  index.html                      ->  https://spec2jira.com/blog/
  feed.xml                        ->  https://spec2jira.com/blog/feed.xml        (§4.3)
  <slug>/
    index.html                    ->  https://spec2jira.com/blog/<slug>/
    og.png                        ->  per-post social card (optional, later)
    img/
      <name>.png                  ->  in-post screenshots (optional)
```

### 1.2 Why directory + `index.html` (and not `blog/my-post.html`)

- **It is the only pattern GitHub Pages serves cleanly without a build step.** A static host maps
  `/blog/my-post/` to `blog/my-post/index.html` automatically. A file named `my-post.html` would be
  reachable at `/blog/my-post.html` (extension visible) — GitHub Pages does *not* silently strip `.html`.
- **It matches every existing page.** `docs/index.html`, `how-it-works/index.html`, `pricing/index.html`
  and the rest are all directory-plus-index. Consistency here costs nothing and keeps the site legible.
- **The URL never has to change.** Adding `og.png` and `img/` inside the post's own folder keeps a post
  self-contained: one directory = one post, delete the directory and the post is gone, no orphaned assets.
- **Trailing slash is what the server actually returns.** `/blog/my-post` will 301 to `/blog/my-post/`.
  Link and canonicalise the slash form so no reader, crawler or social scraper eats a redirect hop.

### 1.3 Slug convention

- lowercase, hyphen-separated, ASCII only, **no dates in the slug** (a dated slug ages the post and
  breaks if you re-publish);
- **3–6 words, keyword-bearing, front-loaded** — the slug is a ranking and a readability surface;
- drop stop-words (`a`, `the`, `to`, `for`) unless the phrase breaks without them;
- **never change a published slug.** A static site has no redirect map (GitHub Pages supports no
  `_redirects` file); a renamed post is a dead link. If a rename is unavoidable, keep the old directory
  with a `<meta http-equiv="refresh">` + `<link rel="canonical">` to the new URL.

| Post idea (from KB 12 §5) | Slug |
|---|---|
| "From Confluence page to sprint-ready backlog: what AI can and can't decide for you" | `confluence-page-to-sprint-ready-backlog` |
| "Acceptance criteria that survive contact with a sprint" | `acceptance-criteria-that-survive-a-sprint` |
| "Bring your own key: what BYOK actually changes for your DPO" | `byok-what-it-changes-for-your-dpo` |
| "Dependency links are the hard part of backlog automation" | `dependency-links-backlog-automation` |

### 1.4 Categories (labels only — no tag pages yet)

Use the five KB content pillars as a **single visible label per post** (rendered as the `.eyebrow` in the
post header and the `.tag` on the index card). Public label names:

| Pillar (KB 12 §5) | Public label |
|---|---|
| 1 — Spec-writing craft | `Spec craft` |
| 2 — AI in agile workflows | `AI in agile` |
| 3 — Privacy-first AI adoption | `Privacy & trust` |
| 4 — Product tours / release notes | `Product tour` / `Release notes` |
| 5 — Founder build-in-public | `Notes from the build` — ⛔ **pillar 5 is not approved yet** (KB 12 §5, gap 7) |

**Do not build `/blog/category/<x>/` pages.** With fewer than ~15 posts they are maintenance with no
reader benefit, and each one is another hand-maintained file. Revisit at ~15 posts.

---

## 2. Templates (paste-ready)

### 2.1 The only new CSS

Everything a post needs already exists in `site.css` **except four selectors**. They go in a page-scoped
`<style>` block in the `<head>`, exactly the way `docs/index.html`, `how-it-works/index.html` and
`404.html` already do it (each with a comment saying why). They use **only existing design tokens** — no
new colours, no new type scale.

```html
<style>
  /* Page-scoped (blog) — four selectors the frozen site.css has no equivalent for:
     (1) a centred article column that matches .prose's 72ch measure, so the post
         header lines up with the body; (2) the byline/date/reading-time row;
     (3) figure + caption treatment (the site has no <img> anywhere, so no image
         convention exists yet). Tokens only — nothing new invented. ~10 lines. */
  .post-shell { max-width: 72ch; margin-inline: auto; }
  .post-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; font-size: var(--fs-small); color: var(--text-500); }
  .post-figure { margin-top: 1.6em; }
  .post-figure img { border: 1px solid var(--line-200); border-radius: var(--radius-m); }
  .post-figure figcaption { margin-top: 10px; font-size: var(--fs-small); color: var(--text-500); }
</style>
```

The blog **index** needs two more (a stretched-link card, for the whole card to be clickable while the
accessible name stays just the title):

```html
<style>
  /* Page-scoped (blog index) — the homepage's .usecase-card is not a link; a post
     card must be. Stretched-link overlay keeps the card clickable while the
     accessible name is only the post title. Tokens only. ~8 lines. */
  .post-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: var(--fs-small); color: var(--text-500); }
  .post-card { position: relative; }
  .post-card h3 a { color: inherit; }
  .post-card h3 a:hover { text-decoration: none; }
  .post-card h3 a::after { content: ""; position: absolute; inset: 0; border-radius: var(--radius-m); }
</style>
```

*(`.usecase-card h3 { margin: 0 }` already exists in site.css, so the card heading needs no reset.)*

> **If this block ever grows past ~80 lines, or a third distinct blog layout appears**, promote it to a
> new `/assets/css/blog.css` linked only from blog pages. That is **not** an edit to `site.css`, so it does
> not break the freeze — the trade-off is one extra render-blocking request against duplicated inline CSS.
> Start inline; the block above is small enough that duplication is cheaper than a second stylesheet.

### 2.2 Post template

`blog/<slug>/index.html`. Replace every `{{TOKEN}}`. The nav and footer blocks are **verbatim copies** —
do not retype them, copy them out of an existing page so the byte-identity holds.

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{{TITLE_SHORT}} — Spec2Tickets</title>
<meta name="description" content="{{META_DESCRIPTION}}">
<meta name="author" content="{{AUTHOR_NAME}}">
<meta name="theme-color" content="#0B1526">
<link rel="canonical" href="https://spec2jira.com/blog/{{SLUG}}/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="alternate" type="application/rss+xml" title="Spec2Tickets blog" href="/blog/feed.xml">
<link rel="preload" href="/assets/fonts/space-grotesk-var-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-var-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/css/site.css" as="style">
<link rel="stylesheet" href="/assets/css/site.css">
<meta property="og:type" content="article">
<meta property="og:site_name" content="Spec2Tickets">
<meta property="og:title" content="{{TITLE_SHORT}}">
<meta property="og:description" content="{{META_DESCRIPTION}}">
<meta property="og:url" content="https://spec2jira.com/blog/{{SLUG}}/">
<meta property="og:image" content="https://spec2jira.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta property="article:published_time" content="{{ISO_DATE}}">
<meta property="article:modified_time" content="{{ISO_DATE_MODIFIED}}">
<meta property="article:author" content="{{AUTHOR_NAME}}">
<meta property="article:section" content="{{CATEGORY}}">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="{{TITLE_SHORT}}">
<meta name="twitter:description" content="{{META_DESCRIPTION}}">
<meta name="twitter:image" content="https://spec2jira.com/og-image.png">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "BlogPosting",
  "headline": "{{TITLE_SHORT}}",
  "description": "{{META_DESCRIPTION}}",
  "inLanguage": "en",
  "datePublished": "{{ISO_DATE}}",
  "dateModified": "{{ISO_DATE_MODIFIED}}",
  "author": {
    "@type": "Person",
    "name": "{{AUTHOR_NAME}}",
    "url": "https://spec2jira.com/about"
  },
  "publisher": {
    "@type": "Organization",
    "name": "Spec2JIRA",
    "url": "https://spec2jira.com/",
    "logo": { "@type": "ImageObject", "url": "https://spec2jira.com/favicon.svg" }
  },
  "image": "https://spec2jira.com/og-image.png",
  "mainEntityOfPage": { "@type": "WebPage", "@id": "https://spec2jira.com/blog/{{SLUG}}/" },
  "isPartOf": { "@type": "Blog", "name": "Spec2Tickets blog", "@id": "https://spec2jira.com/blog/" }
}
</script>
<script src="/assets/js/site.js" defer></script>
<style>
  /* Page-scoped (blog) — four selectors the frozen site.css has no equivalent for:
     (1) a centred article column matching .prose's 72ch measure, so the post header
     lines up with the body; (2) the byline/date/reading-time row; (3) figure +
     caption (the site has no <img> anywhere, so no image convention exists yet).
     Design tokens only. ~10 lines. */
  .post-shell { max-width: 72ch; margin-inline: auto; }
  .post-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; margin-top: 18px; font-size: var(--fs-small); color: var(--text-500); }
  .post-figure { margin-top: 1.6em; }
  .post-figure img { border: 1px solid var(--line-200); border-radius: var(--radius-m); }
  .post-figure figcaption { margin-top: 10px; font-size: var(--fs-small); color: var(--text-500); }
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>

<!-- ==================================================================
     NAV  [component 1] — copied byte-identically to every page
     ================================================================== -->
<header class="site-header">
  <nav class="nav container" aria-label="Primary">
    <a class="nav-logo" href="/" aria-label="Spec2JIRA home">Spec<span class="l2">2</span><span class="ljira">JIRA</span></a>
    <button class="nav-toggle" type="button" aria-expanded="false" aria-controls="nav-menu" aria-label="Toggle menu">
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
      <span class="nav-toggle-bar"></span>
    </button>
    <div class="nav-menu" id="nav-menu">
      <a href="/how-it-works">How it works</a>
      <a href="/#use-cases">Use cases</a>
      <a href="/pricing">Pricing</a>
      <a href="/docs">Docs</a>
      <a href="/about">About</a>
      <a class="btn btn-primary btn-sm" href="https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira" target="_blank" rel="noopener">Start for free</a>
    </div>
  </nav>
</header>

<main id="main">

<article>
  <!-- ===================== POST HEADER ===================== -->
  <section class="section section--tight">
    <div class="container">
      <header class="post-shell">
        <span class="eyebrow">{{CATEGORY}}</span>
        <h1>{{TITLE_FULL}}</h1>
        <p class="lead mt-3">{{DEK}}</p>
        <p class="post-meta">
          <span>By {{AUTHOR_NAME}}</span>
          <span aria-hidden="true">&middot;</span>
          <time datetime="{{ISO_DATE}}">{{HUMAN_DATE}}</time>
          <span aria-hidden="true">&middot;</span>
          <span>{{N}} min read</span>
        </p>
      </header>
    </div>
  </section>

  <!-- ===================== POST BODY ===================== -->
  <section class="section section--tight">
    <div class="container">
      <div class="post-shell">
        <div class="prose">

          <p>{{OPENING_PARAGRAPH}}</p>

          <h2>{{SECTION_HEADING}}</h2>
          <p>{{BODY}}</p>
          <ul>
            <li>{{POINT}}</li>
          </ul>

          <h3>{{SUB_HEADING}}</h3>
          <p>{{BODY}}</p>

          <!-- AUTHORING NOTE — strip before publish: callout, existing component.
               Variants: .callout.warn / .callout.ok -->
          <div class="callout">
            <p><strong><span aria-hidden="true">ℹ</span> {{CALLOUT_TITLE}}</strong> — {{CALLOUT_BODY}}</p>
          </div>

          <!-- AUTHORING NOTE — strip before publish: code, existing component
               (pre = ink-900 surface, overflow-x:auto). tabindex/role/aria-label are
               NOT optional — a box that scrolls must be reachable by keyboard (§5.1.10). -->
          <pre tabindex="0" role="region" aria-label="{{CODE_LABEL}}"><code>{{CODE}}</code></pre>

          <!-- AUTHORING NOTE — strip before publish: table, existing component;
               .table-wrap gives horizontal scroll on phones. Same keyboard rule as
               <pre> — tabindex/role/aria-label are required, not optional (§5.1.10). -->
          <div class="table-wrap" tabindex="0" role="region" aria-label="{{TABLE_LABEL}}">
            <table class="table">
              <thead><tr><th scope="col">{{COL_A}}</th><th scope="col">{{COL_B}}</th></tr></thead>
              <tbody><tr><td>{{A}}</td><td>{{B}}</td></tr></tbody>
            </table>
          </div>

          <!-- AUTHORING NOTE — strip before publish: image, NEW convention (the site
               has no <img> anywhere today). width/height are mandatory (no layout
               shift); loading="lazy" + decoding="async" on anything below the fold;
               alt is mandatory. -->
          <figure class="post-figure">
            <img src="/blog/{{SLUG}}/img/{{IMAGE}}.png" width="1200" height="750"
                 loading="lazy" decoding="async" alt="{{ALT_TEXT}}">
            <figcaption>{{CAPTION}}</figcaption>
          </figure>

          <hr>

          <p>{{CLOSING_PARAGRAPH}}</p>

          <p><a href="/blog/">&larr; All posts</a></p>

        </div>
      </div>
    </div>
  </section>
</article>

<!-- ===================== CLOSING CTA ===================== -->
<section class="section cta-final">
  <div class="container">
    <span class="eyebrow">Get started</span>
    <h2>Turn your next Confluence page into a backlog.</h2>
    <p class="lead">Minutes instead of days — reviewed by your team, pushed on your say-so.</p>
    <div class="hero-cta">
      <a class="btn btn-primary btn-lg" href="https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira" target="_blank" rel="noopener">Start for free</a>
      <a class="btn btn-ghost btn-lg on-dark" href="/how-it-works">See how it works</a>
    </div>
    <p class="cta-note">Bring your own Anthropic API key &middot; Managed through the Atlassian Marketplace &middot; The Marketplace always shows the exact price for your team size before you subscribe.</p>
  </div>
</section>

</main>

<!-- ==================================================================
     FOOTER  [component 21] — copied byte-identically to every page
     ================================================================== -->
<footer class="site-footer">
  <div class="container">
    <div class="footer-grid">
      <div class="footer-brand">
        <a class="nav-logo" href="/" aria-label="Spec2JIRA home">Spec<span class="l2">2</span><span class="ljira">JIRA</span></a>
        <p class="footer-tagline">Turn a Confluence page into a sprint-ready Jira backlog — in minutes, reviewed by humans.</p>
        <p class="footer-meta">
          Made in Sofia, Bulgaria 🇧🇬
          <span>Support 11:00–23:00 (Europe/Sofia), 7 days a week.</span>
        </p>
      </div>
      <div class="footer-col">
        <h3>Product</h3>
        <ul>
          <li><a href="/how-it-works">How it works</a></li>
          <li><a href="/#use-cases">Use cases</a></li>
          <li><a href="/pricing">Pricing</a></li>
          <li><a href="/docs">Docs</a></li>
          <li><a href="/get-api-key">Get your API key</a></li>
          <li><a href="https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira" target="_blank" rel="noopener">Marketplace <span class="ext" aria-hidden="true">↗</span></a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h3>Company</h3>
        <ul>
          <li><a href="/about">About</a></li>
          <li><a href="mailto:support@spec2jira.com">Contact support</a></li>
          <li><a href="mailto:security@spec2jira.com">security@spec2jira.com</a></li>
          <li><a href="mailto:privacy@spec2jira.com">privacy@spec2jira.com</a></li>
        </ul>
      </div>
      <div class="footer-col">
        <h3>Legal</h3>
        <ul>
          <li><a href="/privacy">Privacy</a></li>
          <li><a href="/dpa">DPA</a></li>
          <li><a href="/subprocessors">Sub-processors</a></li>
        </ul>
      </div>
    </div>
    <div class="footer-bottom">
      <span>&copy; <span id="year">2026</span> Spec2JIRA &middot; All rights reserved.</span>
      <nav aria-label="Footer">
        <a href="/">Home</a>
        <a href="/how-it-works">How it works</a>
        <a href="/pricing">Pricing</a>
        <a href="/docs">Docs</a>
        <a href="/about">About</a>
      </nav>
    </div>
  </div>
</footer>

</body>
</html>
```

#### ⚠ Two things about this template that are not decoration

**1. The CTA band carries no free-tier SENTENCE — deliberately (the `Start for free` button label is a
separate, ruled exemption; see below).** The live homepage ends with *"Free up to 10 users · Bring your
own Anthropic API key · Managed through the Atlassian Marketplace."* The template does **not** reuse that
line and does not offer a rewritten one, because a template hard-codes its CTA into **every** post — and
this document is not the owner of the free-tier rule.

- **The owner is `13-claims-register.md`, row A2.1**, together with the qualification test printed under
  the A2 table. That is the only place the rule is stated. This plan does not restate it, does not define
  what "qualified" means, and offers no alternative approved shape.
- The template therefore closes on the BYOK + Marketplace facts plus **A2.9** verbatim (*"The Marketplace
  always shows the exact price for your team size before you subscribe."*).
- **If a specific post's CTA needs the free tier**, it carries **A2.1 quoted verbatim** and nothing else:
  *"Spec2Tickets is free while your whole Confluence site has 10 users or fewer — every feature included,
  no time limit. Paid via Atlassian licenses the entire Confluence instance, so every user on the site
  counts toward the price, not only the people who use the app. Above 10 users it is priced per user, on a
  rate that declines as the site grows, and the Atlassian Marketplace shows you the exact price for your
  site size before you subscribe."*
- ⛔ **Verbatim reuse of the live homepage line is not an exemption — settled and binding** (conductor
  ruling, 2026-07-25). It is recorded in the register under the A2.1 qualification test and carried by
  `EDITORIAL-CALENDAR.md` §0 and the `marketing-content` skill; there is no open decision here and no
  disagreement between the artifacts. That homepage line is part of the **same pending site correction**
  as `/pricing` — written and staged, **not pushed** — so it is still what the live page serves.

##### ⚖ RULING — `Start for free` (the CTA button label) is EXEMPT, as shared chrome

Ruled explicitly, 2026-07-25, so nobody has to re-decide it mid-draft. The template hard-codes
`Start for free` twice — the nav button and the closing CTA band — and that is **permitted**:

- **It is the site's own button label, not this template's invention.** It is already present on **all 10
  live pages** (in the nav; the homepage carries it three times), and the nav/footer are byte-identical
  components the blog must copy forward unchanged (§3.1). Diverging in the blog alone would break the
  copy-forward pattern the whole plan rests on — the same reasoning that exempts the shared nav/footer
  `/pricing` links in §2.4 and §6.2-C.
- **It is an action label, not a statement of the offer's terms.** It names no user count, no site scope
  and no duration, so there is nothing in it for the whole-instance qualifier to qualify. The register's
  rule binds the sentences that *state* the free tier; two words on a button are not one of them.
- **It is true for every reader either way** — free while the whole site has 10 users or fewer, and the
  Marketplace's standard 30-day free trial above that (A2.3).
- ⛔ **The exemption is exactly two strings wide: the `Start for free` button label in the nav and in the
  CTA band.** It does **not** license the word "free" in body copy, a heading, the dek, the meta
  description, an image caption, a social card, or a *rewritten* button label ("Free for small teams",
  "Start free — up to 10 users"). Each of those states the offer, and each takes **A2.1 verbatim** or
  nothing.
- **The §6.2-A sweep is written to MATCH the label rather than skip it**, so every occurrence is seen and
  consciously classified as chrome — exactly like the `/pricing` chrome count in §6.2-C. A grep that
  quietly skips the exempt case cannot tell you the exemption is still only two strings wide.

**2. HTML comments ship to the reader — so every surviving comment must be neutral.** Comments are served
to readers and to every crawler. The `AUTHORING NOTE` blocks in these templates explain how to fill the
template in, and one of them — the `CLOSING CTA` block — had internal claims-process prose **fused into a
banner comment that is supposed to stay**. That fusion is exactly why a marker grep is not a guard:
deleting the `AUTHORING NOTE` line passes the grep while the internal prose underneath it still ships.
It has been split: the banner is now bare (`<!-- ===================== CLOSING CTA ===================== -->`)
and all the guidance lives in this prose, outside the HTML. Keep it that way — **never put guidance,
rationale, review history or anything about an internal document back inside a comment.** Strip every
`AUTHORING NOTE` block before publish, then run the **full comment sweep** in §6.2-A, which lists *every*
remaining comment and requires each to match the neutral whitelist: the `NAV [component 1]` /
`FOOTER [component 21]` banners (byte-identical on all 10 live pages — removing them would break the
copy-forward pattern) and the plain section labels (`POST HEADER`, `POST BODY`, `CLOSING CTA`,
`PAGE HEADER`, `POST LIST (newest first)`).

#### Token reference

| Token | Rule |
|---|---|
| `{{SLUG}}` | §1.3. Must equal the directory name. |
| `{{TITLE_SHORT}}` | Used in `<title>`, OG, Twitter, JSON-LD `headline`. **Keep the whole `<title>` ≤ 60 characters** including the ` — Spec2Tickets` suffix, and the JSON-LD headline ≤ 110. If the real headline is longer, use a shortened form here and the full one in `{{TITLE_FULL}}`. |
| `{{TITLE_FULL}}` | The `<h1>`. May be longer/more expressive than `{{TITLE_SHORT}}`. |
| `{{DEK}}` | One or two sentences under the H1. The same idea as `{{META_DESCRIPTION}}` but written for a human, not a SERP. |
| `{{META_DESCRIPTION}}` | 120–160 characters, no quotes-inside-quotes, ends with a full stop. Reused verbatim in OG + Twitter + JSON-LD `description` (that is the existing site pattern — description, og:description and twitter:description are identical strings on all 10 pages). |
| `{{CATEGORY}}` | One label from §1.4. |
| `{{AUTHOR_NAME}}` | Founder decision (§7). Public founder facts are `Aleks Asenov`, sole trader, Sofia, Bulgaria (claims register A3.11) — a personal byline is claims-safe. The alternative is an Organization byline (`Spec2Tickets`), which needs `"author": {"@type":"Organization","name":"Spec2JIRA"}` in the JSON-LD instead. |
| `{{ISO_DATE}}` / `{{ISO_DATE_MODIFIED}}` | `YYYY-MM-DD`. Identical on first publication. On a later edit, bump **only** `ISO_DATE_MODIFIED` (+ `article:modified_time`, JSON-LD `dateModified`, the sitemap `lastmod`) and add a visible "Updated {{DATE}}" line to `.post-meta`. Never silently rewrite history — the brand is honesty-first. |
| `{{HUMAN_DATE}}` | `1 August 2026` (day, month name, year — unambiguous for both US and EU readers). Pick this format once and keep it. |
| `{{N}} min read` | Computed, not guessed — see below. Minimum "2 min read". |
| `{{CODE_LABEL}}` / `{{TABLE_LABEL}}` | The accessible name of a scrollable block, e.g. `"Example manifest scopes"` / `"Scope comparison"`. Short, describes the content, no "table of"/"code block" prefix (the role already says that). Required — a `role="region"` with no name is worse than no role at all. Delete the whole `<pre>` / `.table-wrap` sample if the post has none. |

Reading time (200 words/minute, rounded, floor of 2) — run from the repo root:

```bash
node -e "const fs=require('fs');const h=fs.readFileSync(process.argv[1],'utf8');const a=(h.split('<article')[1]||'').split('</article>')[0];const w=a.replace(/<[^>]+>/g,' ').split(/\s+/).filter(Boolean).length;console.log(w+' words -> '+Math.max(2,Math.round(w/200))+' min read');" blog/<slug>/index.html
```

### 2.3 Blog index template

`blog/index.html`. **Newest post first, top-left.** No pagination until ~20 posts (then add
`/blog/page-2/`; do not build it before it is needed).

```html
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Blog — Spec2Tickets for Confluence and Jira</title>
<meta name="description" content="Notes on writing specs teams can build from, AI in agile delivery, and privacy-first AI adoption — from the team behind Spec2Tickets for Confluence and Jira.">
<meta name="theme-color" content="#0B1526">
<link rel="canonical" href="https://spec2jira.com/blog/">
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="alternate" type="application/rss+xml" title="Spec2Tickets blog" href="/blog/feed.xml">
<link rel="preload" href="/assets/fonts/space-grotesk-var-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/fonts/inter-var-latin.woff2" as="font" type="font/woff2" crossorigin>
<link rel="preload" href="/assets/css/site.css" as="style">
<link rel="stylesheet" href="/assets/css/site.css">
<meta property="og:type" content="website">
<meta property="og:site_name" content="Spec2Tickets">
<meta property="og:title" content="Blog — Spec2Tickets for Confluence and Jira">
<meta property="og:description" content="Notes on writing specs teams can build from, AI in agile delivery, and privacy-first AI adoption — from the team behind Spec2Tickets for Confluence and Jira.">
<meta property="og:url" content="https://spec2jira.com/blog/">
<meta property="og:image" content="https://spec2jira.com/og-image.png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="twitter:title" content="Blog — Spec2Tickets for Confluence and Jira">
<meta name="twitter:description" content="Notes on writing specs teams can build from, AI in agile delivery, and privacy-first AI adoption — from the team behind Spec2Tickets for Confluence and Jira.">
<meta name="twitter:image" content="https://spec2jira.com/og-image.png">
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "Blog",
  "name": "Spec2Tickets blog",
  "url": "https://spec2jira.com/blog/",
  "inLanguage": "en",
  "publisher": { "@type": "Organization", "name": "Spec2JIRA", "url": "https://spec2jira.com/" },
  "blogPost": [
    {
      "@type": "BlogPosting",
      "headline": "{{TITLE_SHORT}}",
      "url": "https://spec2jira.com/blog/{{SLUG}}/",
      "datePublished": "{{ISO_DATE}}"
    }
  ]
}
</script>
<script src="/assets/js/site.js" defer></script>
<style>
  /* Page-scoped (blog index) — the homepage's .usecase-card is not a link; a post
     card must be. The stretched-link overlay makes the whole card clickable while
     the accessible name stays just the post title. Design tokens only. ~7 lines. */
  .post-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; font-size: var(--fs-small); color: var(--text-500); }
  .post-card { position: relative; }
  .post-card h3 a { color: inherit; }
  .post-card h3 a:hover { text-decoration: none; }
  .post-card h3 a::after { content: ""; position: absolute; inset: 0; border-radius: var(--radius-m); }
</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>

<!-- AUTHORING NOTE — strip before publish: paste the byte-identical NAV block
     (with its own site-standard banner comment) from any existing page. -->

<main id="main">

<!-- ===================== PAGE HEADER ===================== -->
<section class="section section--tight">
  <div class="container">
    <div class="section-head center">
      <span class="eyebrow">Blog</span>
      <h1>Notes on specs, backlogs, and AI you can actually trust</h1>
      <p class="lead mt-3">Practical writing for the people who turn requirements into work: business analysts, product owners, and the delivery teams they hand off to.</p>
    </div>
  </div>
</section>

<!-- ===================== POST LIST (newest first) ===================== -->
<section class="section section--tight">
  <div class="container">
    <h2 class="sr-only">All posts</h2>
    <div class="grid grid-2">

      <!-- AUTHORING NOTE — strip before publish: POST CARD, duplicate per post, newest first -->
      <article class="card card-hover usecase-card post-card reveal">
        <span class="tag">{{CATEGORY}}</span>
        <h3><a href="/blog/{{SLUG}}/">{{TITLE_FULL}}</a></h3>
        <p>{{DEK}}</p>
        <p class="post-meta">
          <time datetime="{{ISO_DATE}}">{{HUMAN_DATE}}</time>
          <span aria-hidden="true">&middot;</span>
          <span>{{N}} min read</span>
        </p>
        <span class="arrow" aria-hidden="true">→</span>
      </article>
      <!-- AUTHORING NOTE — strip before publish: /POST CARD -->

    </div>
  </div>
</section>

<!-- AUTHORING NOTE — strip before publish: paste the CLOSING CTA block (bare banner
     + .cta-final section) from the post template, unchanged. -->

</main>

<!-- AUTHORING NOTE — strip before publish: paste the byte-identical FOOTER block
     (with its own site-standard banner comment) from any existing page. -->

</body>
</html>
```

Notes on the card:
- `card card-hover usecase-card` are **all existing classes** — they give the white surface, the hover
  lift, the blue uppercase `.tag`, the flex column and the blue `.arrow` that slides on hover.
- `.reveal` (+ optional `.delay-1`/`.delay-2`) is the existing scroll-in animation; it is JS-gated and
  disabled under `prefers-reduced-motion`, so it is safe. Use it on **cards only**, never on article prose.
- `.grid-2` collapses to one column at 640px automatically (existing responsive rules).
- **Zero-CSS fallback** if the founder dislikes the stretched-link trick: wrap the whole card in
  `<a class="card card-hover usecase-card" href="...">` — `a.card:hover` is already styled in site.css.
  Cost: a screen reader announces the entire card text as the link name.

### 2.4 Article body conventions

| Element | Markup | Rule |
|---|---|---|
| Headings | `<h2>` sections, `<h3>` sub-sections | The `<h1>` is the post title, once. **Never skip a level** (no `<h2>` → `<h4>`). `.prose` already spaces them. |
| Paragraphs | `<p>` | Plain. `.prose > * + *` handles rhythm; do not add `.mt-*` inside prose. |
| Lists | `<ul>` / `<ol>` | Styled by `.prose` (blue disc markers, numbered markers). |
| Emphasis | `<strong>` | Renders `--text-900`. Use for the load-bearing phrase, not for decoration. |
| Quote | `<blockquote>` | Blue left rule + italic. **Never** put an invented customer quote here (claims register B12). |
| Callout | `<div class="callout">` + `.warn` / `.ok` | The site's existing pattern is a single `<p>` with a bolded lead-in; copy that shape. |
| Code | `<pre tabindex="0" role="region" aria-label="…">` > `<code>` | Dark `--ink-900` surface, `overflow-x: auto`. Escape `<` as `&lt;`. **The three a11y attributes are mandatory** — see §5.1.10; this is the site's first `<pre>` (zero exist today), so the blog sets the precedent. |
| Inline code | `<code>` | Light chip. |
| Table | `.table-wrap` (`tabindex="0" role="region" aria-label="…"`) > `.table` | The wrapper is what makes it scroll on phones — never use a bare `<table>`. **The three a11y attributes are mandatory** (§5.1.10); the four existing `.table-wrap` instances on the site lack them, which is why the blog adds them rather than copying the gap forward. |
| Divider | `<hr>` | Renders as the 48px gradient rule, not a full line. One before the closing paragraph at most. |
| Image | `<figure class="post-figure">` | **NEW convention** (see below). |
| Internal link | `<a href="/docs/">` | Trailing slash. Every post should link to **at least one** product page — `/how-it-works/`, `/docs/`, `/get-api-key/`. ⛔ **Not `/pricing/`** while the publication gate is closed — i.e. while that page still *serves* a flat figure (claims register, the publication gate; EDITORIAL-CALENDAR.md §0; B17). **Check the page, don't assume:** the correction is written and staged but unpushed, so it was still closed at the last check (2026-07-25). Link the **Marketplace listing** instead — it shows the reader the true price for their own team size. `/pricing/` is an allowed target again the day the check passes. *(The shared nav and footer link to `/pricing` on every page of the site; that is site chrome and must stay byte-identical — the ban is on **editorial links you write into the post**.)* |
| External link | `<a href="..." target="_blank" rel="noopener">` | Matches the site's existing external-link pattern exactly. |

**Images — this is new ground.** The site currently has **zero `<img>` elements**; every visual is CSS or
inline SVG. So the following is invented for the blog, and flagged as such:

- store at `/blog/<slug>/img/<name>.png` (self-contained per post);
- **`width` and `height` attributes are mandatory** — without them the page reflows as images load;
- `loading="lazy" decoding="async"` on everything below the first screen;
- `alt` is mandatory and descriptive; if the image is purely decorative, use `alt=""` and put the meaning
  in the caption;
- target ≤ 200 KB per image (PNG for UI screenshots, and prefer a 2× capture downscaled to a 1× size);
- ⚠ **screenshot safety**, see §6 checklist: no dev-site or project names (claims register C5); and
  capture from a **current build**. ✅ The old "the Account panel renders a retired price string" block is
  **closed** — `src/usage.js` was re-read on 2026-07-25 and its price strings now state the shape and
  defer the figure to the Marketplace (claims register, "Governed surfaces" + B4). What survives is the
  ordinary current-version rule: an **older capture** can still show the superseded string, so screenshot
  the app as it is now, not from an archive.

---

## 3. Nav / footer integration

### 3.1 The mechanical fact

The nav is not a template include — it is **copied into every page file**. Verified: the block from
`<header class="site-header">` to `</header>` hashes identically (`0879cd00`) in all 10 HTML files, and
the footer block hashes identically (`a21fbfd6`) in all 10. Adding a "Blog" link is therefore an edit to
**every file at once**, in one PR, or the nav stops being identical and the next person copies the wrong
version forward.

Files in scope: `index.html`, `about/index.html`, `docs/index.html`, `dpa/index.html`,
`get-api-key/index.html`, `how-it-works/index.html`, `pricing/index.html`, `privacy/index.html`,
`subprocessors/index.html`, `404.html` — **10 files**, plus the new blog files.

### 3.2 Option A — nav link (more discoverable, 10-file edit)

Exact insertion point: inside `<div class="nav-menu" id="nav-menu">`, **after the `/docs` line and before
the `/about` line** (Docs and Blog are both "content"; About stays last before the CTA button):

```html
      <a href="/docs">Docs</a>
      <a href="/blog/">Blog</a>          <!-- NEW -->
      <a href="/about">About</a>
```

Mechanical edit across all files (Git Bash, run from the site repo root, on a branch). **The `^`/`$`
anchors are load-bearing — do not drop them**, see the warning below:

```bash
grep -rl '<a href="/docs">Docs</a>' --include='*.html' . \
  | xargs sed -i 's|^      <a href="/docs">Docs</a>$|      <a href="/docs">Docs</a>\n      <a href="/blog/">Blog</a>|'
# then verify all nav blocks are identical again:
for f in $(find . -name '*.html' -not -path './.git/*'); do
  sed -n '/<header class="site-header">/,/<\/header>/p' "$f" | md5sum | cut -c1-8
done | sort -u   # must print exactly ONE hash
```

⚠ **Why the anchors matter (tested, not assumed).** Each page contains the string `<a href="/docs">Docs</a>`
**three** times: the nav (6-space indent), the footer "Product" column (`<li>`-wrapped, harmless), and the
**`footer-bottom` mini-nav (8-space indent)**. An unanchored pattern with 6 leading spaces still matches
inside those 8 spaces, so it silently edits the footer mini-nav too — I verified this on a scratch copy: the
unanchored form patched lines 59 **and** 292; the anchored form patched only line 59. Either way, check the
diff before committing: `git diff --stat` must show exactly **10 files, 1 insertion each** (plus the new
blog files), and the footer hash test in §6.2-E must still print one hash.

⚠ **This adds a SIXTH desktop nav item — verify it before merging, do not assume it fits.** Today the bar
carries five links (How it works · Use cases · Pricing · Docs · About) plus the `Start for free` button;
"Blog" makes six links plus the button on one row. The hamburger only takes over at
**`@media (max-width: 860px)`** (verified in `site.css`), so **861px is the tightest width the desktop bar
ever has to survive**, and it is exactly the width nobody tests. The failure mode is not a crash — it is the
CTA button wrapping, shrinking or sliding off the right edge, i.e. the conversion element quietly degrading
on every page of the site at once. Render the **home page** at **861px, 900px and 1024px** and confirm the
`Start for free` button is fully visible and un-wrapped at all three (§6.2-F). No CSS change is permitted to
make it fit — `site.css` is frozen; if it does not fit, take Option B (footer only) or shorten a label.

### 3.3 Option B — footer only (cheaper, less discoverable)

Same 10 files (the footer is also copied everywhere), but a softer commitment. Insertion point: the
footer "Product" column, after the `/docs` item:

```html
          <li><a href="/docs">Docs</a></li>
          <li><a href="/blog/">Blog</a></li>          <!-- NEW -->
          <li><a href="/get-api-key">Get your API key</a></li>
```

Optionally also the `footer-bottom` mini-nav (5 links today — adding a 6th is fine).

### 3.4 Recommendation and the open decision

**[FOUNDER DECISION — KB 12 §7, gap 6.]** My recommendation: **do both, in the same PR as the first
post** — conditional on the 861 / 900 / 1024px render check in §3.2 passing. The nav link is what makes
the blog a channel rather than a URL you paste into LinkedIn; the footer link is what makes it crawlable
from every page. The edit is mechanical and reversible, and doing it once is cheaper than doing it twice.
If the sixth item does not fit cleanly at 861px, Option B alone still ships the post.

Whatever is chosen, **the blog pages must carry exactly the same nav/footer as everything else** — if the
decision is deferred, paste today's nav verbatim into the blog files and change all 11+ files together
later.

### 3.5 Reverse links (the internal-linking lever)

Also worth one line in the same PR or the next: `/docs/` and `/how-it-works/` should link **out** to the
relevant deep-dive post once one exists. A blog nobody links to from the pages that already get traffic
is a blog nobody reads.

---

## 4. sitemap.xml, robots.txt, and a feed

### 4.1 sitemap.xml — one edit per post

The existing file is a flat `<urlset>` with 9 entries, all `lastmod 2026-07-16`. Add the index once, and
one entry per post. **Use the trailing-slash form** (the URL that returns 200):

```xml
  <url><loc>https://spec2jira.com/blog/</loc><lastmod>{{DATE_OF_NEWEST_POST}}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>
  <url><loc>https://spec2jira.com/blog/{{SLUG}}/</loc><lastmod>{{ISO_DATE}}</lastmod><changefreq>monthly</changefreq><priority>0.6</priority></url>
```

Rules:
- the blog index `lastmod` is bumped on **every** post (its content changed);
- a post's `lastmod` is its publication date, and is bumped only on a real edit (matching
  `dateModified` in the post's JSON-LD — the two must never disagree);
- keep `priority` below the product pages (`/` is 1.0, `/how-it-works` and `/pricing` are 0.8) — posts
  are support material, not the conversion surface;
- ⚠ the 9 existing entries use the **non-slash** form, which 301s. Harmless (crawlers follow), but
  inconsistent with the new entries. Cleaning them up is a **separate one-line-per-row PR** — do not
  bundle it with a post, so a content review stays a content review.

### 4.2 robots.txt — no change needed

```
User-agent: *
Allow: /

Sitemap: https://spec2jira.com/sitemap.xml
```

`Allow: /` already covers `/blog/`, and the sitemap is already declared. **Verified: nothing to change.**
(Do not add a `Disallow` for anything internal — `_redesign-docs` is already unreachable because Jekyll
excludes underscore directories, and a `Disallow` line would advertise the path.)

### 4.3 RSS/Atom — recommendation: **yes, and start it with post #1**

**Worth it for this audience.** The two named channels are Atlassian Community and LinkedIn, and the
readership is BAs, POs and developers in the Atlassian ecosystem — a population that still runs Feedly /
Inoreader, and (more usefully) the population whose aggregators, newsletters and community digests can
only pick you up if a feed exists. The cost is genuinely small: ~9 lines of XML per post, hand-written,
no build step, no dependency.

Two deviations from the KB's earlier sketch, stated openly:
- KB 12 §7 says "optional later, once ≥5 posts exist". **I recommend creating it with the first post
  instead** — the per-post cost is identical either way, and retrofitting means going back through five
  posts to reconstruct dates and descriptions. Starting it costs one extra file today.
- **RSS 2.0, not Atom.** Atom is stricter and less forgiving to hand-write; RSS 2.0 with the Atom
  self-link extension is universally consumed and is what most static sites emit.

`blog/feed.xml`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Spec2Tickets blog</title>
    <link>https://spec2jira.com/blog/</link>
    <atom:link href="https://spec2jira.com/blog/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Notes on writing specs teams can build from, AI in agile delivery, and privacy-first AI adoption — from the team behind Spec2Tickets for Confluence and Jira.</description>
    <language>en</language>
    <lastBuildDate>{{RFC822_DATE_OF_NEWEST_POST}}</lastBuildDate>

    <!-- newest item first -->
    <item>
      <title>{{TITLE_FULL}}</title>
      <link>https://spec2jira.com/blog/{{SLUG}}/</link>
      <guid isPermaLink="true">https://spec2jira.com/blog/{{SLUG}}/</guid>
      <pubDate>{{RFC822_DATE}}</pubDate>
      <category>{{CATEGORY}}</category>
      <description>{{DEK}}</description>
    </item>

  </channel>
</rss>
```

`pubDate` must be RFC-822 with a correct weekday — generate it, do not hand-write it (Git Bash has GNU
`date`):

```bash
date -R -u -d 2026-08-01          # -> Sat, 01 Aug 2026 00:00:00 +0000
```

Also add the discovery link to the `<head>` of `/blog/` and every post (already in both templates):

```html
<link rel="alternate" type="application/rss+xml" title="Spec2Tickets blog" href="/blog/feed.xml">
```

Validate before merging: <https://validator.w3.org/feed/> (paste the file, no account needed).

---

## 5. Accessibility + performance rules (do not regress these)

The site already does these things well. A blog post is the easiest place to break them, so they are
written as rules, not aspirations.

### 5.1 Accessibility

1. **Skip link first.** `<a class="skip-link" href="#main">Skip to content</a>` is the first element in
   `<body>`, and `<main id="main">` exists. Both templates have it — do not drop it.
2. **One `<h1>` per page**, and no skipped levels. Post body starts at `<h2>`. On the index the `<h1>` is
   the blog title and the visually-hidden `<h2 class="sr-only">All posts</h2>` keeps the card `<h3>`s from
   dangling. Verify with: `grep -oE '<h[1-6]' blog/<slug>/index.html`.
3. **Focus is inherited, not re-styled.** `site.css` already defines
   `:where(a,button,input,select,textarea,summary,[tabindex]):focus-visible { outline: 2px solid var(--blue-500); }`.
   Never add `outline: none` in a page-scoped block.
4. **Contrast (my measurements against the site tokens, on `--paper` #FFFFFF):**
   - `--text-700` #3E4C61 → **8.7:1** — body text. Safe everywhere.
   - `--text-500` #64748B → **4.75:1** — passes AA for normal text **on white only**. On the
     `--mist-50` #F6F8FB alt-section background it drops to **≈4.4:1 and fails**. So: keep `.post-meta`
     and `.muted` text on white surfaces, or switch to `--text-700` inside `.section--alt`.
     *(One pre-existing instance on `/how-it-works` sits in that borderline case; the rule here is
     "don't add more", not a claim that the site is flawless.)*
     ⚠ **Scope: text the post author controls.** The shared `.table` component itself pairs those two
     tokens — `site.css` sets `.table thead th { color: var(--text-500); background: var(--mist-50); }`,
     and `.table tbody tr:nth-child(even)` is also `--mist-50`. So a post that uses the prescribed table
     **cannot** satisfy a blanket reading of this rule. That is a **pre-existing condition of the frozen
     `site.css`**, present on `/docs`, `/dpa`, `/get-api-key` and `/subprocessors` today, and it is
     **explicitly exempt** here: the blog must not fork or override `site.css` to fix it. What the rule
     binds is the text the author writes — `.post-meta`, `.muted`, and any inline colour choice. [GAP:
     `.table thead th` contrast — a site-wide `site.css` fix, owner: founder/site repo; out of scope for
     a content PR.]
   - `--blue-600` #1D6FE0 → **4.77:1** — the link colour, passes. `--blue-500` #2684FF → **3.6:1** and
     **fails for text**; it is an icon/accent/border colour only. Never restyle a link to `--blue-500`.
5. **`<time datetime="YYYY-MM-DD">`** for every date, so the machine-readable value exists.
6. **Alt text on every image**, and no meaning conveyed by colour alone in a diagram.
7. **Decorative glyphs get `aria-hidden="true"`** — that is the established site pattern for the `→`
   arrow, the `ℹ` in callouts and the `&middot;` separators.
8. **Reduced motion is already honoured** globally (`.reveal` is JS-gated, and the media query kills
   transitions). Do not add CSS animation in a page-scoped block.
9. **Language is `en`** on `<html>`, and all published copy is English (binding KB rule 10).
10. **Scrollable regions are keyboard-focusable.** Anything with `overflow-x: auto` that can actually
    overflow — `<pre>` and `.table-wrap`, both of which `site.css` sets to `auto` — must carry
    `tabindex="0" role="region" aria-label="…"`. Without `tabindex="0"` a keyboard-only or
    switch-device reader can **never scroll it** and simply cannot reach the clipped content (WCAG 2.1.1
    Keyboard; the standard fix for a scrollable box that contains no focusable element). `role="region"`
    plus a short `aria-label` is what stops a screen reader announcing an unnamed focus stop — a
    `tabindex="0"` with no name is its own defect, so **never add one without the other two**. The blog
    introduces the site's **first `<pre>`** (zero exist today), so this is the precedent, not a retrofit;
    the four existing `.table-wrap` instances lack it, and the blog does not copy that gap forward.
    Verify: every `<pre` and every `table-wrap` in the file has all three attributes.

### 5.2 Performance

1. **No external requests. Ever.** The site self-hosts both webfonts (OFL, in `/assets/fonts/`) and has
   no CDN, no analytics, no embed. A blog post is the classic place someone pastes a Google Fonts tag, a
   YouTube iframe, a Gist embed or a CDN highlighter. Any of those breaks the privacy-first story the
   product is sold on. Check before merging:
   ```bash
   grep -oE '(src|href)="https?://[^"]+"' blog/<slug>/index.html | grep -v 'spec2jira.com' | grep -v 'marketplace.atlassian.com'
   # expected: only the intentional external links you added (each with rel="noopener")
   ```
2. **Keep the head order identical** to the existing pages (charset → viewport → title → description →
   theme-color → canonical → icon → font preloads → css preload → stylesheet → OG → Twitter → JSON-LD →
   `site.js` → page-scoped `<style>`). The two font preloads plus the CSS preload are what make the first
   paint fast; a post that omits them will visibly flash.
3. **One `<script>`: `/assets/js/site.js` with `defer`.** No inline JS, no third-party widgets. If a post
   needs an interactive demo, it is a separate conversation, not a paste.
4. **Images:** `width`+`height` always, `loading="lazy"`+`decoding="async"` below the fold, ≤200 KB each.
5. **Keep the page-scoped `<style>` block small** (see §2.1); promote to `/assets/css/blog.css` if it
   outgrows ~80 lines.
6. **No web-font additions.** The two variable fonts already loaded cover display + body.

---

## 6. Publishing workflow

### 6.1 Why every post is a PR — and who runs this

`main` on `alexace21/spec2jira-site` **is production** — GitHub Pages rebuilds and serves within a minute
of a push, there is no staging, no CI in the repo (verified: no `.github/` directory), and nothing
validates the HTML. So the human review of the diff **is** the entire quality gate. AI-drafted content
never goes straight to `main`.

> ⛔ **The founder runs every command below. No agent touches the site repo — ever.**
> Not "an agent in a PR branch", not "an agent that only creates files". The site repo is public, one
> push is a live publication to every reader and crawler, and the review of the diff is the *only* gate
> that exists — an agent that can open the PR has already written to the surface being reviewed. This
> engine's write boundary is `docs/marketing-kb/drafts/` in the **forge** repo; the site repo is
> **founder-operated, read-only to everything else**. An agent may draft the HTML *into a draft file
> here*, and the founder copies it across. The steps below are therefore a **runbook for the founder**,
> not an automation script.

```bash
# 1. Branch (from the site repo root)
git checkout main && git pull
git checkout -b blog/<slug>

# 2. Create the files
#    blog/<slug>/index.html          (post)
#    blog/index.html                 (new card, newest first + JSON-LD blogPost entry)
#    blog/feed.xml                   (new <item>, newest first + lastBuildDate)
#    sitemap.xml                     (new <url> + blog-index lastmod bump)
#    [only if the nav decision is made] the 10 existing HTML files

# 3. Preview locally — absolute /assets paths mean you must serve from the repo ROOT
python -m http.server 8080
#    open http://localhost:8080/blog/  and  http://localhost:8080/blog/<slug>/
#    NOTE: extensionless links like /docs will 404 locally (GitHub Pages 301s them). Not a bug.

# 4. Run the checks in §6.2, then:
git add -A && git commit -m "blog: <post title>"
git push -u origin blog/<slug>
gh pr create --fill --base main
```

The founder reviews the **rendered** page (not just the diff) and merges. Merge = publish. The reviewer
and the merger are the same person who ran the commands — that is the point; there is no second gate
behind them.

> ⛔ **No internal claims material in the PR description.** The site repo is public, so **its PR
> descriptions are public**. The brief, the filled claims check, the provenance block, Table A row ids,
> the blocked-claims list, `[GAP]` entries, KB filenames, and anything about pricing state or the welcome
> credit stay in the **forge** repo. `gh pr create --fill` uses the commit message, so keep that to
> `blog: <post title>` and let the description carry one line and nothing else:
> `Claims check: <BRIEF ID> — passed, recorded internally.` Writing out what we may not say publishes it,
> and reads as a confession of what we nearly said. Same rule in `EDITORIAL-CALENDAR.md` §6.1 and the
> `marketing-content` skill §4.

**Optional hardening:** the repo is public, so GitHub's branch rulesets are available on the free plan —
a rule on `main` requiring a pull request would make "never push a post directly" mechanical instead of
remembered. *(Verify in Settings → Rules; free-plan rule availability differs between public and private
repos.)*

### 6.2 Pre-publish checklist

Run top to bottom. **Any unchecked box blocks the merge.**

**A. Claims firewall — `13-claims-register.md` governs every sentence**
- [ ] Every number, name and factual claim traces to **Table A**. Anything not in Table A was cut, not guessed.
- [ ] Scanned against **Table B**: no retired claim survived (in particular: no EUR figure, no
      "3 breakdowns/month" free tier, no "only BYOK app", no "zero data retention", no perfection or
      "no review needed" promise, no sub-minute speed claim).
- [ ] Nothing from **Table C** appears, even paraphrased: no unit economics, no enforcement/env-var
      internals, no dev-site or project names, no incident history, no install/review counts, no
      bank/tax/address details.
- [ ] ⛔ **Publication gate CHECKED TODAY, not assumed** — load **https://spec2jira.com/pricing** and read
      what it actually serves. **A flat site price still on it ⇒ no price figure anywhere in the post**,
      and `/pricing` stays a banned link target. **The corrected page (free ≤10, then per user on a
      declining curve) ⇒ the figures and `/pricing` links are cleared, with no further sign-off**, and the
      price boxes in this checklist stop applying. ⚠ The correction is written and staged but **unpushed**
      — so "it's fixed in the repo" is not the answer; the served page is. Where the shape is needed it
      comes from **`13-claims-register.md` A2.1, quoted verbatim** — this document carries no version of
      its own. Where a number is expected while the gate is closed, use **A2.9**: *"The Marketplace always
      shows the exact price for your team size before you subscribe."*
- [ ] ⚠ **Every free-tier sentence is A2.1, verbatim.** The rule, and the test for what counts as
      qualified, live in **`13-claims-register.md` (row A2.1 + the qualification test under the A2
      table)** — read it there; nothing in this checklist restates it. This binds **every** occurrence:
      body copy, headings, meta description, social card text and the CTA band. ⛔ Verbatim reuse of the
      live homepage's shorter line is **not** an exemption (settled ruling, 2026-07-25). The **one** ruled
      exemption is the `Start for free` **button label** as shared chrome (§2.2 ruling) — the sweep below
      deliberately **matches** it rather than skipping it, so it is classified consciously each time.
      Find every occurrence mechanically, then check each one:
      ```bash
      grep -niE 'free|10 users|small teams?' blog/<slug>/index.html
      # EXPECT exactly 2 chrome hits — the `Start for free` button in the nav and in the closing CTA
      #   band (blog/index.html: the same 2). Those are the ruled exemption, and nothing else is.
      # EVERY other hit is either A2.1 verbatim, or says nothing about the free tier.
      # A 3rd "Start for free", or any reworded button ("Free for small teams"), is NOT exempt.
      ```
- [ ] ⛔ **Every surviving HTML comment is neutral — checked by sweep, not by marker.** Comments are
      served to readers and crawlers. Stripping the `AUTHORING NOTE` marker line is **not** sufficient:
      the guidance was fused into banner comments that stay, so deleting the marker leaves the internal
      prose in the published HTML. So: list **every** remaining comment and require each to match the
      neutral whitelist (`NAV [component 1]`, `FOOTER [component 21]`, `POST HEADER`, `POST BODY`,
      `CLOSING CTA`, `PAGE HEADER`, `POST LIST (newest first)`). No comment may carry guidance,
      rationale, review history, a claim id, or any reference to an internal document.
      ```bash
      # Multi-line-safe sweep: normalises each comment to one line, then subtracts the whitelist.
      # Anything printed is a comment that must be deleted or reduced to a bare banner.
      for f in blog/<slug>/index.html blog/index.html; do
        perl -0777 -ne 'while (/<!--(.*?)-->/gs) { my $c=$1; $c =~ s/\s+/ /g; $c =~ s/^ | $//g; print "$c\n" }' "$f"
      done | grep -vxE '=+ (NAV \[component 1\] .*|FOOTER \[component 21\] .*|POST HEADER|POST BODY|CLOSING CTA|PAGE HEADER|POST LIST \(newest first\)) =+'
      # must return NOTHING
      ```
- [ ] ⛔ **No welcome-credit claim of any kind** — no "$5", no "free AI credit", no "start without an API
      key", no frictionless-onboarding angle. Decided, not shipped.
- [ ] **No invented customers, quotes, testimonials, logos or metrics.** There are no case studies.
- [ ] Any internal-validation figure carries the words **"internal validation"**, the **run date**, and no
      customer framing.
- [ ] Any competitor fact carries its **"as of <date>"** and is factual, never disparaging.
- [ ] **Privacy/compliance sentences are quoted from the live site** (`/privacy`, `/dpa`,
      `/subprocessors`), never re-drafted and never made stronger. *(The forge repo's `docs/compliance/*`
      are stale — never source from them.)*
- [ ] No implied partnership, endorsement or certification by **Atlassian** or **Anthropic**.

**B. Trademarks + spelling**
- [ ] **Jira**, **Confluence**, **Atlassian Forge**, **Atlassian Marketplace**, **Anthropic Claude** —
      correct case; **never "JIRA" in prose**.
- [ ] **Spec2Tickets** = the product; **Spec2JIRA** = the vendor/domain. The split is intentional — do not
      "fix" it. No `Spec2tickets`, `Spec2Jira`, `Spec 2 Tickets`.
- [ ] Epic / Stories / Subtasks capitalised consistently when naming Jira objects.
- [ ] **English only.**

**C. Links**
- [ ] Internal links use the **trailing slash** (`/docs/`, `/how-it-works/`, `/blog/`) so nothing 301s.
- [ ] Every external link has `target="_blank" rel="noopener"`.
- [ ] The Marketplace URL is exactly
      `https://marketplace.atlassian.com/apps/1475765564/spec2tickets-for-confluence-and-jira`.
- [ ] At least one link out to a product page — `/how-it-works/`, `/docs/`, `/get-api-key/`.
- [ ] ⛔ **No editorial link to `/pricing` while the publication gate is closed** (the same check as the
      price box above — load the page). While a flat figure is still served it is a banned link target
      (EDITORIAL-CALENDAR.md §0; claims register B17): sending a reader there publishes the retired price
      by proxy, and a post that is otherwise price-clean still lands them on it. Link the **Marketplace
      listing** instead — it shows the reader the true price for their own team size. *(Exempt: the shared
      nav and footer, which link `/pricing` on all 10 pages and must stay byte-identical. The ban is on
      links written into the post body, and on the "product page" item above.)* `/pricing` links come back
      **the day the check passes** — no separate approval; it is gate #1 in §7.
      ```bash
      # the nav+footer chrome accounts for exactly 3 /pricing hrefs; anything above 3 is an editorial link
      grep -c 'href="/pricing' blog/<slug>/index.html   # must be 3
      ```
- [ ] All links resolve — list them and check:
      ```bash
      grep -oE 'href="[^"#]+"' blog/<slug>/index.html | sed 's/href="//;s/"$//' | sort -u
      ```

**D. Head, meta, social**
- [ ] `<title>` ≤ 60 chars including the ` — Spec2Tickets` suffix; description 120–160 chars.
- [ ] `canonical` = `og:url` = the real trailing-slash URL; both absolute `https://spec2jira.com/...`.
- [ ] `og:type` is **`article`** on a post (`website` on the index).
- [ ] `og:image` is absolute and 1200×630 — `https://spec2jira.com/og-image.png` until per-post cards
      exist; `twitter:card` is `summary_large_image`.
- [ ] JSON-LD parses (paste into <https://validator.schema.org/>) and its `datePublished` /
      `dateModified` match the visible date and the sitemap `lastmod`.
- [ ] `{{N}} min read` was **computed** (§2.2 command), not estimated.

**E. Files that must change together**
- [ ] `blog/<slug>/index.html` created.
- [ ] `blog/index.html` — new card **at the top** + a `blogPost` entry in the JSON-LD.
- [ ] `blog/feed.xml` — new `<item>` **first**, `lastBuildDate` bumped, `pubDate` generated with `date -R`.
- [ ] `sitemap.xml` — new `<url>` + blog-index `lastmod` bumped.
- [ ] Nav/footer blocks in the new files are **byte-identical** to the rest of the site:
      ```bash
      for f in $(find . -name '*.html' -not -path './.git/*'); do
        sed -n '/<header class="site-header">/,/<\/header>/p' "$f" | md5sum | cut -c1-8; done | sort -u
      # must print exactly ONE hash (today: 0879cd00). Same test for the footer (today: a21fbfd6).
      ```

**F. Accessibility + performance** (§5)
- [ ] One `<h1>`, no skipped heading levels, skip-link present, `<main id="main">` present.
- [ ] Every image has `alt`, `width`, `height`; below-the-fold images are `loading="lazy"`.
- [ ] No off-domain `src`/`href` other than intentional external links (grep in §5.2).
- [ ] **Scrollable regions are keyboard-focusable** (§5.1.10): every `<pre>` and every `.table-wrap`
      carries `tabindex="0"`, `role="region"` **and** a meaningful `aria-label`. All three or none —
      a named region is the point; an unnamed focus stop is its own defect.
      ```bash
      grep -oE '<(pre|div class="table-wrap")[^>]*' blog/<slug>/index.html
      # every line must show tabindex="0", role="region" and aria-label="…"
      ```
- [ ] **Author-controlled `--text-500` text is on a white surface**, not on `--mist-50` — `.post-meta`,
      `.muted`, and any inline colour choice. *(Scoped deliberately: the shared `.table` component pairs
      `--text-500` on `--mist-50` in its own `thead`, which a post using the prescribed table cannot
      avoid. That is a pre-existing condition of the frozen `site.css` — see §5.1.4 — and is **exempt**;
      never fork or override `site.css` to satisfy this box.)*
- [ ] **Only if this PR also edits the nav (§3.2):** the home page renders correctly at **861px, 900px
      and 1024px** with `Start for free` fully visible and un-wrapped. 861px is the tightest desktop
      width (the hamburger takes over at ≤860px), and "Blog" makes a **sixth** item on that row across
      all 10 pages at once. If it does not fit: Option B (footer only) or a shorter label — **never** a
      `site.css` edit.

**G. Screenshot safety** (if the post has product images)
- [ ] No dev-site or project names visible (`spec2jira-dev`, `SDTY`, `SCRUM-DEV`, `alexacenov`, …).
- [ ] No customer or personal data, no API key fragment, no email address in a screenshot.
- [ ] **No retired price string visible.** ✅ The engineering half is **closed** — `src/usage.js` was
      re-read on 2026-07-25 and renders no retired figure (it states the shape and defers to the
      Marketplace). So the Account/Settings panel is no longer off-limits *as a screen*; what remains is
      to confirm the **capture** came from a build carrying the corrected strings, i.e. the next box.
- [ ] Screenshots reflect the **current UI** (the app was substantially redesigned in July 2026 — older
      captures are stale).

**H. After merge (auto-deploy takes ~1 minute)**
```bash
curl -s -o /dev/null -w "%{http_code}\n" https://spec2jira.com/blog/
curl -s -o /dev/null -w "%{http_code}\n" https://spec2jira.com/blog/<slug>/
curl -s -o /dev/null -w "%{http_code}\n" https://spec2jira.com/blog/feed.xml
```
- [ ] All three return **200**.
- [ ] The social card renders (paste the URL into the LinkedIn Post Inspector, or simply into a draft post).
- [ ] Only then: schedule the 3–5 derived social posts (KB 12 §8 — the blog post is the canonical home,
      social links back to it).

---

## 7. What blocks a first post

**Genuine blockers (a post cannot ship correctly without these):**

| # | Blocker | Owner | Note |
|---|---|---|---|
| 1 | **Is the corrected `/pricing` page LIVE?** A condition to test, not a status to quote: **load https://spec2jira.com/pricing.** A flat site price still served ⇒ blocked. The corrected page ⇒ cleared. | Founder / site repo | ⚠ **The correction EXISTS but is UNPUSHED** — paste-ready at `docs/marketing-kb/drafts/SITE-PRICING-COPY-CORRECTED.md` and edited into the founder's site-repo working tree, but not committed (site `HEAD` = `b1cdfe0`), so the served page was unchanged at the last check (2026-07-25). Written ≠ live: do not publish figures early on the strength of the draft. Not a blocker for a *non-pricing* post — it **is** a blocker for any post that mentions price, and it **bans `/pricing` as a link target** (§2.4, §6.2-C). Both restrictions lift **the day the check passes**, with no further sign-off — and are then deleted, not re-justified. |
| 2 | **Nav vs footer placement decision.** | Founder | §3.4. Deferrable, but then the blog is unreachable except by direct link — which defeats the point. |
| 3 | **Author identity decision.** | Founder | Person byline (`Aleks Asenov` — public per claims register A3.11) vs Organization byline. Changes both the visible `.post-meta` line and the JSON-LD `author` block. |

**Not blockers (contrary to older notes):**

- ~~`og-image.png` export pending~~ — **resolved.** The file is in the repo and live (verified 200,
  1200×630, 140 KB). Posts ship with the site-wide card today. *Per-post* OG images
  (`/blog/<slug>/og.png`) remain a nice-to-have: they measurably lift click-through on LinkedIn, but they
  need a repeatable 1200×630 template, which does not exist yet. **[GAP: a per-post OG card template —
  design task, not a launch blocker.]**

**Open gaps that shape what the first posts can be about:**

| # | Gap | Effect |
|---|---|---|
| 4 | **No current-UI marketing screenshots.** The app UI changed substantially in the July 2026 redesign and existing captures are stale. ✅ **The price half of this gap is CLOSED** — `src/usage.js` no longer renders a retired price (re-read 2026-07-25), so the Account panel is not itself off-limits; the block now rests **only** on the captures being stale. | The **product-tour pillar (4) still cannot ship** — it is screenshot-led by definition and no current capture exists. Start with pillars 1–3 (spec craft, AI in agile, privacy), which need no images at all. Capture fresh screenshots on a clean demo site, **from a build carrying the corrected price strings**, before the first tour post. |
| 5 | **No analytics.** No script on any page; the brand is privacy-first, so the choice is not neutral. | Blog impact is measurable **only** indirectly (Marketplace installs, via the vendor-side reporting run). **[GAP: founder picks a privacy-friendly, cookieless, no-personal-data tool — or consciously decides to run blind.]** Whatever is chosen becomes a new external request on every page, which contradicts §5.2 — a self-hosted or log-based option is the more consistent answer. |
| 6 | **Pillar 5 (founder build-in-public) is unapproved.** | Do not draft `Notes from the build` posts until the founder approves the pillar and its boundaries. |
| 7 | **No keyword validation.** The SEO seed list is unvalidated (no volume/difficulty data, no tool). | Write for the reader first; treat the seed terms as titles-and-headings guidance, not as a targeting plan. |
| 8 | **Live listing copy is not captured in the KB.** | Blocks release-note posts specifically: pull the live listing title/tagline/highlights/release notes verbatim, with a fetch date, before writing one. |
| 9 | **Existing canonical URLs point at the 301 (non-slash) form**, and the sitemap lists the same. | Harmless but untidy; it is why the blog deliberately uses the slash form. A separate 10-line cleanup PR — never bundled with a content PR. |

**One standing hazard, unrelated to content:** do **not** add a `.nojekyll` file to the site repo. It
would disable the default Jekyll build and start serving `/_redesign-docs/*` — the internal design
documents — publicly. They are currently 404 only because Jekyll excludes underscore-prefixed
directories (verified live).

---

## Provenance

- **KB files used:** `13-claims-register.md` (governing — Tables A/B/C, the pricing publication gate, the
  welcome-credit block), `README.md` (the 11 binding rules), `12-marketing-strategy-channels.md`
  (§5 pillars, §7 blog proposal, §8 repurposing, §9 review motion, consolidated gaps),
  `08-brand-voice-visual.md` (§1.4 spelling, §2.3 signature phrases, §2.4 CTA conventions, §6 asset
  inventory).
- **Table A claims used in the templates:** A1.10 (Marketplace name + URL), **A2.9** (the CTA band's
  price deflection; the templates carry **no** free-tier sentence — a post that needs one quotes **A2.1**
  verbatim, per §2.2), A1.2 (footer tagline, verbatim), A1.5 ("minutes, not days" — as the live CTA copy
  "Minutes instead of days"), A3.11 (public founder facts, for the byline option). **No pricing figure is
  used anywhere, and `/pricing` is not linked** while the publication gate is closed (B17 — check the
  live page; the correction is written but unpushed). The `Start for free` button label is chrome, exempt
  by the §2.2 ruling.
- **Deviations from KB 12 §7, stated openly:** (a) canonical/sitemap/links use the **trailing-slash** URL
  form, because `/docs` demonstrably 301s to `/docs/` — §7 sketched the non-slash form; (b) the RSS feed
  is recommended **from post #1** rather than "after ≥5 posts", because the per-post cost is identical and
  retrofitting is not; (c) the recommendation is **nav + footer**, not either/or.
- **Deviation from the live site, deliberate:** the CTA band drops the free-tier *clause* the live homepage
  carries (*"Free up to 10 users …"*) and closes on BYOK + Marketplace + **A2.9** instead — while keeping
  the site's `Start for free` **button label**, which §2.2 rules exempt as shared chrome. **Verbatim
  reuse of already-published copy is not a claims exemption** — settled and binding (conductor ruling,
  2026-07-25), recorded in `13-claims-register.md` under the A2.1 qualification test and carried
  identically by `EDITORIAL-CALENDAR.md` §0 and the `marketing-content` skill. The three artifacts agree;
  there is no open decision. That homepage line is part of the same **written-but-unpushed** site
  correction as `/pricing`.
- **A11y additions the site does not yet have:** `tabindex="0" role="region" aria-label` on `<pre>` and
  `.table-wrap`. The blog introduces the site's first `<pre>` (zero exist today); the four existing
  `.table-wrap` instances lack the attributes, and the blog does not copy that gap forward. Conversely,
  the `.table thead` contrast pair (`--text-500` on `--mist-50`) is a **frozen-`site.css` pre-existing
  condition**, explicitly exempted rather than worked around — **[GAP: site-wide `.table thead` contrast
  fix; founder/site repo.]**
- **Gaps hit:** `[GAP: nav vs footer placement — founder]` · `[GAP: author byline identity — founder]` ·
  `[GAP: per-post OG card template — design]` · `[GAP: current-UI screenshots — founder/product]` ·
  `[GAP: privacy-friendly analytics choice — founder]` · `[GAP: pillar 5 approval — founder]` ·
  `[GAP: /pricing page correction PUSHED LIVE — founder/site repo; the copy is written and staged, the
  push is what is missing. Gates all pricing-adjacent posts AND all /pricing links, and is resolved by
  loading the page, not by reading a document]` · `[GAP: .table thead contrast (--text-500 on --mist-50) —
  a site-wide site.css fix, founder/site repo, out of scope for a content PR]`.
- **Verification performed 2026-07-25:** live `curl` status checks (`/docs` 301 → `/docs/` 200;
  `/_redesign-docs/03-design-concept.md` 404; `/og-image.png` 200, 1200×630); repo-wide md5 comparison of
  the nav and footer blocks across all 10 HTML files; full read of `assets/css/site.css` (1425 lines) and
  `assets/js/site.js`; grep for `<img>` (zero hits) and for a Jekyll/CI config (none).
- **Explicitly guessed markup (nothing else is invented):** the four `.post-*` selectors in §2.1 and the
  two index-card selectors, the `<figure class="post-figure">` image pattern (no image convention exists
  on the site), the human date format, the reading-time formula, and the category label names in §1.4.
  Everything else is copied from existing site files or composed from existing `site.css` classes.
