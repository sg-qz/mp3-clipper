import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite 配置：使用 React 插件（含 Fast Refresh 与 JSX 转换）
export default defineConfig({
  plugins: [react()],
  // 静态部署用相对路径，根路径/子路径均不丢资源
  base: './',
  // 输出到沙箱不拦截清理的目录；关闭 emptyOutDir 避免 Vite 调用 rmSync 被环境拦截
  build: {
    outDir: 'build-out',
    emptyOutDir: false,
  },
  server: {
    port: 5173,
    open: false,
  },
});
