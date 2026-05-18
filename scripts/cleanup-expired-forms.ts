import { db } from '../src/lib/db';

const GRACE_DAYS = 7;

async function main() {
  const cutoff = new Date(Date.now() - GRACE_DAYS * 86_400_000);
  const expired = await db.formSubmission.findMany({
    where: { status: 'pending', expiresAt: { lt: cutoff } },
    select: { id: true }
  });

  if (expired.length === 0) {
    console.log('No expired pending forms to clean up.');
    return;
  }

  for (const form of expired) {
    await db.formSubmission.delete({ where: { id: form.id } });
  }

  console.log(`Cleaned up ${expired.length} expired pending forms.`);
  console.log('Note: pending forms have no images on disk, so no file cleanup needed.');
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
