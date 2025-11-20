/**
 * ===========================================================================================
 * Pearl-2P (Signaling Server)
 * ORGANIZAÇÃO:     Vanelton Open Labs / Vanelton Media
 * VERSÃO:          1.0.0
 * LICENÇA:         MIT License
 *
 * DESCRIÇÃO:
 * O Pearl-2P é um servidor de sinalização (Signaling Server) robusto, leve e extensível
 * projetado para facilitar o handshake e a troca de candidatos ICE entre pares (peers)
 * em aplicações P2P (Peer-to-Peer), como WebRTC.
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
const crypto = require('crypto'); // Módulo nativo para gerar IDs únicos

// Configurações Padrão
const DEFAULT_PORT = 19950;
const PING_INTERVAL = 30000; // 30 segundos para heartbeat

/**
 * Classe Peer
 * Representa um cliente conectado ao servidor.
 */
class Peer {
    constructor(socket, id) {
        this.socket = socket;
        this.id = id;
        this.isAlive = true; // Usado para verificar se a conexão caiu
        this.room = null;    // Implementação futura para salas de chat/video
    }
}

/**
 * Classe Principal do Servidor de Sinalização
 */
class Pearl2PServer {
    constructor(port = DEFAULT_PORT) {
        this.port = port;
        this.server = http.createServer();
        this.wss = null;
        
        // Mapa para armazenar clientes conectados: Chave = ID, Valor = Instância de Peer
        this.peers = new Map();

        this.init();
    }

    /**
     * Inicializa o servidor HTTP e o WebSocket Server
     */
    init() {
        this.wss = new WebSocket.Server({ server: this.server });

        // Configura os eventos do servidor WebSocket
        this.wss.on('connection', (socket, req) => this.handleConnection(socket, req));
        
        // Inicia o intervalo de verificação de conexões (Heartbeat)
        this.startHeartbeat();

        // Inicia o servidor HTTP
        this.server.listen(this.port, () => {
            this.log(`Pearl-2P Server v1.0.0 rodando na porta ${this.port}`);
            this.log(`Vanelton Open Labs - Pronto para conexões.`);
        });
    }

    /**
     * Gerencia uma nova conexão de um cliente
     */
    handleConnection(socket, req) {
        // Gera um ID único para o peer (pode ser substituído por autenticação via token no futuro)
        const peerId = this.generateId();
        const peer = new Peer(socket, peerId);

        // Armazena o peer
        this.peers.set(peerId, peer);
        
        this.log(`Novo Peer conectado: ${peerId} (Total: ${this.peers.size})`);

        // Envia o ID de volta para o cliente para que ele saiba quem é
        this.send(peer, {
            type: 'welcome',
            id: peerId,
            message: 'Bem-vindo ao Pearl-2P Network'
        });

        // Configuração de eventos do Socket específico
        socket.on('message', (message) => this.handleMessage(peer, message));
        
        socket.on('close', () => this.handleDisconnect(peer));
        
        socket.on('error', (error) => {
            this.log(`Erro no Peer ${peerId}: ${error.message}`, 'ERROR');
        });

        // Heartbeat: responde ao pong
        socket.on('pong', () => {
            peer.isAlive = true;
        });
    }

    /**
     * Processa mensagens recebidas dos clientes
     * O formato esperado é JSON: { type: "...", target: "targetId", payload: ... }
     */
    handleMessage(sender, messageData) {
        try {
            const data = JSON.parse(messageData);

            // Roteamento básico de mensagens
            switch (data.type) {
                case 'signal':
                    // Encaminha ofertas SDP, respostas e candidatos ICE
                    this.routeSignal(sender, data);
                    break;
                
                case 'broadcast':
                    // Exemplo de implementação futura: enviar para todos
                    this.broadcast(sender, data.payload);
                    break;

                default:
                    this.log(`Tipo de mensagem desconhecido recebido de ${sender.id}: ${data.type}`, 'WARN');
            }

        } catch (error) {
            this.log(`Falha ao processar mensagem de ${sender.id}: ${error.message}`, 'ERROR');
        }
    }

    /**
     * Lógica de Roteamento P2P (Signaling)
     * Envia a mensagem exclusivamente para o Peer alvo definido em 'data.target'
     */
    routeSignal(sender, data) {
        const targetId = data.target;
        const targetPeer = this.peers.get(targetId);

        if (targetPeer) {
            this.send(targetPeer, {
                type: 'signal',
                sender: sender.id,
                payload: data.payload // Conteúdo WebRTC (SDP ou ICE Candidate)
            });
            // this.log(`Sinalização de ${sender.id} -> ${targetId}`); // Descomentar para debug verboso
        } else {
            // Avisa o remetente que o alvo não existe
            this.send(sender, {
                type: 'error',
                code: 404,
                message: 'Peer alvo não encontrado ou desconectado.'
            });
        }
    }

    /**
     * Gerencia a desconexão de um cliente
     */
    handleDisconnect(peer) {
        this.peers.delete(peer.id);
        this.log(`Peer desconectado: ${peer.id} (Total: ${this.peers.size})`);
        
        // Opcional: Notificar outros peers que este usuário saiu (útil para salas)
    }

    /**
     * Envia uma mensagem formatada em JSON para um peer específico
     */
    send(peer, data) {
        if (peer.socket.readyState === WebSocket.OPEN) {
            peer.socket.send(JSON.stringify(data));
        }
    }

    /**
     * Envia mensagem para todos, exceto o remetente (Opcional)
     */
    broadcast(sender, payload) {
        this.peers.forEach((peer) => {
            if (peer.id !== sender.id) {
                this.send(peer, {
                    type: 'broadcast',
                    sender: sender.id,
                    payload: payload
                });
            }
        });
    }

    /**
     * Sistema de Heartbeat para manter conexões vivas e limpar mortas
     */
    startHeartbeat() {
        setInterval(() => {
            this.peers.forEach((peer) => {
                if (peer.isAlive === false) {
                    this.log(`Peer ${peer.id} inativo. Encerrando conexão.`);
                    return peer.socket.terminate();
                }

                peer.isAlive = false;
                peer.socket.ping(); // Envia ping, espera pong (tratado no handleConnection)
            });
        }, PING_INTERVAL);
    }

    /**
     * Utilitário: Gera um ID curto e aleatório
     */
    generateId() {
        return crypto.randomBytes(4).toString('hex');
    }

    /**
     * Utilitário: Logger simples com Timestamp
     */
    log(message, level = 'INFO') {
        const timestamp = new Date().toISOString();
        console.log(`[${timestamp}] [${level}] ${message}`);
    }
}

// Inicialização da Instância (Singleton Pattern logic)
const app = new Pearl2PServer(process.env.PORT || DEFAULT_PORT);

// Tratamento de erros globais para não derrubar o servidor
process.on('uncaughtException', (err) => {
    console.error('Erro não tratado:', err);
});