// Provide minimal env stubs so pure-function tests can import from modules
// that have a module-level `db` initialization without crashing on missing DATABASE_URL.
// Tests that actually query the DB must supply a real connection.
process.env['DATABASE_URL'] = process.env['DATABASE_URL'] ?? 'postgresql://test:test@localhost:5432/test'
process.env['JWT_SECRET'] = process.env['JWT_SECRET'] ?? 'test-secret-32-chars-xxxxxxxxxxxxxxxxx'
process.env['APP_URL'] = process.env['APP_URL'] ?? 'http://localhost:5173'
process.env['API_URL'] = process.env['API_URL'] ?? 'http://localhost:3001'
process.env['GITHUB_APP_CLIENT_ID'] = process.env['GITHUB_APP_CLIENT_ID'] ?? 'test-client-id'
process.env['GITHUB_APP_CLIENT_SECRET'] = process.env['GITHUB_APP_CLIENT_SECRET'] ?? 'test-client-secret'
