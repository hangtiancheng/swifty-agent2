/** @type {import('prettier').Config} */
export default {
  singleQuote: true,
  semi: false,
  printWidth: 100,
  trailingComma: 'none',
  plugins: ['prettier-plugin-tailwindcss'],
  tailwindStylesheet: './src/renderer/src/assets/main.css'
}
