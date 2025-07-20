// tailwind.config.js
/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    // This line tells Tailwind to scan all JavaScript, TypeScript, JSX, and TSX files in your src folder
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        // Adds 'inter' to Tailwind's font utilities.
        // Assumes 'Inter' is imported via Google Fonts or similar in your CSS/HTML.
        inter: ['Inter', 'sans-serif'],
        // Adds 'serif' to Tailwind's font utilities, matching your code.
        serif: ['Georgia', 'serif'], // You can change 'Georgia' to any other preferred serif font
      },
    },
  },
  plugins: [],
}
