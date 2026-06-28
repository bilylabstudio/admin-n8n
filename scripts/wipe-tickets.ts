import { db } from '../src/lib/db';

async function main() {
  const execute = process.argv.includes('--execute');

  const before = {
    tickets: await db.ticket.count(),
    formSubmissions: await db.formSubmission.count(),
    formImages: await db.formImage.count(),
    caseAuditEvents: await db.auditEvent.count({
      where: { eventType: { notIn: ['login', 'logout'] } }
    }),
    users: await db.user.count(),
    sessions: await db.session.count(),
    blockedEmails: await db.blockedEmail.count(),
    platformOrders: await db.platformOrder.count(),
    platformSyncStates: await db.platformSyncState.count()
  };

  console.log('Limpieza de datos de soporte/admin');
  console.log('Objetivo: borrar tickets, formularios, imagenes de formularios y auditoria de casos.');
  console.log('Preserva: usuarios, sesiones, lista negra y datos financieros.');
  console.log('');
  console.log('Conteos actuales:');
  console.log(`  Ticket: ${before.tickets}`);
  console.log(`  FormSubmission: ${before.formSubmissions}`);
  console.log(`  FormImage: ${before.formImages}`);
  console.log(`  AuditEvent casos: ${before.caseAuditEvents}`);
  console.log(`  User preservados: ${before.users}`);
  console.log(`  Session preservadas: ${before.sessions}`);
  console.log(`  BlockedEmail preservados: ${before.blockedEmails}`);
  console.log(`  PlatformOrder preservados: ${before.platformOrders}`);
  console.log(`  PlatformSyncState preservados: ${before.platformSyncStates}`);
  console.log('');

  if (!execute) {
    console.log('Modo simulacion: no se borro nada.');
    console.log('Para ejecutar realmente: npm run wipe:tickets -- --execute');
    return;
  }

  const result = await db.$transaction(async (tx) => {
    const caseAuditEvents = await tx.auditEvent.deleteMany({
      where: { eventType: { notIn: ['login', 'logout'] } }
    });
    const formImages = await tx.formImage.deleteMany({});
    const formSubmissions = await tx.formSubmission.deleteMany({});
    const tickets = await tx.ticket.deleteMany({});

    return { caseAuditEvents, formImages, formSubmissions, tickets };
  });

  const after = {
    tickets: await db.ticket.count(),
    formSubmissions: await db.formSubmission.count(),
    formImages: await db.formImage.count(),
    caseAuditEvents: await db.auditEvent.count({
      where: { eventType: { notIn: ['login', 'logout'] } }
    }),
    users: await db.user.count(),
    sessions: await db.session.count(),
    blockedEmails: await db.blockedEmail.count(),
    platformOrders: await db.platformOrder.count(),
    platformSyncStates: await db.platformSyncState.count()
  };

  console.log('Wipe ejecutado:');
  console.log(`  AuditEvent casos borrados: ${result.caseAuditEvents.count}`);
  console.log(`  FormImage borrados: ${result.formImages.count}`);
  console.log(`  FormSubmission borrados: ${result.formSubmissions.count}`);
  console.log(`  Ticket borrados: ${result.tickets.count}`);
  console.log('');
  console.log('Conteos finales:');
  console.log(`  Ticket: ${after.tickets}`);
  console.log(`  FormSubmission: ${after.formSubmissions}`);
  console.log(`  FormImage: ${after.formImages}`);
  console.log(`  AuditEvent casos: ${after.caseAuditEvents}`);
  console.log(`  User preservados: ${after.users}`);
  console.log(`  Session preservadas: ${after.sessions}`);
  console.log(`  BlockedEmail preservados: ${after.blockedEmails}`);
  console.log(`  PlatformOrder preservados: ${after.platformOrders}`);
  console.log(`  PlatformSyncState preservados: ${after.platformSyncStates}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await db.$disconnect();
  });
