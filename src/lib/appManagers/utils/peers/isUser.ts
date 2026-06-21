export default function isUser(peerId: PeerId) {
  const value = peerId as unknown;
  if(typeof value === 'string') {
    return value.startsWith('u') || (!value.startsWith('c') && +value >= 0);
  }

  return +peerId >= 0;
}
