// Gemeinsame Fixtures des Freunde-Vertrags (docs/friends/SPEC.md, 8.3): `tsc` prüft sie gegen `friends-types.ts`, der Rust-Test
// `contract_tests.rs` liest dieselbe Datei und parst den Block zwischen den Markern als JSON. Darum zwischen den Markern
// nur striktes JSON (Schlüssel in Anführungszeichen, keine Kommentare, keine Kommas am Ende).
import type { FriendsFixtureTypes } from "./friends-types";

export const FRIENDS_FIXTURES = /*JSON-BEGIN*/{
  "constants": {
    "codePrefix": "pumpkin-",
    "codeBodyLength": 72,
    "codeLength": 80,
    "displayNameMin": 3,
    "displayNameMax": 32,
    "aliasMax": 32,
    "maxFriends": 50,
    "maxActiveCodes": 3,
    "maxGuests": 7,
    "codeTtlSecs": 604800,
    "requestTtlSecs": 1209600,
    "inviteTtlSecs": 7200,
    "minMcReleaseTime": "2023-06-02T08:36:17+00:00",
    "minMcLabel": "1.20",
    "portMin": 1024,
    "portMax": 65535,
    "maxNameRequests": 5,
    "mcNameMax": 16,
    "nameCooldownDays": 7
  },
  "friendsState.available": {
    "availability": "available",
    "enabled": true,
    "me": {
      "peerId": "7b3e91c4a0d85f26e1c9b4a7d3f08e52c6a1b9d4e7f30a85c2d6e1b9a4f7038c",
      "fingerprint": "7b3e 91c4 a0d8 5f26",
      "displayName": "Jonas"
    },
    "settings": {
      "displayName": "Jonas",
      "alwaysRelay": false,
      "findableByName": true,
      "ingameMenu": true,
      "ingameActions": "ask"
    },
    "network": {
      "type": "online",
      "relayHost": "relay-eu1.pumpkin.example"
    },
    "relays": [
      {
        "host": "relay-eu1.pumpkin.example",
        "operator": "pumpkin",
        "thirdParty": false
      }
    ],
    "thirdPartyRelaysAccepted": false,
    "directory": {
      "state": "active",
      "host": "directory.example"
    }
  },
  "friendsState.noSecretStore": {
    "availability": "noSecretStore",
    "enabled": false,
    "me": null,
    "settings": {
      "displayName": "Jonas",
      "alwaysRelay": false,
      "findableByName": false,
      "ingameMenu": false,
      "ingameActions": "allow"
    },
    "network": {
      "type": "off"
    },
    "relays": [],
    "thirdPartyRelaysAccepted": false,
    "directory": {
      "state": "off",
      "host": "directory.example"
    }
  },
  "friendsState.identityLost": {
    "availability": "identityLost",
    "enabled": true,
    "me": null,
    "settings": {
      "displayName": "Jonas",
      "alwaysRelay": false,
      "findableByName": false,
      "ingameMenu": true,
      "ingameActions": "ask"
    },
    "network": {
      "type": "off"
    },
    "relays": [
      {
        "host": "relay-eu1.pumpkin.example",
        "operator": "pumpkin",
        "thirdParty": false
      }
    ],
    "thirdPartyRelaysAccepted": false,
    "directory": {
      "state": "unavailable",
      "host": null
    }
  },
  "networkStatus.off": {
    "type": "off"
  },
  "networkStatus.starting": {
    "type": "starting"
  },
  "networkStatus.online": {
    "type": "online",
    "relayHost": "relay-eu1.pumpkin.example"
  },
  "networkStatus.degraded": {
    "type": "degraded",
    "reason": "relayUnreachable"
  },
  "friend.online": {
    "id": "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7",
    "displayName": "Alex",
    "alias": null,
    "mcName": "Alex",
    "mcUuid": "069a79f444e94726a5befca90e38aaf5",
    "fingerprint": "3f9a c021 77de 01b4",
    "addedAt": 1789136000,
    "lastSeen": 1789996400,
    "confirmed": true,
    "removedByPeer": false,
    "notice": null,
    "presence": "online",
    "path": "direct"
  },
  "friend.relayRenamed": {
    "id": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
    "displayName": "Bea",
    "alias": "Bea vom Bau",
    "mcName": "Bea_Builds",
    "mcUuid": "853c80ef3c3749fdaa49938b674adae6",
    "fingerprint": "a1b2 c3d4 e5f6 0718",
    "addedAt": 1789136000,
    "lastSeen": 1789996400,
    "confirmed": true,
    "removedByPeer": false,
    "notice": {
      "type": "renamed",
      "previousName": "Beatrix"
    },
    "presence": "online",
    "path": "relay"
  },
  "friend.identityChanged": {
    "id": "c4a5e6f7081920314253647586970a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1",
    "displayName": "Chris",
    "alias": null,
    "mcName": null,
    "mcUuid": null,
    "fingerprint": "c4a5 e6f7 0819 2031",
    "addedAt": 1789136000,
    "lastSeen": 1789996400,
    "confirmed": true,
    "removedByPeer": false,
    "notice": {
      "type": "identityChanged",
      "previousFingerprint": "9e8d 7c6b 5a49 3827"
    },
    "presence": "offline",
    "path": null
  },
  "friend.unconfirmed": {
    "id": "d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef",
    "displayName": "Dana",
    "alias": null,
    "mcName": null,
    "mcUuid": null,
    "fingerprint": "d0d1 d2d3 d4d5 d6d7",
    "addedAt": 1789136000,
    "lastSeen": null,
    "confirmed": false,
    "removedByPeer": false,
    "notice": null,
    "presence": "offline",
    "path": null
  },
  "request.incoming": {
    "id": "req-in-1",
    "direction": "incoming",
    "state": "pending",
    "peerId": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
    "fingerprint": "a1b2 c3d4 e5f6 0718",
    "displayName": "Bea",
    "mcName": "Bea_Builds",
    "codeTail": null,
    "createdAt": 1789999400,
    "expiresAt": 1791209000,
    "via": "code"
  },
  "request.delivering": {
    "id": "req-out-1",
    "direction": "outgoing",
    "state": "delivering",
    "peerId": null,
    "fingerprint": null,
    "displayName": null,
    "mcName": null,
    "codeTail": "rvw3",
    "createdAt": 1789999400,
    "expiresAt": 1791209000,
    "via": "code"
  },
  "request.awaitingAnswer": {
    "id": "req-out-2",
    "direction": "outgoing",
    "state": "awaitingAnswer",
    "peerId": "e5a1b2c3d4f5061728394a5b6c7d8e9fa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
    "fingerprint": "e5a1 b2c3 d4f5 0617",
    "displayName": "Eli",
    "mcName": "EliPlays",
    "codeTail": "q7mx",
    "createdAt": 1789999400,
    "expiresAt": 1791209000,
    "via": "code"
  },
  "request.nameIncoming": {
    "id": "req-name-in-1",
    "direction": "incoming",
    "state": "pending",
    "peerId": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
    "fingerprint": "a1b2 c3d4 e5f6 0718",
    "displayName": "Bea",
    "mcName": "Bea_Builds",
    "codeTail": null,
    "createdAt": 1789999400,
    "expiresAt": 1791209000,
    "via": "name"
  },
  "request.nameOutgoing": {
    "id": "req-name-out-1",
    "direction": "outgoing",
    "state": "awaitingAnswer",
    "peerId": null,
    "fingerprint": null,
    "displayName": null,
    "mcName": "Steve",
    "codeTail": null,
    "createdAt": 1789999400,
    "expiresAt": 1791209000,
    "via": "name"
  },
  "request.nameDelivering": {
    "id": "req-name-out-2",
    "direction": "outgoing",
    "state": "delivering",
    "peerId": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
    "fingerprint": "a1b2 c3d4 e5f6 0718",
    "displayName": "Bea",
    "mcName": "Bea_Builds",
    "codeTail": null,
    "createdAt": 1789999400,
    "expiresAt": 1791209000,
    "via": "name"
  },
  "code.created": {
    "id": "code-1",
    "code": "pumpkin-aiaaaaicamcakbqhbaequcymbuha6earcijrifiwc4mbsgq3dqor4h5augrkhjffu2t2rvw3",
    "tail": "rvw3",
    "createdAt": 1790000000,
    "expiresAt": 1790604800,
    "used": false
  },
  "code.listed": {
    "id": "code-1",
    "code": null,
    "tail": "rvw3",
    "createdAt": 1790000000,
    "expiresAt": 1790604800,
    "used": false
  },
  "blocked": {
    "peerId": "e5a1b2c3d4f5061728394a5b6c7d8e9fa0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5",
    "displayName": "Eli",
    "blockedAt": 1789913600
  },
  "hostSession": {
    "id": "c2f4a8b1-93d7-4e65-8b0a-71e5d9c3f482",
    "instanceId": "inst-fabric",
    "port": 51234,
    "portSource": "mod",
    "pid": 18244,
    "worldName": "Inselwelt",
    "showWorldName": true,
    "startedAt": 1789998200,
    "guests": [
      {
        "friendId": "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7",
        "displayName": "Alex",
        "state": "connected",
        "kicked": false,
        "path": "direct",
        "rttMs": 38
      },
      {
        "friendId": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
        "displayName": "Bea",
        "state": "invited",
        "kicked": false,
        "path": null,
        "rttMs": null
      },
      {
        "friendId": "c4a5e6f7081920314253647586970a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1",
        "displayName": "Chris",
        "state": "declined",
        "kicked": false,
        "path": null,
        "rttMs": null
      },
      {
        "friendId": "d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef",
        "displayName": "Dana",
        "state": "left",
        "kicked": true,
        "path": null,
        "rttMs": null
      }
    ]
  },
  "invite": {
    "id": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "sessionId": "c2f4a8b1-93d7-4e65-8b0a-71e5d9c3f482",
    "from": "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7",
    "fromName": "Alex",
    "fromFingerprint": "3f9a c021 77de 01b4",
    "title": "Inselwelt",
    "instance": {
      "name": "Fabric 26.3",
      "minecraftVersion": "26.3",
      "loader": "fabric",
      "loaderVersion": "0.19.5",
      "modCount": 42
    },
    "receivedAt": 1789999880,
    "expiresAt": 1790007080,
    "hostOnline": true
  },
  "joinPlan.ready": {
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "summary": {
      "name": "Fabric 26.3",
      "minecraftVersion": "26.3",
      "loader": "fabric",
      "loaderVersion": "0.19.5",
      "modCount": 42
    },
    "verdict": "ready",
    "candidates": [
      {
        "instanceId": "inst-fabric",
        "name": "Fabric 26.3",
        "matches": true,
        "missing": [],
        "extra": []
      }
    ],
    "createVanilla": false,
    "lookupFailed": false
  },
  "joinPlan.missing": {
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "summary": {
      "name": "Fabric 26.3",
      "minecraftVersion": "26.3",
      "loader": "fabric",
      "loaderVersion": "0.19.5",
      "modCount": 42
    },
    "verdict": "missingContent",
    "candidates": [
      {
        "instanceId": "inst-fabric",
        "name": "Fabric 26.3",
        "matches": false,
        "missing": [
          {
            "title": "Sodium",
            "fileName": "sodium-fabric-0.7.0+mc26.3.jar",
            "projectId": "AANobbMI"
          }
        ],
        "extra": [
          {
            "title": "mymod-1.0.jar",
            "fileName": "mymod-1.0.jar",
            "projectId": null
          }
        ]
      }
    ],
    "createVanilla": false,
    "lookupFailed": true
  },
  "joinPlan.vanilla": {
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "summary": {
      "name": "Vanilla 26.3",
      "minecraftVersion": "26.3",
      "loader": "vanilla",
      "loaderVersion": null,
      "modCount": 0
    },
    "verdict": "noInstance",
    "candidates": [],
    "createVanilla": true,
    "lookupFailed": false
  },
  "joinTicket": {
    "joinId": "a7e90b24-5c3d-4f81-b6a2-d4e8130f9c57",
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "instanceId": "inst-fabric",
    "address": "127.38.201.14:51234"
  },
  "lanStatus": {
    "port": 51234,
    "source": "mod",
    "pid": 18244
  },
  "ingameStatus.active": {
    "state": "active",
    "reason": null,
    "node": {
      "id": "1.21.1-fabric",
      "minecraft": "1.21.1",
      "loader": "fabric"
    }
  },
  "ingameStatus.connected": {
    "state": "connected",
    "reason": null,
    "node": {
      "id": "26.3-fabric",
      "minecraft": "26.3",
      "loader": "fabric"
    }
  },
  "ingameStatus.off": {
    "state": "off",
    "reason": {
      "type": "instanceOff"
    },
    "node": {
      "id": "1.21.1-neoforge",
      "minecraft": "1.21.1",
      "loader": "neoforge"
    }
  },
  "ingameStatus.autoOff": {
    "state": "autoOff",
    "reason": {
      "type": "breaker",
      "reason": "mixinApplyFailed"
    },
    "node": {
      "id": "1.20.1-forge",
      "minecraft": "1.20.1",
      "loader": "forge"
    }
  },
  "ingameStatus.unavailable": {
    "state": "unavailable",
    "reason": {
      "type": "javaTooOld",
      "need": 21
    },
    "node": null
  },
  "ingameStatus.loaderTooOld": {
    "state": "unavailable",
    "reason": {
      "type": "loaderTooOld",
      "need": "0.16.0"
    },
    "node": null
  },
  "event.ingame": {
    "instanceId": "inst-fabric",
    "status": {
      "state": "active",
      "reason": null,
      "node": {
        "id": "1.21.1-fabric",
        "minecraft": "1.21.1",
        "loader": "fabric"
      }
    }
  },
  "event.ingameFailed": {
    "instanceId": "inst-fabric",
    "reason": "fabricIncompatibleModSet"
  },
  "event.friendPresence": {
    "friendId": "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7",
    "presence": "playing",
    "path": "direct"
  },
  "event.friendRequest": {
    "request": {
      "id": "req-in-1",
      "direction": "incoming",
      "state": "pending",
      "peerId": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
      "fingerprint": "a1b2 c3d4 e5f6 0718",
      "displayName": "Bea",
      "mcName": "Bea_Builds",
      "codeTail": null,
      "createdAt": 1789999400,
      "expiresAt": 1791209000,
      "via": "code"
    }
  },
  "event.requestRefused": {
    "request": {
      "id": "req-out-1",
      "direction": "outgoing",
      "state": "delivering",
      "peerId": null,
      "fingerprint": null,
      "displayName": null,
      "mcName": null,
      "codeTail": "k7qm",
      "createdAt": 1789999400,
      "expiresAt": 1791209000,
      "via": "code"
    },
    "reason": "codeUsed"
  },
  "event.invite": {
    "invite": {
      "id": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
      "sessionId": "c2f4a8b1-93d7-4e65-8b0a-71e5d9c3f482",
      "from": "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7",
      "fromName": "Alex",
      "fromFingerprint": "3f9a c021 77de 01b4",
      "title": "Inselwelt",
      "instance": {
        "name": "Fabric 26.3",
        "minecraftVersion": "26.3",
        "loader": "fabric",
        "loaderVersion": "0.19.5",
        "modCount": 42
      },
      "receivedAt": 1789999880,
      "expiresAt": 1790007080,
      "hostOnline": true
    }
  },
  "event.inviteRevoked": {
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "reason": "stopped"
  },
  "event.hostSession": {
    "session": {
      "id": "c2f4a8b1-93d7-4e65-8b0a-71e5d9c3f482",
      "instanceId": "inst-fabric",
      "port": 51234,
      "portSource": "mod",
      "pid": 18244,
      "worldName": "Inselwelt",
      "showWorldName": true,
      "startedAt": 1789998200,
      "guests": [
        {
          "friendId": "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7",
          "displayName": "Alex",
          "state": "connected",
          "kicked": false,
          "path": "direct",
          "rttMs": 38
        },
        {
          "friendId": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
          "displayName": "Bea",
          "state": "invited",
          "kicked": false,
          "path": null,
          "rttMs": null
        },
        {
          "friendId": "c4a5e6f7081920314253647586970a1b2c3d4e5f60718293a4b5c6d7e8f9a0b1",
          "displayName": "Chris",
          "state": "declined",
          "kicked": false,
          "path": null,
          "rttMs": null
        },
        {
          "friendId": "d0d1d2d3d4d5d6d7d8d9dadbdcdddedfe0e1e2e3e4e5e6e7e8e9eaebecedeeef",
          "displayName": "Dana",
          "state": "left",
          "kicked": true,
          "path": null,
          "rttMs": null
        }
      ]
    }
  },
  "event.hostSessionEnded": {
    "sessionId": "c2f4a8b1-93d7-4e65-8b0a-71e5d9c3f482",
    "reason": "lanClosed"
  },
  "event.joinSession.waitingForGame": {
    "joinId": "a7e90b24-5c3d-4f81-b6a2-d4e8130f9c57",
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "instanceId": "inst-fabric",
    "state": {
      "type": "waitingForGame"
    }
  },
  "event.joinSession.connecting": {
    "joinId": "a7e90b24-5c3d-4f81-b6a2-d4e8130f9c57",
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "instanceId": "inst-fabric",
    "state": {
      "type": "connecting"
    }
  },
  "event.joinSession.connected": {
    "joinId": "a7e90b24-5c3d-4f81-b6a2-d4e8130f9c57",
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "instanceId": "inst-fabric",
    "state": {
      "type": "connected",
      "path": "relay",
      "rttMs": 64
    }
  },
  "event.joinSession.ended": {
    "joinId": "a7e90b24-5c3d-4f81-b6a2-d4e8130f9c57",
    "inviteId": "5d1c7a3e-6b24-4f08-9a1d-0c8e3b7f2a46",
    "instanceId": "inst-fabric",
    "state": {
      "type": "ended",
      "reason": "hostOffline"
    }
  },
  "event.lan": {
    "instanceId": "inst-fabric",
    "lan": {
      "port": 51234,
      "source": "mod",
      "pid": 18244
    }
  },
  "event.modConnection": {
    "instanceId": "inst-fabric",
    "connected": true
  },
  "event.modConfirm": {
    "requestId": "e3b1d5f7-2a46-4c80-9e17-6f4a2d8b0c93",
    "instanceId": "inst-fabric",
    "instanceName": "Fabric 26.3",
    "friends": [
      {
        "friendId": "3f9ac02177de01b49d5e8c7a21f06b3344aa90bc12de56f7081926a3b4c5d6e7",
        "displayName": "Alex"
      },
      {
        "friendId": "a1b2c3d4e5f60718293a4b5c6d7e8f900112233445566778899aabbccddeeff0",
        "displayName": "Bea"
      }
    ],
    "scope": "share",
    "summary": {
      "op": "host.invite",
      "targetName": "Alex, Bea"
    }
  },
  "modActivityEntry": {
    "at": "2026-10-04T12:30:05Z",
    "instanceId": "inst-fabric",
    "scope": "social",
    "op": "friend.addByName",
    "targetName": "Alex",
    "ok": true
  },
  "event.modOpen": {
    "instanceId": "inst-fabric",
    "target": "requests"
  }
}/*JSON-END*/ satisfies FriendsFixtureTypes;
