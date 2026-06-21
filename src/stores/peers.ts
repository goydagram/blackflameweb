import {createStore, reconcile} from 'solid-js/store';
import {Chat, User} from '@layer';
import createMemoOrReturn, {ValueOrGetter} from '@helpers/solid/createMemoOrReturn';

type NotEmptyPeer = Exclude<Chat, Chat.chatEmpty> | User.user;

const [state, setState] = createStore<{[peerId: PeerId]: NotEmptyPeer}>({});

const getPeerFromState = (peerId: PeerId) => {
  const peer = state[peerId];
  if(peer) {
    return peer;
  }

  const value = peerId as unknown;
  if(typeof value === 'string') {
    if(value.startsWith('u')) {
      return state[value.slice(1) as unknown as PeerId];
    }

    if(value.startsWith('c')) {
      return state[value.slice(1) as unknown as PeerId];
    }
  }
};

export function usePeer<T extends ValueOrGetter<PeerId>>(peerId: T) {
  return createMemoOrReturn(peerId, getPeerFromState);
}

export function useChat<T extends ValueOrGetter<ChatId>>(chatId: T) {
  return createMemoOrReturn<T, Chat>(chatId, (chatId) => getPeerFromState(chatId?.toPeerId(true)) as Chat);
}

export function useUser<T extends ValueOrGetter<UserId>>(userId: T) {
  return createMemoOrReturn<T, User>(userId, (userId) => getPeerFromState(userId?.toPeerId(false)) as User);
}

export function reconcilePeer(peerId: PeerId, peer: NotEmptyPeer) {
  setState(peerId, reconcile(peer));
}

export function reconcilePeers(peers: {[peerId: PeerId]: NotEmptyPeer}) {
  setState(/* reconcile */(peers));
}
