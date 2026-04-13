import { DatabaseSync } from 'node:sqlite';
import {
  migrate,
  migrateV2,
  migrateV3,
  migrateV4,
  migrateV5,
  migrateV6,
  migrateV7,
  migrateV8,
  migrateV9,
  migrateV10,
  migrateV11,
  migrateV12,
  migrateV13,
  migrateV14,
  migrateV15,
  migrateV16,
  migrateV17,
} from './schema';

export function createTestDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:');
  migrate(db);
  migrateV2(db);
  migrateV3(db);
  migrateV4(db);
  migrateV5(db);
  migrateV6(db);
  migrateV7(db);
  migrateV8(db);
  migrateV9(db);
  migrateV10(db);
  migrateV11(db);
  migrateV12(db);
  migrateV13(db);
  migrateV14(db);
  migrateV15(db);
  migrateV16(db);
  migrateV17(db);
  return db;
}
