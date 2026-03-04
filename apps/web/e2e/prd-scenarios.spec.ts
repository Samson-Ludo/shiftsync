import { expect, test } from '@playwright/test';
import { DateTime } from 'luxon';
import {
  alignWeekStartForManagerShift,
  accounts,
  loginAs,
  logout,
  scenarioWeekStart,
  selectManagerLocation,
  selectManagerShift,
  selectStaffForAssignment,
  setDateRange,
  setWeekStartFilter,
} from './helpers';

let resolvedWeekStart = scenarioWeekStart();
const resolvedWeekEnd = () =>
  DateTime.fromISO(resolvedWeekStart, { zone: 'America/New_York' }).plus({ days: 6 }).toISODate() ??
  resolvedWeekStart;

test.describe.serial('PRD evaluator scenarios via web UI', () => {
  test('1) Overtime Trap shows what-if impact and overtime report evidence', async ({ page }) => {
    await loginAs(page, accounts.victorManager);
    resolvedWeekStart = await alignWeekStartForManagerShift(page, 'High-Hours Prep Block 13', resolvedWeekStart);
    await selectManagerShift(page, 'High-Hours Prep Block 13');
    await selectStaffForAssignment(page, 'Ethan Lopez');

    const weeklyHoursText = await page.getByText(/Weekly Hours:\s*\d+/).first().textContent();
    const weeklyHours = Number(weeklyHoursText?.match(/\d+/)?.[0] ?? 0);
    expect(weeklyHours).toBeGreaterThanOrEqual(40);
    await expect(page.getByText('Compliance what-if impact')).toBeVisible();

    await page.goto('/overtime');
    await setWeekStartFilter(page, resolvedWeekStart);

    const ethanRow = page.locator('li').filter({ hasText: 'Ethan Lopez' }).first();
    await expect(ethanRow).toBeVisible();
    await expect(ethanRow.getByText(/Overtime Hours:/)).toBeVisible();
    await expect(ethanRow.getByText(/Assignments that pushed overtime/i)).toBeVisible();

    await logout(page);
  });

  test('2) Timezone Tangle blocks cross-timezone overlap assignment', async ({ page }) => {
    await loginAs(page, accounts.mayaManager);

    await selectManagerLocation(page, 'Downtown LA');
    await setWeekStartFilter(page, resolvedWeekStart);
    await selectManagerShift(page, 'Timezone Tangle West');
    await selectStaffForAssignment(page, 'Benjamin Price');

    await expect(page.getByText(/Overlaps with assigned shift "Timezone Tangle East"\./)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Confirm Assign' })).toBeDisabled();

    await logout(page);
  });

  test('3) Simultaneous Assignment allows only one winner and one conflict', async ({ browser }, testInfo) => {
    const captureSimultaneousVideo = process.env.E2E_CAPTURE_SIMULTANEOUS_VIDEO === '1';
    const contextOptions = captureSimultaneousVideo
      ? {
          recordVideo: {
            dir: testInfo.outputPath('simultaneous-assignment-videos'),
            size: { width: 1280, height: 720 },
          },
        }
      : undefined;
    const victorContext = await browser.newContext(contextOptions);
    const rileyContext = await browser.newContext(contextOptions);

    const victorPage = await victorContext.newPage();
    const rileyPage = await rileyContext.newPage();

    try {
      await loginAs(victorPage, accounts.victorManager);
      await setWeekStartFilter(victorPage, resolvedWeekStart);
      await selectManagerShift(victorPage, 'Simultaneous Assignment Midtown');
      await selectStaffForAssignment(victorPage, 'Ava Ramirez');
      await expect(victorPage.getByText('No hard blocks. You can assign this staff member.')).toBeVisible();

      await loginAs(rileyPage, accounts.rileyManager);
      await setWeekStartFilter(rileyPage, resolvedWeekStart);
      await selectManagerShift(rileyPage, 'Simultaneous Assignment Brooklyn');
      await selectStaffForAssignment(rileyPage, 'Ava Ramirez');
      await expect(rileyPage.getByText('No hard blocks. You can assign this staff member.')).toBeVisible();

      const victorAssignButton = victorPage.getByRole('button', { name: 'Confirm Assign' });
      const rileyAssignButton = rileyPage.getByRole('button', { name: 'Confirm Assign' });

      await expect(victorAssignButton).toBeEnabled();
      await expect(rileyAssignButton).toBeEnabled();

      await Promise.all([victorAssignButton.click(), rileyAssignButton.click()]);

      const countAssignmentsForShift = async (page: typeof victorPage, shiftTitle: string): Promise<number> => {
        const shiftCard = page
          .locator('article:has(h2:has-text("Shifts")) li')
          .filter({ hasText: shiftTitle })
          .first();
        const text = await shiftCard.getByText(/Assignments:\s*\d+/).first().textContent();
        return Number(text?.match(/Assignments:\s*(\d+)/)?.[1] ?? 0);
      };

      let victorAssignmentCount = 0;
      let rileyAssignmentCount = 0;
      for (let attempt = 0; attempt < 60; attempt += 1) {
        victorAssignmentCount = await countAssignmentsForShift(victorPage, 'Simultaneous Assignment Midtown');
        rileyAssignmentCount = await countAssignmentsForShift(rileyPage, 'Simultaneous Assignment Brooklyn');

        if (victorAssignmentCount + rileyAssignmentCount >= 1) {
          break;
        }

        await victorPage.waitForTimeout(2_000);
      }

      expect(victorAssignmentCount + rileyAssignmentCount).toBe(1);

      const winnerPage = victorAssignmentCount === 1 ? victorPage : rileyPage;
      const loserPage = victorAssignmentCount === 1 ? rileyPage : victorPage;

      await expect(winnerPage.getByText('Assignment saved successfully.')).toBeVisible({ timeout: 90_000 });

      const loserConflictLocator = loserPage.getByText(
        /Assignment conflict detected|Overlaps with assigned shift/i,
      );
      const loserConflictAlreadyVisible = await loserConflictLocator
        .first()
        .isVisible()
        .catch(() => false);

      if (!loserConflictAlreadyVisible) {
        const loserAssignButton = loserPage.getByRole('button', { name: 'Confirm Assign' });
        const loserCanRetry = await loserAssignButton.isEnabled().catch(() => false);

        if (loserCanRetry) {
          await loserAssignButton.click();
        }

        await expect(loserConflictLocator.first()).toBeVisible({ timeout: 90_000 });
      }
    } finally {
      await victorContext.close();
      await rileyContext.close();
    }
  });

  test('4) Fairness Complaint surfaces premium shift distribution data', async ({ page }) => {
    await loginAs(page, accounts.rileyManager);
    await page.goto('/fairness');

    await setDateRange(page, resolvedWeekStart, resolvedWeekEnd());

    await expect(page.getByText(/Overall Fairness Score:/)).toBeVisible();

    const avaRow = page.locator('table tbody tr').filter({ hasText: 'Ava Ramirez' }).first();
    await expect(avaRow).toBeVisible();
    await expect(avaRow.locator('td').nth(4)).toHaveText(/^2$/);

    await logout(page);
  });

  test('5) Regret Swap allows creator cancellation before manager approval', async ({ page }) => {
    await loginAs(page, accounts.avaStaff);
    await page.goto('/staff#swap-requests');

    await setWeekStartFilter(page, resolvedWeekStart);

    const regretCard = page.locator('#swap-requests li').filter({ hasText: 'Regret Swap Demo' }).first();
    await expect(regretCard).toBeVisible();
    await expect(regretCard.getByText(/^accepted$/i)).toBeVisible();

    await regretCard.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Request cancelled.')).toBeVisible();

    await logout(page);

    await loginAs(page, accounts.victorManager);
    await page.goto('/manager#swap-inbox');

    await expect(page.locator('#swap-inbox li').filter({ hasText: 'Regret Swap Demo' })).toHaveCount(0);

    await logout(page);
  });

  test('6) Sunday Night Chaos drop can be claimed by staff and approved by manager', async ({ page }) => {
    await loginAs(page, accounts.benjaminStaff);
    await page.goto('/staff#available-drops');

    await setWeekStartFilter(page, resolvedWeekStart);

    const chaosCard = page.locator('#available-drops li').filter({ hasText: 'Sunday Night Chaos' }).first();
    await expect(chaosCard).toBeVisible();

    await chaosCard.getByRole('button', { name: 'Claim Shift' }).click();
    await expect(page.getByText('Drop request claimed. Waiting for manager approval.')).toBeVisible();

    await logout(page);

    await loginAs(page, accounts.victorManager);
    await page.goto('/manager#swap-inbox');

    const inboxCard = page.locator('#swap-inbox li').filter({ hasText: 'Sunday Night Chaos' }).first();
    await expect(inboxCard).toBeVisible();

    await inboxCard.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Swap request approved.')).toBeVisible({ timeout: 60_000 });
    await expect(page.locator('#swap-inbox li').filter({ hasText: 'Sunday Night Chaos' })).toHaveCount(0, {
      timeout: 60_000,
    });

    await logout(page);
  });
});
