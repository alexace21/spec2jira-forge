/**
 * Breakdown Editor — Shared Constants
 * Light theme (Swagger palette) — April 14, 2026
 */

export const TASK_TYPES = ['API', 'UI', 'DB', 'INTEGRATION', 'SECURITY', 'TESTING', 'INFRA', 'ML', 'REPORTING'];

export const TASK_TYPE_COLORS = {
  API:         'bg-blue-50 text-blue-700 ring-blue-200',
  UI:          'bg-violet-50 text-violet-700 ring-violet-200',
  DB:          'bg-amber-50 text-amber-700 ring-amber-200',
  INTEGRATION: 'bg-cyan-50 text-cyan-700 ring-cyan-200',
  SECURITY:    'bg-red-50 text-red-700 ring-red-200',
  TESTING:     'bg-emerald-50 text-emerald-700 ring-emerald-200',
  INFRA:       'bg-orange-50 text-orange-700 ring-orange-200',
  ML:          'bg-pink-50 text-pink-700 ring-pink-200',
  REPORTING:   'bg-indigo-50 text-indigo-700 ring-indigo-200',
};

export const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export const PRIORITY_COLORS = {
  CRITICAL: 'bg-red-50 text-red-700 ring-red-200',
  HIGH:     'bg-orange-50 text-orange-700 ring-orange-200',
  MEDIUM:   'bg-yellow-50 text-yellow-700 ring-yellow-200',
  LOW:      'bg-gray-100 text-gray-500 ring-gray-200',
};

export const PRIORITY_ICONS = {
  CRITICAL: '🔴',
  HIGH:     '🟠',
  MEDIUM:   '🟡',
  LOW:      '⚪',
};

export const STORY_POINTS = [1, 2, 3, 5, 8, 13];

export const SP_LABELS = {
  1:  'XS (1)',
  2:  'S (2)',
  3:  'M (3)',
  5:  'L (5)',
  8:  'XL (8)',
  13: 'XXL (13)',
};

export const SP_COLORS = {
  1:  'bg-gray-100 text-gray-600 ring-gray-200',
  2:  'bg-gray-100 text-gray-700 ring-gray-200',
  3:  'bg-blue-50 text-blue-700 ring-blue-200',
  5:  'bg-blue-100 text-blue-800 ring-blue-200',
  8:  'bg-amber-50 text-amber-700 ring-amber-200',
  13: 'bg-red-50 text-red-700 ring-red-200',
};

export const JIRA_TYPE_LABELS = {
  capability: 'JIRA Epic',
  feature:    'JIRA Story (carries SP)',
  task:       'JIRA Subtask (type label, no SP)',
};
