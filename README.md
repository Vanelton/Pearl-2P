# Pearl-2P Signaling Server (Multi-Project Host Logic)
Um servidor de sinalização Opensource agnóstico, projetado para servir múltiplos projetos simultaneamente com lógica de descoberta automática de Host.

**Autores do código:** Vanelton Junior, Lucas de Morais
**Organização:** Vanelton Open Labs / Vanelton Media

## 📖 Como Funciona
Diferente de servidores simples que apenas trocam mensagens, o Pearl-2P gerencia Salas Virtuais. A lógica é focada na distribuição de IDs baseada em "Quem chegou primeiro".

- Host Automático: Ao enviar os dados do seu projeto, se a sala não existir, você se torna o Host.
- Conexão de Peers: Se a sala já existe, o servidor detecta o Host automaticamente e devolve o hostId para o novo peer.
- Isolamento: Projetos diferentes (MyGameRPG, ChatApp) nunca se misturam, mesmo usando o mesmo servidor.

## 🚀 API de Comunicação (JSON)

### 1. Conexão Inicial e Registro (Join Room)
Assim que conectar via WebSocket, envie este comando para registrar sua instância.

**Envio (Cliente -> Servidor):**
```json
{
  "type": "join-room",
  "payload": {
    "project": "NomeDoSeuJogoOuApp",
    "instance": "Versao1.0",
    "room": "SalaDoBoss" 
  }
}
```

**Resposta A - Se você for o PRIMEIRO (Host):**
```json
{
  "type": "room-created",
  "role": "host",
  "message": "Você é o Host. Aguardando peers..."
}
```

**Resposta B - Se já houver um Host na sala (Cliente):**
```json
{
  "type": "room-joined",
  "role": "client",
  "hostId": "id_do_host_detectado" 
}
```

O cliente recebe o hostId e deve iniciar imediatamente a Oferta WebRTC para este ID.

### 2. Sinalização P2P (Handshake)
Após receber o ID do Host (se for cliente) ou receber um Peer (se for Host), use o sistema de sinalização padrão.

**Envio (Você -> Outro):**
```json
{
  "type": "signal",
  "target": "ID_DO_DESTINATARIO", 
  "payload": { "sdp": "...", "type": "offer" }
}
```

(O campo target é preenchido com o hostId recebido no passo anterior ou o ID do peer que acabou de entrar).

### 3. Eventos de Controle
- peer-joined: Enviado ao Host quando um novo cliente entra na sala. Contém { peerId: "..." }.
- host-disconnected: Enviado aos Clientes se o Host fechar o jogo/app. A sala é destruída.

## 📦 Instalação
```bash
npm install
node pearl.js
```

## 🤝 Contribuindo
Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou pull requests para melhorar a arquitetura, adicionar suporte a Salas (Rooms) ou autenticação.

## 📄 Licença
Este projeto está licenciado sob a Licença MIT.
Copyright © 2025-Presente Vanelton Open Labs / Vanelton Media.