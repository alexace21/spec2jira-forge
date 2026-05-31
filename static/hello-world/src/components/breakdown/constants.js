/**
 * Breakdown Editor — Shared Constants
 * Light theme (Swagger palette) — April 14, 2026
 */

// v3 task-type enum — mirrors the model schema in src/prompts.js
// (BREAKDOWN_SCHEMA tasks[].type). Keep in sync with that enum.
export const TASK_TYPES = ['API', 'UI', 'DB', 'ML', 'OPS', 'DOC', 'TEST'];

export const TASK_TYPE_COLORS = {
  API:  'bg-blue-50 text-blue-700 ring-blue-200',
  UI:   'bg-violet-50 text-violet-700 ring-violet-200',
  DB:   'bg-amber-50 text-amber-700 ring-amber-200',
  ML:   'bg-pink-50 text-pink-700 ring-pink-200',
  OPS:  'bg-orange-50 text-orange-700 ring-orange-200',
  DOC:  'bg-cyan-50 text-cyan-700 ring-cyan-200',
  TEST: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
};
