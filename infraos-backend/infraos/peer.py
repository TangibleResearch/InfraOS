from .models import PeerInfo


def list_peers() -> list[PeerInfo]:
    return [PeerInfo(peer_id="local", address="127.0.0.1", status="self")]


def discover_peers() -> list[PeerInfo]:
    return [
        PeerInfo(
            peer_id="discovery-stub",
            address="not-enabled",
            status="P2P discovery is stubbed in v0.1",
        )
    ]
