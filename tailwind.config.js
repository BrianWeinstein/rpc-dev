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
        // // Adds 'inter' to Tailwind's font utilities.
        // // Assumes 'Inter' is imported via Google Fonts or similar in your CSS/HTML.
        // inter: ['Inter', 'sans-serif'],
        // // Adds 'serif' to Tailwind's font utilities, matching your code.
        // serif: ['Georgia', 'serif'], // You can change 'Georgia' to any other preferred serif font


        // Defines the 'sans' font stack to use Comic Sans MS as the primary font,
        // falling back to a generic sans-serif if Comic Sans MS is not available.
        sans: ['"Comic Relief"', 'sans-serif'],
        // Defines the 'serif' font stack to use Times New Roman as the primary font,
        // falling back to a generic serif if Times New Roman is not available.
        serif: ['"Times New Roman"', 'Times', 'serif'], // Changed to Times New Roman



      },
    },
  },
  plugins: [],
}
