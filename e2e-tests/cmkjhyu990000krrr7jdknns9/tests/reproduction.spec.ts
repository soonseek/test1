
import { test, expect } from '@playwright/test';

test('reproduce reported issue', async ({ page }) => {
  await page.goto('undefined');

  // 이슈 재현 시도
  // 실제로는 더 정교한 로직 필요

  const title = await page.title();
  expect(title).toBeTruthy();
});
