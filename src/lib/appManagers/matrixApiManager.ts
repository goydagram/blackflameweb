import type {MethodDeclMap} from '@layer';
import {InvokeApiOptions} from '@types';
import {UserAuth} from '@appManagers/constants';
import App from '@config/app';
import ApiManagerMethods from './apiManagerMethods';
import {MatrixClient, MatrixEvent, MatrixSyncResponse, MatrixSyncRoom} from '@lib/matrix/matrixClient';
import {
  MatrixIdMapper,
  matrixMemberToParticipant,
  matrixMemberToUser,
  matrixEventToMessage,
  matrixMessagesToTelegramResult,
  matrixRoomToFullChannel,
  matrixRoomToChat,
  matrixRoomToDialog,
  matrixRoomTitle,
  matrixSelfUser
} from '@lib/matrix/telegramShape';

const MATRIX_SAVED_ROOM_ID = (import.meta.env as Record<string, string | undefined>).VITE_MATRIX_SAVED_ROOM_ID;
const SAVED_ROOM_TITLE_RE = /^(saved messages|saved|notes|note to self|personal notes|избранное|сохран[её]нные|заметки)$/i;

export class MatrixApiManager extends ApiManagerMethods {
  private client = MatrixClient.fromEnv();
  private mapper = new MatrixIdMapper();
  private lastSync?: MatrixSyncResponse;
  private nextBatch?: string;
  private roomMembers = new Map<string, MatrixEvent[]>();
  private directUserByRoomId = new Map<string, string>();
  private directRoomByUserId = new Map<string, string>();
  private savedRoomId?: string;
  private avatarToHttp = (url?: string) => this.client.mxcToHttp(url, {width: 128, height: 128});

  constructor() {
    super();
    this.name = 'MATRIX_API';
  }

  public async getBaseDcId() {
    return App.baseDcId;
  }

  public async setUserAuth(userAuth: UserAuth | UserId) {
    if(typeof userAuth === 'number') {
      this.rootScope.dispatchEvent('user_auth', {
        dcID: 1,
        date: Math.floor(Date.now() / 1000),
        id: userAuth.toPeerId(false)
      });
      await this.hydrateSelfUser();
      return;
    }

    if(typeof userAuth === 'string' && userAuth.startsWith('@')) {
      this.client.userId = userAuth;
    }

    if(typeof userAuth === 'object') {
      this.rootScope.dispatchEvent('user_auth', userAuth);
    }

    await this.hydrateSelfUser();
  }

