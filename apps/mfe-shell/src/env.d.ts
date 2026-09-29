/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Sentinel API (default: http://localhost:3000/api/v1). */
  readonly VITE_API_BASE_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Remote module specifiers resolved by @originjs/vite-plugin-federation at
// runtime (ADR-005). Vitest aliases them to source in vitest.config.ts.
declare module 'config/ConfigView' {
  const ConfigView: () => JSX.Element;
  export default ConfigView;
}

declare module 'metrics/MetricsView' {
  const MetricsView: () => JSX.Element;
  export default MetricsView;
}
