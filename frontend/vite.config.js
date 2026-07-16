import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // en desarrollo el backend corre en :3000; en prod se usa VITE_API_URL
    proxy: { '/api': 'http://localhost:3000' },
  },
})
