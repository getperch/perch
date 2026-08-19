// @types/react-syntax-highlighter doesn't declare the individual per-language ESM submodules
// (react-syntax-highlighter/dist/esm/languages/prism/*.js) used for PrismLight's registerLanguage.
declare module "react-syntax-highlighter/dist/esm/languages/prism/*.js" {
  const language: unknown;
  export default language;
}
