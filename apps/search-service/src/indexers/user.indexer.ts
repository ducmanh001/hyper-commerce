import { Injectable, Logger } from '@nestjs/common';
import { ElasticsearchService } from '@nestjs/elasticsearch';

@Injectable()
export class UserIndexer {
  private readonly logger = new Logger(UserIndexer.name);
  readonly indexName = 'users';

  constructor(private readonly es: ElasticsearchService) {}

  async index(user: {
    id: string; username: string; fullName?: string;
    bio?: string; avatarUrl?: string; followerCount: number; isActive: boolean;
  }): Promise<void> {
    await this.es.index({ index: this.indexName, id: user.id, document: user, refresh: false });
  }

  async delete(userId: string): Promise<void> {
    await this.es.delete({ index: this.indexName, id: userId, refresh: false });
  }
}

@Injectable()
export class LiveStreamIndexer {
  private readonly logger = new Logger(LiveStreamIndexer.name);
  readonly indexName = 'live_streams';

  constructor(private readonly es: ElasticsearchService) {}

  async index(stream: {
    id: string; title: string; hostId: string; hostName: string;
    currentViewers: number; products: string[]; isLive: boolean; startedAt: Date;
  }): Promise<void> {
    await this.es.index({ index: this.indexName, id: stream.id, document: stream, refresh: true }); // refresh=true: live streams need immediate visibility
  }

  async updateViewerCount(streamId: string, count: number): Promise<void> {
    await this.es.update({ index: this.indexName, id: streamId, doc: { currentViewers: count } });
  }

  async markEnded(streamId: string): Promise<void> {
    await this.es.update({ index: this.indexName, id: streamId, doc: { isLive: false } });
  }
}
