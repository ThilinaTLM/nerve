import type { PeerDescriptor } from "@nervekit/contracts/wire";

export function samePeer(left: PeerDescriptor, right: PeerDescriptor): boolean {
  return left.role === right.role && left.id === right.id;
}

export function matchesAddressedPeer(
  addressed: PeerDescriptor,
  actual: PeerDescriptor,
): boolean {
  return (
    addressed.role === actual.role &&
    (!addressed.id || addressed.id === actual.id)
  );
}

export function matchesNegotiatedPeerBinding(
  source: PeerDescriptor,
  target: PeerDescriptor,
  expectedSource: PeerDescriptor,
  acceptingPeer: PeerDescriptor,
  negotiatedTarget: PeerDescriptor,
): boolean {
  return (
    samePeer(source, expectedSource) &&
    samePeer(target, acceptingPeer) &&
    matchesAddressedPeer(negotiatedTarget, target)
  );
}
