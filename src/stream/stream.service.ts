import { Injectable, InternalServerErrorException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import { StreamChat } from 'stream-chat';

@Injectable()
export class StreamService {
  private readonly client: StreamChat;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('STREAM_API_KEY');
    const apiSecret = this.config.get<string>('STREAM_API_SECRET');

    if (!apiKey || !apiSecret) {
      throw new InternalServerErrorException(
        'Stream credentials are not configured',
      );
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

  ownerProviderChannelId(firstUserId: string, secondUserId: string) {
    const pair = [firstUserId, secondUserId].sort().join(':');
    return `op_${createHash('sha256').update(pair).digest('hex').slice(0, 40)}`;
  }

  async createDirectChannel(
    channelId: string,
    memberIds: string[],
    createdById: string,
    metadata?: Record<string, string>,
  ) {
    const channel = this.client.channel('messaging', channelId, {
      members: memberIds,
      created_by_id: createdById,
      ...(metadata ?? {}),
    });
    await channel.watch();
    return channelId;
  }

  /** Resolve one authorized owner/provider conversation, preserving legacy history. */
  async resolveOwnerProviderChannel(
    firstUserId: string,
    secondUserId: string,
  ): Promise<string> {
    const canonicalId = this.ownerProviderChannelId(firstUserId, secondUserId);
    const expected = new Set([firstUserId, secondUserId]);
    const channels = await this.client.queryChannels(
      {
        type: 'messaging',
        members: { $in: [...expected] },
      },
      { created_at: 1 },
      { limit: 50, state: true, watch: false, presence: false },
    );
    const valid = (
      await Promise.all(
        channels.map(async (channel: any) => {
          const members = channel.state?.members ?? channel.data?.members ?? {};
          const ids = new Set(
            Array.isArray(members)
              ? members
                  .map((m: any) => m?.user_id ?? m?.user?.id)
                  .filter(Boolean)
              : Object.keys(members),
          );
          let hasHistory = (channel.state?.messages ?? []).length > 0;
          if (
            !hasHistory &&
            ids.size === 2 &&
            [...ids].every((id) => expected.has(id))
          ) {
            try {
              hasHistory =
                (await this.getChannelMessages('messaging', channel.id))
                  .length > 0;
            } catch {
              hasHistory = false;
            }
          }
          return ids.size === 2 && [...ids].every((id) => expected.has(id))
            ? {
                id: channel.id as string,
                hasHistory,
                createdAt: new Date(
                  channel.data?.created_at ?? channel.created_at ?? 0,
                ).getTime(),
              }
            : null;
        }),
      )
    ).filter(
      (
        channel,
      ): channel is { id: string; hasHistory: boolean; createdAt: number } =>
        !!channel,
    );
    const canonical = valid.find((channel) => channel.id === canonicalId);
    if (canonical?.hasHistory) return canonicalId;
    const legacy = valid
      .filter((channel) => channel.id !== canonicalId && channel.hasHistory)
      .sort((a, b) => a.createdAt - b.createdAt);
    return legacy[0]?.id ?? canonicalId;
  }

  async isAuthorizedOwnerProviderChannel(
    channelType: string,
    channelId: string,
    ownerUserId: string,
    providerUserId: string,
  ): Promise<boolean> {
    if (channelType !== 'messaging') return false;
    const participantData = await this.getChannelParticipantData(
      channelType,
      channelId,
    );
    if (!participantData) return false;
    const expected = new Set([ownerUserId, providerUserId]);
    if (
      participantData.memberIds.length !== 2 ||
      !participantData.memberIds.every((id) => expected.has(id))
    )
      return false;
    const canonicalId = this.ownerProviderChannelId(
      ownerUserId,
      providerUserId,
    );
    if (channelId === canonicalId) return true;
    const messages = await this.getChannelMessages(channelType, channelId);
    return messages.length > 0;
  }

  async getChannelParticipantData(
    channelType: string,
    channelId: string,
  ): Promise<{ memberIds: string[]; data: Record<string, unknown> } | null> {
    const channels = await this.client.queryChannels(
      { type: channelType, id: channelId },
      {},
      { limit: 1 },
    );
    const channel = channels[0] as any;
    if (!channel) return null;
    const membersValue = channel.state?.members ?? channel.data?.members ?? {};
    const memberIds = Array.isArray(membersValue)
      ? membersValue
          .map((member: any) => member?.user_id ?? member?.user?.id)
          .filter((id: unknown): id is string => typeof id === 'string')
      : Object.keys(membersValue);
    return {
      memberIds: [...new Set(memberIds)],
      data: (channel.data ?? {}) as Record<string, unknown>,
    };
  }

  async getChannelMessages(
    channelType: string,
    channelId: string,
    around?: Date,
  ): Promise<Array<Record<string, unknown>>> {
    const channel = this.client.channel(channelType, channelId);
    const response = await channel.query({
      state: true,
      watch: false,
      presence: false,
      messages: {
        limit: 50,
        ...(around ? { created_at_around: around } : {}),
      },
    });
    return (response.messages ?? []) as unknown as Array<
      Record<string, unknown>
    >;
  }
}
