import isAnyChat from '@appManagers/utils/peers/isAnyChat';
import isUser from '@appManagers/utils/peers/isUser';

const maybeNumber = (value: string): string | number => /^-?\d+$/.test(value) ? +value : value;
const stripPeerPrefix = (value: string) => /^[uc]/.test(value) ? value.slice(1) : value;

String.prototype.toUserId = function() {
  const value = stripPeerPrefix(this.toString());
  return maybeNumber(value) as UserId;
};

String.prototype.toChatId = function() {
  const value = stripPeerPrefix(this.toString()).replace(/^-/, '');
  return maybeNumber(value) as ChatId;
};

String.prototype.toPeerId = function(isChat?: boolean) {
  const value = this.toString();
  if(/^[uc].+/.test(value)) {
    return value as unknown as PeerId;
  }

  if(isChat === undefined) {
    return (value.startsWith('-') ? `c${value.slice(1)}` : `u${value}`) as unknown as PeerId;
  }

  return (isChat ? `c${value.replace(/^-/, '')}` : `u${value}`) as unknown as PeerId;
};

String.prototype.isPeerId = function(): this is string {
  return /^[uc].+/.test(this.toString()) || /^-?\d+$/.test(this.toString());
};

// * don't return just 'this', because Firefox returns empty `Number` class
Number.prototype.toUserId = function() {
  return +this;
};

Number.prototype.toChatId = function() {
  return Math.abs(this as any);
};

// * don't return just 'this', because Firefox returns empty `Number` class
Number.prototype.toPeerId = function(isChat?: boolean) {
  if(isChat === undefined) {
    return (+this).toString().toPeerId(+this < 0);
  }

  return (isChat ? `c${Math.abs(this as number)}` : `u${+this}`) as unknown as PeerId;
};

Number.prototype.isPeerId = function(): this is number {
  return true;
};

[
  ['isUser' as const, isUser],
  ['isAnyChat' as const, isAnyChat]
].forEach((value) => {
  const newMethod = Array.isArray(value) ? value[0] : value;
  const originMethod = Array.isArray(value) ? value[1] : value;
  // @ts-ignore
  String.prototype[newMethod] = function() {
    // @ts-ignore
    // eslint-disable-next-line no-useless-call
    return originMethod.call(null, this.toString());
  };

  // @ts-ignore
  Number.prototype[newMethod] = function() {
    // * don't use just 'this', because Firefox returns empty `Number` class
    // @ts-ignore
    // eslint-disable-next-line no-useless-call
    return originMethod.call(null, +this);
  };
});

declare global {
  interface String {
    toUserId(): UserId;
    toChatId(): ChatId;
    toPeerId(isChat?: boolean): PeerId;
    isPeerId(): this is string;

    isUser(): boolean;
    isAnyChat(): boolean;
  }

  interface Number {
    toUserId(): UserId;
    toChatId(): ChatId;
    toPeerId(isChat?: boolean): PeerId;
    isPeerId(): this is PeerId;

    isUser(): boolean;
    isAnyChat(): boolean;
  }
}

export {};
