import { expect, type Harness } from './electron-app';

/** Select the seeded project and wait until the renderer is ready for project flows. */
export async function selectSeedProject(harness: Harness): Promise<void> {
  await harness.callStore('selectProject', harness.seed.projectId);
  await expect(harness.page.locator('#root')).toBeVisible();
}

/** Select the seeded project and open the GitHub issues board. */
export async function openSeedBoard(harness: Harness): Promise<void> {
  await selectSeedProject(harness);
  await harness.callStore('openBoard');
}
