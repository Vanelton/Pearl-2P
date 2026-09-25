/**
 * ===========================================================================================
 * Pearl-2P (Signaling Server)
 * ORGANIZAÇÃO:     Vanelton Open Labs / Vanelton Media
 * VERSÃO:          1.1.1
 * LICENÇA:         MIT License
 *
 * DESCRIÇÃO:
 * O Pearl-2P é um servidor de sinalização agnóstico.
 *
 * A identificação de uma sala utiliza três propriedades:
 *
 *     PROJECT -> INSTANCE -> KEY
 *
 * `project` identifica o projeto ao qual a sala pertence.
 * `instance` permite separar diferentes instâncias dentro do mesmo projeto.
 * `key` identifica a sala dentro dessa combinação.
 *
 * A `instance` utiliza "default" quando não é informada.
 *
 * Informações adicionais podem ser armazenadas em `metadata`.
 * Sua estrutura é definida pelo cliente e não é interpretada pelo servidor.
 *
 * O servidor atua como intermediário para que clientes possam trocar
 * informações necessárias para estabelecer uma conexão direta.
 *
 * CARACTERÍSTICAS:
 * - Arquitetura baseada em eventos e classes.
 * - Dependência mínima (apenas `ws`).
 * - Suporte a múltiplos projetos e instâncias.
 * - Suporte a salas identificadas por `project`, `instance` e `key`.
 * - Metadata definido pelo cliente.
 * - Roteamento de sinalização WebRTC.
 * - Roteamento de dados.
 * - Listagem de salas ativas.
 * - Heartbeat para conexões.
 * - Logs estruturados.
 * - Suporte a saída explícita de sala (leave-room) sem desconectar o WebSocket.
 *
 * ===========================================================================================
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

// ===========================================================================================
// CONFIGURATION
// ===========================================================================================

const DEFAULT_PORT = 19950;

/**
 * Interval between heartbeat checks.
 */
const PING_INTERVAL = 30000;

// ===========================================================================================
// PEER
// ===========================================================================================

/**
 * Represents a connected client.
 */
class Peer {
    constructor(socket, id) {
        this.socket = socket;
        this.id = id;

        /**
         * Used by the heartbeat system to detect inactive connections.
         */
        this.isAlive = true;

        /**
         * Internal identifier of the room this peer belongs to.
         */
        this.roomKey = null;

        /**
         * Whether this peer is the Host of its room.
         */
        this.isHost = false;
    }
}

// ===========================================================================================
// PEARL-2P SERVER
// ===========================================================================================

class Pearl2PServer {
    constructor(port = DEFAULT_PORT) {
        this.port = port;

        /**
         * HTTP server used as the underlying server for WebSocket connections.
         */
        this.server = http.createServer();

        this.wss = null;

        /**
         * Connected peers.
         *
         * peerId -> Peer
         */
        this.peers = new Map();

        /**
         * Active rooms.
         *
         * roomKey -> room data
         *
         * The internal room key is composed from:
         *
         *     project + instance + key
         */
        this.rooms = new Map();

        this.init();
    }

    // =======================================================================================
    // INITIALIZATION
    // =======================================================================================

    /**
     * Initializes the WebSocket server, connection events and heartbeat system.
     */
    init() {
        this.wss = new WebSocket.Server({
            server: this.server
        });

        this.wss.on(
            'connection',
            (socket) => this.handleConnection(socket)
        );

        this.startHeartbeat();

        this.server.listen(this.port, () => {
            this.log(
                `Pearl-2P Server v1.1.1 running on port ${this.port}`
            );

            this.log(
                `Mode: Host-Oriented (Multi-Project Support)`
            );
        });
    }

    // =======================================================================================
    // CONNECTION
    // =======================================================================================

