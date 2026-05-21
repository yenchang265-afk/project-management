import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createIssuesService, MAX_ATTACHMENT_BYTES } from '@/server/services/issues';
import { on, reset } from '@/server/events/bus';
import { ISSUE_EVENTS } from '@/server/events/types';
import { __resetS3ClientForTesting, __setS3ClientForTesting } from '@/server/storage/s3';
import {
  createFakePrisma,
  seedProjectScaffolding,
  type FakePrisma,
} from './__support__/fakePrisma';

describe('issues.attachments', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createIssuesService>;
  let scaff: Awaited<ReturnType<typeof seedProjectScaffolding>>;
  let s3Stub: { calls: { put: string[]; get: string[]; del: string[] } };

  beforeEach(async () => {
    reset();
    prisma = createFakePrisma();
    svc = createIssuesService({ prisma: prisma as never });
    scaff = await seedProjectScaffolding(prisma);
    s3Stub = { calls: { put: [], get: [], del: [] } };
    __setS3ClientForTesting({
      send: async () => undefined,
      presignPut: async (key: string) => {
        s3Stub.calls.put.push(key);
        return `https://s3.test/put/${encodeURIComponent(key)}`;
      },
      presignGet: async (key: string) => {
        s3Stub.calls.get.push(key);
        return `https://s3.test/get/${encodeURIComponent(key)}`;
      },
      deleteObject: async (key: string) => {
        s3Stub.calls.del.push(key);
      },
    } as never);
  });

  afterEach(() => {
    __resetS3ClientForTesting();
  });

  it('happy path: creates Attachment + returns presigned PUT URL', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'i', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const handler = vi.fn();
    on(ISSUE_EVENTS.ATTACHED, handler);
    const { attachment, uploadUrl } = await svc.attachFile(
      i.key,
      { filename: 'doc.pdf', mimeType: 'application/pdf', size: 1024 },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    expect(attachment.filename).toBe('doc.pdf');
    expect(uploadUrl).toMatch(/^https:\/\/s3\.test\/put\//);
    expect(handler).toHaveBeenCalledOnce();
    expect(s3Stub.calls.put).toHaveLength(1);
  });

  it('rejects files over 25MB', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'i', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.attachFile(
        i.key,
        { filename: 'big.pdf', mimeType: 'application/pdf', size: MAX_ATTACHMENT_BYTES + 1 },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('rejects disallowed MIME types', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'i', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.attachFile(
        i.key,
        { filename: 'a.exe', mimeType: 'application/x-msdownload', size: 10 },
        { id: scaff.lead.id, role: 'LEAD' },
      ),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('uploader can remove their own attachment', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'i', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const { attachment } = await svc.attachFile(
      i.key,
      { filename: 'a.png', mimeType: 'image/png', size: 10 },
      { id: scaff.member.id, role: 'MEMBER' },
    );
    await svc.removeAttachment(attachment.id, { id: scaff.member.id, role: 'MEMBER' });
    expect(await prisma.attachment.findUnique({ where: { id: attachment.id } })).toBeNull();
    expect(s3Stub.calls.del).toContain(attachment.storageKey);
  });

  it('non-uploader non-LEAD member cannot remove (403)', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'i', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const { attachment } = await svc.attachFile(
      i.key,
      { filename: 'a.png', mimeType: 'image/png', size: 10 },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    await expect(
      svc.removeAttachment(attachment.id, { id: scaff.member.id, role: 'MEMBER' }),
    ).rejects.toMatchObject({ code: 'forbidden' });
  });

  it('LEAD can remove someone else’s attachment', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'i', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const { attachment } = await svc.attachFile(
      i.key,
      { filename: 'a.png', mimeType: 'image/png', size: 10 },
      { id: scaff.member.id, role: 'MEMBER' },
    );
    await svc.removeAttachment(attachment.id, { id: scaff.lead.id, role: 'LEAD' });
    expect(await prisma.attachment.findUnique({ where: { id: attachment.id } })).toBeNull();
  });

  it('returns a presigned GET URL', async () => {
    const i = await svc.createIssue(
      { projectKey: 'ALPHA', title: 'i', type: 'TASK' },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const { attachment } = await svc.attachFile(
      i.key,
      { filename: 'a.png', mimeType: 'image/png', size: 10 },
      { id: scaff.lead.id, role: 'LEAD' },
    );
    const url = await svc.getAttachmentDownloadUrl(attachment.id, {
      id: scaff.member.id,
      role: 'MEMBER',
    });
    expect(url).toMatch(/^https:\/\/s3\.test\/get\//);
  });
});
