const WebSocket = require('ws');
const http = require('http');

class OSCRelayClient {
    constructor(serverUrl) {
        this.serverUrl = serverUrl;
        this.ws = null;
        this.messageHandlers = new Set();
        this.filters = new Set();
        this.schema = null;
        this.queryPort = parseInt(serverUrl.split(':')[2]) + 1;
    }

    async connect() {
        await this.fetchOSCSchema();
        this.ws = new WebSocket(this.serverUrl);

        this.ws.on('open', () => {
            console.log('Connected to OSC relay');
        });

        this.ws.on('message', (data) => {
            const message = JSON.parse(data);
            if (this.shouldProcessMessage(message)) {
                this.messageHandlers.forEach(handler => handler(message));
            }
        });

        this.ws.on('close', () => {
            console.log('Disconnected from OSC relay');
            setTimeout(() => this.connect(), 5000);
        });
    }

    async fetchOSCSchema() {
        try {
            const response = await fetch(`http://localhost:${this.queryPort}/avatar`);
            this.schema = await response.json();
            console.log('Loaded OSC schema:', Object.keys(this.schema).length, 'endpoints');
        } catch (err) {
            console.error('Failed to fetch OSC schema:', err);
        }
    }

    send(address, ...args) {
        if (this.schema && !this.schema[address]) {
            console.warn(`Unknown OSC address: ${address}`);
            return;
        }
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            const message = { address, args };
            if (this.shouldProcessMessage(message)) {
                this.ws.send(JSON.stringify(message));
            }
        }
    }

    onMessage(handler) {
        this.messageHandlers.add(handler);
    }

    addFilter(pattern) {
        this.filters.add(pattern);
    }

    shouldProcessMessage(message) {
        if (this.filters.size === 0) return true;
        return Array.from(this.filters).some(pattern => 
            message.address.match(new RegExp(pattern)));
    }
}

module.exports = OSCRelayClient;