    /**
     * Handles a new WebSocket connection.
     *
     * Each connection receives a short randomly generated peer ID.
     */
    handleConnection(socket) {
        const peerId = this.generateId();
        const peer = new Peer(socket, peerId);

        this.peers.set(peerId, peer);

        this.log(
            `New peer connected: ${peerId}`
        );

        /**
         * Sends the generated peer ID to the client.
         *
         * The client must use this ID when communicating with other peers
         * through the signaling server.
         */
        this.send(peer, {
            type: 'welcome',
            id: peerId,
            message: 'Connected to Pearl-2P. Waiting for room data (join-room).'
        });

        socket.on(
            'message',
            (message) => this.handleMessage(peer, message)
        );

        socket.on(
            'close',
            () => this.handleDisconnect(peer)
        );

        socket.on(
            'error',
            (err) => this.log(
                `Peer ${peerId} error: ${err.message}`,
                'ERROR'
            )
        );

        socket.on(
            'pong',
            () => {
                peer.isAlive = true;
            }
        );
    }

    // =======================================================================================
    // MESSAGE HANDLING
    // =======================================================================================

    /**
     * Processes messages received from clients.
     *
     * Supported message types:
     *
     * - join-room
     * - leave-room
     * - signal
     * - data
     * - list-rooms
     */
    handleMessage(sender, messageData) {
        try {
            const data = JSON.parse(messageData);

            switch (data.type) {
                case 'join-room':
                    this.handleJoinRoom(
                        sender,
                        data.payload
                    );
                    break;

                case 'leave-room':
                    this.handleLeaveRoom(sender);
                    break;

                case 'signal':
                    this.routeSignal(
                        sender,
                        data
                    );
                    break;

                case 'data':
                    this.routeData(
                        sender,
                        data
                    );
                    break;

                case 'list-rooms':
                    this.handleListRooms(
                        sender,
                        data.payload
                    );
                    break;

                default:
                    this.log(
                        `Unknown message type from ${sender.id}: ${data.type}`,
                        'WARN'
                    );
                    break;
            }
        } catch (error) {
            this.log(
                `Error processing message from ${sender.id}: ${error.message}`,
                'ERROR'
            );
        }
    }

    // =======================================================================================
    // CREATE / JOIN ROOM
    // =======================================================================================

    /**
     * Creates a room or joins an existing one.
     *
     * Required properties:
     *
     *     project
     *     key
     *
     * Optional:
     *
     *     instance
     *     metadata
     *
     * `instance` defaults to "default".
     *
     * `metadata` is completely defined by the client and is stored and
     * returned by the server without interpreting its contents.
     */
    handleJoinRoom(peer, payload) {
        if (
            !payload ||
            !payload.project ||
            !payload.key
        ) {
            return this.sendError(
                peer,
                400,
                'Missing data: project and key are required.'
            );
        }

        const project = String(payload.project);
        const instance = String(
            payload.instance || 'default'
        );
        const key = String(payload.key);

        /**
         * Metadata must be an object.
         *
         * Arrays and other value types are not accepted as room metadata.
         */
        const metadata =
            payload.metadata &&
            typeof payload.metadata === 'object' &&
            !Array.isArray(payload.metadata)
                ? payload.metadata
                : {};

        /**
         * A room is uniquely identified by:
         *
         *     project + instance + key
         */
        const roomKey = `${project}#${instance}#${key}`;

        // ===================================================================================
        // EXISTING ROOM
        // ===================================================================================

        if (this.rooms.has(roomKey)) {
            const roomData = this.rooms.get(roomKey);

            /**
             * Existing rooms are Host-oriented.
             * New peers join as clients.
             */
            roomData.peers.add(peer.id);

            peer.roomKey = roomKey;
            peer.isHost = false;

            this.log(
                `Peer ${peer.id} joined room '${roomKey}' as CLIENT.`
            );

            /**
             * Sends the existing room information to the new client.
             *
             * The metadata belongs to the room created by the Host.
             * The metadata supplied by a joining client is therefore not used
             * to modify the existing room.
             */
            this.send(peer, {
                type: 'room-joined',
                role: 'client',
                project: roomData.project,
                instance: roomData.instance,
                key: roomData.key,
                hostId: roomData.hostId,
                metadata: roomData.metadata
            });

            /**
             * Notifies the Host that a new peer has joined.
             */
            const hostPeer = this.peers.get(
                roomData.hostId
            );

            if (hostPeer) {
                this.send(hostPeer, {
                    type: 'peer-joined',
                    peerId: peer.id
                });
            }

            return;
        }

        // ===================================================================================
        // NEW ROOM
        // ===================================================================================

        /**
         * The first peer to create the room becomes its Host.
         *
         * The Host owns the room session. If the Host disconnects,
         * the room is closed and the remaining clients are notified.
         */
        const newRoom = {
            project,
            instance,
            key,
            hostId: peer.id,

            /**
             * The Host is stored separately through `hostId`.
             * Only clients are stored in this Set.
             */
            peers: new Set(),

            /**
             * Metadata is stored exactly as provided by the client.
             */
            metadata
        };

        this.rooms.set(
            roomKey,
            newRoom
        );

        peer.roomKey = roomKey;
        peer.isHost = true;

        this.log(
            `Room created: '${roomKey}' by Host ${peer.id}`
        );

        /**
         * Confirms room creation to the Host.
         */
        this.send(peer, {
            type: 'room-created',
            role: 'host',
            project,
            instance,
            key,
            metadata
        });
    }

