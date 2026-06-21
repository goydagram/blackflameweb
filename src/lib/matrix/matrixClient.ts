export type MatrixLoginResponse = {
  access_token: string,
  device_id: string,
  user_id: string,
  well_known?: {
    'm.homeserver'?: {
      base_url: string
    }
  }
};

export type MatrixEvent = {
  type: string,
  event_id?: string,
  sender?: string,
  origin_server_ts?: number,
  content?: Record<string, any>,
  state_key?: string
};

export type MatrixSyncRoom = {
  name?: string,
  summary?: {
    'm.joined_member_count'?: number,
    'm.invited_member_count'?: number
  },
  state?: {
    events?: MatrixEvent[]
  },
  timeline?: {
    events?: MatrixEvent[],
    prev_batch?: string,
    limited?: boolean
  },
  unread_notifications?: {
    notification_count?: number,
    highlight_count?: number
  }
};

export type MatrixSyncResponse = {
  next_batch: string,
  account_data?: {
    events?: MatrixEvent[]
  },
  rooms?: {
    join?: Record<string, MatrixSyncRoom>
  }
};

export type MatrixMessagesResponse = {
  chunk: MatrixEvent[],
  start?: string,
  end?: string
};

export type MatrixMembersResponse = {
  chunk: MatrixEvent[]
};

export type MatrixCreateRoomResponse = {
  room_id: string
};

type MatrixClientOptions = {
  homeserverUrl: string,
  accessToken?: string,
  userId?: string
};

const REQUEST_TIMEOUT_MS = 15000;

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const env = import.meta.env as Record<string, string | undefined>;

export class MatrixClient {
  public homeserverUrl: string;
  public accessToken?: string;
  public userId?: string;

  constructor(options: MatrixClientOptions) {
    this.homeserverUrl = trimTrailingSlash(options.homeserverUrl);
    this.accessToken = options.accessToken;
    this.userId = options.userId;
  }

  public static fromEnv() {
    return new MatrixClient({
      homeserverUrl: env.VITE_MATRIX_HOMESERVER || 'https://rix.takasaki.moe',
      accessToken: env.VITE_MATRIX_ACCESS_TOKEN,
      userId: env.VITE_MATRIX_USER_ID
    });
  }

  public async login(username: string, password: string) {
    const response = await this.request<MatrixLoginResponse>('POST', '/_matrix/client/v3/login', {
      type: 'm.login.password',
      identifier: {
        type: 'm.id.user',
        user: username
      },
      password
    }, false);

    this.accessToken = response.access_token;
    this.userId = response.user_id;

    return response;
  }

  public async whoami() {
    const response = await this.request<{user_id: string}>('GET', '/_matrix/client/v3/account/whoami');
    this.userId = response.user_id;
    return response;
  }

  public sync(since?: string, timeout = 0) {
    const params = new URLSearchParams({
      timeout: String(timeout)
    });

    if(since) {
      params.set('since', since);
    }

    return this.request<MatrixSyncResponse>('GET', `/_matrix/client/v3/sync?${params}`);
  }

  public messages(roomId: string, from?: string, limit = 50) {
    const params = new URLSearchParams({
      dir: 'b',
      limit: String(limit)
    });

    if(from) {
      params.set('from', from);
    }

    return this.request<MatrixMessagesResponse>(
      'GET',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/messages?${params}`
    );
  }

  public roomMembers(roomId: string) {
    return this.request<MatrixMembersResponse>(
      'GET',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/members`
    );
  }

  public accountData<T = Record<string, unknown>>(type: string) {
    return this.request<T>(
      'GET',
      `/_matrix/client/v3/user/${encodeURIComponent(this.userId)}/account_data/${encodeURIComponent(type)}`
    );
  }

  public sendText(roomId: string, body: string) {
    const txnId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return this.request<{event_id: string}>(
      'PUT',
      `/_matrix/client/v3/rooms/${encodeURIComponent(roomId)}/send/m.room.message/${txnId}`,
      {
        msgtype: 'm.text',
        body
      }
    );
  }

  public createRoom(body: Record<string, unknown>) {
    return this.request<MatrixCreateRoomResponse>(
      'POST',
      '/_matrix/client/v3/createRoom',
      body
    );
  }

  public mxcToHttp(mxc?: string, thumbnail?: {width: number, height: number, method?: 'crop' | 'scale'}) {
    if(!mxc?.startsWith('mxc://')) {
      return mxc;
    }

    const [serverName, mediaId] = mxc.slice('mxc://'.length).split('/', 2);
    const endpoint = thumbnail ? 'thumbnail' : 'download';
    const params = thumbnail ? `?width=${thumbnail.width}&height=${thumbnail.height}&method=${thumbnail.method || 'crop'}` : '';

    return `${this.homeserverUrl}/_matrix/media/v3/${endpoint}/${encodeURIComponent(serverName)}/${encodeURIComponent(mediaId)}${params}`;
  }

  private async request<T>(method: string, path: string, body?: unknown, requireAuth = true): Promise<T> {
    if(requireAuth && !this.accessToken) {
      throw new Error('Matrix access token is not configured. Set VITE_MATRIX_ACCESS_TOKEN for the compatibility backend.');
    }

    const headers: Record<string, string> = {
      accept: 'application/json'
    };

    if(body !== undefined) {
      headers['content-type'] = 'application/json';
    }

    if(this.accessToken) {
      headers.authorization = `Bearer ${this.accessToken}`;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    let response: Response;

    try {
      response = await fetch(`${this.homeserverUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal
      });
    } catch(error) {
      if((error as Error)?.name === 'AbortError') {
        throw new Error(`Matrix ${method} ${path} timed out after ${REQUEST_TIMEOUT_MS}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }

    if(!response.ok) {
      const text = await response.text();
      throw new Error(`Matrix ${method} ${path} failed with ${response.status}: ${text}`);
    }

    return response.json();
  }
}
