import { eq } from 'drizzle-orm'
import { repos } from '@grassion/db'
import { db } from '../db.js'
import { logger } from '../logger.js'

export interface RepoLite {
  id: number
  name: string
  full_name: string
  default_branch?: string
  private?: boolean
}

export async function connectRepo(teamId: string, repo: RepoLite) {
  const [owner, name] = repo.full_name.split('/')
  if (!owner || !name) {
    logger.warn({ repo }, 'cannot connect repo: invalid full_name')
    return
  }

  const existing = await db.select().from(repos).where(eq(repos.githubRepoId, repo.id)).limit(1)
  if (existing[0]) {
    await db
      .update(repos)
      .set({
        teamId,
        owner,
        name,
        defaultBranch: repo.default_branch ?? existing[0].defaultBranch,
        isActive: true,
      })
      .where(eq(repos.id, existing[0].id))
    return existing[0]
  }
  const [created] = await db
    .insert(repos)
    .values({
      teamId,
      githubRepoId: repo.id,
      owner,
      name,
      defaultBranch: repo.default_branch ?? 'main',
      isActive: true,
    })
    .returning()
  logger.info({ repoId: created!.id, githubRepoId: repo.id }, 'repo connected')
  return created!
}

export async function disconnectRepo(githubRepoId: number) {
  await db.update(repos).set({ isActive: false }).where(eq(repos.githubRepoId, githubRepoId))
}
