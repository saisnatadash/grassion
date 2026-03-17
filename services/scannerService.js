const axios = require('axios');
const OpenAI = require('openai');

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

async function getRepoFiles(accessToken, owner, repo) {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/HEAD?recursive=1`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return response.data.tree.filter(f =>
    f.type === 'blob' &&
    (f.path.includes('route') || f.path.includes('router') || f.path.includes('api') ||
     f.path.includes('controller') || f.path.includes('handler') || f.path.includes('endpoint')) &&
    (f.path.endsWith('.js') || f.path.endsWith('.ts') || f.path.endsWith('.py') || f.path.endsWith('.go'))
  );
}

async function getFileContent(accessToken, owner, repo, filePath) {
  const response = await axios.get(
    `https://api.github.com/repos/${owner}/${repo}/contents/${filePath}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  return Buffer.from(response.data.content, 'base64').toString('utf-8');
}

async function analyzeFileForAuthGaps(content, filePath) {
  const prompt = `You are a security expert. Analyze this code for API endpoints missing authentication middleware.

File: ${filePath}
Code:
${content.substring(0, 3000)}

Find all API endpoints (GET, POST, PUT, DELETE, PATCH) missing authentication/authorization.

Return ONLY a JSON array:
[{"endpoint":"/api/example","method":"GET","line":15,"issue":"No auth middleware","severity":"high","fix":"Add auth middleware"}]

Return [] if none found. Return ONLY JSON, nothing else.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 500
  });

  try {
    const text = response.choices[0].message.content.trim();
    return JSON.parse(text);
  } catch { return []; }
}

async function generateFix(content, filePath, issues) {
  const prompt = `Fix these authentication gaps in the code.

File: ${filePath}
Issues: ${JSON.stringify(issues)}

Original code:
${content.substring(0, 3000)}

Add JWT/session authentication middleware to all unprotected endpoints.
Return ONLY the complete fixed code, no explanations, no markdown.`;

  const response = await openai.chat.completions.create({
    model: 'gpt-4',
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.1,
    max_tokens: 2000
  });

  return response.choices[0].message.content;
}

async function scanRepo(accessToken, owner, repo) {
  const files = await getRepoFiles(accessToken, owner, repo);
  const results = [];
  for (const file of files.slice(0, 15)) {
    try {
      const content = await getFileContent(accessToken, owner, repo, file.path);
      const issues = await analyzeFileForAuthGaps(content, file.path);
      if (issues.length > 0) results.push({ file: file.path, issues, content });
    } catch (err) {
      console.error(`Error scanning ${file.path}:`, err.message);
    }
  }
  return results;
}

module.exports = { scanRepo, generateFix, getFileContent };
