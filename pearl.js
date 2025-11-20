/**
 * ===========================================================================================
 * Pearl-2P (Signaling Server)
 * ORGANIZAÇÃO:     Vanelton Open Labs / Vanelton Media
 * VERSÃO:          1.0.1
 * LICENÇA:         MIT License
 *
 * DESCRIÇÃO:
 * O Pearl-2P é um servidor de sinalização agnóstico.
 * Ele permite que múltiplos projetos utilizem o mesmo servidor WebSocket.
 * A conexão é baseada na estrutura: PROJETO -> INSTÂNCIA -> SALA.
 *
 * Este servidor atua como um intermediário para que dois clientes, que ainda não se conhecem,
 * possam trocar informações de rede e mídia antes de estabelecerem uma conexão direta.
 *
 * CARACTERÍSTICAS:
 * - Arquitetura baseada em Eventos e Classes.
 * - Dependências mínimas (apenas 'ws').
 * - Suporte a salas (rooms) ou conexões diretas por ID.
 * - Logs estruturados para depuração.
 *
 * DESENVOLVEDORES & COLABORADORES:
 * - Vanelton Open Labs
 * - Vanelton Media
 *
 * ===========================================================================================
 */

const WebSocket = require('ws');
const http = require('http');
const crypto = require('crypto');

// Configurações Padrão
const DEFAULT_PORT = 19950;
const PING_INTERVAL = 30000; // 30 segundos para heartbeat

/**
 * Classe Peer
 * Representa um cliente conectado.
 */
class Peer {
    constructor(socket, id) {
        this.socket = socket;
        this.id = id;
        this.isAlive = true;
        
        // Metadados da Sala
        this.roomKey = null; // Chave única da sala (ex: projeto#instancia#sala)
        this.isHost = false; // Define se este peer é o dono da sala
    }
}

/**
 * Classe Principal do Servidor
 */
class Pearl2PServer {
    constructor(port = DEFAULT_PORT) {
        this.port = port;
        this.server = http.createServer();
        this.wss = null;
        
        // Mapa de Peers: ID -> Objeto Peer
        this.peers = new Map();
        
        // Mapa de Salas: RoomKey -> { hostId: String, peers: Set<String> }
        this.rooms = new Map();

        this.init();
    }

    init() {
        this.wss = new WebSocket.Server({ server: this.server });

        this.wss.on('connection', (socket) => this.handleConnection(socket));
        this.startHeartbeat();

        this.server.listen(this.port, () => {
            this.log(`Pearl-2P Server v2.0 rodando na porta ${this.port}`);
            this.log(`Modo: Host-Oriented (Multi-Project Support)`);
        });
    }

    handleConnection(socket) {
        const peerId = this.generateId();
        const peer = new Peer(socket, peerId);

        this.peers.set(peerId, peer);
        this.log(`Novo Peer conectado: ${peerId}`);

        // 1. Envia ID para o cliente saber quem é
        this.send(peer, {
            type: 'welcome',
            id: peerId,
            message: 'Conectado ao Pearl-2P. Aguardando dados da sala (join-room).'
        });

        socket.on('message', (message) => this.handleMessage(peer, message));
        socket.on('close', () => this.handleDisconnect(peer));
        socket.on('error', (err) => this.log(`Erro no Peer ${peerId}: ${err.message}`, 'ERROR'));
        socket.on('pong', () => { peer.isAlive = true; });
    }

    handleMessage(sender, messageData) {
        try {
            const data = JSON.parse(messageData);

            switch (data.type) {
                case 'join-room':
                    // Lógica principal: define quem é Host e quem é Cliente
                    this.handleJoinRoom(sender, data.payload);
                    break;

                case 'signal':
                    // Roteamento de WebRTC (SDP/ICE) direto entre IDs
                    this.routeSignal(sender, data);
                    break;
                
                // Caso precise enviar dados genéricos do jogo/app via server
                case 'data': 
                    this.routeData(sender, data);
                    break;

                default:
                    this.log(`Tipo desconhecido de ${sender.id}: ${data.type}`, 'WARN');
            }

        } catch (error) {
            this.log(`Erro ao processar msg de ${sender.id}: ${error.message}`, 'ERROR');
        }
    }

