export interface LanguageServerConfig {
  id: string;
  root?: string;
  ignoreDirectories?: string[];
  autoOpenFiles?: string[];
  initSleep?: number;
  languageId: string;
  extensions: string[];
  command: string;
  args?: string[];
  env?: Record<string, string>;
  initializationOptions?: Record<string, unknown>;
}

export interface RegistryOptions {
  servers?: LanguageServerConfig[];
  overrides?: Record<string, Partial<LanguageServerConfig>>;
}

export class LanguageServerRegistry {
  private servers: LanguageServerConfig[];

  constructor(options: RegistryOptions = {}) {
    this.servers = (options.servers ?? []).map((s) => ({ ...s }));
    if (options.overrides) {
      for (const [id, override] of Object.entries(options.overrides)) {
        const idx = this.servers.findIndex((s) => s.id === id);
        if (idx >= 0) {
          this.servers[idx] = { ...this.servers[idx]!, ...override };
        }
      }
    }
  }

  list(): LanguageServerConfig[] {
    return [...this.servers];
  }

  getById(id: string): LanguageServerConfig | undefined {
    return this.servers.find((s) => s.id === id);
  }

  getByExtension(ext: string): LanguageServerConfig | undefined {
    const normalized = ext.startsWith(".") ? ext : `.${ext}`;
    return this.servers.find((s) => s.extensions.includes(normalized));
  }

  getByLanguageId(languageId: string): LanguageServerConfig | undefined {
    return this.servers.find((s) => s.languageId === languageId);
  }
}
