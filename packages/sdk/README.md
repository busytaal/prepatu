# @prepatu/sdk

JavaScript/TypeScript SDK for [Prepatu](https://prepatu.com) voice flows — managed cloud and self-hosted.

## Install

```bash
npm install @prepatu/sdk
```

## Usage

### Managed (Prepatu Cloud)

```ts
import { Prepatu } from '@prepatu/sdk';

const agent = await Prepatu.createAgent({
  apiKey: 'pk_live_...',
  flowId: 'my-flow-id',   // optional
});

agent.on('message', (msg) => console.log(msg));
agent.on('status',  (s)   => console.log('status:', s));
agent.on('audio',   (buf) => /* feed to AudioContext */);

await agent.connect();
```

### Self-hosted

```ts
const agent = await Prepatu.createAgent({
  backendUrl: 'ws://localhost:8000',
});

await agent.connect();
```

### Credit balance

```ts
const balance = await agent.getBalance();
console.log(balance.balance_usd_cents);
```

## API

### `Prepatu.createAgent(options)`

| Option | Type | Description |
|---|---|---|
| `apiKey` | `string` | Managed mode — your Prepatu API key |
| `flowId` | `string?` | Flow to run (managed mode) |
| `backendUrl` | `string` | Self-hosted mode — WebSocket URL |
| `metadata` | `Record<string,string>?` | Session metadata passed to the flow |

### `agent.connect()` / `agent.disconnect()`

Open or close the WebSocket connection.

### `agent.send(msg)` / `agent.sendAudio(buffer)`

Send a JSON message or raw PCM16 audio to the pipeline.

### `agent.on(event, cb)` / `agent.off(event, cb)`

Events: `message`, `status`, `audio`, `error`

## License

MIT
