import { db } from '../src/lib/db';
import { assertAllowedAdminEmail, hashPassword } from '../src/lib/auth';

async function main() {
  const email = process.env.ADMIN_SEED_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_SEED_NAME?.trim() || 'Admin';
  const password = process.env.ADMIN_SEED_PASSWORD || '';

  if (!email || !password) {
    throw new Error('Set ADMIN_SEED_EMAIL and ADMIN_SEED_PASSWORD before running seed:admin.');
  }

  assertAllowedAdminEmail(email);

  await db.user.upsert({
    where: { email },
    update: {
      name,
      passwordHash: hashPassword(password)
    },
    create: {
      email,
      name,
      passwordHash: hashPassword(password)
    }
  });

  console.log(`Admin user ready: ${email}`);
}

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
