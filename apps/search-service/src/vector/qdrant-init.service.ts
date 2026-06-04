import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import axios, { type AxiosInstance } from 'axios';

interface QdrantCollection {
  name: string;
  vectorSize: number;
}

@Injectable()
export class QdrantInitService implements OnModuleInit {
  private readonly logger = new Logger(QdrantInitService.name);
  private readonly http: AxiosInstance;

  private readonly COLLECTIONS: QdrantCollection[] = [
    { name: 'products', vectorSize: 768 },
    { name: 'users', vectorSize: 256 },
    { name: 'content', vectorSize: 768 },
  ];

  constructor(private readonly config: ConfigService) {
    const baseURL = this.config.get<string>('QDRANT_URL', 'http://localhost:6333');
    const apiKey = this.config.get<string>('QDRANT_API_KEY');

    this.http = axios.create({
      baseURL,
      timeout: 10_000,
      headers: apiKey ? { 'api-key': apiKey } : {},
    });
  }

  async onModuleInit(): Promise<void> {
    for (const col of this.COLLECTIONS) {
      await this.ensureCollection(col).catch((err: Error) =>
        this.logger.warn(`Failed to init Qdrant collection '${col.name}': ${err.message}`),
      );
    }
  }

  private async ensureCollection(col: QdrantCollection): Promise<void> {
    try {
      await this.http.get(`/collections/${col.name}`);
      this.logger.log(`Qdrant collection already exists: ${col.name}`);
      return;
    } catch (err) {
      const status = (err as { response?: { status?: number } }).response?.status;
      if (status !== 404) throw err;
    }

    await this.http.put(`/collections/${col.name}`, {
      vectors: {
        size: col.vectorSize,
        distance: 'Cosine',
        hnsw_config: {
          m: 16,
          ef_construct: 100,
          on_disk: false,
        },
      },
    });

    this.logger.log(`Qdrant collection created: ${col.name} (${col.vectorSize}-dim, cosine HNSW)`);
  }

  getClient(): AxiosInstance {
    return this.http;
  }
}
