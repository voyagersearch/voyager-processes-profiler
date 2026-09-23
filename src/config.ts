export interface Config {
  port: number;
  publicBaseUrl: string;
  registerBaseUrl: string;
  hq: {
    baseUrl: string;
    username: string;
    password: string;
    provRoot: string;
    provSubpath: string;
    provConcurrency: number;
  };
  rag: {
    baseUrl: string;
  };
  toggleOverride: string;
}

export function readConfig(): Config {
  return {
    port: Number(process.env.PORT ?? 4600),
    publicBaseUrl: (process.env.PUBLIC_BASE_URL ?? "http://localhost:4600").replace(/\/+$/, ""),
    registerBaseUrl: (process.env.REGISTER_BASE_URL ?? "").replace(/\/+$/, ""),
    hq: {
      baseUrl: (process.env.HQ_BASE_URL ?? "").replace(/\/+$/, ""),
      username: process.env.HQ_USERNAME ?? "admin",
      password: process.env.HQ_PASSWORD ?? "voyager",
      provRoot: process.env.HQ_PROV_FILE_ROOT ?? "py",
      provSubpath: (process.env.HQ_PROV_SUBPATH ?? "test_data/prov").replace(/^\/+|\/+$/g, ""),
      provConcurrency: Math.max(1, Number(process.env.HQ_PROV_CONCURRENCY ?? 8)),
    },
    rag: {
      baseUrl: (process.env.RAG_BASE_URL ?? "").replace(/\/+$/, ""),
    },
    toggleOverride: process.env.PROCESSES_TOGGLE_OVERRIDE ?? "",
  };
}
