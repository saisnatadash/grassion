import { App } from '@octokit/app'
import { Octokit } from '@octokit/rest'
import { env, normalizePrivateKey } from './env.js'

let _app: App | undefined

export function getApp(): App {
  if (!_app) {
    const e = env()
    _app = new App({
      appId: Number(e.GITHUB_APP_ID),
      privateKey: normalizePrivateKey(e.GITHUB_APP_PRIVATE_KEY),
      oauth: {
        clientId: e.GITHUB_APP_CLIENT_ID,
        clientSecret: e.GITHUB_APP_CLIENT_SECRET,
      },
      webhooks: {
        secret: e.GITHUB_APP_WEBHOOK_SECRET,
      },
    })
  }
  return _app
}

export async function getInstallationOctokit(installationId: number): Promise<Octokit> {
  const app = getApp()
  const octokit = (await app.getInstallationOctokit(installationId)) as unknown as Octokit
  return octokit
}
