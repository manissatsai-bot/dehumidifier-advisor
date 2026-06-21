import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        green: { 500: '#22c55e', 100: '#dcfce7' },
        yellow: { 500: '#eab308', 100: '#fef9c3' },
        red: { 500: '#ef4444', 100: '#fee2e2' },
      },
    },
  },
  plugins: [],
}

export default config
