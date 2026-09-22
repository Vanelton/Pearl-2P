# Pearl-2P Signaling Server

Um servidor de sinalização open-source e agnóstico, projetado para servir múltiplos projetos simultaneamente com lógica automática de descoberta de Host.

**Autores do código:** Vanelton Junior, Lucas de Morais
**Organização:** Vanelton Open Labs / Vanelton Media

## 📖 Como Funciona

O Pearl-2P gerencia salas virtuais e facilita a comunicação inicial entre peers que ainda não possuem uma conexão direta.

A identificação de uma sala é feita através de três informações:

* `project`: identifica o projeto.
* `instance`: identifica a instância do projeto.
* `key`: identifica a sala dentro daquela instância.

A estrutura é:

```text
PROJECT -> INSTANCE -> KEY
```

### Host Automático

Ao tentar entrar em uma sala:

* Se a sala não existir, o peer se torna automaticamente o Host.
* Se a sala já existir, o peer entra como Cliente e recebe o `hostId`.
* O Host é responsável pela comunicação P2P com os demais peers.

### Isolamento

Projetos diferentes podem utilizar o mesmo servidor Pearl-2P sem misturar suas salas.

Por exemplo:

```text
game-a#production#room123
game-b#production#room123
```

São salas diferentes porque pertencem a projetos diferentes.

### Metadata

As salas também podem possuir um objeto `metadata`.

O Pearl-2P não define sua estrutura e não depende de seus campos. Os dados são armazenados e retornados pelo servidor para que o projeto possa utilizá-los conforme sua própria necessidade.

Exemplo:

```json
{
  "metadata": {
    "name": "My Room",
    "mode": 1,
    "players": 4
  }
}
```

---

# 🚀 API de Comunicação (JSON)

## 1. Conexão Inicial

Ao estabelecer uma conexão WebSocket, o servidor envia automaticamente um `welcome` contendo o ID atribuído ao peer.

**Servidor → Cliente:**

```json
{
  "type": "welcome",
  "id": "a7f3b9c1",
  "message": "Connected to Pearl-2P. Waiting for room data (join-room)."
}
```

O `id` recebido identifica o peer durante aquela conexão.

---

## 2. Criar ou Entrar em uma Sala

Para criar ou entrar em uma sala, envie `join-room`.

**Cliente → Servidor:**

```json
{
  "type": "join-room",
  "payload": {
    "project": "MyGame",
    "instance": "production",
    "key": "room123",
    "metadata": {
      "name": "My Room",
      "mode": 1
    }
  }
}
```

`project` e `key` são obrigatórios.

`instance` é opcional. Caso não seja informado, o servidor utiliza:

```text
default
```

`metadata` também é opcional.

---

## 3. Resposta do Host

Se a sala ainda não existir, o peer se torna automaticamente o Host.

**Servidor → Cliente:**

```json
{
  "type": "room-created",
  "role": "host",
  "project": "MyGame",
  "instance": "production",
  "key": "room123",
  "metadata": {
    "name": "My Room",
    "mode": 1
  }
}
```

O primeiro peer a entrar na sala assume o papel de Host.

---

## 4. Resposta do Cliente

Se a sala já existir, o peer entra como Cliente.

**Servidor → Cliente:**

```json
{
  "type": "room-joined",
  "role": "client",
  "project": "MyGame",
  "instance": "production",
  "key": "room123",
  "hostId": "a7f3b9c1",
  "metadata": {
    "name": "My Room",
    "mode": 1
  }
}
```

O `hostId` identifica o Host atual da sala.

O cliente pode então iniciar a sinalização WebRTC com esse peer.

---

# 🔎 5. Listagem de Salas

O Pearl-2P permite consultar as salas atualmente ativas através de `list-rooms`.

**Cliente → Servidor:**

```json
{
  "type": "list-rooms",
  "payload": {
    "project": "MyGame",
    "instance": "production"
  }
}
```

Os filtros `project` e `instance` são opcionais.

Para solicitar todas as salas:

```json
{
  "type": "list-rooms"
}
```

### Resposta

**Servidor → Cliente:**

```json
{
  "type": "rooms-list",
  "total": 1,
  "rooms": [
    {
      "project": "MyGame",
      "instance": "production",
      "key": "room123",
      "hostId": "a7f3b9c1",
      "peerCount": 4,
      "metadata": {
        "name": "My Room",
        "mode": 1
      }
    }
  ]
}
```

A listagem retorna o `metadata` armazenado junto com cada sala.

Isso permite que o próprio cliente determine quais informações deseja exibir ou utilizar.

---

# 🔗 6. Sinalização P2P

Depois que os peers conhecerem seus respectivos IDs, o Pearl-2P pode ser utilizado para encaminhar mensagens de sinalização WebRTC.

**Cliente → Servidor:**

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

O servidor encaminha o conteúdo ao peer especificado.

**Servidor → Cliente:**

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

O Pearl-2P não interpreta o conteúdo de `payload`. Ele apenas realiza o encaminhamento entre os peers.

---

# 📡 7. Mensagens de Dados

Também é possível encaminhar dados genéricos entre peers através de `data`.

**Cliente → Servidor:**

```json
{
  "type": "data",
  "target": "ID_DO_DESTINATARIO",
  "payload": {
    "message": "Hello!"
  }
}
```

O servidor encaminhará:

```json
{
  "type": "data",
  "sender": "ID_DO_REMETENTE",
  "payload": {
    "message": "Hello!"
  }
}
```

O conteúdo de `payload` é definido pelo projeto.

---

# 👥 8. Eventos da Sala

## peer-joined

Enviado ao Host quando um novo peer entra na sala.

```json
{
  "type": "peer-joined",
  "peerId": "b8c4d2e1"
}
```

O Host pode utilizar o `peerId` para iniciar a sinalização WebRTC.

---

## peer-left

Enviado ao Host quando um Cliente deixa a sala.

```json
{
  "type": "peer-left",
  "peerId": "b8c4d2e1"
}
```

---

## host-disconnected

Enviado aos Clientes quando o Host se desconecta.

```json
{
  "type": "host-disconnected",
  "message": "The Host has ended the session."
}
```

Quando o Host sai, a sala é encerrada.

---

# ❌ 9. Erros

Quando uma operação não pode ser executada, o servidor pode responder com:

```json
{
  "type": "error",
  "code": 400,
  "message": "Missing data: project and key are required."
}
```

Códigos utilizados pelo servidor incluem:

* `400` — dados inválidos ou incompletos.
* `404` — peer de destino não encontrado.

---

# 📦 Instalação

Clone o repositório e instale as dependências:

```bash
npm install
```

Inicie o servidor:

```bash
node pearl.js
```

Por padrão, o servidor utiliza a porta:

```text
19950
```

Também é possível definir uma porta através da variável de ambiente `PORT`:

```bash
PORT=3000 node pearl.js
```

---

# 🛠️ Dependências

O Pearl-2P foi desenvolvido para possuir uma estrutura simples e poucas dependências.

A principal dependência é:

```text
ws
```

---

# 🤝 Contribuindo

Contribuições são bem-vindas.

Issues, sugestões e pull requests podem ser utilizados para propor melhorias, correções e novas funcionalidades para o projeto.

---

# 📄 Licença

Este projeto está licenciado sob a Licença MIT.

Copyright © 2026-Presente Vanelton Open Labs / Vanelton Media.
