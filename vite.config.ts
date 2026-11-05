import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { thirdPartyNotices } from './scripts/third-party-notices.ts';
export default defineConfig({ plugins: [react(), thirdPartyNotices()], test: { environment: 'jsdom', include: ['src/**/*.test.ts', 'src/**/*.test.tsx'] } });
