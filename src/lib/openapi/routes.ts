// Phase 5b — central registration of OpenAPI paths for representative
// endpoints. Each route is described once here; importing this module is what
// the generate-openapi script does to flatten everything into one document.
//
// Why centralized vs. per-route: Next.js route files are Node-runtime
// modules. Loading them at script time pulls in PrismaClient and the whole
// dependency graph (~slow + needs DB env vars). Phase 5b only requires a
// "registry mechanism"; we keep the wire format here as the canonical
// description and rely on tests to keep route handlers in sync.

import { z } from 'zod';

import { registerOpenApiComponent, registerOpenApiPath } from './registry';

// -- shared shapes -------------------------------------------------------

const ErrorEnvelope = registerOpenApiComponent(
  'ErrorEnvelope',
  z
    .object({
      error: z.object({
        code: z.string().openapi({ example: 'invalid_input' }),
        message: z.string(),
        details: z.unknown().optional(),
      }),
    })
    .openapi('ErrorEnvelope'),
);

const PageInfo = registerOpenApiComponent(
  'PageInfo',
  z
    .object({
      nextCursor: z.string().nullable().openapi({ example: 'eyJhdCI6Ii4uLiJ9' }),
      hasMore: z.boolean(),
    })
    .openapi('PageInfo'),
);

const IssueSummary = registerOpenApiComponent(
  'IssueSummary',
  z
    .object({
      id: z.string().cuid(),
      key: z.string().openapi({ example: 'PROJ-42' }),
      title: z.string(),
      status: z.enum(['BACKLOG', 'TODO', 'IN_PROGRESS', 'IN_REVIEW', 'DONE']),
      priority: z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
      type: z.enum(['STORY', 'TASK', 'BUG', 'EPIC']),
      assigneeId: z.string().cuid().nullable(),
      reporterId: z.string().cuid(),
      createdAt: z.string().datetime(),
      updatedAt: z.string().datetime(),
    })
    .openapi('IssueSummary'),
);

const ProjectSummary = registerOpenApiComponent(
  'ProjectSummary',
  z
    .object({
      id: z.string().cuid(),
      key: z.string().openapi({ example: 'PROJ' }),
      name: z.string(),
      description: z.string().nullable(),
      leadId: z.string().cuid(),
      archived: z.boolean().optional(),
      createdAt: z.string().datetime(),
    })
    .openapi('ProjectSummary'),
);

const NotificationSummary = registerOpenApiComponent(
  'NotificationSummary',
  z
    .object({
      id: z.string().cuid(),
      type: z.string(),
      payload: z.unknown(),
      readAt: z.string().datetime().nullable(),
      createdAt: z.string().datetime(),
    })
    .openapi('NotificationSummary'),
);

const errorRef = {
  description: 'Error',
  content: { 'application/json': { schema: ErrorEnvelope } },
};

// -- registrations -------------------------------------------------------

registerOpenApiPath({
  method: 'post',
  path: '/api/auth/register',
  summary: 'Register a new user',
  tags: ['auth'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            email: z.string().email(),
            password: z.string().min(8),
            name: z.string().min(1),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'User created',
      content: {
        'application/json': {
          schema: z.object({ id: z.string().cuid(), email: z.string().email() }),
        },
      },
    },
    400: errorRef,
    409: errorRef,
    429: errorRef,
  },
});

registerOpenApiPath({
  method: 'get',
  path: '/api/projects',
  summary: 'List projects visible to the current user',
  tags: ['projects'],
  request: {
    query: z.object({
      includeArchived: z
        .string()
        .optional()
        .openapi({ description: '"true" to include archived (LEAD+)' }),
    }),
  },
  responses: {
    200: {
      description: 'Projects',
      content: {
        'application/json': {
          schema: z.object({ projects: z.array(ProjectSummary) }),
        },
      },
    },
    401: errorRef,
    403: errorRef,
  },
});

registerOpenApiPath({
  method: 'post',
  path: '/api/projects',
  summary: 'Create a project (LEAD+)',
  tags: ['projects'],
  request: {
    body: {
      content: {
        'application/json': {
          schema: z.object({
            key: z.string().min(2).max(10),
            name: z.string().min(1),
            description: z.string().optional(),
            leadId: z.string().cuid().optional(),
          }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Created',
      content: {
        'application/json': {
          schema: z.object({ id: z.string().cuid(), key: z.string() }),
        },
      },
    },
    400: errorRef,
    401: errorRef,
    403: errorRef,
    409: errorRef,
    429: errorRef,
  },
});

registerOpenApiPath({
  method: 'get',
  path: '/api/projects/{key}/issues',
  summary: 'List issues in a project',
  tags: ['issues'],
  request: {
    params: z.object({ key: z.string() }),
    query: z.object({
      status: z.string().optional(),
      priority: z.string().optional(),
      type: z.string().optional(),
      assigneeId: z.string().optional(),
      labelNames: z.string().optional(),
      query: z.string().optional(),
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated issues',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(IssueSummary),
            pageInfo: PageInfo,
          }),
        },
      },
    },
    401: errorRef,
    403: errorRef,
    404: errorRef,
  },
});

registerOpenApiPath({
  method: 'get',
  path: '/api/issues/{issueKey}',
  summary: 'Fetch a composed issue (with comments, links, attachments)',
  tags: ['issues'],
  request: { params: z.object({ issueKey: z.string() }) },
  responses: {
    200: {
      description: 'Issue',
      content: { 'application/json': { schema: IssueSummary } },
    },
    401: errorRef,
    404: errorRef,
  },
});

registerOpenApiPath({
  method: 'post',
  path: '/api/issues/{issueKey}/comments',
  summary: 'Post a comment on an issue',
  tags: ['issues'],
  request: {
    params: z.object({ issueKey: z.string() }),
    body: {
      content: {
        'application/json': {
          schema: z.object({ body: z.string().min(1) }),
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Comment created',
      content: {
        'application/json': {
          schema: z.object({
            comment: z.object({
              id: z.string().cuid(),
              body: z.string(),
              authorId: z.string().cuid(),
              createdAt: z.string().datetime(),
            }),
          }),
        },
      },
    },
    400: errorRef,
    401: errorRef,
    404: errorRef,
    429: errorRef,
  },
});

registerOpenApiPath({
  method: 'get',
  path: '/api/dashboard',
  summary: 'Dashboard read-model for the current user',
  tags: ['dashboard'],
  responses: {
    200: {
      description: 'Dashboard payload',
      content: {
        'application/json': {
          schema: z.object({
            assignedToMe: z.array(IssueSummary),
            recentActivity: z.array(
              z.object({
                id: z.string().cuid(),
                action: z.string(),
                createdAt: z.string().datetime(),
              }),
            ),
            projects: z.array(ProjectSummary),
          }),
        },
      },
    },
    401: errorRef,
  },
});

registerOpenApiPath({
  method: 'get',
  path: '/api/notifications',
  summary: 'List notifications for the current user',
  tags: ['notifications'],
  request: {
    query: z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(100).optional(),
      unreadOnly: z.string().optional(),
    }),
  },
  responses: {
    200: {
      description: 'Paginated notifications',
      content: {
        'application/json': {
          schema: z.object({
            data: z.array(NotificationSummary),
            pageInfo: PageInfo,
          }),
        },
      },
    },
    401: errorRef,
  },
});
