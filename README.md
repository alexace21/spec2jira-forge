# Spec2Tickets

A Confluence **Forge** app (Custom UI) that turns a specification page into a
structured JIRA breakdown — an Epic, Stories, Subtasks, cross-feature dependency
links, and category labels — using **Anthropic Claude Sonnet 4.6** with
structured outputs.

**BYOK (bring your own key):** you provide your own Anthropic API key in
Settings. There is no Spec2Tickets-operated backend — the app runs entirely on
Atlassian Forge, and your key calls Anthropic directly.

## How it works

```
Confluence spec page
  → Generate   (Anthropic Message Batches API — async, polled)
  → Review     (in-app editor + quality signals)
  → Push       (chunked, attributed to you via asUser → JIRA)
JIRA: 1 Epic + N Stories + Subtasks + Story-blocks-Story links + labels
```

- **Generate** submits the page to the Anthropic Batches API and polls until the
  breakdown is ready (sync calls would exceed Forge's async timeouts on large specs).
- **Review** lets you edit features, acceptance criteria, and tasks before
  anything is written to JIRA.
- **Push** creates the issues in bounded chunks to stay within Forge's 25-second
  resolver limit, with a progress bar.

## Setup

1. Install the app into **both** Confluence and Jira — it is a cross-product app,
   so two entries in *Manage Apps* is expected and normal.
2. Open **Settings → Spec2Tickets** and provide your Anthropic API key and a
   default JIRA project key.
3. Open the Spec2Tickets global page, pick a Confluence spec page, and generate.

## Development

```bash
# Build the Custom UI
cd static/hello-world && npm run build && cd ..

# Deploy (code-only changes)
forge deploy

# Reinstall — only when manifest.yml scopes/modules change (pick Confluence AND Jira)
forge install --upgrade

# Watch logs
forge logs --since 5m
```

> ⚠ Do **not** run `npm audit fix --force` in `static/hello-world` — it breaks
> react-scripts (CRA). Recovery is documented in `CLAUDE.md`.

## Engineering docs

- **`CLAUDE.md`** — architecture, the hard-won Forge platform gotchas, current state.
- **`POLICY.md`** — the binding engineering philosophy (LENS, Analyze→Design→Solve,
  pure-function-vs-LLM dispatch rule, prompt-engineering slots).
