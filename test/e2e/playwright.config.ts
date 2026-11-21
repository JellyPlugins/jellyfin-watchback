import {defineConfig, devices} from '@playwright/test';
export default defineConfig({
  testDir: './tests', timeout: 90000, expect: {timeout: 15000}, workers: 1,
  forbidOnly: !!process.env.CI, retries: process.env.CI ? 1 : 0,
  globalSetup: './setup/global-setup.ts',
  reporter: [['list'], ['html', {outputFolder: 'playwright-report', open: 'never'}], ['junit', {outputFile: 'test-reports/server.junit.xml'}]],
  use: {baseURL: process.env.JELLYFIN_URL ?? 'http://localhost:8098', trace: 'retain-on-failure', screenshot: 'only-on-failure'},
  projects: [
    {name: 'api', testMatch: /\.api\.spec\.ts/},
    {name: 'ui', testMatch: /\.ui\.spec\.ts/, dependencies: ['api'], use: {...devices['Desktop Chrome']}}
  ]
});
