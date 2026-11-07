import { web } from '@e2e-dev/web';
import type { E2EConfig } from 'e2e';

export default {
  tests: 'tests/**/*.e2e.ts',
  targets: [{
    name: 'editor-fixtures',
    engine: web(),
    app: {
      url: 'http://127.0.0.1:0',
      command: {
        executable: process.execPath,
        args: ['scripts/server.mjs', '{port}'],
        log: '.e2e/logs/fixture-server.log',
      },
    },
  }],
  workers: 1,
  retries: 0,
  timeout: 30000,
  assertionTimeout: 3000,
  cache: 'off',
  trace: 'on',
  video: 'retain-on-failure',
  reporters: ['list', 'markdown'],
} satisfies E2EConfig;
