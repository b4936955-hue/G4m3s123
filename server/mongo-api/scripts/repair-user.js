import dotenv from 'dotenv';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { MongoClient } from 'mongodb';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
dotenv.config({ path: path.join(__dirname, '..', '.env') });
dotenv.config({ path: path.join(__dirname, '..', '..', '.env') });

const mongoUri = process.env.MONGODB_URI;
const dbName = process.env.MONGODB_DB || 'unblocked_zone';
if (!mongoUri) throw new Error('MONGODB_URI is required. Put it in server/.env or server/mongo-api/.env.');

function arg(name, fallback = '') {
  const prefix = `--${name}=`;
  const found = process.argv.find(v => v.startsWith(prefix));
  return found ? found.slice(prefix.length) : fallback;
}

function cleanUsername(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9_.-]/g, '').slice(0, 24);
}

function publicUser(user) {
  return {
    id: String(user._id),
    username: user.username,
    role: user.role || 'member',
    warnings: user.warnings || 0,
    bannedUntil: user.bannedUntil || null,
    kickedUntil: user.kickedUntil || null,
    mutedUntil: user.mutedUntil || null,
    createdAt: user.createdAt || null,
    lastSeen: user.lastSeen || null
  };
}

const username = cleanUsername(arg('username', 'billy41'));
const role = String(arg('role', 'owner')).toLowerCase();
const password = String(arg('password', ''));

if (!username) throw new Error('Username required.');
if (!['owner', 'admin', 'mod', 'member'].includes(role)) throw new Error('Role must be owner, admin, mod, or member.');

const mongo = new MongoClient(mongoUri);
await mongo.connect();
const db = mongo.db(dbName);
const users = db.collection('users');
const audit = db.collection('audit');

const existing = await users.findOne({ username });
const set = { role, bannedUntil: null, kickedUntil: null, mutedUntil: null, lastSeen: null };

if (existing) {
  await users.updateOne({ _id: existing._id }, { $set: set });
  const repaired = await users.findOne({ _id: existing._id });
  await audit.insertOne({ action: 'local-repair-user', detail: `${username} -> ${role}`, by: 'local-repair-script', username: 'local-repair-script', at: new Date() });
  console.log(JSON.stringify({ ok: true, created: false, user: publicUser(repaired) }, null, 2));
} else {
  if (password.length < 6) {
    await mongo.close();
    throw new Error('Account is missing. Re-run with --password=NEWPASSWORD to recreate it.');
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const result = await users.insertOne({ username, passwordHash, role, warnings: 0, bannedUntil: null, kickedUntil: null, mutedUntil: null, createdAt: new Date(), lastSeen: null });
  const created = await users.findOne({ _id: result.insertedId });
  await audit.insertOne({ action: 'local-repair-user-create', detail: `${username} -> ${role}`, by: 'local-repair-script', username: 'local-repair-script', at: new Date() });
  console.log(JSON.stringify({ ok: true, created: true, user: publicUser(created) }, null, 2));
}

await mongo.close();
