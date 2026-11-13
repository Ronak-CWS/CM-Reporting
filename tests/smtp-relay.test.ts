import { createServer, type Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const probe = vi.hoisted(() => ({ port: 0 }));
vi.mock('nodemailer', async (importOriginal) => {
  const actual = await importOriginal<typeof import('nodemailer')>();
  return { ...actual, default: { ...actual.default,
    // Exercise the real app transport against an isolated, non-forwarding SMTP
    // fixture. Keep production's port-25 validation and redirect only the socket.
    createTransport: (options: Record<string, unknown>) => actual.default.createTransport({
      ...options, host: '127.0.0.1', port: probe.port,
    }),
  } };
});
import { sendEmail, verifySmtp } from '../lib/smtp.js';

beforeEach(() => {
  for (const [name, value] of Object.entries({
    SMTP_HOST: 'smtp.example.invalid', SMTP_PORT: '25', SMTP_AUTH_MODE: 'none',
    SMTP_SECURE: 'false', SMTP_REQUIRE_TLS: 'false', SMTP_IGNORE_TLS: 'true',
    SMTP_USER: 'stale@example.invalid', SMTP_PASS: 'unused-test-password',
    EMAIL_FROM: 'sender@example.invalid', REPORT_EMAIL_ENABLED: 'false',
  })) vi.stubEnv(name, value);
});
afterEach(() => vi.unstubAllEnvs());

async function withRelay(advertiseTls: boolean, run: (commands: string[], messages: string[]) => Promise<void>) {
  const commands: string[] = [];
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    socket.write('220 fixture.example.invalid\r\n');
    let pending = '';
    let body: string[] | null = null;
    socket.on('data', (chunk) => {
      pending += chunk.toString();
      let end;
      while ((end = pending.indexOf('\r\n')) >= 0) {
        const line = pending.slice(0, end);
        pending = pending.slice(end + 2);
        if (body) {
          if (line === '.') {
            messages.push(body.join('\r\n'));
            body = null;
            socket.write('250 Accepted by test fixture\r\n');
          } else body.push(line);
          continue;
        }
        commands.push(line);
        if (line.startsWith('EHLO ')) socket.write(`250-fixture.example.invalid\r\n250-SIZE 50480000\r\n${advertiseTls ? '250-STARTTLS\r\n' : ''}250-AUTH LOGIN\r\n250 HELP\r\n`);
        else if (line === 'STARTTLS') socket.write('503 Bad sequence of commands\r\n');
        else if (line.startsWith('MAIL FROM:') || line.startsWith('RCPT TO:')) socket.write('250 OK\r\n');
        else if (line === 'DATA') { body = []; socket.write('354 End with a dot\r\n'); }
        else if (line === 'QUIT') socket.end('221 goodbye\r\n');
        else socket.write('500 Unexpected command\r\n');
      }
    });
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Fixture did not start.');
    probe.port = address.port;
    await run(commands, messages);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

describe('real SMTP protocol against a local relay fixture', () => {
  it('sends one message with both To recipients, CC, and PDF plus Excel attachments', async () => {
    await withRelay(false, async (commands, messages) => {
      const result = await sendEmail({ to: ['one@example.invalid', 'two@example.invalid'], cc: ['copy@example.invalid', 'ONE@example.invalid'],
        subject: 'Shared report', text: 'Synthetic report.', messageId: '<shared-report@example.invalid>', attachments: [
          { filename: 'report.pdf', content: Buffer.from('%PDF-fixture'), contentType: 'application/pdf' },
          { filename: 'report.xlsx', content: Buffer.from('xlsx-fixture'), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' },
        ] });
      expect(commands.filter((line) => line.startsWith('RCPT TO:'))).toEqual(['RCPT TO:<one@example.invalid>', 'RCPT TO:<two@example.invalid>', 'RCPT TO:<copy@example.invalid>']);
      expect(commands.filter((line) => line === 'DATA')).toHaveLength(1);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/To: one@example.invalid, two@example.invalid/);
      expect(messages[0]).toMatch(/Cc: copy@example.invalid/);
      expect(messages[0]).toContain('filename=report.pdf');
      expect(messages[0]).toContain('filename=report.xlsx');
      expect(result).toEqual({ accepted: ['one@example.invalid', 'two@example.invalid', 'copy@example.invalid'], rejected: [] });
    });
  });
  it('verifies without STARTTLS, AUTH or a message even when those extensions are advertised', async () => {
    await withRelay(true, async (commands, messages) => {
      await verifySmtp();
      expect(commands[0]).toMatch(/^EHLO /);
      expect(commands.some((line) => /^(STARTTLS|AUTH|MAIL FROM:|RCPT TO:|DATA)/.test(line))).toBe(false);
      expect(messages).toEqual([]);
    });
  });

  it('delivers a PDF to the non-forwarding fixture without login or TLS', async () => {
    await withRelay(false, async (commands, messages) => {
      await sendEmail({ to: 'recipient@example.invalid', subject: 'Fixture report', text: 'Synthetic test data only.',
        messageId: '<relay-fixture@example.invalid>',
        attachments: [{ filename: 'report.pdf', content: Buffer.from('%PDF-test'), contentType: 'application/pdf' }],
      });
      expect(commands).toContain('MAIL FROM:<sender@example.invalid>');
      expect(commands).toContain('RCPT TO:<recipient@example.invalid>');
      expect(commands.some((line) => /^(STARTTLS|AUTH)/.test(line))).toBe(false);
      expect(messages).toHaveLength(1);
      expect(messages[0]).toMatch(/Content-Type: application\/pdf/i);
      expect(messages[0]).toContain(Buffer.from('%PDF-test').toString('base64'));
      expect(messages[0]).not.toContain('unused-test-password');
    });
  });

  it('still fails when required STARTTLS is rejected instead of falling back to plaintext', async () => {
    vi.stubEnv('SMTP_IGNORE_TLS', 'false');
    vi.stubEnv('SMTP_REQUIRE_TLS', 'true');
    await withRelay(false, async (commands, messages) => {
      await expect(verifySmtp()).rejects.toMatchObject({ code: 'ETLS' });
      expect(commands).toContain('STARTTLS');
      expect(commands.some((line) => /^(AUTH|MAIL FROM:|DATA)/.test(line))).toBe(false);
      expect(messages).toEqual([]);
    });
  });
});