  public async invokeApi<T extends keyof MethodDeclMap>(
    method: T,
    params: MethodDeclMap[T]['req'] = {} as MethodDeclMap[T]['req'],
    options: InvokeApiOptions = {}
  ): Promise<MethodDeclMap[T]['res']> {
    switch(method as string) {
      case 'help.getConfig':
        return this.getMatrixConfig() as MethodDeclMap[T]['res'];

      case 'help.getAppConfig':
        return {
          _: 'help.appConfigNotModified'
        } as MethodDeclMap[T]['res'];

      case 'help.getCountriesList':
        return {
          _: 'help.countriesList',
          countries: [],
          hash: 0
        } as MethodDeclMap[T]['res'];

      case 'help.getPromoData':
        return {
          _: 'help.promoDataEmpty',
          expires: Math.floor(Date.now() / 1000) + 3600
        } as MethodDeclMap[T]['res'];

      case 'langpack.getLangPack':
        return {
          _: 'langPackDifference',
          lang_code: 'en',
          from_version: 0,
          version: 0,
          strings: []
        } as MethodDeclMap[T]['res'];

      case 'help.getPeerColors':
      case 'help.getPeerProfileColors':
        return {
          _: 'help.peerColors',
          hash: 0,
          colors: []
        } as MethodDeclMap[T]['res'];

      case 'updates.getState':
        return {
          _: 'updates.state',
          pts: 1,
          qts: 1,
          date: Math.floor(Date.now() / 1000),
          seq: 1,
          unread_count: 0
        } as MethodDeclMap[T]['res'];

      case 'users.getUsers':
        return await this.getUsers(params as any) as MethodDeclMap[T]['res'];

      case 'users.getFullUser':
        return await this.getFullUser(params as any) as MethodDeclMap[T]['res'];

      case 'account.updateStatus':
        return true as MethodDeclMap[T]['res'];

      case 'account.registerDevice':
      case 'account.unregisterDevice':
        return true as MethodDeclMap[T]['res'];

      case 'account.getNotifySettings':
        return {
          _: 'peerNotifySettings'
        } as MethodDeclMap[T]['res'];

      case 'account.getGlobalPrivacySettings':
        return {
          _: 'globalPrivacySettings',
          pFlags: {}
        } as MethodDeclMap[T]['res'];

      case 'account.getContentSettings':
        return {
          _: 'account.contentSettings',
          pFlags: {}
        } as MethodDeclMap[T]['res'];

      case 'account.getWebAuthorizations':
        return {
          _: 'account.webAuthorizations',
          authorizations: [],
          users: [await this.getSelfUser()]
        } as MethodDeclMap[T]['res'];

      case 'account.getAuthorizations':
        return {
          _: 'account.authorizations',
          authorization_ttl_days: 0,
          authorizations: []
        } as MethodDeclMap[T]['res'];

      case 'contacts.getTopPeers':
        return {
          _: 'contacts.topPeers',
          categories: [],
          chats: [],
          users: [await this.getSelfUser()]
        } as MethodDeclMap[T]['res'];

      case 'contacts.resolveUsername':
        return await this.resolveUsername(params as any) as MethodDeclMap[T]['res'];

      case 'messages.getDialogs':
        return await this.getDialogs(params as any) as MethodDeclMap[T]['res'];

      case 'messages.getDialogFilters':
        return {
          _: 'messages.dialogFilters',
          pFlags: {},
          filters: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getAllDrafts':
        return this.emptyUpdates() as MethodDeclMap[T]['res'];

      case 'messages.receivedMessages':
        return [] as MethodDeclMap[T]['res'];

      case 'messages.getSavedDialogs':
        return await this.getSavedDialogs(params as any) as MethodDeclMap[T]['res'];

      case 'messages.getSavedHistory':
        return await this.getSavedHistory(params as any) as MethodDeclMap[T]['res'];

      case 'messages.readSavedHistory':
        return true as MethodDeclMap[T]['res'];

      case 'messages.getSavedReactionTags':
        return {
          _: 'messages.savedReactionTags',
          tags: [],
          hash: 0
        } as MethodDeclMap[T]['res'];

      case 'messages.getHistory':
        return await this.getHistory(params as any) as MethodDeclMap[T]['res'];

      case 'messages.setTyping':
        return true as MethodDeclMap[T]['res'];

      case 'messages.readHistory':
        return {
          _: 'messages.affectedMessages',
          pts: 1,
          pts_count: 0
        } as MethodDeclMap[T]['res'];

      case 'channels.readHistory':
        return true as MethodDeclMap[T]['res'];

      case 'messages.getPeerSettings':
        return {
          _: 'messages.peerSettings',
          settings: {
            _: 'peerSettings',
            pFlags: {}
          },
          chats: [],
          users: [await this.getSelfUser()]
        } as MethodDeclMap[T]['res'];

      case 'messages.getScheduledHistory':
        return {
          _: 'messages.messages',
          messages: [],
          chats: [],
          users: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getSearchCounters':
        return ((params as any).filters || []).map((filter: any) => ({
          _: 'messages.searchCounter',
          pFlags: {},
          filter,
          count: 0
        })) as MethodDeclMap[T]['res'];

      case 'messages.search':
      case 'messages.searchGlobal':
        return {
          _: 'messages.messages',
          messages: [],
          chats: [],
          users: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getAvailableReactions':
        return {
          _: 'messages.availableReactions',
          hash: 0,
          reactions: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getMessagesReactions':
        return this.emptyUpdates() as MethodDeclMap[T]['res'];

      case 'messages.readReactions':
        return {
          _: 'messages.affectedHistory',
          pts: 1,
          pts_count: 0,
          offset: 0
        } as MethodDeclMap[T]['res'];

      case 'messages.getSponsoredMessages':
        return {
          _: 'messages.sponsoredMessagesEmpty'
        } as MethodDeclMap[T]['res'];

      case 'messages.getAttachMenuBots':
        return {
          _: 'attachMenuBots',
          hash: 0,
          bots: [],
          users: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getSavedGifs':
        return {
          _: 'messages.savedGifs',
          hash: 0,
          gifs: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getRecentStickers':
        return {
          _: 'messages.recentStickers',
          hash: 0,
          packs: [],
          stickers: [],
          dates: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getFavedStickers':
        return {
          _: 'messages.favedStickers',
          hash: 0,
          packs: [],
          stickers: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getStickerSet':
        return this.emptyStickerSet((params as any).stickerset) as MethodDeclMap[T]['res'];

      case 'messages.getFeaturedStickers':
        return {
          _: 'messages.featuredStickers',
          pFlags: {},
          hash: 0,
          count: 0,
          sets: [],
          unread: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getStickers':
        return {
          _: 'messages.stickers',
          hash: 0,
          stickers: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getAllStickers':
        return {
          _: 'messages.allStickers',
          hash: 0,
          sets: []
        } as MethodDeclMap[T]['res'];

      case 'messages.sendMessage':
      case 'messages.sendMedia':
        return await this.sendMessage(params as any) as MethodDeclMap[T]['res'];

      case 'channels.getFullChannel':
        return await this.getFullChannel(params as any) as MethodDeclMap[T]['res'];

      case 'messages.getFullChat':
        return await this.getFullChannel(params as any) as MethodDeclMap[T]['res'];

      case 'channels.getParticipants':
        return await this.getParticipants(params as any) as MethodDeclMap[T]['res'];

      case 'channels.getParticipant':
        return await this.getParticipant(params as any) as MethodDeclMap[T]['res'];

      case 'stories.getAllStories':
        return {
          _: 'stories.allStories',
          pFlags: {},
          count: 0,
          state: '',
          peer_stories: [],
          chats: [],
          users: [],
          stealth_mode: {
            _: 'storiesStealthMode'
          }
        } as MethodDeclMap[T]['res'];

      case 'stories.getPeerStories':
        return {
          _: 'stories.peerStories',
          stories: {
            _: 'peerStories',
            peer: (params as any).peer || {_: 'peerUser', user_id: (await this.getSelfUser()).id},
            stories: [],
            max_read_id: 0
          },
          chats: [],
          users: [await this.getSelfUser()]
        } as MethodDeclMap[T]['res'];

      case 'payments.getStarsStatus':
        return {
          _: 'payments.starsStatus',
          balance: {
            _: 'starsAmount',
            amount: 0,
            nanos: 0
          },
          chats: [],
          users: []
        } as MethodDeclMap[T]['res'];

      case 'payments.getSavedStarGifts':
      case 'payments.getSavedStarGift':
        return {
          _: 'payments.savedStarGifts',
          count: 0,
          gifts: [],
          chats: [],
          users: []
        } as MethodDeclMap[T]['res'];

      case 'payments.getPremiumGiftCodeOptions':
        return [] as MethodDeclMap[T]['res'];

      case 'account.getThemes':
        return {
          _: 'account.themes',
          hash: 0,
          themes: []
        } as MethodDeclMap[T]['res'];

      case 'messages.getPaidReactionPrivacy':
        return {
          ...this.emptyUpdates(),
          updates: [{
            _: 'updatePaidReactionPrivacy',
            private: {
              _: 'paidReactionPrivacyDefault'
            }
          }]
        } as MethodDeclMap[T]['res'];

      default:
        this.log.error('[unimplemented Matrix API method]', method as string, params);
        throw {
          type: 'MATRIX_METHOD_UNIMPLEMENTED',
          code: 400,
          message: `Matrix compatibility backend does not implement ${method as string}`,
          stack: options.noErrorBox ? undefined : new Error().stack
        };
    }
  }

  private emptyUpdates(): any {
    return {
      _: 'updates',
      users: [] as any[],
      chats: [] as any[],
      date: Math.floor(Date.now() / 1000),
      seq: 0,
      updates: [] as any[]
    };
  }

  private emptyStickerSet(inputStickerSet?: any) {
    const id = inputStickerSet?.id ?? inputStickerSet?.short_name ?? inputStickerSet?._ ?? 'matrix-empty-sticker-set';
    const shortName = String(inputStickerSet?.short_name ?? id);

    return {
      _: 'messages.stickerSet',
      set: {
        _: 'stickerSet',
        pFlags: {},
        id,
        access_hash: 0,
        title: shortName,
        short_name: shortName,
        count: 0,
        hash: 0
      },
      packs: [] as any[],
      keywords: [] as any[],
      documents: [] as any[]
    };
  }

  public async sendMatrixTextToPeer(peer: any, body: string) {
    const roomId = await this.getRoomIdFromPeer(peer);
    const response = await this.client.sendText(roomId, body);
    const event = {
      type: 'm.room.message',
      event_id: response.event_id,
      sender: this.client.userId,
      origin_server_ts: Date.now(),
      content: {
        msgtype: 'm.text',
        body
      }
    };
    const message = matrixEventToMessage(roomId, event, this.mapper, this.client.userId);

    return {
      id: message.id,
      date: message.date
    };
  }

  private async ensureSession() {
    if(this.client.userId) {
      return;
    }

    await this.client.whoami();
  }

  private async sync() {
    await this.ensureSession();
    this.lastSync = await this.client.sync(this.nextBatch, 0);
    this.nextBatch = this.lastSync.next_batch;
    this.indexStableIds(this.lastSync);
    this.indexDirectRooms(this.lastSync);
    return this.lastSync;
  }

  private async getSelfUser() {
    await this.ensureSession();
    return matrixSelfUser(this.client.userId, this.mapper, this.avatarToHttp);
  }

  private async hydrateSelfUser() {
    await this.ensureSession();
    const self = await this.getSelfUser();
    const selfUserId = self.id as UserId;
    const selfPeerId = selfUserId.toPeerId(false);

    this.appUsersManager.saveApiUser(self as any, true);

    this.rootScope.dispatchEvent('user_auth', {
      dcID: 1,
      date: Math.floor(Date.now() / 1000),
      id: selfPeerId
    });
    this.rootScope.dispatchEvent('user_update', selfUserId);
    this.rootScope.dispatchEvent('peer_title_edit', {peerId: selfPeerId});
    this.rootScope.dispatchEvent('avatar_update', {peerId: selfPeerId});

    this.rootScope.dispatchEvent('account_logged_in', {
      accountNumber: this.getAccountNumber(),
      userId: selfUserId
    });
  }

  private async getDialogs(params: {limit?: number}) {
    const sync = await this.sync();
    const savedRoomId = await this.findSavedMessagesRoomId().catch((): undefined => undefined);
    const joinedRooms = Object.entries(sync.rooms?.join || {}).sort(([, a], [, b]) => {
      return this.latestRoomTimestamp(b) - this.latestRoomTimestamp(a);
    });
    const limit = params.limit || joinedRooms.length;
    const rooms = joinedRooms.slice(0, limit);
    const chats: any[] = [];
    const dialogs: any[] = [];
    const messages: any[] = [];
    const users: any[] = [];

    for(const [roomId, room] of rooms) {
      const members = await this.getRoomMembers(roomId, room);
      const dialogUserId = roomId === savedRoomId ? this.client.userId : this.getDirectUserForRoom(roomId, room, members);
      const chat = matrixRoomToChat(roomId, room, this.mapper, this.avatarToHttp);
      const latestEvent = [...(room.timeline?.events || [])].reverse().find((event) => event.type === 'm.room.message');
      const message = latestEvent ? matrixEventToMessage(roomId, latestEvent, this.mapper, this.client.userId, dialogUserId) : undefined;
      const roomUsers = await this.getRoomUsers(roomId, room, members);

      if(!dialogUserId) {
        chats.push(chat);
      }
      users.push(...roomUsers);
      if(message) {
        messages.push(message);
      }

      dialogs.push(matrixRoomToDialog(roomId, room, this.mapper, message?.id || 0, dialogUserId));
    }

    return {
      _: 'messages.dialogs',
      dialogs,
      messages,
      chats,
      users,
      count: dialogs.length
    };
  }

  private async getSavedDialogs(params: {limit?: number} = {}) {
    const roomId = await this.findSavedMessagesRoomId().catch((): undefined => undefined);
    const self = await this.getSelfUser();
    if(!roomId) {
      return {
        _: 'messages.savedDialogs',
        dialogs: [],
        messages: [],
        chats: [] as any[],
        users: [self]
      };
    }

    const room = this.getCachedRoom(roomId);
    const roomEvents = [...(room?.timeline?.events || [])];
    const latestEvents = roomEvents.filter((event) => event.type === 'm.room.message').reverse().slice(0, params.limit || 1);
    const messages = latestEvents.map((event) => matrixEventToMessage(roomId, event, this.mapper, this.client.userId, this.client.userId));
    const topMessage = messages[0]?.id || 0;

    return {
      _: 'messages.savedDialogs',
      dialogs: topMessage ? [{
        _: 'savedDialog',
        pFlags: {},
        peer: {
          _: 'peerUser',
          user_id: self.id
        },
        top_message: topMessage
      }] : [],
      messages,
      chats: [] as any[],
      users: [self]
    };
  }

  private async getUsers(params: {id?: any[]} = {}) {
    const ids = params.id || [];
    if(!ids.length) {
      return [await this.getSelfUser()];
    }

    const users = await Promise.all(ids.map((id) => this.getUserFromInputUser(id)));
    return users.filter(Boolean);
  }

  private async getFullUser(params: {id?: any} = {}) {
    const user = await this.getUserFromInputUser(params.id) || await this.getSelfUser();

    return {
      _: 'users.userFull',
      full_user: {
        _: 'userFull',
        pFlags: {},
        id: user.id,
        settings: {
          _: 'peerSettings',
          pFlags: {}
        },
        notify_settings: {
          _: 'peerNotifySettings'
        },
        common_chats_count: 0
      },
      chats: [] as any[],
      users: [user]
    };
  }

  private async resolveUsername(params: {username?: string}) {
    const username = (params.username || '').replace(/^@/, '').toLowerCase();
    const member = await this.findMemberByLocalpart(username);
    if(member) {
      const user = matrixMemberToUser(member, this.mapper, this.client.userId, this.avatarToHttp);

      return {
        _: 'contacts.resolvedPeer',
        peer: {
          _: 'peerUser',
          user_id: user.id
        },
        chats: [] as any[],
        users: [user]
      };
    }

    throw {
      type: 'USERNAME_NOT_FOUND',
      code: 400,
      message: `Matrix user ${params.username} was not found in joined rooms`
    };
  }

  private async getHistory(params: {peer?: any, limit?: number, offset_id?: number}) {
    const roomId = await this.getRoomIdFromPeer(params.peer);
    const savedRoomId = await this.findSavedMessagesRoomId().catch((): undefined => undefined);
    const cachedRoom = this.lastSync?.rooms?.join?.[roomId];
    const timelineEvents = cachedRoom?.timeline?.events?.filter((event) => event.type === 'm.room.message') || [];
    const members = await this.getRoomMembers(roomId, cachedRoom);
    const dialogUserId = roomId === savedRoomId ? this.client.userId : this.getDirectUserForRoom(roomId, cachedRoom, members);
    const users = await this.getRoomUsers(roomId, cachedRoom, members);

    if(timelineEvents.length && !params.offset_id) {
      return {
        _: 'messages.messages',
        messages: timelineEvents.map((event) => matrixEventToMessage(roomId, event, this.mapper, this.client.userId, dialogUserId)).reverse(),
        chats: dialogUserId ? [] : [matrixRoomToChat(roomId, cachedRoom, this.mapper, this.avatarToHttp)],
        users
      };
    }

    const response = await this.client.messages(roomId, undefined, params.limit || 50);
    const result = matrixMessagesToTelegramResult(roomId, response, this.mapper, this.client.userId, dialogUserId) as any;
    result.chats = dialogUserId ? [] : [matrixRoomToChat(roomId, cachedRoom, this.mapper, this.avatarToHttp)];
    result.users = users;

    return result;
  }

  private async getSavedHistory(params: {limit?: number, offset_id?: number}) {
    return this.getHistory({
      peer: {
        _: 'inputPeerSelf'
      },
      limit: params.limit,
      offset_id: params.offset_id
    });
  }

  private async sendMessage(params: {peer?: any, message?: string, random_id?: any}) {
    const roomId = await this.getRoomIdFromPeer(params.peer);
    const targetUserId = this.getMatrixUserIdFromPeer(params.peer);
    const isSavedTarget = this.isSelfPeer(params.peer) || targetUserId === this.client.userId;
    const dialogUserId = isSavedTarget ? this.client.userId : targetUserId;
    this.log.warn('[sendMessage] sending Matrix text', {
      roomId,
      dialogUserId,
      peer: params.peer,
      randomId: params.random_id
    });
    const response = await this.client.sendText(roomId, params.message || '');
    this.log.warn('[sendMessage] Matrix sent text', {
      roomId,
      eventId: response.event_id,
      randomId: params.random_id
    });
    const event = {
      type: 'm.room.message',
      event_id: response.event_id,
      sender: this.client.userId,
      origin_server_ts: Date.now(),
      content: {
        msgtype: 'm.text',
        body: params.message || ''
      }
    };
    const message = matrixEventToMessage(roomId, event, this.mapper, this.client.userId, dialogUserId);

    return {
      _: 'updateShortSentMessage',
      pFlags: {
        out: true
      },
      id: message.id,
      date: message.date,
      pts: 1,
      pts_count: 1,
      entities: [] as any[]
    };
  }

  private getCachedRoom(roomId: string) {
    return this.lastSync?.rooms?.join?.[roomId];
  }

  private async getRoomMembers(roomId: string, room = this.getCachedRoom(roomId)) {
    const cached = this.roomMembers.get(roomId);
    if(cached) {
      return cached;
    }

    const stateMembers = room?.state?.events?.filter((event) => event.type === 'm.room.member') || [];
    try {
      const response = await this.client.roomMembers(roomId);
      const joined = this.normalizeMembers(response.chunk);
      this.indexMemberIds(joined);
      this.roomMembers.set(roomId, joined);
      return joined;
    } catch(error) {
      const joined = this.normalizeMembers(stateMembers);
      this.indexMemberIds(joined);
      this.roomMembers.set(roomId, joined);
      return joined;
    }
  }

  private normalizeMembers(events: MatrixEvent[]) {
    const members = new Map<string, MatrixEvent>();

    for(const event of events) {
      const userId = event.state_key || event.sender;
      if(!userId) {
        continue;
      }

      if(event.content?.membership && !['join', 'invite'].includes(event.content.membership)) {
        continue;
      }

      members.set(userId, event);
    }

    return [...members.values()];
  }

  private indexStableIds(sync: MatrixSyncResponse) {
    for(const [roomId, room] of Object.entries(sync.rooms?.join || {})) {
      this.mapper.register(roomId);

      const events = [
        ...(room.state?.events || []),
        ...(room.timeline?.events || [])
      ];

      for(const event of events) {
        if(event.event_id) {
          this.mapper.register(`event:${roomId}:${event.event_id}`);
        }

        if(event.type === 'm.room.member') {
          const userId = event.state_key || event.sender;
          if(userId) {
            this.mapper.register(userId);
          }
        }
      }
    }
  }

  private indexMemberIds(members: MatrixEvent[]) {
    for(const member of members) {
      const userId = member.state_key || member.sender;
      if(userId) {
        this.mapper.register(userId);
      }
    }
  }

  private async getRoomUsers(roomId: string, room = this.getCachedRoom(roomId), roomMembers?: MatrixEvent[]) {
    const members = roomMembers || await this.getRoomMembers(roomId, room);
    const users = members.map((member) => matrixMemberToUser(member, this.mapper, this.client.userId, this.avatarToHttp));
    const selfId = (await this.getSelfUser()).id;

    if(!users.some((user) => user.id === selfId)) {
      users.push(await this.getSelfUser());
    }

    return users;
  }

  private async getUserFromInputUser(inputUser: any) {
    if(!inputUser || inputUser._ === 'inputUserSelf' || inputUser._ === 'inputPeerSelf') {
      return this.getSelfUser();
    }

    const userId = this.getNativeUserId(inputUser.user_id || inputUser.peer?.user_id);
    if(!userId) {
      return undefined;
    }

    const member = await this.findMemberForUserId(userId);
    if(member) {
      return matrixMemberToUser(member, this.mapper, this.client.userId, this.avatarToHttp);
    }

    return matrixMemberToUser({
      type: 'm.room.member',
      sender: userId,
      state_key: userId,
      content: {
        membership: 'join'
      }
    }, this.mapper, this.client.userId, this.avatarToHttp);
  }

  private indexDirectRooms(sync: MatrixSyncResponse) {
    const direct = sync.account_data?.events?.find((event) => event.type === 'm.direct')?.content || {};
    this.indexDirectRoomContent(direct);
  }

  private indexDirectRoomContent(direct: Record<string, unknown>) {
    for(const [userId, roomIds] of Object.entries(direct)) {
      if(!Array.isArray(roomIds)) {
        continue;
      }

      for(const roomId of roomIds) {
        if(typeof roomId !== 'string') {
          continue;
        }

        this.directUserByRoomId.set(roomId, userId);
        this.directRoomByUserId.set(userId, roomId);
      }
    }
  }

  private getDirectUserForRoom(roomId: string, room: MatrixSyncRoom | undefined, members: MatrixEvent[]) {
    const fromAccountData = this.directUserByRoomId.get(roomId);
    if(fromAccountData) {
      return fromAccountData;
    }

    if(!this.isLikelyUnnamedDirectRoom(room)) {
      return;
    }

    const joinedMembers = members.filter((member) => ['join', 'invite', undefined].includes(member.content?.membership));
    const otherMember = joinedMembers.find((member) => {
      const userId = member.state_key || member.sender;
      return userId && userId !== this.client.userId;
    });

    if(joinedMembers.length <= 2 && otherMember) {
      const userId = otherMember.state_key || otherMember.sender;
      this.directUserByRoomId.set(roomId, userId);
      this.directRoomByUserId.set(userId, roomId);
      return userId;
    }
  }

  private isLikelyUnnamedDirectRoom(room: MatrixSyncRoom | undefined) {
    if(!room) {
      return false;
    }

    const hasExplicitName = room.state?.events?.some((event) => {
      if(event.type === 'm.room.name' && typeof event.content?.name === 'string' && event.content.name.trim()) {
        return true;
      }

      if(event.type === 'm.room.canonical_alias' && typeof event.content?.alias === 'string' && event.content.alias.trim()) {
        return true;
      }

      return false;
    });

    return !hasExplicitName;
  }

  private latestRoomTimestamp(room: MatrixSyncRoom | undefined) {
    const latest = [...(room?.timeline?.events || [])].reverse().find((event) => event.origin_server_ts);
    return latest?.origin_server_ts || 0;
  }

  private async getFullChannel(params: {channel?: any, chat_id?: number}) {
    const roomId = await this.getRoomIdFromPeer(params.channel || params);
    const room = this.getCachedRoom(roomId);

    return {
      _: 'messages.chatFull',
      full_chat: matrixRoomToFullChannel(roomId, room, this.mapper),
      chats: [matrixRoomToChat(roomId, room, this.mapper, this.avatarToHttp)],
      users: await this.getRoomUsers(roomId, room)
    };
  }

  private async getParticipants(params: {channel?: any, offset?: number, limit?: number}) {
    const roomId = await this.getRoomIdFromPeer(params.channel);
    const room = this.getCachedRoom(roomId);
    const members = await this.getRoomMembers(roomId, room);
    const offset = params.offset || 0;
    const limit = params.limit || members.length;
    const page = members.slice(offset, offset + limit);

    return {
      _: 'channels.channelParticipants',
      count: members.length,
      participants: page.map((member) => matrixMemberToParticipant(member, this.mapper)),
      chats: [matrixRoomToChat(roomId, room, this.mapper, this.avatarToHttp)],
      users: page.map((member) => matrixMemberToUser(member, this.mapper, this.client.userId, this.avatarToHttp))
    };
  }

  private async getParticipant(params: {channel?: any, participant?: any}) {
    const roomId = await this.getRoomIdFromPeer(params.channel);
    const members = await this.getRoomMembers(roomId);
    const userId = this.getMatrixUserIdFromPeer(params.participant) || this.client.userId;
    const member = members.find((candidate) => (candidate.state_key || candidate.sender) === userId);

    if(!member) {
      throw new Error(`Matrix user ${userId} is not a participant of ${roomId}`);
    }

    return {
      _: 'channels.channelParticipant',
      participant: matrixMemberToParticipant(member, this.mapper),
      chats: [matrixRoomToChat(roomId, this.getCachedRoom(roomId), this.mapper, this.avatarToHttp)],
      users: [matrixMemberToUser(member, this.mapper, this.client.userId, this.avatarToHttp)]
    };
  }

  private async getRoomIdFromPeer(peer: any) {
    await this.ensureSession();

    if(this.isSelfPeer(peer)) {
      return this.findSavedMessagesRoomId();
    }

    const userId = this.getNativeUserId(peer?.user_id || peer?.peer?.user_id);
    if(userId && userId === this.client.userId) {
      return this.findSavedMessagesRoomId();
    }

    const directRoomId = userId ? await this.findDirectRoomForUserId(userId) : undefined;
    if(directRoomId) {
      return directRoomId;
    }

    const chatId = peer?.chat_id || peer?.channel_id || peer?.channel?.channel_id || peer?.peer?.chat_id || peer?.peer?.channel_id;
    const roomId = chatId ? this.getNativeRoomId(chatId) : undefined;

    if(!roomId) {
      throw new Error(`Cannot map Telegram peer ${JSON.stringify(peer)} to Matrix room id`);
    }

    return roomId;
  }

  private isSelfPeer(peer: any) {
    return !!peer && (peer._ === 'inputPeerSelf' || peer._ === 'inputUserSelf');
  }

  private async findSavedMessagesRoomId() {
    await this.ensureSession();

    if(MATRIX_SAVED_ROOM_ID) {
      this.savedRoomId = MATRIX_SAVED_ROOM_ID;
      this.mapper.register(MATRIX_SAVED_ROOM_ID);
      return MATRIX_SAVED_ROOM_ID;
    }

    if(!this.lastSync) {
      await this.sync();
    }

    const directSelfRoomId = await this.findDirectRoomForUserId(this.client.userId);
    if(directSelfRoomId) {
      this.savedRoomId = directSelfRoomId;
      this.mapper.register(directSelfRoomId);
      return directSelfRoomId;
    }

    if(this.savedRoomId && this.lastSync?.rooms?.join?.[this.savedRoomId]) {
      return this.savedRoomId;
    }

    const candidates: Array<{roomId: string, room: MatrixSyncRoom, score: number}> = [];
    for(const [roomId, room] of Object.entries(this.lastSync?.rooms?.join || {})) {
      const members = await this.getRoomMembers(roomId, room);
      const joinedMembers = members.filter((member) => ['join', 'invite', undefined].includes(member.content?.membership));
      const memberIds = joinedMembers.map((member) => member.state_key || member.sender).filter(Boolean);
      const isSelfOnlyRoom = memberIds.length > 0 && memberIds.every((userId) => userId === this.client.userId);
      const title = matrixRoomTitle(roomId, room).trim();
      const isSavedTitle = SAVED_ROOM_TITLE_RE.test(title);

      if(!isSavedTitle && !isSelfOnlyRoom) {
        continue;
      }

      candidates.push({
        roomId,
        room,
        score: (isSavedTitle ? 4 : 0) + (isSelfOnlyRoom ? 2 : 0)
      });
    }

    candidates.sort((a, b) => {
      const scoreDelta = b.score - a.score;
      return scoreDelta || this.latestRoomTimestamp(b.room) - this.latestRoomTimestamp(a.room);
    });

    const match = candidates[0];
    if(match) {
      this.savedRoomId = match.roomId;
      this.mapper.register(match.roomId);
      return match.roomId;
    }

    const created = await this.client.createRoom({
      visibility: 'private',
      preset: 'private_chat',
      name: 'Saved Messages',
      topic: 'Personal saved messages for tweb Matrix compatibility'
    });
    this.savedRoomId = created.room_id;
    this.mapper.register(created.room_id);
    await this.sync().catch((): undefined => undefined);
    return created.room_id;
  }

  private getNativeUserId(userId: any) {
    if(userId === undefined || userId === null) {
      return undefined;
    }

    const value = String(userId);
    if(value.startsWith('u')) {
      return value.slice(1);
    }

    return this.mapper.toString(Number(value)) || value;
  }

  private getNativeRoomId(roomId: any) {
    if(roomId === undefined || roomId === null) {
      return undefined;
    }

    const value = String(roomId);
    if(value.startsWith('c')) {
      return value.slice(1);
    }

    return this.mapper.toString(Math.abs(Number(value))) || value.replace(/^-/, '');
  }

  private async findDirectRoomForUserId(userId: string) {
    const cached = this.directRoomByUserId.get(userId);
    if(cached) {
      return cached;
    }

    const direct = await this.client.accountData<Record<string, unknown>>('m.direct').catch((): undefined => undefined);
    if(direct) {
      this.indexDirectRoomContent(direct);
      const roomId = this.directRoomByUserId.get(userId);
      if(roomId) {
        return roomId;
      }
    }

    if(!this.lastSync) {
      await this.sync();
    }

    for(const [roomId, room] of Object.entries(this.lastSync?.rooms?.join || {})) {
      const members = await this.getRoomMembers(roomId, room);
      const directUserId = this.getDirectUserForRoom(roomId, room, members);
      if(directUserId === userId) {
        return roomId;
      }
    }
  }

  private async findMemberForUserId(userId: string) {
    if(!this.lastSync) {
      await this.sync();
    }

    for(const [roomId, room] of Object.entries(this.lastSync?.rooms?.join || {})) {
      const members = await this.getRoomMembers(roomId, room);
      const member = members.find((candidate) => {
        const candidateUserId = candidate.state_key || candidate.sender;
        return candidateUserId === userId;
      });

      if(member) {
        return member;
      }
    }
  }

  private async findMemberByLocalpart(localpart: string) {
    if(!this.lastSync) {
      await this.sync();
    }

    for(const [roomId, room] of Object.entries(this.lastSync?.rooms?.join || {})) {
      const members = await this.getRoomMembers(roomId, room);
      const member = members.find((candidate) => {
        const userId = candidate.state_key || candidate.sender || '';
        const candidateLocalpart = userId.match(/^@([^:]+):/)?.[1] || userId;
        return candidateLocalpart.toLowerCase() === localpart;
      });

      if(member) {
        return member;
      }
    }
  }

  private getMatrixUserIdFromPeer(peer: any) {
    if(peer?._ === 'inputPeerSelf' || peer?._ === 'inputUserSelf') {
      return this.client.userId;
    }

    return this.getNativeUserId(peer?.user_id || peer?.peer?.user_id);
  }

  private getMatrixConfig() {
    return {
      _: 'config',
      pFlags: {},
      date: Math.floor(Date.now() / 1000),
      expires: Math.floor(Date.now() / 1000) + 3600,
      test_mode: false,
      this_dc: 1,
      dc_options: [] as any[],
      dc_txt_domain_name: '',
      chat_size_max: 200,
      megagroup_size_max: 10000,
      forwarded_count_max: 100,
      online_update_period_ms: 120000,
      offline_blur_timeout_ms: 5000,
      offline_idle_timeout_ms: 30000,
      online_cloud_timeout_ms: 300000,
      notify_cloud_delay_ms: 30000,
      notify_default_delay_ms: 1500,
      push_chat_period_ms: 60000,
      push_chat_limit: 2,
      edit_time_limit: 172800,
      revoke_time_limit: 172800,
      revoke_pm_time_limit: 172800,
      rating_e_decay: 2419200,
      stickers_recent_limit: 50,
      channels_read_media_period: 604800,
      call_receive_timeout_ms: 20000,
      call_ring_timeout_ms: 90000,
      call_connect_timeout_ms: 30000,
      call_packet_timeout_ms: 10000,
      me_url_prefix: 'https://matrix.to/#/',
      autoupdate_url_prefix: '',
      gif_search_username: '',
      venue_search_username: '',
      img_search_username: '',
      static_maps_provider: '',
      caption_length_max: 4096,
      message_length_max: 4096,
      webfile_dc_id: 1,
      suggested_lang_code: 'en',
      lang_pack_version: 0,
      base_lang_pack_version: 0,
      reactions_default: [] as any[],
      autologin_token: ''
    };
  }
}
