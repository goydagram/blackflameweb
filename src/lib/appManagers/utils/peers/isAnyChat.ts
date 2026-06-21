export default function isAnyChat(peerId: PeerId) {
  const value = peerId as unknown;
  if(typeof value === 'string') {
    return value.startsWith('c') || +value < 0;
  }

  return +peerId < 0;
}
