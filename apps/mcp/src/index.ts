#!/usr/bin/env node
/**
 * Grassion MCP Server — exposes Human Coverage data to AI coding tools.
 *
 * Authentication: set GRASSION_API_TOKEN in the MCP server environment.
 * Get your token from app.grassion.com/settings/mcp.
 *
 * See docs/MCP.md for setup instructions.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'
import { z } from 'zod'
import { validateApiToken } from './auth.js'
import { humanCoverage } from './tools/human-coverage.js'
import { darkAreas } from './tools/dark-areas.js'

const server = new Server(
  { name: 'grassion', version: '0.1.0' },
  { capabilities: { tools: {} } },
)

// ── Auth ───────────────────────────────────────────────────────────────────────

const rawToken = process.env['GRASSION_API_TOKEN'] ?? ''

async function getAuth() {
  const ctx = await validateApiToken(rawToken)
  if (!ctx) throw new Error('Invalid GRASSION_API_TOKEN. Get one from app.grassion.com/settings/mcp')
  return ctx
}

// ── Tool definitions ──────────────────────────────────────────────────────────

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'human_coverage',
      description:
        'Returns who has human coverage for a given file path or directory in a repo. Shows coverage weight and whether the area is dark (no human coverage).',
      inputSchema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string', description: 'Repo name or owner/repo (e.g. "frontend" or "acme/frontend")' },
          path: { type: 'string', description: 'File or directory path to look up (e.g. "src/auth/login.ts")' },
        },
        required: ['repo', 'path'],
      },
    },
    {
      name: 'dark_areas',
      description:
        'Returns all dark code areas in a repo — areas with no active human coverage. Sorted with critical areas first.',
      inputSchema: {
        type: 'object' as const,
        properties: {
          repo: { type: 'string', description: 'Repo name or owner/repo' },
        },
        required: ['repo'],
      },
    },
  ],
}))

// ── Tool handlers ─────────────────────────────────────────────────────────────

const HumanCoverageInput = z.object({ repo: z.string().min(1), path: z.string().min(1) })
const DarkAreasInput = z.object({ repo: z.string().min(1) })

server.setRequestHandler(CallToolRequestSchema, async (request): Promise<{ content: CallToolResult['content'] }> => {
  const { name, arguments: args } = request.params
  const auth = await getAuth()

  if (name === 'human_coverage') {
    const { repo, path } = HumanCoverageInput.parse(args)
    const result = await humanCoverage(auth, repo, path)

    const summary = result.dark
      ? `⚫ \`${result.areaPath}\` is dark — no active human coverage.${result.isCritical ? ' (CRITICAL)' : ''}`
      : `✅ \`${result.areaPath}\` is covered by ${result.activePeople.map((p) => `@${p.githubLogin} (${p.coverageWeight})`).join(', ')}.${result.isCritical ? ' (critical area)' : ''}`

    return {
      content: [
        { type: 'text', text: summary },
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
    }
  }

  if (name === 'dark_areas') {
    const { repo } = DarkAreasInput.parse(args)
    const result = await darkAreas(auth, repo)

    const lines = [
      `${result.darkPct}% of ${result.totalAreas} areas are dark (${result.darkAreas.length} total).`,
      '',
      ...result.darkAreas.slice(0, 20).map(
        (a) => `${a.isCritical ? '🔴' : '⚫'} \`${a.path}\`${a.lastChangedAt ? ` — last changed ${a.lastChangedAt.slice(0, 10)}` : ''}`,
      ),
      ...(result.darkAreas.length > 20 ? [`…and ${result.darkAreas.length - 20} more.`] : []),
    ]

    return {
      content: [
        { type: 'text', text: lines.join('\n') },
        { type: 'text', text: JSON.stringify(result, null, 2) },
      ],
    }
  }

  throw new Error(`Unknown tool: ${name}`)
})

// ── Start ─────────────────────────────────────────────────────────────────────

const transport = new StdioServerTransport()
await server.connect(transport)
