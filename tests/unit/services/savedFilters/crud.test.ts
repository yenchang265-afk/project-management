import { beforeEach, describe, expect, it } from 'vitest';

import { AuthError } from '@/lib/errors';
import { createSavedFiltersService } from '@/server/services/savedFilters';

import { createFakePrisma, type FakePrisma } from './__support__/fakePrisma';

describe('savedFilters service', () => {
  let prisma: FakePrisma;
  let svc: ReturnType<typeof createSavedFiltersService>;

  beforeEach(() => {
    prisma = createFakePrisma();
    svc = createSavedFiltersService({ prisma: prisma as never });
  });

  it('creates and lists owner filters', async () => {
    const actor = { id: 'u1', role: 'MEMBER' as const };
    const filter = await svc.createFilter(
      { name: 'My open issues', query: { status: ['TODO'] } },
      actor,
    );
    expect(filter.id).toBeDefined();
    expect(filter.name).toBe('My open issues');

    const list = await svc.listFilters(actor, {});
    expect(list).toHaveLength(1);
    expect(list[0]?.id).toBe(filter.id);
  });

  it('does not list other users filters', async () => {
    const a = { id: 'u1', role: 'MEMBER' as const };
    const b = { id: 'u2', role: 'MEMBER' as const };
    await svc.createFilter({ name: 'mine', query: {} }, a);
    const list = await svc.listFilters(b, {});
    expect(list).toHaveLength(0);
  });

  it('only the owner can update', async () => {
    const a = { id: 'u1', role: 'MEMBER' as const };
    const b = { id: 'u2', role: 'MEMBER' as const };
    const f = await svc.createFilter({ name: 'mine', query: {} }, a);
    await expect(svc.updateFilter(f.id, { name: 'renamed' }, b)).rejects.toBeInstanceOf(AuthError);
    const updated = await svc.updateFilter(f.id, { name: 'renamed' }, a);
    expect(updated.name).toBe('renamed');
  });

  it('only the owner can delete', async () => {
    const a = { id: 'u1', role: 'MEMBER' as const };
    const b = { id: 'u2', role: 'MEMBER' as const };
    const f = await svc.createFilter({ name: 'mine', query: {} }, a);
    await expect(svc.deleteFilter(f.id, b)).rejects.toBeInstanceOf(AuthError);
    await svc.deleteFilter(f.id, a);
    const list = await svc.listFilters(a, {});
    expect(list).toHaveLength(0);
  });

  it('rejects invalid query payload', async () => {
    const a = { id: 'u1', role: 'MEMBER' as const };
    await expect(
      svc.createFilter({ name: 'bad', query: { status: ['BOGUS'] } as never }, a),
    ).rejects.toBeInstanceOf(AuthError);
  });

  it('rejects empty name', async () => {
    const a = { id: 'u1', role: 'MEMBER' as const };
    await expect(svc.createFilter({ name: '', query: {} }, a)).rejects.toBeInstanceOf(AuthError);
  });

  it('project-scoped filter requires membership to list', async () => {
    const lead = { id: 'lead1', role: 'LEAD' as const };
    const stranger = { id: 'stranger1', role: 'MEMBER' as const };
    const project = await prisma.project.create({
      data: { key: 'AAA', name: 'A', leadId: lead.id },
    });
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: lead.id, role: 'LEAD' },
    });
    await svc.createFilter({ name: 'proj', projectId: project.id, query: {} }, lead);
    // Lead sees their project filter
    const leadList = await svc.listFilters(lead, { projectId: project.id });
    expect(leadList).toHaveLength(1);
    // Stranger (no membership) can't list project-scoped filters in that project
    await expect(svc.listFilters(stranger, { projectId: project.id })).rejects.toBeInstanceOf(
      AuthError,
    );
  });
});
