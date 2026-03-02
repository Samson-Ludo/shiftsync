import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluateTemporalViolations, hasOverlap } from '../services/assignmentValidator.js';

test('hasOverlap detects overlapping windows', () => {
  const overlaps = hasOverlap(
    '2026-04-10T16:00:00Z',
    '2026-04-10T20:00:00Z',
    '2026-04-10T19:00:00Z',
    '2026-04-10T23:00:00Z',
  );

  assert.equal(overlaps, true);
});

test('evaluateTemporalViolations returns minimum rest violation when rest is below 10 hours', () => {
  const violations = evaluateTemporalViolations(
    {
      shiftId: 'shift-new',
      title: 'Morning Shift',
      startAtUtc: '2026-04-11T12:00:00Z',
      endAtUtc: '2026-04-11T16:00:00Z',
    },
    [
      {
        shiftId: 'shift-existing',
        title: 'Late Close',
        startAtUtc: '2026-04-11T03:00:00Z',
        endAtUtc: '2026-04-11T08:00:00Z',
      },
    ],
  );

  assert.equal(violations.some((violation) => violation.code === 'MIN_REST_NOT_MET'), true);
});