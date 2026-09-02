import { defineConfig } from 'vitest/config'

/**
 * 打真实模型的端到端回归专用配置。单独一份而不是塞进 vite.config.ts，是因为
 * 这两类测试的取舍正好相反：单元测试要快、要确定、要能进 CI；这个要外网、
 * 要几分钟、结果天然不确定。混在一起的结果是 `npm test` 变成看天吃饭的东西。
 *
 * 跑法见 README「端到端回归」，或 e2e/regression.test.ts 的文件头注释。
 */
export default defineConfig({
  test: {
    include: ['e2e/**/*.test.ts'],
    testTimeout: 1_800_000,
    hookTimeout: 1_800_000,
  },
})
