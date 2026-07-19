import { expect, type Harness } from './electron-app';

/** Select the seeded project and wait until the renderer is ready for project flows. */
export async function selectSeedProject(harness: Harness): Promise<void> {
  await harness.callStore('selectProject', harness.seed.projectId);
  await expect(harness.page.locator('#root')).toBeVisible();
}
