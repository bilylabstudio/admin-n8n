import { db } from '../src/lib/db';

async function main() {
  const audit = await db.auditEvent.deleteMany({});
  const tickets = await db.ticket.deleteMany({});
  const blocked = await db.blockedEmail.deleteMany({});

  console.log(`Wipe completo:`);
  console.log(`  AuditEvent  borrados: ${audit.count}`);
  console.log(`  Ticket      borrados: ${tickets.count}`);
  console.log(`  BlockedEmail borrados: ${blocked.count}`);
  console.log(`Usuarios y sesiones preservados.`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
