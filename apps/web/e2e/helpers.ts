import { expect, Locator, Page } from '@playwright/test';
import { DateTime } from 'luxon';

export const accounts = {
  mayaManager: {
    email: 'maya.manager@coastaleats.com',
    password: 'Pass123!',
    defaultPath: '/manager',
  },
  victorManager: {
    email: 'victor.manager@coastaleats.com',
    password: 'Pass123!',
    defaultPath: '/manager',
  },
  rileyManager: {
    email: 'riley.manager@coastaleats.com',
    password: 'Pass123!',
    defaultPath: '/manager',
  },
  avaStaff: {
    email: 'ava.staff@coastaleats.com',
    password: 'Pass123!',
    defaultPath: '/staff',
  },
  benjaminStaff: {
    email: 'benjamin.staff@coastaleats.com',
    password: 'Pass123!',
    defaultPath: '/staff',
  },
} as const;

type Account = (typeof accounts)[keyof typeof accounts];

const weekStartFromSeedConvention = (): string =>
  DateTime.now().setZone('America/New_York').plus({ weeks: 1 }).startOf('week').toISODate() ??
  DateTime.now().setZone('America/New_York').toISODate()!;

export const scenarioWeekStart = (): string => process.env.E2E_WEEK_START?.trim() || weekStartFromSeedConvention();

export const scenarioWeekEnd = (): string =>
  DateTime.fromISO(scenarioWeekStart(), { zone: 'America/New_York' }).plus({ days: 6 }).toISODate() ??
  scenarioWeekStart();

const pickOptionValueByPartialText = async (select: Locator, partialText: string): Promise<string> => {
  const options = select.locator('option');
  const count = await options.count();

  for (let index = 0; index < count; index += 1) {
    const option = options.nth(index);
    const label = (await option.textContent())?.trim() ?? '';
    const value = (await option.getAttribute('value')) ?? '';

    if (label.toLowerCase().includes(partialText.toLowerCase()) && value) {
      return value;
    }
  }

  throw new Error(`No option found containing text: ${partialText}`);
};

export const loginAs = async (page: Page, account: Account): Promise<void> => {
  const targetUrl = new RegExp(`${account.defaultPath}(#.*)?$`);

  for (let attempt = 1; attempt <= 4; attempt += 1) {
    const pathWithHashBefore = `${new URL(page.url()).pathname}${new URL(page.url()).hash}`;
    const alreadyOnExpectedRoute = targetUrl.test(pathWithHashBefore);
    const weekStartAlreadyVisible = await page
      .getByLabel('Week Start')
      .first()
      .isVisible()
      .catch(() => false);

    if (alreadyOnExpectedRoute && weekStartAlreadyVisible) {
      return;
    }

    await page.goto('/login');
    await page.getByLabel('Email').fill(account.email);
    await page.getByLabel('Password').fill(account.password);
    await page.getByRole('button', { name: 'Sign In' }).click();

    try {
      await expect(page).toHaveURL(targetUrl, { timeout: 30_000 });
    } catch {
      // Retry below.
    }

    const tokenPresent = await page
      .evaluate(() => Boolean(window.localStorage.getItem('shiftsync_token')))
      .catch(() => false);
    const pathWithHash = `${new URL(page.url()).pathname}${new URL(page.url()).hash}`;
    const onExpectedRoute = targetUrl.test(pathWithHash);

    if (onExpectedRoute && tokenPresent) {
      const weekStartVisible = await page
        .getByLabel('Week Start')
        .first()
        .isVisible({ timeout: 15_000 })
        .catch(() => false);
      const stillOnExpectedRoute = targetUrl.test(`${new URL(page.url()).pathname}${new URL(page.url()).hash}`);

      if (weekStartVisible && stillOnExpectedRoute) {
        return;
      }
    }

    if (attempt === 4) {
      const loginErrorText = await page.locator('p.text-sm.text-red-600').first().textContent().catch(() => null);
      throw new Error(
        `Failed to log in as ${account.email}. Final URL: ${page.url()}. Error: ${loginErrorText ?? 'none'}`,
      );
    }

    await page.waitForTimeout(3_000);
  }
};

export const logout = async (page: Page): Promise<void> => {
  const logoutButton = page.getByRole('button', { name: /Log out/i }).first();
  const hasVisibleLogout = await logoutButton.isVisible().catch(() => false);

  if (hasVisibleLogout) {
    await logoutButton.click();
  } else {
    await page.evaluate(() => {
      window.localStorage.clear();
    });
    await page.goto('/login');
  }

  await expect(page).toHaveURL(/\/login$/);
};

export const setWeekStartFilter = async (page: Page, weekStartIso: string): Promise<void> => {
  const weekStartInput = page.getByLabel('Week Start').first();
  await weekStartInput.fill(weekStartIso);
  await weekStartInput.press('Tab');
};

const waitForManagerDataIdle = async (page: Page, timeout = 30_000): Promise<void> => {
  await expect
    .poll(
      async () => (await page.locator('div[aria-busy="true"]').count()) === 0,
      { timeout },
    )
    .toBe(true);
};

export const alignWeekStartForManagerShift = async (
  page: Page,
  shiftTitle: string,
  initialWeekStartIso: string,
): Promise<string> => {
  let currentWeek = initialWeekStartIso;

  for (let attempt = 0; attempt < 8; attempt += 1) {
    await setWeekStartFilter(page, currentWeek);
    await waitForManagerDataIdle(page, 45_000);

    const shiftCard = page
      .locator('article:has(h2:has-text("Shifts")) li')
      .filter({ hasText: shiftTitle })
      .first();

    const hasShift = await shiftCard.isVisible({ timeout: 20_000 }).catch(() => false);
    if (hasShift) {
      return currentWeek;
    }

    currentWeek =
      DateTime.fromISO(currentWeek, { zone: 'America/New_York' }).plus({ weeks: 1 }).toISODate() ?? currentWeek;
  }

  throw new Error(`Could not find shift "${shiftTitle}" within 8 weekly windows from ${initialWeekStartIso}`);
};

export const setDateRange = async (page: Page, startDateIso: string, endDateIso: string): Promise<void> => {
  await page.getByLabel('Start').fill(startDateIso);
  await page.getByLabel('Start').press('Tab');
  await page.getByLabel('End').fill(endDateIso);
  await page.getByLabel('End').press('Tab');
};

export const selectManagerLocation = async (page: Page, partialLocationName: string): Promise<void> => {
  const select = page.getByLabel('Location').first();
  const value = await pickOptionValueByPartialText(select, partialLocationName);
  await select.selectOption(value);
};

export const selectManagerShift = async (page: Page, shiftTitle: string): Promise<void> => {
  const shiftCard = page
    .locator('article:has(h2:has-text("Shifts")) li')
    .filter({ hasText: shiftTitle })
    .first();

  await expect(shiftCard).toBeVisible();
  await shiftCard.click();
};

export const selectStaffForAssignment = async (page: Page, staffName: string): Promise<void> => {
  const select = page.getByLabel('Assign staff').first();
  const value = await pickOptionValueByPartialText(select, staffName);
  await select.selectOption(value);
};
