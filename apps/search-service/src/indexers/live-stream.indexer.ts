import { Injectable, Logger } from '@nestjs/common';
import type { ElasticsearchService } from '@nestjs/elasticsearch';

export interface IndexableLiveStream {
  id: string;
  hostId: string;
  hostName: string;
  title: string;
  description?: string;
  thumbnailUrl?: string;
  tags: string[];
  viewerCount: number;
  startedAt: string;
  status: 'LIVE' | 'ENDED' | 'SCHEDULED';
  productIds?: string[];
}

@Injectable()
export class LiveStreamIndexer {
  private readonly logger = new Logger(LiveStreamIndexer.name);
  private readonly INDEX = 'live_streams';

  constructor(private readonly es: ElasticsearchService) {}

  async index(stream: IndexableLiveStream): Promise<void> {
    try {
      await this.es.index({
        index: this.INDEX,
        id: stream.id,
        document: {
          ...stream,
          indexedAt: new Date().toISOString(),
        },
      });
    } catch (err) {
      this.logger.error(`Failed to index live stream ${stream.id}`, err);
    }
  }

  async delete(streamId: string): Promise<void> {
    try {
      await this.es.delete({ index: this.INDEX, id: streamId });
    } catch (err) {
      this.logger.warn(`Failed to delete live stream ${streamId}`, err);
    }
  }

  async searchLive(query: string, limit = 20): Promise<IndexableLiveStream[]> {
    const result = await this.es.search<IndexableLiveStream>({
      index: this.INDEX,
      size: limit,
      query: {
        bool: {
          must: [
            { term: { status: 'LIVE' } },
            query
              ? { multi_match: { query, fields: ['title^2', 'description', 'tags'] } }
              : { match_all: {} },
          ],
        },
      },
      sort: [{ viewerCount: 'desc' }],
    });

    return result.hits.hits.map((h) => h._source as IndexableLiveStream);
  }
}
