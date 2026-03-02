/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#112233',
        sea: '#0f7c8d',
        sand: '#f3e9d2',
        coral: '#ef6f6c',
      },
    },
  },
  plugins: [],
};