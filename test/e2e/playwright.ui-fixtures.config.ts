import {defineConfig} from '@playwright/test';
export default defineConfig({
  testDir: './tests', testMatch: /\.fixture\.spec\.ts/, timeout: 30000, workers: 1,
  reporter: 'list', use: {screenshot: 'only-on-failure', trace: 'retain-on-failure'},
  projects: [{name:'documentation',testMatch:/coverage-doc\.api\.spec\.ts/},{name: 'chromium', dependencies:['documentation'], use: {browserName: 'chromium'}}, {name: 'webkit', dependencies:['documentation'], use: {browserName: 'webkit'}}]
});
