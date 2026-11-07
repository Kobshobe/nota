import { loadConfig } from '../config';
import { createDb, migrateDb } from '../db';

const config = loadConfig();
const { db, sqlite } = createDb(config.databasePath);
migrateDb(db);
sqlite.close();
console.log(`Migrations applied to ${config.databasePath}`);
