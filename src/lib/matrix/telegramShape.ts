import type {MatrixEvent, MatrixMessagesResponse, MatrixSyncRoom} from './matrixClient';

export class MatrixIdMapper {
  private idToNumber = new Map<string, number>();
  private numberToId = new Map<number, string>();
  private storageKey = 'kuromatrix:id-map:v1';

  constructor() {
    this.load();
  }

  public toNumber(id: string) {
    id = this.normalize(id);
    const existing = this.idToNumber.get(id);
    if(existing) {
      return existing;
    }

    let hash = 2166136261;
    for(let i = 0; i < id.length; i++) {
      hash ^= id.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }

    let numeric = (hash >>> 0) % 2000000000;
    if(numeric < 1000) {
      numeric += 1000;
    }

    while(this.numberToId.has(numeric) && this.numberToId.get(numeric) !== id) {
      numeric++;
    }

    this.idToNumber.set(id, numeric);
    this.numberToId.set(numeric, id);
    this.save();

    return numeric;
  }

  public toString(id: number) {
    return this.numberToId.get(Number(id));
  }

  public register(id: string, numeric?: number) {
    id = this.normalize(id);
    numeric ??= this.toNumber(id);

    const existingId = this.numberToId.get(numeric);
    if(existingId && existingId !== id) {
      return this.toNumber(id);
    }

    this.idToNumber.set(id, numeric);
    this.numberToId.set(numeric, id);
    this.save();
    return numeric;
  }

  private normalize(id: string) {
    return String(id).trim();
  }

  private load() {
    try {
      const raw = localStorage.getItem(this.storageKey);
      if(!raw) {
        return;
      }

      const entries = JSON.parse(raw) as Array<[string, number]>;
      if(!Array.isArray(entries)) {
        return;
      }

      for(const [id, numeric] of entries) {
        if(typeof id !== 'string' || !Number.isFinite(numeric)) {
          continue;
        }

        this.idToNumber.set(id, numeric);
        this.numberToId.set(numeric, id);
      }
    } catch(error) {
      // A corrupt local map should not prevent the Matrix bridge from booting.
    }
  }

  private save() {
    try {
      localStorage.setItem(this.storageKey, JSON.stringify([...this.idToNumber.entries()]));
    } catch(error) {
      // Storage can be unavailable in private contexts; deterministic hashing remains as fallback.
    }
  }
}

const now = () => Math.floor(Date.now() / 1000);

const eventTimestamp = (event?: MatrixEvent) => event?.origin_server_ts ? Math.floor(event.origin_server_ts / 1000) : now();

const messageId = (roomId: string, event: MatrixEvent, mapper: MatrixIdMapper) => {
  const seconds = eventTimestamp(event);
  const stableEventPart = mapper.toNumber(`event:${roomId}:${event.event_id || seconds}`) % 10;
  return Math.max(1, ((seconds - 1600000000) * 10) + stableEventPart);
};

export const findState = (room: MatrixSyncRoom | undefined, type: string, stateKey = '') => {
  return room?.state?.events?.find((event) => event.type === type && (event.state_key || '') === stateKey);
};

export const matrixRoomTitle = (roomId: string, room?: MatrixSyncRoom) => {
  const name = findState(room, 'm.room.name')?.content?.name;
  if(typeof name === 'string' && name.trim()) {
    return name;
  }

  const alias = findState(room, 'm.room.canonical_alias')?.content?.alias;
  if(typeof alias === 'string' && alias.trim()) {
    return alias;
  }

  return room?.name || roomId;
};

export const matrixRoomAvatarUrl = (room?: MatrixSyncRoom) => {
  const avatar = findState(room, 'm.room.avatar')?.content?.url;
  return typeof avatar === 'string' && avatar.trim() ? avatar : undefined;
};

const localpart = (userId: string) => userId.match(/^@([^:]+):/)?.[1] || userId;

export const isMatrixBotUserId = (userId: string) => /bot$/i.test(localpart(userId));

const matrixUserStatus = (userId: string, selfUserId?: string) => {
  if(isMatrixBotUserId(userId)) {
    return {
      _: 'userStatusEmpty'
    };
  }

  return userId === selfUserId ? {
    _: 'userStatusOnline',
    expires: now() + 300
  } : {
    _: 'userStatusRecently',
    pFlags: {}
  };
};

const matrixPhoto = (
  kind: 'userProfilePhoto' | 'chatPhoto',
  id: string,
  mapper: MatrixIdMapper,
  avatarUrl?: string,
  avatarToHttp?: (url?: string) => string | undefined
) => {
  const matrixUrl = avatarToHttp?.(avatarUrl) || avatarUrl;
  if(!matrixUrl) {
    return {
      _: kind === 'userProfilePhoto' ? 'userProfilePhotoEmpty' : 'chatPhotoEmpty'
    };
  }

  return {
    _: kind,
    pFlags: {},
    photo_id: mapper.toNumber(`photo:${id}:${avatarUrl}`),
    dc_id: 1,
    matrix_url: matrixUrl
  };
};

export const matrixSelfUser = (
  userId: string,
  mapper: MatrixIdMapper,
  avatarToHttp?: (url?: string) => string | undefined,
  avatarUrl?: string,
  displayName = localpart(userId)
) => {
  return {
    _: 'user',
    id: userId,
    access_hash: '0',
    pFlags: {
      self: true,
      bot: isMatrixBotUserId(userId)
    },
    first_name: displayName,
    username: localpart(userId),
    photo: matrixPhoto('userProfilePhoto', userId, mapper, avatarUrl, avatarToHttp),
    status: matrixUserStatus(userId, userId)
  };
};

