import fs from 'node:fs';
import path from 'node:path';
import { getDatabase, SettingsQueries } from '@shipcode/db';
import { CURRENT_ONBOARDING_VERSION } from '@shipcode/shared';
import { markCliFailure } from '../exit-code';

/**
 * Returns true when the machine is onboarded. On failure it prints the fix and
 * marks the process as failed, so callers can keep the `if (!requireOnboarding())
 * return;` shape while the shell still sees a non-zero exit code.
 */
export function requireOnboarding(): boolean {
  const dataDir = path.join(process.env.HOME ?? '', '.shipcode', 'data');
  const dbPath = path.join(dataDir, 'shipcode.db');

  if (!fs.existsSync(dbPath)) {
    console.log('ShipCode is not set up yet. Run: shipcode onboard');
    markCliFailure();
    return false;
  }

  try {
    const db = getDatabase(dataDir);
    const settings = new SettingsQueries(db);
    const current = settings.get();
    if (current.onboardingVersion < CURRENT_ONBOARDING_VERSION) {
      console.log('ShipCode setup is incomplete. Run: shipcode onboard');
      markCliFailure();
      return false;
    }
    return true;
  } catch {
    console.log('ShipCode setup is incomplete. Run: shipcode onboard');
    markCliFailure();
    return false;
  }
}
