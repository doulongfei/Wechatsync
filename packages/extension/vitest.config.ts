import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./vitest.setup.ts'],
    include: ['__tests__/**/*.test.ts'],
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
    // 让 .ts 排在 .js 前面。src/ 下曾散落 tsc 生成的 .js 编译产物，
    // 而无扩展名的 import 在默认顺序下会优先解析到它们——结果是
    // vite build 读 .ts、vitest 读 .js，测试悄悄跑在过期代码上。
    // 残留已清理，这里再钉一道防线，避免它们重新出现时又踩同一个坑。
    extensions: ['.mts', '.ts', '.tsx', '.mjs', '.js', '.jsx', '.json'],
  },
})
