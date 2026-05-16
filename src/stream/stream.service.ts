import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StreamChat } from 'stream-chat';

@Injectable()
export class StreamService {
  private readonly client: StreamChat;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('STREAM_API_KEY');
    const apiSecret = this.config.get<string>('STREAM_API_SECRET');

    if (!apiKey || !apiSecret) {
      throw new InternalServerErrorException('Stream credentials are not configured');
    }

    this.client = StreamChat.getInstance(apiKey, apiSecret);
  }

  async upsertStreamUser(
    id: string,
    name: string | null,
    role: string,
    isVerified?: boolean,
  ) {
    const streamRole = role === 'admin' ? 'admin' : 'user';
    await this.client.upsertUser({
      id,
      name: name ?? '',
      role: streamRole,
      ...(isVerified !== undefined ? { isVerified } : {}),
    });
  }

  generateStreamToken(userId: string) {
    return this.client.createToken(userId);
  }
}
