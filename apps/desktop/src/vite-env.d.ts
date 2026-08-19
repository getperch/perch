/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_WORKSPACE_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
