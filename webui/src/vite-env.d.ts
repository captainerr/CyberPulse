/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_NVD_API_KEY?: string;
  readonly VITE_NVD_BASE_URL?: string;
  readonly VITE_KEV_CATALOG_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