    /**
     * LÓGICA CENTRAL: Gerenciamento de Salas e Hosts
     * Payload esperado: { project: "nome", instance: "v1", room: "sala1" }
     */
    handleJoinRoom(peer, payload) {
        if (!payload || !payload.project || !payload.room) {
            return this.sendError(peer, 400, 'Dados de projeto/sala incompletos.');
        }

        // Cria uma chave única para isolar projetos diferentes
        const instance = payload.instance || 'default';
        const roomKey = `${payload.project}#${instance}#${payload.room}`;

        // Verifica se a sala já existe
        if (this.rooms.has(roomKey)) {
            // --- SALA EXISTE: Conectar como CLIENTE ---
            const roomData = this.rooms.get(roomKey);
            
            // Registra peer na sala
            roomData.peers.add(peer.id);
            peer.roomKey = roomKey;
            peer.isHost = false;

            this.log(`Peer ${peer.id} entrou na sala '${roomKey}' como CLIENTE.`);

            // 1. Avisa o peer quem é o HOST (para ele mandar o Offer)
            this.send(peer, {
                type: 'room-joined',
                role: 'client',
                room: payload.room,
                hostId: roomData.hostId // O peer usa isso para iniciar conexão P2P
            });

            // 2. Avisa o Host que alguém entrou (opcional, mas útil)
            const hostPeer = this.peers.get(roomData.hostId);
            if (hostPeer) {
                this.send(hostPeer, {
                    type: 'peer-joined',
                    peerId: peer.id
                });
            }

        } else {
            // --- SALA NÃO EXISTE: Criar como HOST ---
            const newRoom = {
                hostId: peer.id,
                peers: new Set() // Lista de outros peers na sala
            };

            this.rooms.set(roomKey, newRoom);
            peer.roomKey = roomKey;
            peer.isHost = true;

            this.log(`Sala criada: '${roomKey}' pelo Host ${peer.id}`);

            this.send(peer, {
                type: 'room-created',
                role: 'host',
                room: payload.room,
                message: 'Você é o Host. Aguardando peers...'
            });
        }
    }

    /**
     * Roteamento de Sinais (Offer, Answer, Candidate)
     */
    routeSignal(sender, data) {
        const targetId = data.target;
        const targetPeer = this.peers.get(targetId);

        if (targetPeer) {
            this.send(targetPeer, {
                type: 'signal',
                sender: sender.id, // Quem mandou (para o destinatário saber responder)
                payload: data.payload
            });
        } else {
            // Se o alvo não existe, avisa o remetente (pode ter desconectado)
            this.sendError(sender, 404, 'Peer alvo desconectado.');
        }
    }

    /**
     * Roteamento de dados genéricos (chat, estado simples)
     */
    routeData(sender, data) {
        const targetId = data.target;
        const targetPeer = this.peers.get(targetId);
        if (targetPeer) {
            this.send(targetPeer, {
                type: 'data',
                sender: sender.id,
                payload: data.payload
            });
        }
    }

    handleDisconnect(peer) {
        this.log(`Peer desconectado: ${peer.id}`);
        
        // Remove da lista global
        this.peers.delete(peer.id);

        if (peer.roomKey && this.rooms.has(peer.roomKey)) {
            const roomData = this.rooms.get(peer.roomKey);

            if (peer.isHost) {
                // CASO CRÍTICO: O Host saiu. 
                // Opção A: Derrubar a sala (mais seguro para sync de jogos).
                // Opção B: Migrar Host (complexo para WebRTC).
                // Vamos usar Opção A: Avisar a todos que a sala fechou.
                
                this.log(`HOST saiu da sala ${peer.roomKey}. Encerrando sala.`);
                
                roomData.peers.forEach(clientId => {
                    const clientPeer = this.peers.get(clientId);
                    if (clientPeer) {
                        this.send(clientPeer, { type: 'host-disconnected', message: 'O Host encerrou a sessão.' });
                        clientPeer.roomKey = null; // Reseta estado do cliente
                    }
                });

                this.rooms.delete(peer.roomKey);

            } else {
                // Apenas um cliente saiu
                roomData.peers.delete(peer.id);
                
                // Avisa o Host que o cliente saiu
                const hostPeer = this.peers.get(roomData.hostId);
                if (hostPeer) {
                    this.send(hostPeer, {
                        type: 'peer-left',
                        peerId: peer.id
                    });
                }
            }
        }
    }

    send(peer, data) {
        if (peer.socket.readyState === WebSocket.OPEN) {
            peer.socket.send(JSON.stringify(data));
        }
    }

    sendError(peer, code, msg) {
        this.send(peer, { type: 'error', code: code, message: msg });
    }

    startHeartbeat() {
        setInterval(() => {
            this.peers.forEach((peer) => {
                if (peer.isAlive === false) return peer.socket.terminate();
                peer.isAlive = false;
                peer.socket.ping();
            });
        }, PING_INTERVAL);
    }

    generateId() { return crypto.randomBytes(4).toString('hex'); }

    log(message, level = 'INFO') {
        console.log(`[${new Date().toISOString()}] [${level}] ${message}`);
    }
}

// Inicialização
const app = new Pearl2PServer(process.env.PORT || DEFAULT_PORT);