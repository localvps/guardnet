/**
 * Emergency CLI: create (or reset) a superadmin from the server shell.
 *   npm run create-admin -- <username>
 * Prints a one-time strong password. The admin must change it and enroll TOTP at first login.
 */
import { q1, ex, run, now } from '../db.js';
import { hashPassword } from '../lib/security.js';
import { generatePassword } from '../admin/session.js';

const username = (process.argv[2] || 'superadmin').trim();
if (!/^[A-Za-z][A-Za-z0-9_.-]{3,31}$/.test(username)) { console.error('invalid username'); process.exit(1); }
const pw = generatePassword(20);
const hash = await hashPassword(pw);
const a = q1('SELECT id FROM admins WHERE username=?', username);
if (a) {
  run("UPDATE admins SET pass_hash=?, role='superadmin', must_change=1, totp_on=0, totp_enc=NULL, recovery_enc=NULL, disabled=0, fails=0, locked_until=0 WHERE id=?", hash, a.id);
  run('DELETE FROM admin_sessions WHERE admin_id=?', a.id);
} else {
  ex("INSERT INTO admins(username,pass_hash,role,must_change,created_at) VALUES(?,?,'superadmin',1,?)", username, hash, now());
}
console.log(`superadmin "${username}" ready.\npassword: ${pw}\n(change it and enroll TOTP on first login)`);
process.exit(0);