export const matrixMemberToUser = (
  member: MatrixEvent,
  mapper: MatrixIdMapper,
  selfUserId?: string,
  avatarToHttp?: (url?: string) => string | undefined
) => {
  const userId = member.state_key || member.sender || '@unknown:matrix';
  const displayName = typeof member.content?.displayname === 'string' && member.content.displayname.trim() ?
    member.content.displayname :
    localpart(userId);
  const avatarUrl = typeof member.content?.avatar_url === 'string' ? member.content.avatar_url : undefined;

  return {
    _: 'user',
    id: userId,
    access_hash: '0',
    pFlags: {
      self: userId === selfUserId,
      bot: isMatrixBotUserId(userId)
    },
    first_name: displayName,
    username: localpart(userId),
    photo: matrixPhoto('userProfilePhoto', userId, mapper, avatarUrl, avatarToHttp),
    status: matrixUserStatus(userId, selfUserId)
  };
};

export const matrixMemberToParticipant = (member: MatrixEvent, mapper: MatrixIdMapper) => {
  const userId = member.state_key || member.sender || '@unknown:matrix';

  return {
    _: 'channelParticipant',
    pFlags: {},
    user_id: userId,
    date: eventTimestamp(member)
  };
};

export const matrixRoomToChat = (
  roomId: string,
  room: MatrixSyncRoom | undefined,
  mapper: MatrixIdMapper,
  avatarToHttp?: (url?: string) => string | undefined
) => {
  const latestEvent = room?.timeline?.events?.[room.timeline.events.length - 1];
  const avatarUrl = matrixRoomAvatarUrl(room);

  return {
    _: 'channel',
    id: roomId,
    access_hash: '0',
    pFlags: {
      megagroup: true
    },
    title: matrixRoomTitle(roomId, room),
    photo: matrixPhoto('chatPhoto', roomId, mapper, avatarUrl, avatarToHttp),
    date: eventTimestamp(latestEvent),
    participants_count: room?.summary?.['m.joined_member_count'] || 0,
    default_banned_rights: {
      _: 'chatBannedRights',
      pFlags: {},
      until_date: 0
    }
  };
};

export const matrixRoomToFullChannel = (
  roomId: string,
  room: MatrixSyncRoom | undefined,
  mapper: MatrixIdMapper
) => {
  const topic = findState(room, 'm.room.topic')?.content?.topic;

  return {
    _: 'channelFull',
    pFlags: {
      can_view_participants: true,
      can_set_username: false
    },
    id: roomId,
    about: typeof topic === 'string' ? topic : '',
    participants_count: room?.summary?.['m.joined_member_count'] || 0,
    admins_count: 0,
    kicked_count: 0,
    banned_count: 0,
    online_count: 0,
    read_inbox_max_id: 0,
    read_outbox_max_id: 0,
    unread_count: room?.unread_notifications?.notification_count || 0,
    notify_settings: {
      _: 'peerNotifySettings'
    },
    bot_info: [] as any[]
  };
};

export const matrixEventToMessage = (
  roomId: string,
  event: MatrixEvent,
  mapper: MatrixIdMapper,
  selfUserId?: string,
  dialogUserId?: string
) => {
  const content = event.content || {};
  const sender = event.sender || selfUserId || '@unknown:matrix';
  const text = typeof content.body === 'string' ? content.body : '';
  const isDirect = !!dialogUserId;

  return {
    _: 'message',
    id: messageId(roomId, event, mapper),
    pFlags: {
      out: sender === selfUserId
    },
    peer_id: isDirect ? {
      _: 'peerUser',
      user_id: dialogUserId
    } : {
      _: 'peerChannel',
      channel_id: roomId
    },
    from_id: {
      _: 'peerUser',
      user_id: sender
    },
    date: eventTimestamp(event),
    message: text,
    entities: [] as any[],
    views: 0,
    forwards: 0,
    replies: {
      _: 'messageReplies',
      pFlags: {},
      replies: 0,
      replies_pts: 0,
      recent_repliers: [] as any[],
      channel_id: 0,
      max_id: 0,
      read_max_id: 0
    }
  };
};

export const matrixRoomToDialog = (
  roomId: string,
  room: MatrixSyncRoom | undefined,
  mapper: MatrixIdMapper,
  topMessageId = 0,
  dialogUserId?: string
) => {
  return {
    _: 'dialog',
    pFlags: {},
    peer: dialogUserId ? {
      _: 'peerUser',
      user_id: dialogUserId
    } : {
      _: 'peerChannel',
      channel_id: roomId
    },
    top_message: topMessageId,
    read_inbox_max_id: topMessageId,
    read_outbox_max_id: topMessageId,
    unread_count: room?.unread_notifications?.notification_count || 0,
    unread_mentions_count: room?.unread_notifications?.highlight_count || 0,
    unread_reactions_count: 0,
    notify_settings: {
      _: 'peerNotifySettings'
    }
  };
};

export const matrixMessagesToTelegramResult = (
  roomId: string,
  response: MatrixMessagesResponse,
  mapper: MatrixIdMapper,
  selfUserId?: string,
  dialogUserId?: string
) => {
  const messages = response.chunk
  .filter((event) => event.type === 'm.room.message')
  .map((event) => matrixEventToMessage(roomId, event, mapper, selfUserId, dialogUserId));

  return {
    _: 'messages.messages',
    messages,
    chats: [] as any[],
    users: selfUserId ? [matrixSelfUser(selfUserId, mapper)] : []
  };
};
