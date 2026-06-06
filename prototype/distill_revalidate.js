#!/usr/bin/env node
/**
 * Re-validate the distill FIX on the real FlexiCash context (which exposed the bug).
 * Re-distills Domain + Conventions with the FIXED prompts (imported single-source from
 * src/anthropic_client.js) and asserts the decisive tests:
 *   1. Domain — no injected normative emphasis (must-preserve / never-collapse / unresolved-tension).
 *   2. Conventions — no fabricated "document requirements immutable" rule.
 *   3. Conventions — JIRA structure (epic/story/subtask) + anti-templating guidance PRESERVED.
 *   4. Conventions — canonical reference-data tables (band ranges, pricing) ABSENT.
 *   5 (info) — the correct rules (bureau hold-and-retry, uplift A/E) retained.
 * Needs ANTHROPIC_API_KEY. RUNS env (default 2). ~$0.03/run (2 Haiku calls).
 */
import { DISTILL_CATEGORIES, distillCategory } from '../src/anthropic_client.js';
import { readFileSync } from 'node:fs';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) { console.error('Set ANTHROPIC_API_KEY'); process.exit(1); }
const SRC = 'C:/Software Engineer/Success/Spec2Tickets/pages/ProjectContext_FlexiCash_Lending.md';
const source = readFileSync(SRC, 'utf8');
const RUNS = Number(process.env.RUNS || 2);
const domain = DISTILL_CATEGORIES.find((c) => c.key === 'domain');
const conv = DISTILL_CATEGORIES.find((c) => c.key === 'conventions');
const lc = (s) => String(s == null ? '' : s).toLowerCase();
const row = (ok, lbl) => console.log('  ' + (ok ? '✅' : '❌') + ' ' + lbl);

let allPass = true;
for (let run = 1; run <= RUNS; run++) {
  const d = await distillCategory({ text: source, category: domain, apiKey, model: 'claude-haiku-4-5' });
  const c = await distillCategory({ text: source, category: conv, apiKey, model: 'claude-haiku-4-5' });
  if (d.error || c.error) { console.error('distill error:', d.error || c.error, d.detail || c.detail); process.exit(1); }
  const dT = lc(d.section);
  const cT = lc(c.section);

  const domainClean = !/must be preserved|never[^.]{0,15}collapse|collapse into|silently collapsed|must all be honoured|intentionally[^.]{0,20}unresolved|unresolved[^.]{0,20}tension/.test(dT);
  const noFabImmutable = !/document[^.]{0,40}immutable|requirements[^.]{0,25}immutable|immutable once set/.test(cT);
  const jiraPresent = /epic/.test(cT) && /story|stories/.test(cT) && /subtask/.test(cT);
  const antiTemplating = /fixed template|actual work|not.{0,12}template|reflect.{0,20}work/.test(cT);
  const noRefData = !/\b881\b|\b721\b|6\.90|24\.90/.test(cT);
  const bureauRule = /hold.{0,6}retr|holds and retr/.test(cT);
  const upliftRule = /uplift/.test(cT);

  console.log(`\n========== RUN ${run} ==========`);
  row(domainClean, 'Domain: NO fabricated emphasis (must-preserve / never-collapse / unresolved-tension)');
  row(noFabImmutable, 'Conv:   NO fabricated "document requirements immutable" rule');
  row(jiraPresent, 'Conv:   JIRA structure (epic / story / subtask) PRESERVED');
  row(antiTemplating, 'Conv:   anti-templating guidance PRESERVED');
  row(noRefData, 'Conv:   canonical reference-data (band ranges / pricing) ABSENT');
  row(bureauRule, '(info)  bureau hold-and-retry retained');
  row(upliftRule, '(info)  behavioural uplift rule retained');
  const pass = domainClean && noFabImmutable && jiraPresent && antiTemplating && noRefData;
  allPass = allPass && pass;
  if (run === 1) {
    console.log('\n--- DOMAIN (run 1) ---\n' + d.section);
    console.log('\n--- CONVENTIONS (run 1) ---\n' + c.section);
  }
}
console.log('\n' + (allPass ? '✅✅ ALL 5 DECISIVE TESTS PASS (every run)' : '❌ SOME DECISIVE TEST FAILED'));
