import { expect, test } from "@playwright/test";

function startOfMondayWeek(date: Date) {
  const copy = new Date(date);
  const day = copy.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  copy.setDate(copy.getDate() + diff);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function addDays(date: Date, days: number) {
  const copy = new Date(date);
  copy.setDate(copy.getDate() + days);
  return copy;
}

function formatDateTimeLocal(date: Date, hours: number, minutes: number) {
  const copy = new Date(date);
  copy.setHours(hours, minutes, 0, 0);
  const year = copy.getFullYear();
  const month = String(copy.getMonth() + 1).padStart(2, "0");
  const day = String(copy.getDate()).padStart(2, "0");
  const hour = String(copy.getHours()).padStart(2, "0");
  const minute = String(copy.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

function formatDateOnly(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

async function createRecurringEvent(page: import("@playwright/test").Page, options: {
  title: string;
  start: string;
  end: string;
  repeatUntil: string;
  weekdays?: boolean;
  tuesdayOnly?: boolean;
}) {
  await page.getByTestId("calendar-add-event").click();
  await expect(page.getByTestId("event-editor-dialog")).toBeVisible();
  await page.getByTestId("event-title-input").fill(options.title);
  await page.getByTestId("event-start-input").fill(options.start);
  await page.getByTestId("event-end-input").fill(options.end);
  await page.getByTestId("event-recurrence-select").selectOption("weekly");

  if (options.weekdays) {
    await page.getByTestId("event-weekdays-button").click();
  }

  if (options.tuesdayOnly) {
    await page.getByTestId("event-clear-days-button").click();
    await page.getByTestId("event-weekday-tue").click();
  }

  await page.getByTestId("event-repeat-until-input").fill(options.repeatUntil);
  await page.getByTestId("event-save-button").click();
  await expect(page.getByTestId("event-editor-dialog")).toBeHidden();
}

test.describe("calendar recurrence and persistence", () => {
  test("recurring weekday event persists across reload and future-week navigation", async ({ page }) => {
    const monday = startOfMondayWeek(new Date());
    const nextMonday = addDays(monday, 7);
    const repeatUntil = addDays(nextMonday, 11);
    const recurringEvent = page.locator(
      '[data-testid="calendar-fixed-event"][data-event-title="School E2E Recurring"]',
    );

    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

    await createRecurringEvent(page, {
      title: "School E2E Recurring",
      start: formatDateTimeLocal(nextMonday, 8, 0),
      end: formatDateTimeLocal(nextMonday, 15, 0),
      repeatUntil: formatDateOnly(repeatUntil),
      weekdays: true,
    });

    await expect(recurringEvent).toHaveCount(5);

    await page.getByTestId("calendar-next-week").click();
    await expect(recurringEvent).toHaveCount(5);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await page.getByTestId("calendar-next-week").click();
    await expect(recurringEvent).toHaveCount(5);
    await page.getByTestId("calendar-next-week").click();
    await expect(recurringEvent).toHaveCount(5);
  });

  test("deleting one occurrence preserves the rest of a recurring series", async ({ page }) => {
    const monday = startOfMondayWeek(new Date());
    const nextTuesday = addDays(monday, 8);
    const repeatUntil = addDays(nextTuesday, 14);

    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();

    await createRecurringEvent(page, {
      title: "Gym E2E Series",
      start: formatDateTimeLocal(nextTuesday, 18, 0),
      end: formatDateTimeLocal(nextTuesday, 19, 0),
      repeatUntil: formatDateOnly(repeatUntil),
      tuesdayOnly: true,
    });

    await page.getByTestId("calendar-next-week").click();
    const firstOccurrence = page.locator(
      '[data-testid="calendar-fixed-event"][data-event-title="Gym E2E Series"]',
    );
    await expect(firstOccurrence).toHaveCount(1);
    await firstOccurrence.click();

    await expect(page.getByTestId("event-editor-dialog")).toBeVisible();
    await page.getByTestId("event-delete-button").click();
    await page.getByTestId("event-delete-occurrence").click();
    await expect(page.getByTestId("event-editor-dialog")).toBeHidden();
    await expect(
      page.locator('[data-testid="calendar-fixed-event"][data-event-title="Gym E2E Series"]'),
    ).toHaveCount(0);

    await page.getByTestId("calendar-next-week").click();
    await expect(
      page.locator('[data-testid="calendar-fixed-event"][data-event-title="Gym E2E Series"]'),
    ).toHaveCount(1);
  });

  test("sick days persist and appear in the calendar all-day row", async ({ page }) => {
    const today = formatDateOnly(new Date());

    await page.goto("/settings");
    await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();

    await page.getByTestId("settings-add-sick-day").click();
    const sickDayRow = page.getByTestId("settings-sick-day-row").last();
    await sickDayRow.locator('[data-testid^="settings-sick-day-from-"]').fill(today);
    await sickDayRow.locator('[data-testid^="settings-sick-day-to-"]').fill(today);
    await sickDayRow.locator('[data-testid^="settings-sick-day-severity-"]').selectOption("moderate");
    await sickDayRow.locator('[data-testid^="settings-sick-day-save-"]').click();

    await page.goto("/calendar");
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(
      page.locator('[data-testid="calendar-sick-day"][data-event-title="Sick day · Moderate"]'),
    ).toHaveCount(1);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Calendar" })).toBeVisible();
    await expect(
      page.locator('[data-testid="calendar-sick-day"][data-event-title="Sick day · Moderate"]'),
    ).toHaveCount(1);
  });
});
