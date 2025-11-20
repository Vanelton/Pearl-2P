# Pearl-2P Signaling Server
Um servidor de sinalização leve, robusto e extensível para conexões P2P.

**Autoria do código:** Vanelton Junior e Lucas de Morais
Distribuido sob nome da **Vanelton Open Labs / Vanelton Media**.

# 📖 Sobre
O Pearl-2P é a espinha dorsal para qualquer aplicação que deseje implementar comunicação Peer-to-Peer (WebRTC) sem a complexidade de frameworks pesados. Ele atua como o ponto de encontro inicial, permitindo que clientes (browsers, dispositivos IoT, servidores) troquem as informações necessárias (SDP Offers, Answers, ICE Candidates) para estabelecerem uma conexão direta entre si.

## Características

- Minimalista: Dependência apenas da biblioteca ws.
- Extensível: Código estruturado em classes com métodos claros para fácil adição de funcionalidades (como autenticação ou salas).
- Resiliente: Sistema de Heartbeat (Ping/Pong) para detectar e limpar conexões fantasmas.
- Agnóstico: Funciona com qualquer biblioteca WebRTC no front-end (Vanilla JS, simple-peer, React-WebRTC, etc).

## 🚀 Instalação e Execução

### Pré-requisitos

**Node.js (v14 ou superior recomendado)**
1. Clone este repositório ou baixe os arquivos.

2. Instale a dependência do WebSocket:

```bash
npm init -y
npm install ws
```

3. Execute o servidor:
```bash
node pearl.js
```

O servidor iniciará na porta 19950 por padrão.

## 🔌 Protocolo de Comunicação (API)
O servidor utiliza WebSockets. Todas as mensagens devem ser enviadas em formato JSON stringified.

1. Conectando (Client -> Server)

Ao se conectar, o servidor envia automaticamente um evento de boas-vindas contendo o seu ID.

Resposta do Servidor:
```json
{
  "type": "welcome",
  "id": "a1b2c3d4",
  "message": "Bem-vindo ao Pearl-2P Network"
}
```

2. Sinalização P2P (Signal)

Use este tipo de mensagem para enviar dados WebRTC (Offer, Answer ou Candidate) para outro peer.

Envio (Client A -> Server):
```json
{
  "type": "signal",
  "target": "ID_DO_DESTINATARIO",
  "payload": {
      "sdp": "...",
      "type": "offer" 
  }
}
```

Recebimento (Server -> Client B):
```json
{
  "type": "signal",
  "sender": "ID_DO_REMETENTE",
  "payload": {
      "sdp": "...",
      "type": "offer"
  }
}
```

3. Tratamento de Erros

Se você tentar enviar uma mensagem para um ID que não existe:

Resposta do Servidor:
```json
{
  "type": "error",
  "code": 404,
  "message": "Peer alvo não encontrado ou desconectado."
}
```

## 💻 Exemplo de Cliente (JavaScript / Browser)
```javascript
const ws = new WebSocket('ws://localhost:8080');
let myId = null;

ws.onmessage = (event) => {
    const data = JSON.parse(event.data);

    switch (data.type) {
        case 'welcome':
            myId = data.id;
            console.log(`Conectado! Meu ID é: ${myId}`);
            break;
            
        case 'signal':
            console.log(`Recebido sinal de ${data.sender}:`, data.payload);
            // Aqui você injeta o sinal no seu objeto WebRTC (RTCPeerConnection)
            break;
    }
};

// Exemplo: Enviando uma oferta para outro ID (supondo que você saiba o ID)
function sendOffer(targetId, offerData) {
    ws.send(JSON.stringify({
        type: 'signal',
        target: targetId,
        payload: offerData
    }));
}
```


## 🤝 Contribuindo
Contribuições são bem-vindas! Sinta-se à vontade para abrir issues ou pull requests para melhorar a arquitetura, adicionar suporte a Salas (Rooms) ou autenticação.

## 📄 Licença

Este projeto está licenciado sob a Licença MIT.

Copyright © 2025-Presente Vanelton Open Labs / Vanelton Media.