    // =======================================================================================
    // LEAVE ROOM
    // =======================================================================================

    /**
     * Handles a peer explicitly leaving a room without disconnecting the WebSocket.
     */
    handleLeaveRoom(peer) {
        if (!peer.roomKey || !this.rooms.has(peer.roomKey)) {
            return;
        }

        const roomData = this.rooms.get(peer.roomKey);

        if (peer.isHost) {
            /**
             * The Host owns the room.
             *
             * When the Host explicitly leaves, the room is destroyed.
             */
            this.log(
                `HOST ${peer.id} explicitly left room ${peer.roomKey}. Closing room.`
            );

            roomData.peers.forEach(
                (clientId) => {
                    const clientPeer = this.peers.get(
                        clientId
                    );

                    if (clientPeer) {
                        this.send(
                            clientPeer,
                            {
                                type: 'host-disconnected',
                                message: 'The Host has ended the session.'
                            }
                        );

                        clientPeer.roomKey = null;
                    }
                }
            );

            this.rooms.delete(
                peer.roomKey
            );
        } else {
            /**
             * A client is leaving. Remove them from the room and notify the Host.
             */
            this.log(
                `Client ${peer.id} explicitly left room ${peer.roomKey}.`
            );

            roomData.peers.delete(
                peer.id
            );

            peer.roomKey = null;
            peer.isHost = false;

            const hostPeer = this.peers.get(
                roomData.hostId
            );

            if (hostPeer) {
                this.send(
                    hostPeer,
                    {
                        type: 'peer-left',
                        peerId: peer.id
                    }
                );
            }
        }
    }

    // =======================================================================================
    // LIST ROOMS
    // =======================================================================================

    /**
     * Returns the active rooms visible to the requesting client.
     *
     * `project` and `instance` can optionally be used as filters.
     */
    handleListRooms(peer, payload = {}) {
        const roomsList = [];

        this.rooms.forEach(
            (roomData) => {
                if (
                    payload.project &&
                    payload.project !== roomData.project
                ) {
                    return;
                }

                if (
                    payload.instance &&
                    payload.instance !== roomData.instance
                ) {
                    return;
                }

                roomsList.push({
                    project: roomData.project,
                    instance: roomData.instance,
                    key: roomData.key,
                    hostId: roomData.hostId,

                    /**
                     * The Host is not included in the peer Set,
                     * so it is added to the client count here.
                     */
                    peerCount: roomData.peers.size + 1,

                    metadata: roomData.metadata
                });
            }
        );

        this.send(peer, {
            type: 'rooms-list',
            total: roomsList.length,
            rooms: roomsList
        });

        this.log(
            `Peer ${peer.id} requested room list (${roomsList.length} found).`
        );
    }

    // =======================================================================================
    // SIGNAL ROUTING
    // =======================================================================================

    /**
     * Routes WebRTC signaling messages between peers.
     *
     * The server does not interpret the signaling payload.
     * It only forwards it to the peer identified by `target`.
     */
    routeSignal(sender, data) {
        const targetId = data.target;
        const targetPeer = this.peers.get(targetId);

        if (targetPeer) {
            this.send(
                targetPeer,
                {
                    type: 'signal',
                    sender: sender.id,
                    payload: data.payload
                }
            );
        } else {
            this.sendError(
                sender,
                404,
                'Target peer is disconnected.'
            );
        }
    }

