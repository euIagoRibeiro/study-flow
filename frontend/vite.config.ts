import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'

// O site chama a API pela mesma origem (/api), como na hospedagem: o proxy
// tira o prefixo (/api/tasks chega como /tasks). API_PROXY_TARGET troca o
// destino (instância isolada); sem VITE_, não vai pro código do site
const apiTarget = process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:3333'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      '/api': {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
    },
  },
})
