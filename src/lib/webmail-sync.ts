import { ImapFlow } from 'imapflow';

type EnvLike = Record<string, string | undefined>;

type EnabledSyncConfig = {
  enabled: true;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  mailbox: string;
  sentMailbox: string;
  appendSentEnabled: boolean;
};

type DisabledSyncConfig = {
  enabled: false;
  reason: string;
  appendSentEnabled: boolean;
};

type SyncConfig = EnabledSyncConfig | DisabledSyncConfig;

type ImapClientLike = {
  connect(): Promise<void>;
  getMailboxLock(mailbox: string): Promise<{ release(): void }>;
  messageFlagsAdd(range: string, flags: string[], options: { uid: true }): Promise<unknown>;
  append(mailbox: string, content: Buffer, flags?: string[], idate?: Date): Promise<unknown>;
  logout(): Promise<void>;
};

type ClientFactory = (config: EnabledSyncConfig) => ImapClientLike;

type SyncOptions = {
  uid: string | null | undefined;
  mailbox?: string | null;
  env?: EnvLike;
  clientFactory?: ClientFactory;
};

type AppendOptions = {
  env?: EnvLike;
  clientFactory?: ClientFactory;
  message: string;
  sentAt?: string | null;
};

export type WebmailSyncResult = {
  ok: boolean;
  skipped?: boolean;
  action: 'seen' | 'answered' | 'append_sent';
  message?: string;
};

export function getWebmailSyncConfig(env: EnvLike = process.env): SyncConfig {
  const appendSentEnabled =
    String(env.WEBMAIL_IMAP_APPEND_SENT_ENABLED || 'false').toLowerCase() === 'true';

  if (String(env.WEBMAIL_SYNC_ENABLED || 'false').toLowerCase() !== 'true') {
    return { enabled: false, reason: 'webmail_sync_disabled', appendSentEnabled };
  }

  const missing = ['WEBMAIL_IMAP_HOST', 'WEBMAIL_IMAP_USER', 'WEBMAIL_IMAP_PASSWORD'].filter(
    (key) => !String(env[key] || '').trim()
  );

  if (missing.length) {
    return { enabled: false, reason: `missing_${missing.join('_')}`, appendSentEnabled };
  }

  const port = Number(env.WEBMAIL_IMAP_PORT || 993);
  return {
    enabled: true,
    host: String(env.WEBMAIL_IMAP_HOST),
    port: Number.isFinite(port) ? port : 993,
    secure: String(env.WEBMAIL_IMAP_SECURE || 'true').toLowerCase() !== 'false',
    user: String(env.WEBMAIL_IMAP_USER),
    password: String(env.WEBMAIL_IMAP_PASSWORD),
    mailbox: String(env.WEBMAIL_IMAP_MAILBOX || 'INBOX'),
    sentMailbox: String(env.WEBMAIL_IMAP_SENT_MAILBOX || 'Sent'),
    appendSentEnabled
  };
}

function defaultClientFactory(config: EnabledSyncConfig): ImapClientLike {
  return new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: { user: config.user, pass: config.password },
    logger: false
  }) as unknown as ImapClientLike;
}

async function withMailbox<T>(
  config: EnabledSyncConfig,
  mailbox: string,
  clientFactory: ClientFactory,
  run: (client: ImapClientLike) => Promise<T>
): Promise<T> {
  const client = clientFactory(config);
  await client.connect();
  const lock = await client.getMailboxLock(mailbox);
  try {
    return await run(client);
  } finally {
    lock.release();
    await client.logout();
  }
}

export async function markSeen(options: SyncOptions): Promise<WebmailSyncResult> {
  const uid = String(options.uid || '').trim();
  if (!uid) return { ok: true, skipped: true, action: 'seen', message: 'missing_imap_uid' };

  const config = getWebmailSyncConfig(options.env);
  if (!config.enabled) {
    return { ok: true, skipped: true, action: 'seen', message: config.reason };
  }

  try {
    await withMailbox(
      config,
      options.mailbox || config.mailbox,
      options.clientFactory || defaultClientFactory,
      async (client) => {
        await client.messageFlagsAdd(uid, ['\\Seen'], { uid: true });
      }
    );
    return { ok: true, action: 'seen' };
  } catch (error) {
    return {
      ok: false,
      action: 'seen',
      message: error instanceof Error ? error.message : 'imap_seen_failed'
    };
  }
}

export async function markAnswered(options: SyncOptions): Promise<WebmailSyncResult> {
  const uid = String(options.uid || '').trim();
  if (!uid) {
    return { ok: true, skipped: true, action: 'answered', message: 'missing_imap_uid' };
  }

  const config = getWebmailSyncConfig(options.env);
  if (!config.enabled) {
    return { ok: true, skipped: true, action: 'answered', message: config.reason };
  }

  try {
    await withMailbox(
      config,
      options.mailbox || config.mailbox,
      options.clientFactory || defaultClientFactory,
      async (client) => {
        await client.messageFlagsAdd(uid, ['\\Seen', '\\Answered'], { uid: true });
      }
    );
    return { ok: true, action: 'answered' };
  } catch (error) {
    return {
      ok: false,
      action: 'answered',
      message: error instanceof Error ? error.message : 'imap_answered_failed'
    };
  }
}

function header(value: string) {
  return value.replace(/[\r\n]+/g, ' ').trim();
}

export function buildRfc822Message(input: {
  from: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  sentAt: string;
  inReplyTo?: string | null;
  references?: string | null;
}) {
  const boundary = `vgummies-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const lines = [
    `From: ${header(input.from)}`,
    `To: ${header(input.to)}`,
    `Subject: ${header(input.subject)}`,
    `Date: ${new Date(input.sentAt).toUTCString()}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`
  ];

  if (input.inReplyTo) lines.push(`In-Reply-To: ${header(input.inReplyTo)}`);
  if (input.references) lines.push(`References: ${header(input.references)}`);

  lines.push(
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=utf-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    input.html,
    '',
    `--${boundary}--`,
    ''
  );

  return lines.join('\r\n');
}

export async function appendSentCopy(options: AppendOptions): Promise<WebmailSyncResult> {
  const config = getWebmailSyncConfig(options.env);
  if (!config.appendSentEnabled) {
    return {
      ok: true,
      skipped: true,
      action: 'append_sent',
      message: 'append_sent_disabled'
    };
  }
  if (!config.enabled) {
    return { ok: true, skipped: true, action: 'append_sent', message: config.reason };
  }

  const client = (options.clientFactory || defaultClientFactory)(config);
  let connected = false;
  try {
    await client.connect();
    connected = true;
    await client.append(
      config.sentMailbox,
      Buffer.from(options.message, 'utf8'),
      ['\\Seen'],
      options.sentAt ? new Date(options.sentAt) : new Date()
    );
    return { ok: true, action: 'append_sent' };
  } catch (error) {
    return {
      ok: false,
      action: 'append_sent',
      message: error instanceof Error ? error.message : 'imap_append_sent_failed'
    };
  } finally {
    if (connected) {
      await client.logout().catch(() => undefined);
    }
  }
}
