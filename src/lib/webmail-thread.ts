import { ImapFlow } from 'imapflow';
import { getWebmailSyncConfig } from './webmail-sync';

type SentThreadMessage = {
  customerEmail: string;
  customerName: string | null;
  subject: string;
  text: string;
  messageAt: Date;
  messageId: string | null;
  imapUid: string;
  imapMailbox: string;
  rawJson: Record<string, unknown>;
};

const MAX_SOURCE_BYTES = 40_000;

export async function fetchSentMessagesForCustomer(
  email: string,
  limit: number
): Promise<SentThreadMessage[]> {
  const config = getWebmailSyncConfig();
  if (!config.enabled) return [];

  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false
  });

  let connected = false;
  try {
    await client.connect();
    connected = true;
    const lock = await client.getMailboxLock(config.sentMailbox);
    try {
      const found = await client.search({ to: email }, { uid: true });
      if (!Array.isArray(found) || !found.length) return [];

      const uids = found.slice(-limit);
      const messages: SentThreadMessage[] = [];
      for await (const message of client.fetch(
        uids,
        { uid: true, envelope: true, source: { maxLength: MAX_SOURCE_BYTES } },
        { uid: true }
      )) {
        const raw = message.source?.toString('utf8') || '';
        const text = extractReadableText(raw);
        if (!text) continue;

        const recipient = message.envelope?.to?.find((item) =>
          item.address?.toLowerCase().includes(email.toLowerCase())
        );
        messages.push({
          customerEmail: email,
          customerName: recipient?.name || null,
          subject: message.envelope?.subject || '(sin asunto)',
          text,
          messageAt: new Date(
            message.envelope?.date || message.internalDate || Date.now()
          ),
          messageId: message.envelope?.messageId || null,
          imapUid: String(message.uid),
          imapMailbox: config.sentMailbox,
          rawJson: {
            uid: message.uid,
            mailbox: config.sentMailbox,
            messageId: message.envelope?.messageId || null,
            fetchedAt: new Date().toISOString()
          }
        });
      }
      return messages;
    } finally {
      lock.release();
    }
  } catch {
    return [];
  } finally {
    if (connected) {
      await client.logout().catch(() => undefined);
    }
  }
}

function extractReadableText(source: string): string {
  if (!source.trim()) return '';

  const normalized = source.replace(/\r\n/g, '\n');
  const [, headers = '', body = normalized] =
    normalized.match(/^([\s\S]*?)\n\n([\s\S]*)$/) || [];
  const boundary = headers.match(/boundary="?([^";\n]+)"?/i)?.[1];

  if (boundary) {
    const parts = body.split(`--${boundary}`);
    const textPart = parts.find((part) => /content-type:\s*text\/plain/i.test(part));
    if (textPart) return decodePart(textPart);

    const htmlPart = parts.find((part) => /content-type:\s*text\/html/i.test(part));
    if (htmlPart) return stripHtml(decodePart(htmlPart));
  }

  const contentType = headers.match(/content-type:\s*([^;\n]+)/i)?.[1] || '';
  const decoded = decodeBody(body, headers);
  return contentType.toLowerCase().includes('html') ? stripHtml(decoded) : cleanText(decoded);
}

function decodePart(part: string): string {
  const [, headers = '', body = part] = part.match(/^([\s\S]*?)\n\n([\s\S]*)$/) || [];
  return cleanText(decodeBody(body, headers));
}

function decodeBody(body: string, headers: string): string {
  const encoding = headers.match(/content-transfer-encoding:\s*([^\n]+)/i)?.[1]?.trim().toLowerCase();
  if (encoding === 'base64') {
    return Buffer.from(body.replace(/\s+/g, ''), 'base64').toString('utf8');
  }
  if (encoding === 'quoted-printable') {
    return body
      .replace(/=\n/g, '')
      .replace(/=([A-Fa-f0-9]{2})/g, (_, hex: string) =>
        String.fromCharCode(Number.parseInt(hex, 16))
      );
  }
  return body;
}

function stripHtml(value: string): string {
  return cleanText(
    value
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/p>/gi, '\n')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<[^>]+>/g, ' ')
  );
}

function cleanText(value: string): string {
  return value
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
