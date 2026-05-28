/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50:  '#E6F0FF',
          100: '#B3D4FF',
          200: '#80B8FF',
          300: '#4C9AFF',
          400: '#2684FF',
          500: '#0065FF',
          600: '#0052CC',  // Atlassian blue
          700: '#0747A6',
          800: '#003884',
          900: '#002966',
        },
      },
    },
  },
  plugins: [],
};
