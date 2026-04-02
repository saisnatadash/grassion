// services/scannerService.js
// Fixed: OpenAI client created lazily inside functions, not at module load
// This prevents server crash when OPENAI_API_KEY is not set

const { Octokit } = require('@octokit/rest');

// ── LAZY OPENAI ──────────────────────────────────────────────────────────────
// Don't crash server on startup if key is missing — fail gracefully at call time
function getOpenAI() {
  const key = process.env.OPENAI_API_KEY;
  if (!key || key.trim() === '' || key.length < 20) {
    throw new Error(
      'OPENAI_API_KEY not configured. Go to Railway → Grassion service → Variables → add OPENAI_API_KEY=sk-proj-...'
    );
  }
  // Require here so it only loads when actually needed
  const OpenAI = require('openai');
  return new OpenAI({ apiKey: key });
}

// ── SCAN REPO ─────────────────────────────────────────────────────────────────
// Reads route files from GitHub and finds unprotected endpoints
async function scanRepo(accessToken, owner, repo) {
  const octokit = new Octokit({ auth: accessToken });

  // Get repo tree
  let tree;
  try {
    const defaultBranch = await getDefaultBranch(octokit, owner, repo);
    const { data } = await octokit.git.getTree({
      owner, repo,
      tree_sha: defaultBranch,
      recursive: '1'
    });
    tree = data.tree;
  } catch (e) {
    throw new Error(`Could not read repo: ${e.message}`);
  }

  // Find route/handler files
  const routeFiles = tree.filter(f =>
    f.type === 'blob' &&
    !f.path.includes('node_modules') &&
    !f.path.includes('.min.') &&
    (
      f.path.match(/routes?\//i) ||
      f.path.match(/controllers?\//i) ||
      f.path.match(/handlers?\//i) ||
      f.path.match(/api\//i) ||
      f.path === 'server.js' ||
      f.path === 'app.js' ||
      f.path === 'index.js'
    ) &&
    f.path.match(/\.(js|ts|py|go|rb)$/)
  ).slice(0, 15);

  if (!routeFiles.length) return [];

  const results = [];

  for (const file of routeFiles) {
    try {
      const { data } = await octokit.repos.getContent({
        owner, repo, path: file.path
      });
      if (data.encoding !== 'base64') continue;
      const content = Buffer.from(data.content, 'base64').toString('utf8');
      if (content.length > 50000) continue;

      const issues = findUnprotectedRoutes(content, file.path);
      if (issues.length > 0) {
        results.push({
          file: file.path,
          content,
          issues
        });
      }
    } catch (e) {
      // Skip unreadable files
    }
  }

  return results;
}

// ── RULE-BASED SCANNER ───────────────────────────────────────────────────────
function findUnprotectedRoutes(content, filePath) {
  const issues = [];
  const lines = content.split('\n');

  // Auth middleware patterns (things that ARE protected)
  const authPatterns = [
    /authMiddleware/i,
    /isAuthenticated/i,
    /requireAuth/i,
    /verifyToken/i,
    /passport\.authenticate/i,
    /checkAuth/i,
    /authenticate/i,
    /authorize/i,
    /jwtAuth/i,
    /bearerAuth/i,
  ];

  // Route patterns to scan
  const routeRegex = /(?:router|app)\.(get|post|put|delete|patch)\s*\(\s*['"`](\/[^'"`]*)/gi;

  let match;
  while ((match = routeRegex.exec(content)) !== null) {
    const method = match[1].toUpperCase();
    const endpoint = match[2];

    // Skip obviously public routes
    if (isPublicRoute(endpoint, method)) continue;

    // Find context around this route (next 3 lines)
    const matchPos = content.substring(0, match.index).split('\n').length - 1;
    const contextLines = lines.slice(matchPos, matchPos + 4).join(' ');

    // Check if any auth middleware is present in context
    const hasAuth = authPatterns.some(p => p.test(contextLines));

    if (!hasAuth) {
      // Determine issue severity
      const severity = getSeverity(endpoint, method);
      issues.push({
        method,
        endpoint,
        issue: `No authentication middleware — ${severity} risk`,
        severity,
        line: matchPos + 1
      });
    }
  }

  return issues;
}

function isPublicRoute(endpoint, method) {
  const publicPatterns = [
    /^\/$/,
    /\/health/i,
    /\/ping/i,
    /\/status/i,
    /\/webhook/i,
    /\/auth\/(login|signin|signup|register|github|callback|logout)/i,
    /\/api\/(waitlist|contact|feedback)/i,
    /\.(css|js|png|jpg|ico|svg|woff)/i,
  ];
  return publicPatterns.some(p => p.test(endpoint));
}

function getSeverity(endpoint, method) {
  if (/admin|user|payment|billing|secret|token|key/i.test(endpoint)) return 'HIGH';
  if (/\/api\//i.test(endpoint) && ['POST', 'PUT', 'DELETE', 'PATCH'].includes(method)) return 'HIGH';
  if (['DELETE', 'PUT', 'PATCH'].includes(method)) return 'MEDIUM';
  return 'LOW';
}

async function getDefaultBranch(octokit, owner, repo) {
  try {
    const { data } = await octokit.repos.get({ owner, repo });
    return data.default_branch || 'main';
  } catch (e) {
    return 'main';
  }
}

// ── GENERATE FIX ─────────────────────────────────────────────────────────────
// Uses OpenAI to generate the auth middleware fix
async function generateFix(content, filePath, issues) {
  // Try AI fix first, fall back to rule-based
  try {
    const openai = getOpenAI();
    const issueList = issues.map(i => `${i.method} ${i.endpoint} (line ${i.line || '?'})`).join('\n');

    const completion = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [{
        role: 'system',
        content: `You are a security engineer. Add authentication middleware to the unprotected routes listed below.
Only output the fixed file content — no explanations, no markdown code blocks, just the raw code.
Add the auth middleware as the second argument to each unprotected route handler.
If an authMiddleware or similar function doesn't exist in the file, add: const authMiddleware = require('../middleware/auth');
Preserve all existing code exactly — only add middleware where missing.`
      }, {
        role: 'user',
        content: `File: ${filePath}\n\nUnprotected routes to fix:\n${issueList}\n\nOriginal file:\n${content.substring(0, 8000)}`
      }],
      max_tokens: 3000,
      temperature: 0.1
    });

    return completion.choices[0].message.content;
  } catch (e) {
    console.error('[ScannerService] AI fix failed, using rule-based:', e.message);
    return generateRuleBasedFix(content, issues);
  }
}

// ── RULE-BASED FIX (fallback when no OpenAI) ─────────────────────────────────
function generateRuleBasedFix(content, issues) {
  let fixed = content;

  // Ensure auth middleware is imported
  if (!fixed.includes('authMiddleware') && !fixed.includes('middleware/auth')) {
    const insertAfterRequire = fixed.match(/const .+ = require\(.+\);?\n/);
    if (insertAfterRequire) {
      const insertPos = fixed.indexOf(insertAfterRequire[0]) + insertAfterRequire[0].length;
      fixed = fixed.slice(0, insertPos) +
        "const authMiddleware = require('../middleware/auth');\n" +
        fixed.slice(insertPos);
    }
  }

  // Add authMiddleware to each unprotected route
  for (const issue of issues) {
    const routePattern = new RegExp(
      `((?:router|app)\\.(?:${issue.method.toLowerCase()}))\\s*\\(\\s*(['"\`]${escapeRegex(issue.endpoint)}['"\`])\\s*,\\s*(?!authMiddleware)`,
      'i'
    );
    fixed = fixed.replace(routePattern, `$1($2, authMiddleware, `);
  }

  return fixed;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { scanRepo, generateFix };
