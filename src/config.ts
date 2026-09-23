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
  rank: {
    apiUrl: string;
    apiKey: string;
    model: string;
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
    rank: {
      apiUrl: (process.env.RANK_API_URL ?? "").replace(/\/+$/, ""),
      apiKey: process.env.RANK_API_KEY ?? "",
      model: process.env.RANK_MODEL ?? "rerank-english-v3.0",
    },
    toggleOverride: process.env.PROCESSES_TOGGLE_OVERRIDE ?? "",
  };
}
