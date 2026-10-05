import { auditLogs } from '@grassion/db'
import { db } from '../db.js'
import { logger } from '../logger.js'
import type { Request } from 'express'

export interface AuditEventParams {
  teamId?: string | null
  userId?: string | null
  action: string
  resourceType?: string | null
  resourceId?: string | null
  ipAddress?: string | null
  userAgent?: string | null
  metadata?: Record<string, unknown>
}

export function logAuditEvent(params: AuditEventParams): void {
  db.insert(auditLogs)
    .values({
      teamId: params.teamId ?? null,
      userId: params.userId ?? null,
      action: params.action,
      resourceType: params.resourceType ?? null,
      resourceId: params.resourceId ?? null,
      ipAddress: params.ipAddress ?? null,
      userAgent: params.userAgent ?? null,
      metadata: params.metadata ?? {},
    })
    .catch((err: unknown) => logger.error({ err }, 'audit log insert failed'))
}

export function getIp(req: Request): string | null {
  const xff = req.headers['x-forwarded-for']
  if (Array.isArray(xff)) return xff[0] ?? null
  if (typeof xff === 'string') return xff.split(',')[0]?.trim() ?? null
  return req.ip ?? null
}