    // =======================================================================================
    // DATA ROUTING
    // =======================================================================================

    /**
     * Routes generic application data between peers.
     *
     * Like signaling messages, the payload is not interpreted by the server.
     */
    routeData(sender, data) {
        const targetId = data.target;
        const targetPeer = this.peers.get(targetId);

        if (targetPeer) {
            this.send(
                targetPeer,
                {
                    type: 'data',
                    sender: sender.id,
                    payload: data.payload
                }
            );
        }
    }

    // =======================================================================================
    // DISCONNECTION
    // =======================================================================================

    /**
     * Handles a disconnected peer.
     */
    handleDisconnect(peer) {
        this.log(
            `Peer disconnected: ${peer.id}`
        );

        this.peers.delete(peer.id);

        /**
         * The peer was not inside a room.
         */
        if (
            !peer.roomKey ||
            !this.rooms.has(peer.roomKey)
        ) {
            return;
        }

        const roomData = this.rooms.get(
            peer.roomKey
        );

        // ===================================================================================
        // HOST DISCONNECTED
        // ===================================================================================

        if (peer.isHost) {
            /**
             * The Host owns the room.
             *
             * When the Host disconnects, the room is destroyed because
             * there is no Host migration mechanism.
             */
            this.log(
                `HOST disconnected from room ${peer.roomKey}. Closing room.`
            );

            roomData.peers.forEach(
                (clientId) => {
                    const clientPeer = this.peers.get(
                        clientId
                    );

                    if (clientPeer) {
                        this.send(
                            clientPeer,
                            {
                                type: 'host-disconnected',
                                message: 'The Host has ended the session.'
                            }
                        );

                        clientPeer.roomKey = null;
                    }
                }
            );

            this.rooms.delete(
                peer.roomKey
            );

            return;
        }

        // ===================================================================================
        // CLIENT DISCONNECTED
        // ===================================================================================

        roomData.peers.delete(
            peer.id
        );

        /**
         * Only the Host needs to be notified about a client leaving.
         */
        const hostPeer = this.peers.get(
            roomData.hostId
        );

        if (hostPeer) {
            this.send(
                hostPeer,
                {
                    type: 'peer-left',
                    peerId: peer.id
                }
            );
        }
    }

    // =======================================================================================
    // SEND
    // =======================================================================================

    /**
     * Sends a JSON message to a peer when its WebSocket is open.
     */
    send(peer, data) {
        if (
            peer &&
            peer.socket.readyState === WebSocket.OPEN
        ) {
            peer.socket.send(
                JSON.stringify(data)
            );
        }
    }

    // =======================================================================================
    // ERROR
    // =======================================================================================

    /**
     * Sends a standardized error response to a peer.
     */
    sendError(peer, code, msg) {
        this.send(
            peer,
            {
                type: 'error',
                code,
                message: msg
            }
        );
    }

    // =======================================================================================
    // HEARTBEAT
    // =======================================================================================

    /**
     * Periodically checks whether connected peers are still responsive.
     *
     * Peers that fail to respond to the heartbeat are terminated.
     */
    startHeartbeat() {
        setInterval(
            () => {
                this.peers.forEach(
                    (peer) => {
                        if (peer.isAlive === false) {
                            return peer.socket.terminate();
                        }

                        peer.isAlive = false;

                        peer.socket.ping();
                    }
                );
            },
            PING_INTERVAL
        );
    }

    // =======================================================================================
    // ID GENERATION
    // =======================================================================================

    /**
     * Generates a short random ID for a peer.
     */
    generateId() {
        return crypto
            .randomBytes(4)
            .toString('hex');
    }

    // =======================================================================================
    // LOG
    // =======================================================================================

    /**
     * Writes a timestamped structured message to the console.
     */
    log(message, level = 'INFO') {
        console.log(
            `[${new Date().toISOString()}] [${level}] ${message}`
        );
    }
}

// ===========================================================================================
// START SERVER
// ===========================================================================================

/**
 * Uses the PORT environment variable when available.
 * Falls back to the default port otherwise.
 */
const app = new Pearl2PServer(
    process.env.PORT || DEFAULT_PORT
);
